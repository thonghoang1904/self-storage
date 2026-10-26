import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Icon, StatusBadge } from '../components/ui'
import type { CheckoutResponse, Invoice } from '../types'

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [startingInvoiceId, setStartingInvoiceId] = useState<number | null>(null)
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

  /** Online payment goes through VNPay only; the page comes back here and the IPN marks the invoice paid. */
  const startCheckout = async (invoiceId: number) => {
    setError('')
    setStartingInvoiceId(invoiceId)
    try {
      const checkout = await api<CheckoutResponse>(`/api/invoices/${invoiceId}/checkout/vnpay`, { method: 'POST' })
      window.location.assign(checkout.paymentUrl)
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
        <p>Thanh toán cọc, gia hạn và các khoản phí trực tuyến qua VNPay hoặc tại quầy.</p>
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
            <p>Bước cuối: thanh toán tiền cọc bên dưới{deadline && <> trước <b>{fmtTime(deadline)}</b></>} qua VNPay hoặc tại quầy. Sau khi cọc được xác nhận, đặt lịch nhận kho ở mục Thuê Kho.</p>
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
              {payable && (
                <div className="row wrap">
                  <button className="btn primary" disabled={startingInvoiceId !== null}
                    onClick={() => void startCheckout(invoice.invoiceId)}>
                    {startingInvoiceId === invoice.invoiceId ? 'Đang chuyển đến thanh toán…' : 'Thanh toán VNPay'}
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
