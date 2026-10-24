import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { AppointmentPicker } from '../components/appointment'
import { MomoQrPanel, PayButtons, SandboxPayButton, TYPE_ICON, useCheckout } from '../components/checkout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { Facility, Invoice, Reservation } from '../types'

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  /** VNPay redirect / MoMo QR (desktop), keyed by invoice. */
  const { startingInvoiceId, momo, setMomo, startCheckout } = useCheckout(setError)
  const [searchParams] = useSearchParams()
  const returnedFromGateway = searchParams.get('paymentReturn') === '1'
  // Arrived from the rent page right after agreeing to the terms: put that deposit invoice first.
  const newReservationId = Number(searchParams.get('reservation')) || null
  const newCode = searchParams.get('code')
  const deadline = searchParams.get('deadline')
  const ordered = newReservationId
    ? [...invoices.filter((i) => i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'), ...invoices.filter((i) => !(i.reservationId === newReservationId && i.invoiceType === 'DEPOSIT'))]
    : invoices

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [paidNotice, setPaidNotice] = useState('')

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

  const onSandboxPaid = (paid: Invoice) => {
    setMomo(null)
    setInvoices((all) => all.map((i) => (i.invoiceId === paid.invoiceId ? paid : i)))
    setPaidNotice(`Đã thanh toán ${paid.invoiceNumber} · ${fmtMoney(paid.totalAmount)}.`)
    setJustPaid((ids) => [...ids, paid.invoiceId])
    void load(true)
  }
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
  const [justPaid, setJustPaid] = useState<number[]>([])
  const pinned = (i: Invoice) => isNew(i) || justPaid.includes(i.invoiceId)
  const shown = ordered.filter((i) => pinned(i) || ((tab === 'due' ? isPayable(i) : tab === 'paid' ? i.status === 'Paid' : true) && (!type || i.invoiceType === type)))
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
            {newDepositPaid
              ? <><h3>Đã thanh toán cọc · {newCode}</h3><p>Đơn đã chuyển sang <b>Chờ bàn giao kho</b>. Chọn giờ đến nhận kho ngay ở hóa đơn cọc bên dưới.</p></>
              : <><h3>Đã đồng ý điều khoản & giữ chỗ · {newCode}</h3><p>Bước cuối: thanh toán tiền cọc{deadline && <> trước <b>{fmtTime(deadline)}</b></>}.</p></>}
          </div>
        </div>
      )}
      {paidNotice && <p className="alert ok"><Icon name="check" size={16} />{paidNotice}</p>}
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
                  {momo?.invoiceId === invoice.invoiceId
                    ? <MomoQrPanel invoiceNumber={invoice.invoiceNumber} checkout={momo.checkout} onPaid={() => { setMomo(null); void load(true) }} onClose={() => setMomo(null)} />
                    : <div className="row wrap pay-row">
                        <PayButtons invoiceId={invoice.invoiceId} startingInvoiceId={startingInvoiceId} startCheckout={(i, p) => void startCheckout(i, p)} />
                        <SandboxPayButton invoiceId={invoice.invoiceId} onPaid={onSandboxPaid} onError={setError} />
                      </div>}
                  {momo?.invoiceId === invoice.invoiceId && <SandboxPayButton invoiceId={invoice.invoiceId} provider="momo" onPaid={onSandboxPaid} onError={setError} />}
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
