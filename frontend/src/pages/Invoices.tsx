import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { QrCode } from '../components/qr'
import { Empty, Icon, StatusBadge } from '../components/ui'
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

  const isNew = (i: Invoice) => !!newReservationId && i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'
  const isPayable = (i: Invoice) => i.status === 'Unpaid' || i.status === 'Overdue'
  const due = invoices.filter(isPayable)
  const overdue = invoices.filter((i) => i.status === 'Overdue')
  const year = new Date().getFullYear()
  const paidThisYear = invoices.flatMap((i) => i.payments).filter((p) => p.status === 'Success' && p.paymentDate.startsWith(String(year)))
    .reduce((n, p) => n + p.amountPaid, 0)
  const [tab, setTab] = useState<'due' | 'paid' | 'all'>('all')
  const [type, setType] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  useEffect(() => { if (!loading && due.length) setTab('due') }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = ordered.filter((i) => (tab === 'due' ? isPayable(i) : tab === 'paid' ? i.status === 'Paid' : true) && (!type || i.invoiceType === type))
  const types = [...new Set(invoices.map((i) => i.invoiceType))]

  return (
    <>
    <section className="page-hero">
      <div className="container">
        <span className="eyebrow dark"><i />Tài khoản khách hàng</span>
        <h1>Hóa Đơn & Thanh Toán</h1>
        <p>Theo dõi tiền cọc, tiền thuê hằng tháng, gia hạn và phụ phí; thanh toán trực tuyến qua VNPay hoặc MoMo.</p>
      </div>
    </section>
    <div className="container page-body">
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
        <p className="alert ok">Đã quay lại từ cổng thanh toán. Trạng thái được cập nhật khi cổng thanh toán xác nhận; bấm Làm mới nếu hóa đơn vẫn đang chờ.</p>
      )}

      <div className="stat-grid three">
        <div className="stat-card">
          <div className="row between"><span className="muted">Cần thanh toán</span><span className="stat-icon warn"><Icon name="wallet" size={17} /></span></div>
          <b className="stat-value">{fmtMoney(due.reduce((n, i) => n + i.totalAmount, 0))}</b>
          <small className={`stat-note ${due.length ? 'warn' : 'ok'}`}>{due.length ? `${due.length} hóa đơn chưa thanh toán` : 'Không có khoản nào cần trả'}</small>
        </div>
        <div className="stat-card">
          <div className="row between"><span className="muted">Quá hạn</span><span className={`stat-icon ${overdue.length ? 'bad' : 'ok'}`}><Icon name="alert" size={17} /></span></div>
          <b className="stat-value">{overdue.length}</b>
          <small className={`stat-note ${overdue.length ? 'bad' : 'ok'}`}>{overdue.length ? 'Thanh toán sớm để tránh khóa kho' : 'Bạn đang thanh toán đúng hạn'}</small>
        </div>
        <div className="stat-card">
          <div className="row between"><span className="muted">Đã thanh toán năm {year}</span><span className="stat-icon ok"><Icon name="check" size={17} /></span></div>
          <b className="stat-value">{fmtMoney(paidThisYear)}</b>
          <small className="stat-note ok">{invoices.filter((i) => i.status === 'Paid').length} hóa đơn đã thanh toán</small>
        </div>
      </div>

      <div className="panel filter-bar">
        <div className="segmented" role="tablist">
          <button className={tab === 'due' ? 'active' : ''} onClick={() => setTab('due')}>Cần thanh toán{due.length > 0 && <span className="count-pill">{due.length}</span>}</button>
          <button className={tab === 'paid' ? 'active' : ''} onClick={() => setTab('paid')}>Đã thanh toán</button>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Tất cả</button>
        </div>
        <div className="row">
          <select id="invoice-type" value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại hóa đơn">
            <option value="">Mọi loại hóa đơn</option>
            {types.map((t) => <option key={t} value={t}>{invoiceTypeName(t)}</option>)}
          </select>
          <button className="btn outline sm" onClick={() => { setLoading(true); void load() }} disabled={loading}><Icon name="refresh" size={14} /> Làm mới</button>
        </div>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {loading && <p className="muted">Đang tải hóa đơn…</p>}

      <div className="invoice-list">
        {shown.map((invoice) => {
          const payable = isPayable(invoice)
          const open = openId === invoice.invoiceId || payable && (isNew(invoice) || momo?.invoiceId === invoice.invoiceId)
          const period = invoice.billingPeriodStart && invoice.billingPeriodEnd ? `Kỳ ${fmtDate(invoice.billingPeriodStart)} – ${fmtDate(invoice.billingPeriodEnd)}` : null
          return (
            <section className={`invoice-card ${payable ? 'payable' : ''} ${invoice.status === 'Overdue' ? 'overdue' : ''} ${isNew(invoice) ? 'highlight' : ''}`} key={invoice.invoiceId}>
              <button type="button" className="invoice-head" aria-expanded={open} onClick={() => setOpenId(openId === invoice.invoiceId ? null : invoice.invoiceId)}>
                <span className={`invoice-icon t-${invoice.invoiceType.toLowerCase()}`}><Icon name={TYPE_ICON[invoice.invoiceType] ?? 'file'} size={18} /></span>
                <span className="invoice-main">
                  <b>{invoiceTypeName(invoice.invoiceType)}</b>
                  <small className="muted">{invoice.invoiceNumber} · {period ?? invoice.details[0]?.description}</small>
                </span>
                <span className="invoice-due">
                  <small className="muted">{payable ? 'Hạn thanh toán' : 'Ngày lập'}</small>
                  <span>{fmtDate(payable ? invoice.dueDate : invoice.createdAt)}</span>
                </span>
                <span className="invoice-amount">
                  <b>{fmtMoney(invoice.totalAmount)}</b>
                  <StatusBadge status={invoice.status} />
                </span>
                <Icon name="arrowRight" size={15} className={`invoice-chevron ${open ? 'open' : ''}`} />
              </button>

              {open && (
                <div className="invoice-body">
                  <table className="invoice-lines">
                    <tbody>
                      {invoice.details.map((d) => (
                        <tr key={d.detailId}><td>{d.description}</td><td className="right muted">{d.quantity} × {fmtMoney(d.unitPrice)}</td><td className="right">{fmtMoney(d.lineTotal)}</td></tr>
                      ))}
                      {invoice.discountAmount > 0 && <tr><td>Giảm giá</td><td /><td className="right ok-text">−{fmtMoney(invoice.discountAmount)}</td></tr>}
                      <tr className="total"><td>Tổng cộng</td><td /><td className="right">{fmtMoney(invoice.totalAmount)}</td></tr>
                    </tbody>
                  </table>
                  {invoice.payments.length > 0 && (
                    <div className="stack-sm">
                      <span className="label">Lịch sử thanh toán</span>
                      {invoice.payments.map((p) => (
                        <div key={p.paymentId} className="payment-row">
                          <span><b>{PAY_METHOD[p.paymentMethod] ?? p.paymentMethod}</b>{p.transactionCode && <small className="muted"> · mã {p.transactionCode}</small>}</span>
                          <small className="muted">{fmtTime(p.paymentDate)}{p.receivedByStaff && ` · ${p.receivedByStaff}`}</small>
                          <span className={`badge ${PAY_STATUS[p.status]?.tone ?? 'muted'}`}>{PAY_STATUS[p.status]?.label ?? p.status}</span>
                          <b className={p.status === 'Refunded' ? 'ok-text' : ''}>{p.status === 'Refunded' ? '+' : ''}{fmtMoney(p.amountPaid)}</b>
                        </div>
                      ))}
                    </div>
                  )}
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
                    <div className="row wrap pay-actions">
                      <button className="btn primary" disabled={startingInvoiceId !== null} onClick={() => void startCheckout(invoice.invoiceId, 'vnpay')}>
                        <Icon name="card" size={16} /> {startingInvoiceId === invoice.invoiceId ? 'Đang chuyển đến thanh toán…' : 'Thanh toán VNPay'}
                      </button>
                      <button className="btn momo" disabled={startingInvoiceId !== null} onClick={() => void startCheckout(invoice.invoiceId, 'momo')}>
                        <Icon name="scan" size={16} /> Thanh toán MoMo · quét QR
                      </button>
                      <small className="muted">Hoặc thanh toán tiền mặt / chuyển khoản tại quầy cơ sở.</small>
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {!loading && shown.length === 0 && (
          <div className="panel"><Empty icon="wallet">{tab === 'due' ? 'Bạn không có hóa đơn nào cần thanh toán.' : invoices.length ? 'Không có hóa đơn nào khớp bộ lọc.' : 'Bạn chưa có hóa đơn.'}</Empty></div>
        )}
      </div>
    </div>
    </>
  )
}

const TYPE_ICON: Record<string, string> = { DEPOSIT: 'shield', MONTHLY_RENT: 'calendar', RENEWAL: 'refresh', OVERDUE_FINE: 'alert', EXTRA_CHARGE: 'plus' }
const PAY_METHOD: Record<string, string> = { Cash: 'Tiền mặt', BankTransfer: 'Chuyển khoản', VNPay: 'VNPay', MoMo: 'MoMo', Momo: 'MoMo' }
const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  Success: { label: 'Thành công', tone: 'ok' },
  Pending: { label: 'Đang chờ', tone: 'warn' },
  Failed: { label: 'Thất bại', tone: 'bad' },
  Refunded: { label: 'Đã hoàn tiền', tone: 'info' },
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
