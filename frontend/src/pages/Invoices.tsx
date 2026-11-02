import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { AppointmentPicker, pickupMissed } from '../components/appointment'
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

  // Deposit just paid (back from VNPay, or confirmed while this page waited): go straight to booking the pickup
  // time instead of leaving it in a notification. Reservations already confirmed before arriving are left alone.
  const navigate = useNavigate()
  const confirmedAtStart = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (loading) return
    const waiting = reservations.filter((r) => r.status === 'Confirmed' && !r.checkInAppointmentAt && !pickupMissed(r))
    if (confirmedAtStart.current === null) {
      confirmedAtStart.current = new Set(reservations.filter((r) => r.status === 'Confirmed').map((r) => r.reservationId))
      // Coming back from the gateway: the payment was applied before this page loaded.
      if (returnedFromGateway && gatewayResult !== 'failed' && waiting.length) {
        const r = waiting.reduce((a, b) => (b.reservationId > a.reservationId ? b : a))
        navigate(`/reservations/${r.reservationId}/pickup?paid=1`, { replace: true })
      }
      return
    }
    const fresh = waiting.find((r) => !confirmedAtStart.current!.has(r.reservationId))
    if (fresh) navigate(`/reservations/${fresh.reservationId}/pickup?paid=1`)
  }, [loading, reservations, returnedFromGateway, gatewayResult, navigate])

  const isNew = (i: Invoice) => !!newReservationId && i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'
  const isPayable = (i: Invoice) => i.status === 'Unpaid' || i.status === 'Overdue'
  const due = invoices.filter(isPayable)
  const overdue = invoices.filter((i) => i.status === 'Overdue')
  const [tab, setTab] = useState<'due' | 'paid' | 'overdue' | 'all'>('all')
  const [type, setType] = useState('')
  useEffect(() => { if (!loading && due.length) setTab('due') }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
  // Just paid here (or the deposit of the reservation just made): kept on the "Cần thanh toán" tab once paid, so the next
  // step (pick-up time) stays visible. The other tabs and the type filter still apply to it.
  const pinned = (i: Invoice) => isNew(i)
  const tabMatch = (i: Invoice) => (tab === 'due' ? isPayable(i) || pinned(i) : tab === 'paid' ? i.status === 'Paid' : tab === 'overdue' ? i.status === 'Overdue' : true)
  const shown = ordered.filter((i) => tabMatch(i) && (!type || i.invoiceType === type))
  const types = [...new Set(invoices.map((i) => i.invoiceType))]
  const pickTab = (t: typeof tab) => { setTab(tab === t ? 'all' : t); setType('') }
  const dueTotal = due.reduce((n, i) => n + i.totalAmount, 0)
  const paidTotal = invoices.filter((i) => i.status === 'Paid').reduce((n, i) => n + i.totalAmount, 0)
  // The payable invoice due first: what the customer should pay next.
  const nextDue = [...due].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]

  return (
    <>
    <section className="page-hero">
      <div className="container">
        <h1>Thanh Toán</h1>
        <p>Tiền cọc, tiền thuê, gia hạn và phụ phí của bạn. Thanh toán trực tuyến qua VNPay.</p>
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

      {/* what is owed right now, then the running totals */}
      <section className={`pay-summary ${overdue.length ? 'bad' : due.length ? 'warn' : 'ok'}`}>
        <button type="button" className={`pay-due ${tab === 'due' ? 'active' : ''}`} onClick={() => pickTab('due')}>
          <span className="pay-due-icon"><Icon name={overdue.length ? 'alert' : due.length ? 'wallet' : 'check'} size={22} /></span>
          <span className="grow">
            <small>{due.length ? 'Cần thanh toán' : 'Bạn đã thanh toán hết'}</small>
            <b>{fmtMoney(dueTotal)}</b>
            <small>{overdue.length ? `${overdue.length} hóa đơn quá hạn, thanh toán sớm để tránh khóa kho`
              : nextDue ? `${due.length} hóa đơn · hạn gần nhất ${fmtDate(nextDue.dueDate)}` : 'Không có khoản nào cần trả'}</small>
          </span>
        </button>
        <div className="pay-stats">
          <button type="button" className={tab === 'overdue' ? 'active' : ''} onClick={() => pickTab('overdue')}><small>Quá hạn</small><b className={overdue.length ? 'danger-text' : ''}>{overdue.length}</b></button>
          <button type="button" className={tab === 'paid' ? 'active' : ''} onClick={() => pickTab('paid')}><small>Đã thanh toán</small><b>{fmtMoney(paidTotal)}</b></button>
          <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => pickTab('all')}><small>Tổng hóa đơn</small><b>{invoices.length}</b></button>
        </div>
      </section>

      <div className="dash-grid pay-grid">
      <div className="stack">
      <div className="invoice-toolbar">
        <div className="segmented" role="tablist">
          <button className={tab === 'due' ? 'active' : ''} onClick={() => setTab('due')}>Cần thanh toán{due.length > 0 && <span className="count-pill">{due.length}</span>}</button>
          <button className={tab === 'paid' ? 'active' : ''} onClick={() => setTab('paid')}>Đã thanh toán</button>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Tất cả</button>
        </div>
        <span className="grow" />
        <Select id="invoice-type" value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại hóa đơn">
          <option value="">Mọi loại hóa đơn</option>
          {types.map((t) => <option key={t} value={t}>{invoiceTypeName(t)}</option>)}
        </Select>
        <button className="icon-btn" title="Làm mới" aria-label="Làm mới" onClick={() => { setLoading(true); void load() }} disabled={loading}><Icon name="refresh" size={16} /></button>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {loading && <p className="muted">Đang tải hóa đơn…</p>}

      <div className="invoice-list" id="invoice-list">
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
                <span className="invoice-more"><Icon name="arrowRight" size={16} /></span>
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
      </div>
      </div>
      <aside className="stack-lg pay-aside">
        <PaymentHistory refreshKey={invoices} />
      </aside>
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
  const shown = open ? rows : rows.slice(0, 6)
  return (
    <section className="panel stack">
      <div>
        <h2 className="panel-title"><Icon name="history" size={18} className="cyan" /> Lịch sử thanh toán</h2>
        <p className="muted">Mới nhất ở trên.</p>
      </div>
      {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}
      <ul className="pay-hist">
        {shown.map((p) => {
          const st = PAY_STATUS[p.status] ?? { label: p.status, tone: 'muted' }
          const pending = p.status === 'Pending'
          const canCancel = pending && Date.now() - new Date(p.paymentDate).getTime() >= CANCEL_AFTER_MS
          return (
            <li key={p.paymentId}>
              <div className="row between">
                <Link to={`/invoices/${p.invoiceId}`} className="link code">{p.invoiceNumber}</Link>
                <b>{fmtMoney(p.amountPaid)}</b>
              </div>
              <div className="row between">
                <small className="muted">{fmtTime(p.paymentDate)} · {PAY_METHOD[p.paymentMethod] ?? p.paymentMethod}</small>
                <span className={`badge ${st.tone}`}>{st.label}</span>
              </div>
              {canCancel && <button className="btn outline sm self-start" disabled={busyId !== null} onClick={() => void cancel(p)}>{busyId === p.paymentId ? 'Đang hủy…' : 'Hủy giao dịch'}</button>}
              {pending && !canCancel && <small className="muted">Chờ cổng thanh toán; hủy được sau {fmtTime(new Date(new Date(p.paymentDate).getTime() + CANCEL_AFTER_MS).toISOString())}</small>}
            </li>
          )
        })}
      </ul>
      {rows.length > 6 && <button className="btn ghost sm self-start" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : `Xem tất cả ${rows.length} giao dịch`}</button>}
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
