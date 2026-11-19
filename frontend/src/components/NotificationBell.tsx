import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import { useAuth } from '../auth'
import { Roles, type Contract, type Invoice } from '../types'
import { Icon } from './ui'

const daysUntil = (iso: string) => Math.ceil((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
const ago = (iso: string) => {
  const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000)
  return d <= 0 ? 'Hôm nay' : d === 1 ? '1 ngày trước' : `${d} ngày trước`
}

const REFRESH_MS = 30_000

type Note = { key: string; tone: 'warn' | 'bad'; icon: string; title: string; when: string; text: string; to: string; action: string }

/**
 * Customer's bell in the top-right of the header (replaces "Thông Báo Mới Nhất" on Kho của tôi):
 * bills to pay (deposits excluded, they have their own banner) and contracts ending within 45 days.
 * Built from GET /api/invoices/my and GET /api/contracts/my, reloaded on each page change, when the bell is opened,
 * when the tab regains focus and every 30 seconds while the tab is visible.
 */
export function NotificationBell() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const customer = user?.role === Roles.Customer

  // Fetch the latest bills and contracts. Failures keep what is shown, so a network blip does not empty the bell.
  const refresh = useCallback(() => {
    if (!customer) return
    api<Contract[]>('/api/contracts/my').then(setContracts).catch(() => {})
    api<Invoice[]>('/api/invoices/my').then(setInvoices).catch(() => {})
  }, [customer])

  // On every page change.
  useEffect(() => { setOpen(false); refresh() }, [refresh, pathname])

  // Keep it current while the customer stays on one page: every 30 seconds while the tab is visible,
  // and right away when they come back to the tab (a payment finished in another tab, staff confirmed something).
  useEffect(() => {
    if (!customer) return
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = window.setInterval(tick, REFRESH_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [customer, refresh])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!customer) return null
  const unitOf = (i: Invoice) => contracts.find((c) => c.contractId === i.contractId)?.unitCode
  const notes: Note[] = [
    ...invoices.filter((i) => (i.status === 'Unpaid' || i.status === 'Overdue') && i.invoiceType !== 'DEPOSIT').map<Note>((i) => ({
      key: `i${i.invoiceId}`, tone: i.status === 'Overdue' ? 'bad' : 'warn', icon: 'wallet',
      title: i.status === 'Overdue' ? 'Hóa đơn quá hạn' : 'Yêu cầu thanh toán', when: ago(i.createdAt),
      text: `${unitOf(i) ? `Kho ${unitOf(i)} · ` : ''}${i.invoiceNumber}: ${fmtMoney(i.totalAmount)}, hạn ${fmtDate(i.dueDate)}.`,
      to: `/invoices/${i.invoiceId}`, action: 'Thanh toán',
    })),
    ...contracts.filter((c) => c.status === 'Active' && daysUntil(c.endDate) <= 45).map<Note>((c) => ({
      key: `c${c.contractId}`, tone: 'bad', icon: 'alert', title: 'Sắp hết hạn hợp đồng', when: `Còn ${daysUntil(c.endDate)} ngày`,
      text: `Kho ${c.unitCode} hết hạn thuê ngày ${fmtDate(c.endDate)}.`, to: `/my-units/${c.contractId}/renew`, action: 'Gửi yêu cầu gia hạn',
    })),
  ]

  return (
    <div className="bell" ref={box}>
      <button type="button" className="icon-btn bell-btn" aria-label={`Thông báo${notes.length ? ` (${notes.length})` : ''}`} aria-expanded={open} onClick={() => { if (!open) refresh(); setOpen(!open) }}>
        <Icon name="bell" size={20} />
        {notes.length > 0 && <span className="bell-count">{notes.length > 9 ? '9+' : notes.length}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="dialog" aria-label="Thông báo">
          <div className="bell-head"><b>Thông báo</b>{notes.length > 0 && <small className="muted">{notes.length} mới</small>}</div>
          <div className="bell-list">
            {notes.map((n) => (
              <Link key={n.key} to={n.to} className="bell-item" onClick={() => setOpen(false)}>
                <span className={`notice-icon ${n.tone}`}><Icon name={n.icon} size={15} /></span>
                <span className="grow">
                  <span className="notice-head"><b>{n.title}</b><small>{n.when}</small></span>
                  <small className="block">{n.text}</small>
                  <small className="link">{n.action} →</small>
                </span>
              </Link>
            ))}
            {notes.length === 0 && <p className="muted bell-empty">Không có thông báo mới.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
