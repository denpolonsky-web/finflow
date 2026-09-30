import { v4 as uuid } from 'uuid'
import { supabase } from './supabase'

const TOKEN_KEY = 'finflow_device_token'
const NAME_KEY  = 'finflow_device_name'

// Get or create a persistent device token
export function getDeviceToken(): string {
  let token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    token = uuid()
    localStorage.setItem(TOKEN_KEY, token)
  }
  return token
}

export function getDeviceName(): string {
  return localStorage.getItem(NAME_KEY) ?? 'Устройство'
}

export function setDeviceName(name: string) {
  localStorage.setItem(NAME_KEY, name)
}

// Register device in Supabase on first launch / each session
export async function registerDevice() {
  if (!supabase) return
  const token = getDeviceToken()
  const name  = getDeviceName()

  await supabase.from('devices').upsert({
    id:        token,
    token:     token,
    name:      name,
    last_seen: new Date().toISOString(),
  }, { onConflict: 'id' })
}

// Validate token — returns true if this device is known
export async function validateDevice(): Promise<boolean> {
  if (!supabase) return true  // offline mode — always allow
  const token = getDeviceToken()
  const { data } = await supabase
    .from('devices')
    .select('id')
    .eq('token', token)
    .single()
  return !!data
}
