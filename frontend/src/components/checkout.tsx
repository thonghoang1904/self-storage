import { useState } from 'react'
import { IS_DEMO, api } from '../api'
import { Icon } from './ui'
import type { CheckoutResponse, Invoice } from '../types'

/** Online payment of an invoice (POST /api/invoices/{id}/checkout/vnpay): redirects to the VNPay gateway. */
export function useCheckout(onError: (message: string) => void) {
  const [startingInvoiceId, setStartingInvoiceId] = useState<number | null>(null)

  const startCheckout = async (invoiceId: number) => {
    onError('')
    setStartingInvoiceId(invoiceId)
    try {
      const checkout = await api<CheckoutResponse>(`/api/invoices/${invoiceId}/checkout/vnpay`, { method: 'POST' })
      window.location.assign(checkout.paymentUrl)
    } catch (e) {
      onError((e as Error).message)
      setStartingInvoiceId(null)
    }
  }
  return { startingInvoiceId, startCheckout }
}

export function PayButtons({ invoiceId, startingInvoiceId, startCheckout }: { invoiceId: number; startingInvoiceId: number | null; startCheckout: (id: number) => void }) {
  return (
    <div className="row wrap pay-actions">
      <button className="btn primary" disabled={startingInvoiceId !== null} onClick={() => startCheckout(invoiceId)}>
        <Icon name="card" size={16} /> {startingInvoiceId === invoiceId ? 'Đang chuyển đến thanh toán…' : 'Thanh toán VNPay'}
      </button>
    </div>
  )
}

export const INVOICE_TYPE: Record<string, string> = { DEPOSIT: 'Tiền cọc', MONTHLY_RENT: 'Tiền thuê', RENEWAL: 'Gia hạn hợp đồng', OVERDUE_FINE: 'Phí quá hạn', EXTRA_CHARGE: 'Phí phát sinh' }
export const TYPE_ICON: Record<string, string> = { DEPOSIT: 'shield', MONTHLY_RENT: 'calendar', RENEWAL: 'refresh', OVERDUE_FINE: 'alert', EXTRA_CHARGE: 'plus' }
export const PAY_METHOD: Record<string, string> = { Cash: 'Tiền mặt', BankTransfer: 'Chuyển khoản', VNPay: 'VNPay', MoMo: 'MoMo', Momo: 'MoMo' }
export const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  Success: { label: 'Thành công', tone: 'ok' },
  Pending: { label: 'Đang chờ', tone: 'warn' },
  Failed: { label: 'Thất bại', tone: 'bad' },
  Refunded: { label: 'Đã hoàn tiền', tone: 'info' },
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10
  const out: string[] = []
  if (full || h > 0) out.push(`${DIGITS[h]} trăm`)
  if (t === 0) { if (u > 0 && (full || h > 0)) out.push('lẻ') }
  else out.push(t === 1 ? 'mười' : `${DIGITS[t]} mươi`)
  if (u > 0) out.push(u === 1 && t >= 2 ? 'mốt' : u === 5 && t >= 1 ? 'lăm' : u === 4 && t >= 2 ? 'tư' : DIGITS[u])
  return out.join(' ')
}
/** 1.200.000 → "Một triệu hai trăm nghìn đồng". */
export function moneyInWords(amount: number): string {
  let n = Math.round(Math.abs(amount))
  if (n === 0) return 'Không đồng'
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']
  const groups: number[] = []
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000) }
  const parts: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue
    parts.push(`${readTriple(groups[i], i < groups.length - 1)}${units[i] ? ` ${units[i]}` : ''}`)
  }
  const s = `${parts.join(' ')} đồng`.replace(/\s+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The development sandbox payment exists in dev builds (real backend, Development) and in the in-browser demo. */
export const SANDBOX_PAY = import.meta.env.DEV === true || IS_DEMO

/**
 * Test-only "paid successfully" button (POST /api/invoices/{id}/checkout/{provider}/sandbox-complete): the backend completes the
 * payment exactly as a VNPay confirmation would, so a deposit moves the reservation to "Chờ bàn giao kho" by itself.
 */
export function SandboxPayButton({ invoiceId, provider = 'vnpay', onPaid, onError }: {
  invoiceId: number
  provider?: 'vnpay' | 'momo'
  onPaid: (invoice: Invoice) => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  if (!SANDBOX_PAY) return null
  const pay = async () => {
    onError('')
    setBusy(true)
    try {
      onPaid(await api<Invoice>(`/api/invoices/${invoiceId}/checkout/${provider}/sandbox-complete`, { method: 'POST' }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className="btn success" disabled={busy} onClick={() => void pay()} title="Chỉ có khi chạy thử: giả lập cổng thanh toán báo thành công">
      <Icon name="check" size={16} /> {busy ? 'Đang xác nhận…' : 'Đã thanh toán thành công'} <span className="sandbox-tag">thử</span>
    </button>
  )
}
