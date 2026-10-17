import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import type { CheckoutResponse, Invoice } from '../types'

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [startingInvoiceId, setStartingInvoiceId] = useState<number | null>(null)
  const [searchParams] = useSearchParams()
  const returnedFromGateway = searchParams.get('paymentReturn') === '1'

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
      const checkout = await api<CheckoutResponse>(`/api/invoices/${invoiceId}/checkout/${provider}`)
      window.location.assign(checkout.paymentUrl)
    } catch (e) {
      setError((e as Error).message)
      setStartingInvoiceId(null)
    }
  }

  return (
    <div className="page">
      <div className="row between wrap">
        <div>
          <h2>Hóa đơn & thanh toán</h2>
          <p className="muted">Thanh toán cọc, gia hạn và các khoản phí trực tuyến.</p>
        </div>
        <button className="btn ghost" onClick={() => void load()} disabled={loading}>Làm mới</button>
      </div>
      {returnedFromGateway && (
        <p className="success">
          Đã quay lại từ cổng thanh toán. Trạng thái cuối cùng được cập nhật qua IPN; hãy làm mới nếu hóa đơn vẫn đang chờ.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Đang tải hóa đơn…</p>}
      {!loading && invoices.length === 0 && <p className="muted">Bạn chưa có hóa đơn.</p>}
      <div className="stack">
        {invoices.map((invoice) => {
          const payable = invoice.status === 'Unpaid' || invoice.status === 'Overdue'
          return (
            <section className="card" key={invoice.invoiceId}>
              <div className="row between wrap">
                <div>
                  <h3>{invoice.invoiceNumber} · {invoiceTypeName(invoice.invoiceType)}</h3>
                  <p className="muted">Hạn thanh toán: {fmtDate(invoice.dueDate)}</p>
                </div>
                <span className={`badge ${invoice.status === 'Paid' ? 'ok' : payable ? 'warn' : ''}`}>
                  {invoice.status}
                </span>
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
                    onClick={() => void startCheckout(invoice.invoiceId, 'vnpay')}>
                    {startingInvoiceId === invoice.invoiceId ? 'Đang chuyển đến thanh toán…' : 'Thanh toán VNPay'}
                  </button>
                  <button className="btn" disabled={startingInvoiceId !== null}
                    onClick={() => void startCheckout(invoice.invoiceId, 'momo')}>
                    Thanh toán MoMo
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
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
