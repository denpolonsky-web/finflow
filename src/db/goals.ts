import { v4 as uuid } from 'uuid'
import { db } from './index'
import { enqueue } from './queue'
import { addTransaction } from './transactions'
import { accountBalance } from './accounts'
import type { Goal, Minor } from '../types'

export interface GoalInput {
  title: string
  icon: string
  kind: Goal['kind']
  targetAmount: Minor
  fundingAccountId?: string | null
  manualAmount?: Minor
  cushionMonths?: number
  deadline?: string | null
  /**
   * Сколько уже накоплено на момент создания — база для темпа. Для цели на
   * счёте это текущий баланс счёта, для ручной — введённая сумма. Передаётся
   * вызывающим: ядро целей не ходит за балансами само.
   */
  startAmount?: Minor
}

export async function createGoal(i: GoalInput): Promise<Goal> {
  const now = new Date().toISOString()
  const goal: Goal = {
    id: uuid(),
    title: i.title.trim(),
    icon: i.icon || '🎯',
    kind: i.kind,
    targetAmount: i.targetAmount,
    fundingAccountId: i.fundingAccountId || null,
    manualAmount: i.manualAmount ?? 0,
    startAmount: i.startAmount ?? i.manualAmount ?? 0,
    cushionMonths: i.cushionMonths,
    deadline: i.deadline || null,
    isArchived: 0,
    createdAt: now,
    completedAt: null,
    updatedAt: now,
    deletedAt: null,
  }
  await db.goals.add(goal)
  await enqueue('goal', goal.id, 'upsert', goal)
  return goal
}

export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
  await db.goals.update(id, { ...patch, updatedAt: new Date().toISOString() })
  const fresh = await db.goals.get(id)
  if (fresh) await enqueue('goal', id, 'upsert', fresh)
}

export async function archiveGoal(id: string): Promise<void> {
  await updateGoal(id, { isArchived: 1 })
}

export async function deleteGoal(id: string): Promise<void> {
  await db.goals.delete(id)
  await enqueue('goal', id, 'delete', null)
}

/**
 * Пополнение цели. Если цель привязана к счёту — это НАСТОЯЩИЙ перевод денег,
 * а не увеличение счётчика: в прошлой версии цель и реальный баланс жили
 * в разных вселенных.
 */
export async function contributeToGoal(
  goal: Goal,
  amount: Minor,
  fromAccountId?: string,
): Promise<void> {
  if (amount <= 0) return
  if (goal.fundingAccountId && fromAccountId && fromAccountId !== goal.fundingAccountId) {
    await addTransaction({
      type: 'transfer',
      amount,
      categoryId: 'transfer',
      accountId: fromAccountId,
      toAccountId: goal.fundingAccountId,
      title: `В цель: ${goal.title}`,
      goalId: goal.id,
      source: 'goal',
    })
  } else {
    await updateGoal(goal.id, { manualAmount: goal.manualAmount + amount })
  }
}

/** Накоплено по цели: баланс привязанного счёта либо ручная сумма. */
export async function goalProgress(goal: Goal): Promise<Minor> {
  if (goal.fundingAccountId) return accountBalance(goal.fundingAccountId)
  return goal.manualAmount
}

/**
 * Моложе этого срока темп не считаем: по одной точке за несколько часов
 * экстраполировать нечего, а экран показывал бы заведомую чушь.
 */
export const MIN_RATE_DAYS = 7

export interface GoalPlan {
  current: Minor
  target: Minor
  pct: number
  remaining: Minor
  daysLeft: number | null
  /** сколько нужно откладывать в месяц, чтобы успеть к дедлайну */
  requiredMonthly: Minor | null
  /** фактический темп в месяц; null — данных пока недостаточно */
  actualMonthly: Minor | null
  /** прогноз даты достижения при текущем темпе */
  projectedDate: Date | null
  status: 'done' | 'on-track' | 'behind' | 'no-progress' | 'no-deadline' | 'too-early'
}

export function buildPlan(goal: Goal, current: Minor): GoalPlan {
  const target = goal.targetAmount
  const remaining = Math.max(0, target - current)
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0

  const dl = goal.deadline ? new Date(goal.deadline) : null
  const daysLeft = dl && !Number.isNaN(dl.getTime())
    ? Math.ceil((dl.getTime() - Date.now()) / 86_400_000)
    : null

  /**
   * Фактический темп считается от того, что накоплено ПОСЛЕ создания цели.
   *
   * Раньше в числителе стоял весь `current`, а для цели, привязанной к счёту,
   * current — это полный баланс счёта. Новая цель на счёте, где уже лежат
   * деньги, давала темп в миллионы в месяц, статус «В графике» и прогноз
   * даты, не имеющий отношения к реальности. Стартовую сумму из темпа
   * исключаем, а пока цель слишком молодая — темпа нет вовсе: по одной точке
   * за несколько часов экстраполировать нечего.
   */
  const ageDays = (Date.now() - new Date(goal.createdAt).getTime()) / 86_400_000
  const accumulated = goal.startAmount == null ? null : Math.max(0, current - goal.startAmount)
  const actualMonthly = accumulated != null && ageDays >= MIN_RATE_DAYS
    ? Math.round((accumulated / ageDays) * 30.44)
    : null

  const requiredMonthly = daysLeft != null && daysLeft > 0
    ? Math.ceil(remaining / (daysLeft / 30.44))
    : null

  const projectedDate = remaining > 0 && actualMonthly != null && actualMonthly > 0
    ? new Date(Date.now() + (remaining / actualMonthly) * 30.44 * 86_400_000)
    : null

  let status: GoalPlan['status']
  if (remaining === 0) status = 'done'
  else if (actualMonthly == null) status = 'too-early'
  else if (actualMonthly <= 0) status = 'no-progress'
  else if (requiredMonthly == null) status = 'no-deadline'
  else status = actualMonthly >= requiredMonthly ? 'on-track' : 'behind'

  return { current, target, pct, remaining, daysLeft, requiredMonthly, actualMonthly, projectedDate, status }
}
