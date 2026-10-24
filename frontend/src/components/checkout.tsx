import { useState } from 'react'
import { api, fmtMoney } from '../api'
import { QrCode } from './qr'
import { Icon } from './ui'
import type { CheckoutResponse } from '../types'

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/**
 * Online payment of an invoice (POST /api/invoices/{id}/checkout/{vnpay|momo}).
 * VNPay redirects to the gateway; MoMo shows a QR to scan on a computer and opens the app on a phone.
 */
export function useCheckout(onError: (message: string) => void) {
  const [startingInvoiceId, setStartingInvoiceId] = useState<number | null>(null)
  const [momo, setMomo] = useState<{ invoiceId: number; checkout: CheckoutResponse } | null>(null)

  const startCheckout = async (invoiceId: number, provider: 'vnpay' | 'momo') => {
    onError('')
    setStartingInvoiceId(invoiceId)
    try {
      const checkout = await api<CheckoutResponse>(`/api/invoices/${invoiceId}/checkout/${provider}`, { method: 'POST' })
      if (provider === 'momo' && checkout.qrCodeUrl && !(isMobile() && checkout.deeplink)) {
        setMomo({ invoiceId, checkout })
        setStartingInvoiceId(null)
        return
      }
      window.location.assign(provider === 'momo' && isMobile() && checkout.deeplink ? checkout.deeplink : checkout.paymentUrl)
    } catch (e) {
      onError((e as Error).message)
      setStartingInvoiceId(null)
    }
  }
  return { startingInvoiceId, momo, setMomo, startCheckout }
}

export function MomoQrPanel({ invoiceNumber, checkout, onPaid, onClose }: { invoiceNumber: string; checkout: CheckoutResponse; onPaid: () => void; onClose: () => void }) {
  return (
    <div className="momo-qr">
      <div className="momo-qr-code"><QrCode text={checkout.qrCodeUrl!} size={200} label={`Mã QR MoMo cho hóa đơn ${invoiceNumber}`} /></div>
      <div className="stack-sm grow">
        <b className="momo-title">Quét mã bằng ứng dụng MoMo</b>
        <span className="muted">Mở MoMo → biểu tượng quét mã → quét mã bên cạnh để thanh toán <b>{fmtMoney(checkout.amount)}</b>.</span>
        <small className="muted">Mã giao dịch: <span className="code">{checkout.transactionReference}</span></small>
        <small className="muted">Hóa đơn chỉ chuyển sang Đã thanh toán sau khi MoMo xác nhận; bấm Làm mới sau khi trả xong.</small>
        <div className="row wrap">
          {checkout.paymentUrl && <a className="btn outline sm" href={checkout.paymentUrl}>Mở trang thanh toán MoMo</a>}
          <button className="btn primary sm" onClick={onPaid}><Icon name="refresh" size={14} /> Tôi đã thanh toán, làm mới</button>
          <button className="btn ghost sm" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  )
}

export function PayButtons({ invoiceId, startingInvoiceId, startCheckout }: { invoiceId: number; startingInvoiceId: number | null; startCheckout: (id: number, p: 'vnpay' | 'momo') => void }) {
  return (
    <div className="row wrap pay-actions">
      <button className="btn primary" disabled={startingInvoiceId !== null} onClick={() => startCheckout(invoiceId, 'vnpay')}>
        <Icon name="card" size={16} /> {startingInvoiceId === invoiceId ? 'Đang chuyển đến thanh toán…' : 'Thanh toán VNPay'}
      </button>
      <button className="btn momo" disabled={startingInvoiceId !== null} onClick={() => startCheckout(invoiceId, 'momo')}>
        <Icon name="scan" size={16} /> Thanh toán MoMo · quét QR
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
