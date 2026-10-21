import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { QrCode } from '../components/qr'
import { Icon, StatusBadge } from '../components/ui'
import type { CheckoutResponse, Invoice } from '../types'

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [startingInvoiceId, setStartingInvoiceId] = useState<number | null>(null)
  /** MoMo checkout shown as a QR code to scan (desktop), keyed by invoice. */
  const [momo, setMomo] = useState<{ invoiceId: number; checkout: CheckoutResponse } | null>(null)
  const [searchParams] = useSearchParams()
  const returnedFromGateway = searchParams.get('paymentReturn') === '1'
  // Arrived from the rent page right after agreeing to the terms: put that deposit invoice first.
  const newReservationId = Number(searchParams.get('reservation')) || null
  const newCode = searchParams.get('code')
  const deadline = searchParams.get('deadline')
  const ordered = newReservationId
    ? [...invoices.filter((i) => i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'), ...invoices.filter((i) => !(i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'))]
    : invoices

  const load = async () => {
    setError('')
    try {
      setInvoices(await api<Invoice[]>('/api/invoices/my'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void api<Invoice[]>('/api/invoices/my')
      .then((items) => {
        if (!cancelled) setInvoices(items)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const startCheckout = async (invoiceId: number, provider: 'vnpay' | 'momo') => {
    setError('')
    setStartingInvoiceId(invoiceId)
    try {
      const checkout = await api<CheckoutResponse>(`/api/invoices/${invoiceId}/checkout/${provider}`, { method: 'POST' })
      // MoMo: on a computer show the QR to scan with the MoMo app; on a phone open the app directly.
      if (provider === 'momo' && checkout.qrCodeUrl && !(isMobile() && checkout.deeplink)) {
        setMomo({ invoiceId, checkout })
        setStartingInvoiceId(null)
        return
      }
      window.location.assign(provider === 'momo' && isMobile() && checkout.deeplink ? checkout.deeplink : checkout.paymentUrl)
    } catch (e) {
      setError((e as Error).message)
      setStartingInvoiceId(null)
    }
  }

  return (
    <>
    <section className="page-hero">
      <div className="container">
        <span className="eyebrow dark"><i />Tài khoản khách hàng</span>
        <h1>Hóa Đơn & Thanh Toán</h1>
        <p>Thanh toán cọc, gia hạn và các khoản phí trực tuyến qua VNPay hoặc MoMo.</p>
      </div>
    </section>
    <div className="container page-body">
      <div className="row between wrap">
        <h2 className="section-title">Hóa đơn của tôi</h2>
        <button className="btn outline sm" onClick={() => void load()} disabled={loading}>Làm mới</button>
      </div>
      {newCode && (
        <div className="success-panel">
          <span className="success-icon"><Icon name="check" size={22} /></span>
          <div className="grow">
            <h3>Đã đồng ý điều khoản & giữ chỗ · {newCode}</h3>
            <p>Bước cuối: thanh toán tiền cọc bên dưới{deadline && <> trước <b>{fmtTime(deadline)}</b></>} qua VNPay, MoMo hoặc tại quầy. Sau khi cọc được xác nhận, đặt lịch nhận kho ở mục Thuê Kho.</p>
          </div>
        </div>
      )}
      {returnedFromGateway && (
        <p className="alert ok">
          Đã quay lại từ cổng thanh toán. Trạng thái cuối cùng được cập nhật qua IPN; hãy làm mới nếu hóa đơn vẫn đang chờ.
        </p>
      )}
      {error && <p className="alert bad">{error}</p>}
      {loading && <p className="muted">Đang tải hóa đơn…</p>}
      {!loading && invoices.length === 0 && <p className="muted">Bạn chưa có hóa đơn.</p>}
      <div className="stack">
        {ordered.map((invoice) => {
          const payable = invoice.status === 'Unpaid' || invoice.status === 'Overdue'
          return (
            <section className={`panel ${newReservationId && invoice.reservationId === newReservationId && invoice.invoiceType === 'DEPOSIT' ? 'highlight' : ''}`} key={invoice.invoiceId}>
              <div className="row between wrap">
                <div>
                  <h3>{invoice.invoiceNumber} · {invoiceTypeName(invoice.invoiceType)}</h3>
                  <p className="muted">Hạn thanh toán: {fmtDate(invoice.dueDate)}</p>
                </div>
                <StatusBadge status={invoice.status} />
              </div>
              {invoice.details.map((detail) => (
                <div className="row between wrap" key={detail.detailId}>
                  <span>{detail.description} × {detail.quantity}</span>
                  <span>{fmtMoney(detail.lineTotal)}</span>
                </div>
              ))}
              <div className="row between">
                <b>Tổng cộng</b>
                <b>{fmtMoney(invoice.totalAmount)}</b>
              </div>
              {invoice.payments.map((payment) => (
                <p className="muted" key={payment.paymentId}>
                  {payment.paymentMethod} · {payment.status} · {fmtMoney(payment.amountPaid)}
                </p>
              ))}
              {payable && momo?.invoiceId === invoice.invoiceId && (
                <div className="momo-qr">
                  <div className="momo-qr-code"><QrCode text={momo.checkout.qrCodeUrl!} size={200} label={`Mã QR MoMo cho hóa đơn ${invoice.invoiceNumber}`} /></div>
                  <div className="stack-sm grow">
                    <b className="momo-title">Quét mã bằng ứng dụng MoMo</b>
                    <span className="muted">Mở MoMo → biểu tượng quét mã → quét mã bên cạnh để thanh toán <b>{fmtMoney(momo.checkout.amount)}</b>.</span>
                    <small className="muted">Mã giao dịch: <span className="code">{momo.checkout.transactionReference}</span></small>
                    <small className="muted">Hóa đơn chỉ chuyển sang Đã thanh toán sau khi MoMo xác nhận; bấm Làm mới sau khi trả xong.</small>
                    <div className="row wrap">
                      {momo.checkout.paymentUrl && <a className="btn outline sm" href={momo.checkout.paymentUrl}>Mở trang thanh toán MoMo</a>}
                      <button className="btn primary sm" onClick={() => { setMomo(null); setLoading(true); void load() }}><Icon name="refresh" size={14} /> Tôi đã thanh toán, làm mới</button>
                      <button className="btn ghost sm" onClick={() => setMomo(null)}>Đóng</button>
                    </div>
                  </div>
                </div>
              )}
              {payable && momo?.invoiceId !== invoice.invoiceId && (
                <div className="row wrap">
                  <button className="btn primary" disabled={startingInvoiceId !== null}
                    onClick={() => void startCheckout(invoice.invoiceId, 'vnpay')}>
                    {startingInvoiceId === invoice.invoiceId ? 'Đang chuyển đến thanh toán…' : 'Thanh toán VNPay'}
                  </button>
                  <button className="btn" disabled={startingInvoiceId !== null}
                    onClick={() => void startCheckout(invoice.invoiceId, 'momo')}>
                    Thanh toán MoMo · quét QR
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
    </>
  )
}

function invoiceTypeName(type: string) {
  switch (type) {
    case 'DEPOSIT': return 'Tiền cọc'
    case 'RENEWAL': return 'Gia hạn'
    case 'MONTHLY_RENT': return 'Tiền thuê'
    case 'OVERDUE_FINE': return 'Phí quá hạn'
    case 'EXTRA_CHARGE': return 'Phụ phí'
    default: return type
  }
}
