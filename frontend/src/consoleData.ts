// Data helpers shared by the admin and operations-manager screens that sum up the whole system.
import { api } from './api'
import type { AdminContract } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** First and last day of the month `offset` months from now; the current month ends today. */
export function monthRange(offset = 0): { from: string; to: string; label: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = offset === 0 ? now : new Date(first.getFullYear(), first.getMonth() + 1, 0)
  return { from: iso(first), to: iso(last), label: `Tháng ${first.getMonth() + 1}` }
}

/** Whole days from today to a "yyyy-mm-dd" date (negative once it has passed). */
export function daysUntil(date: string): number {
  const today = new Date(iso(new Date()) + 'T00:00:00')
  return Math.round((new Date(date + 'T00:00:00').getTime() - today.getTime()) / 86400000)
}

/** Contracts the system is still running: active and overdue ones. */
export const LIVE_CONTRACT_STATUSES = ['Active', 'Overdue'] as const

/**
 * Every contract with the given status from GET /api/admin/contracts (system administrator only).
 * The API pages by 100 at most, so this keeps asking until a short page comes back.
 */
export async function fetchContracts(status?: string, maxPages = 20): Promise<AdminContract[]> {
  const all: AdminContract[] = []
  for (let page = 1; page <= maxPages; page++) {
    const p = new URLSearchParams({ page: String(page), pageSize: '100' })
    if (status) p.set('status', status)
    const rows = await api<AdminContract[]>(`/api/admin/contracts?${p}`)
    all.push(...rows)
    if (rows.length < 100) break
  }
  return all
}

/** "2 giờ trước", "3 ngày trước"… for activity feeds. */
export function timeAgo(date: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000))
  if (minutes < 1) return 'vừa xong'
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days} ngày trước` : new Date(date).toLocaleDateString('vi-VN')
}
