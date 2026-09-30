import { db } from './index'
import { supabase, hasSupabase } from './supabase'

export function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    category_id:     'categoryId',
    card_id:         'cardId',
    to_card_id:      'toCardId',
    created_at:      'createdAt',
    updated_at:      'updatedAt',
    synced_at:       'syncedAt',
    goal_id:         'goalId',
    last_four:       'lastFour',
    target_amount:   'targetAmount',
    current_amount:  'currentAmount',
    is_archived:     'isArchived',
    completed_at:    'completedAt',
    user_name:       'userName',
    daily_limit:     'dailyLimit',
    category_limits: 'categoryLimits',
    interest_rate:   'interestRate',
    expected_date:   'expectedDate',
    expected_amount: 'expectedAmount',
    is_active:       'isActive',
  }
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[map[k] ?? k] = v
  }
  return result
}

export async function pullFromSupabase(): Promise<void> {
  if (!hasSupabase || !navigator.onLine) return
  console.log('[Pull] starting...')
  try {
    // Settings
    const { data: settings } = await supabase!.from('app_settings').select('*').eq('id', 1).single()
    if (settings) {
      await db.settings.put(toCamelCase(settings as Record<string, unknown>) as never)
      console.log('[Pull] ✓ settings')
    }

    // Transactions
    const { data: txs, error: txErr } = await supabase!.from('transactions').select('*').order('created_at', { ascending: false }).limit(500)
    if (txErr) console.error('[Pull] tx error:', txErr)
    else if (txs?.length) {
      await db.transactions.bulkPut(txs.map(t => toCamelCase(t as Record<string, unknown>)) as never[])
      console.log('[Pull] ✓ transactions:', txs.length)
    }

    // Cards
    const { data: cards, error: cardsErr } = await supabase!.from('cards').select('*')
    if (cardsErr) console.error('[Pull] cards error:', cardsErr)
    else if (cards?.length) {
      await db.cards.bulkPut(cards.map(c => toCamelCase(c as Record<string, unknown>)) as never[])
      console.log('[Pull] ✓ cards:', cards.length)
    }

    // Goals
    const { data: goals, error: goalsErr } = await supabase!.from('goals').select('*')
    if (goalsErr) console.error('[Pull] goals error:', goalsErr)
    else if (goals?.length) {
      await db.goals.bulkPut(goals.map(g => toCamelCase(g as Record<string, unknown>)) as never[])
      console.log('[Pull] ✓ goals:', goals.length)
    }

    // Deposits
    const { data: deps, error: depsErr } = await supabase!.from('deposits').select('*')
    if (depsErr) console.error('[Pull] deposits error:', depsErr)
    else if (deps?.length) {
      await db.deposits.bulkPut(deps.map(d => toCamelCase(d as Record<string, unknown>)) as never[])
      console.log('[Pull] ✓ deposits:', deps.length)
    }

    console.log('[Pull] all done ✓')
  } catch (e) {
    console.error('[Pull] exception:', e)
  }
}
