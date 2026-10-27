import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { AppointmentPicker } from '../components/appointment'
import { PayButtons, TYPE_ICON, useCheckout } from '../components/checkout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { Facility, Invoice, Reservation } from '../types'
import { Select } from '../components/Select'

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  /** VNPay redirect, keyed by invoice. */
  const { startingInvoiceId, startCheckout } = useCheckout(setError)
  const [searchParams] = useSearchParams()
  const returnedFromGateway = searchParams.get('paymentReturn') === '1'
  /** success / failed when the backend could read the gateway's signed result, otherwise absent. */
  const gatewayResult = searchParams.get('result')
  // Arrived from the rent page right after agreeing to the terms: put that deposit invoice first.
  const newReservationId = Number(searchParams.get('reservation')) || null
  const newCode = searchParams.get('code')
  const deadline = searchParams.get('deadline')
  const ordered = newReservationId
    ? [...invoices.filter((i) => i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'), ...invoices.filter((i) => !(i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'))]
    : invoices

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])

  /** Invoices plus the customer's reservations (deposit status and pick-up time). Quiet reloads keep the list in place. */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError('')
    try {
      const [inv, rs] = await Promise.all([
        api<Invoice[]>('/api/invoices/my'),
        api<Reservation[]>('/api/reservations/my').catch(() => [] as Reservation[]),
      ])
      setInvoices(inv)
      setReservations(rs)
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {})
  }, [load])

  // A gateway confirms payments on its own: while something is unpaid, check again every 10 seconds so the status changes by itself.
  const hasPayable = invoices.some((i) => i.status === 'Unpaid' || i.status === 'Overdue')
  useEffect(() => {
    if (!hasPayable) return
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true) }, 10000)
    return () => window.clearInterval(t)
  }, [hasPayable, load])

  const reservationOf = (i: Invoice) => (i.invoiceType === 'DEPOSIT' ? reservations.find((r) => r.reservationId === i.reservationId) : undefined)
  const hoursOf = (r: Reservation) => facilities.find((f) => f.facilityName === r.facilityName)?.operatingHours
  const updateReservation = (u: Reservation) => setReservations((rs) => rs.map((x) => (x.reservationId === u.reservationId ? u : x)))
  const newDepositPaid = !!newReservationId && reservations.some((r) => r.reservationId === newReservationId && r.status === 'Confirmed')

  const isNew = (i: Invoice) => !!newReservationId && i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'
  const isPayable = (i: Invoice) => i.status === 'Unpaid' || i.status === 'Overdue'
  const due = invoices.filter(isPayable)
  const overdue = invoices.filter((i) => i.status === 'Overdue')
  const year = new Date().getFullYear()
  const paidThisYear = invoices.flatMap((i) => i.payments).filter((p) => p.status === 'Success' && p.paymentDate.startsWith(String(year)))
    .reduce((n, p) => n + p.amountPaid, 0)
  const [tab, setTab] = useState<'due' | 'paid' | 'all'>('all')
  const [type, setType] = useState('')
  useEffect(() => { if (!loading && due.length) setTab('due') }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
  // Just paid here (or the deposit of the reservation just made): keep it on screen so the next step (pick-up time) stays visible.
  const pinned = (i: Invoice) => isNew(i)
  const shown = ordered.filter((i) => pinned(i) || ((tab === 'due' ? isPayable(i) : tab === 'paid' ? i.status === 'Paid' : true) && (!type || i.invoiceType === type)))
  const types = [...new Set(invoices.map((i) => i.invoiceType))]

  return (
    <>
    <section className="page-hero">
      <div className="container">
        <span className="eyebrow dark"><i />Tài khoản khách hàng</span>
        <h1>Hóa Đơn & Thanh Toán</h1>
        <p>Theo dõi tiền cọc, tiền thuê hằng tháng, gia hạn và phụ phí; thanh toán trực tuyến qua VNPay hoặc tại quầy.</p>
      </div>
    </section>
    <div className="container page-body">
      {newCode && (
        <div className="success-panel">
          <span className="success-icon"><Icon name="check" size={22} /></span>
          <div className="grow">
            {newDepositPaid
              ? <><h3>Đã thanh toán cọc · {newCode}</h3><p>Đơn đã chuyển sang <b>Chờ bàn giao kho</b>. Chọn giờ đến nhận kho ngay ở hóa đơn cọc bên dưới.</p></>
              : <><h3>Đã đồng ý điều khoản & giữ chỗ · {newCode}</h3><p>Bước cuối: thanh toán tiền cọc{deadline && <> trước <b>{fmtTime(deadline)}</b></>}.</p></>}
          </div>
        </div>
      )}
      {returnedFromGateway && (gatewayResult === 'success'
        ? <p className="alert ok"><Icon name="check" size={16} />Thanh toán thành công. Hóa đơn đã được cập nhật.</p>
        : gatewayResult === 'failed'
          ? <p className="alert bad"><Icon name="alert" size={16} />Giao dịch chưa thành công hoặc đã bị hủy; hóa đơn vẫn chờ thanh toán, bạn có thể thanh toán lại.</p>
          : <p className="alert ok">Đã quay lại từ cổng thanh toán. Trạng thái được cập nhật khi cổng thanh toán xác nhận; bấm Làm mới nếu hóa đơn vẫn đang chờ.</p>)}

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
          <Select id="invoice-type" value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại hóa đơn">
            <option value="">Mọi loại hóa đơn</option>
            {types.map((t) => <option key={t} value={t}>{invoiceTypeName(t)}</option>)}
          </Select>
          <button className="btn outline sm" onClick={() => { setLoading(true); void load() }} disabled={loading}><Icon name="refresh" size={14} /> Làm mới</button>
        </div>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {loading && <p className="muted">Đang tải hóa đơn…</p>}

      <div className="invoice-list">
        {shown.map((invoice) => {
          const payable = isPayable(invoice)
          const period = invoice.billingPeriodStart && invoice.billingPeriodEnd ? `Kỳ ${fmtDate(invoice.billingPeriodStart)} – ${fmtDate(invoice.billingPeriodEnd)}` : null
          return (
            <section className={`invoice-card ${payable ? 'payable' : ''} ${invoice.status === 'Overdue' ? 'overdue' : ''} ${isNew(invoice) ? 'highlight' : ''}`} key={invoice.invoiceId}>
              <Link className="invoice-head" to={`/invoices/${invoice.invoiceId}`} aria-label={`Xem chi tiết hóa đơn ${invoice.invoiceNumber}`}>
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
                <span className="invoice-more">Chi tiết <Icon name="arrowRight" size={14} /></span>
              </Link>
              {payable && (
                <div className="invoice-body">
                  <div className="row wrap pay-row">
                    <PayButtons invoiceId={invoice.invoiceId} startingInvoiceId={startingInvoiceId} startCheckout={(i) => void startCheckout(i)} />
                  </div>
                </div>
              )}
              {(() => {
                const r = reservationOf(invoice)
                if (!r || r.status !== 'Confirmed') return null
                return (
                  <div className="handover-cta">
                    <span className="handover-icon"><Icon name="package" size={20} /></span>
                    <div className="grow">
                      <b>Chờ bàn giao kho · {r.reservationCode}</b>
                      <small className="muted">Nhận kho ngày <b>{fmtDate(r.expectedStartDate)}</b> tại {r.facilityName}{r.assignedUnitCode && <> · kho {r.assignedUnitCode}</>}. {r.checkInAppointmentAt ? 'Mang CCCD khi đến.' : 'Chọn giờ đến để nhân viên chuẩn bị bàn giao.'}</small>
                    </div>
                    <AppointmentPicker reservation={r} operatingHours={hoursOf(r)} defaultOpen onSaved={updateReservation} />
                  </div>
                )
              })()}
            </section>
          )
        })}
        {!loading && shown.length === 0 && (
          <div className="panel"><Empty icon="wallet">{tab === 'due' ? 'Bạn không có hóa đơn nào cần thanh toán.' : invoices.length ? 'Không có hóa đơn nào khớp bộ lọc.' : 'Bạn chưa có hóa đơn.'}</Empty></div>
        )}
        <PaymentHistory refreshKey={invoices} />
      </div>
    </div>
    </>
  )
}

interface MyPayment {
  paymentId: number
  invoiceId: number
  invoiceNumber: string
  paymentMethod: string
  status: string
  amountPaid: number
  paymentDate: string
  transactionCode: string | null
  invoiceStatus: string
  paymentNotes: string | null
}
const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  Pending: { label: 'Đang chờ xác nhận', tone: 'warn' },
  Success: { label: 'Thành công', tone: 'ok' },
  Failed: { label: 'Không thành công', tone: 'bad' },
  Refunded: { label: 'Đã hoàn tiền', tone: 'muted' },
  RefundDue: { label: 'Cơ sở sẽ hoàn tiền', tone: 'warn' },
  Reversed: { label: 'Đã hoàn tiền', tone: 'muted' },
}
const PAY_METHOD: Record<string, string> = { VNPay: 'VNPay', MoMo: 'MoMo', BankTransfer: 'Chuyển khoản', Cash: 'Tiền mặt', CreditCard: 'Thẻ', DepositOffset: 'Cấn trừ tiền cọc' }
/** The API refuses to cancel a pending online payment for 30 minutes, while its gateway link may still be paid. */
const CANCEL_AFTER_MS = 30 * 60 * 1000

/**
 * "Lịch sử thanh toán" (GET /api/payments/my): every payment of the customer. A VNPay/MoMo payment left pending
 * (customer closed the gateway page) can be cancelled once its link has expired (POST /api/payments/{id}/cancel),
 * so the invoice can be paid again.
 */
function PaymentHistory({ refreshKey }: { refreshKey: unknown }) {
  const [rows, setRows] = useState<MyPayment[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(() => api<MyPayment[]>('/api/payments/my?pageSize=100').then(setRows).catch(() => setRows([])), [])
  useEffect(() => { void load() }, [load, refreshKey])
  if (rows.length === 0) return null

  const cancel = async (p: MyPayment) => {
    setBusyId(p.paymentId); setMsg(null)
    try {
      await api(`/api/payments/${p.paymentId}/cancel`, { method: 'POST' })
      setMsg({ tone: 'ok', text: `Đã hủy giao dịch chờ của hóa đơn ${p.invoiceNumber}; bạn có thể thanh toán lại.` })
      await load()
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message })
    } finally {
      setBusyId(null)
    }
  }
  const shown = open ? rows : rows.slice(0, 5)
  return (
    <section className="panel stack">
      <div>
        <h2 className="panel-title"><Icon name="history" size={18} className="cyan" /> Lịch sử thanh toán</h2>
        <p className="muted">Mọi lần thanh toán của bạn, mới nhất ở trên.</p>
      </div>
      {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Thời gian</th><th>Hóa đơn</th><th>Hình thức</th><th className="right">Số tiền</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {shown.map((p) => {
              const st = PAY_STATUS[p.status] ?? { label: p.status, tone: 'muted' }
              const pending = p.status === 'Pending'
              const canCancel = pending && Date.now() - new Date(p.paymentDate).getTime() >= CANCEL_AFTER_MS
              return (
                <tr key={p.paymentId}>
                  <td>{fmtTime(p.paymentDate)}</td>
                  <td><Link to={`/invoices/${p.invoiceId}`} className="link">{p.invoiceNumber}</Link></td>
                  <td>{PAY_METHOD[p.paymentMethod] ?? p.paymentMethod}{p.transactionCode && <><br /><small className="muted code">{p.transactionCode}</small></>}</td>
                  <td className="right"><b>{fmtMoney(p.amountPaid)}</b></td>
                  <td><span className={`badge ${st.tone}`}>{st.label}</span>{p.paymentNotes && <><br /><small className="muted">{p.paymentNotes}</small></>}</td>
                  <td className="right">
                    {canCancel && <button className="btn outline sm" disabled={busyId !== null} onClick={() => void cancel(p)}>{busyId === p.paymentId ? 'Đang hủy…' : 'Hủy giao dịch'}</button>}
                    {pending && !canCancel && <small className="muted">Chờ cổng thanh toán; hủy được sau {fmtTime(new Date(new Date(p.paymentDate).getTime() + CANCEL_AFTER_MS).toISOString())}</small>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 5 && <button className="btn ghost sm self-start" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : `Xem tất cả ${rows.length} giao dịch`}</button>}
    </section>
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
