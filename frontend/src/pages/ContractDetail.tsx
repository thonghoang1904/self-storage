import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { FormField } from '../components/form'
import { Badge, Empty, Icon, StatusBadge, UnitArt, splitTypeName } from '../components/ui'
import { readPolicyAcks } from './ContractPolicy'
import type { AccessRecord, ContractDetail as Detail, EarlyReturnQuote, EarlyReturnRequest, Facility, Invoice, Person, Renewal, StorageUnit, UnitType } from '../types'
import { textError } from '../validation'

/**
 * Figma "customer-storage-contract-detail": the unit and its contract, the contract's invoices,
 * access status, overdue fees / deposit balance and the renewal request (GET /api/contracts/{id},
 * GET/POST /api/contracts/{id}/renewals), and the early-return request (GET/POST/DELETE
 * /api/contracts/{id}/early-return-requests, cost preview from GET .../early-return-quote).
 */

const DAY = 86400000
const asLocal = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
const daysUntil = (iso: string) => Math.ceil((asLocal(iso).getTime() - new Date().setHours(0, 0, 0, 0)) / DAY)
/** Same as .NET DateOnly.AddMonths: clamp to the last day of the month. */
const addMonths = (iso: string, n: number) => {
  const d = asLocal(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const INVOICE_TYPE: Record<string, string> = { DEPOSIT: 'Tiền cọc', RENEWAL: 'Gia hạn', MONTHLY_RENT: 'Tiền thuê', OVERDUE_FINE: 'Phí quá hạn', EXTRA_CHARGE: 'Phí phát sinh' }
const monthLabel = (iso: string) => `Tháng ${iso.slice(5, 7)}/${iso.slice(0, 4)}`

type ScheduleRow = { key: string; period: string; note?: string; amount: number; due: string; state: 'paid' | 'soon' | 'overdue' | 'scheduled' | 'cancelled'; invoice: string | null }
const STATE_BADGE: Record<ScheduleRow['state'], { label: string; tone: string }> = {
  paid: { label: 'Đã thanh toán', tone: 'ok' },
  soon: { label: 'Sắp đến hạn', tone: 'warn' },
  overdue: { label: 'Quá hạn', tone: 'bad' },
  scheduled: { label: 'Theo lịch', tone: 'muted' },
  cancelled: { label: 'Đã hủy', tone: 'muted' },
}

/**
 * Figma "Lịch Thanh Toán & Hóa Đơn": the contract's invoices by period (the backend bills rent monthly, see
 * MonthlyRentInvoiceService), then the next periods that are not invoiced yet, shown as "Theo lịch / Chưa phát hành".
 */
function paymentSchedule(c: Detail, invoices: Invoice[]): ScheduleRow[] {
  const today = new Date().setHours(0, 0, 0, 0)
  const rows: ScheduleRow[] = [...invoices].sort((a, b) => (a.billingPeriodStart ?? a.dueDate).localeCompare(b.billingPeriodStart ?? b.dueDate)).map((i) => {
    const due = asLocal(i.dueDate).getTime()
    const state: ScheduleRow['state'] = i.status === 'Paid' ? 'paid' : i.status === 'Cancelled' ? 'cancelled'
      : i.status === 'Overdue' || due < today ? 'overdue' : 'soon'
    const period = i.invoiceType === 'MONTHLY_RENT' ? monthLabel(i.billingPeriodStart ?? i.dueDate)
      : i.invoiceType === 'RENEWAL' ? `Gia hạn ${i.details[0]?.quantity ?? ''} tháng` : INVOICE_TYPE[i.invoiceType] ?? i.invoiceType
    return { key: `i${i.invoiceId}`, period, amount: i.totalAmount, due: i.dueDate, state, invoice: i.invoiceNumber }
  })
  if (c.status === 'Active' || c.status === 'Renewed') {
    const billed = new Set(invoices.filter((i) => i.invoiceType === 'MONTHLY_RENT').map((i) => i.billingPeriodStart ?? i.dueDate))
    let added = 0
    for (let k = 0; added < 2; k++) {
      const start = addMonths(c.startDate, k)
      if (start >= c.endDate) break
      if (asLocal(start).getTime() <= today || billed.has(start)) continue
      rows.push({ key: `s${start}`, period: monthLabel(start), amount: c.monthlyRentFee, due: start, state: 'scheduled', invoice: null })
      added++
    }
  }
  return rows
}

export default function ContractDetail() {
  const id = Number(useParams().id)
  const { user } = useAuth()
  const search = useLocation().search
  const wantRenew = search.includes('renew')
  const wantEarly = search.includes('return=early')
  const [c, setC] = useState<Detail | null>(null)
  const [renewals, setRenewals] = useState<Renewal[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [unit, setUnit] = useState<StorageUnit | null>(null)
  const [type, setType] = useState<UnitType | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [lastVisit, setLastVisit] = useState<AccessRecord | null>(null)
  const [showRenew, setShowRenew] = useState(wantRenew)
  const [showEarly, setShowEarly] = useState(wantEarly)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([
        api<Detail>(`/api/contracts/${id}`),
        api<Renewal[]>(`/api/contracts/${id}/renewals`),
      ])
      setC(d)
      setRenewals(r)
      // Secondary data: the page still works if any of these fail.
      void api<Invoice[]>('/api/invoices/my').then((all) => setInvoices(all.filter((i) => i.contractId === id))).catch(() => {})
      void api<StorageUnit[]>(`/api/facilities/${d.facilityId}/units`).then((us) => {
        const u = us.find((x) => x.unitId === d.unitId) ?? null
        setUnit(u)
        if (u) void api<UnitType[]>('/api/unit-types').then((ts) => setType(ts.find((t) => t.unitTypeId === u.unitTypeId) ?? null)).catch(() => {})
      }).catch(() => {})
      void api<Facility[]>('/api/facilities').then((fs) => setFacility(fs.find((f) => f.facilityId === d.facilityId) ?? null)).catch(() => {})
      void api<Person[]>(`/api/contracts/${id}/authorized-persons`).then(setPeople).catch(() => {})
      void api<AccessRecord[]>(`/api/contracts/${id}/access-history`).then((h) => setLastVisit(h.find((x) => x.result === 'Granted') ?? null)).catch(() => {})
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  if (!c) {
    return (
      <div className="container page-body">
        {error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}
        <Link to="/my-units" className="link">← Về Kho Của Tôi</Link>
      </div>
    )
  }

  const left = daysUntil(c.endDate)
  const ended = c.status === 'Terminated' || c.status === 'Liquidated'
  const locked = c.unitStatus === 'OverdueLocked' || c.status === 'Overdue'
  const typeName = unit ? splitTypeName(unit.unitTypeName) : null
  const pending = renewals.find((r) => r.status === 'Pending')
  const schedule = paymentSchedule(c, invoices)
  const next = schedule.find((r) => r.state !== 'paid' && r.state !== 'cancelled')
  const area = type ? Math.round(type.lengthMeters * type.widthMeters * 100) / 100 : null
  // Until the day before the end date the customer can ask to hand the unit back early; on the end date it is a normal return.
  const canReturnEarly = c.status === 'Active' && left > 0

  return (
    <>
      <section className="page-hero detail-hero">
        <div className="container">
          <div className="grow">
            <nav className="crumbs"><Link to="/my-units">Kho Của Tôi</Link><span>/</span><b>{c.unitCode}</b></nav>
            <h1>Chi Tiết Kho & Hợp Đồng</h1>
            <p>Theo dõi quyền truy cập, thời hạn, thanh toán và các thao tác hợp đồng của kho {c.unitCode}{typeName ? ` · ${typeName.name}` : ''}.</p>
          </div>
          <div className="hero-side">
            {c.status === 'Active' ? <span className="badge ok">Đang hoạt động</span> : <StatusBadge status={c.status} />}
            <small>Hợp đồng {c.contractNumber}</small>
          </div>
        </div>
      </section>

      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <div className="detail-grid detail-cols">
          <div className="stack-lg detail-main">
          {/* row 1 left: the unit */}
          <>
            <section className="panel unit-panel">
              <div className="unit-photo"><UnitArt variant={unit ? unit.unitTypeId - 1 : 2} /></div>
              <div className="row between wrap">
                <div>
                  <h2 className="unit-title">{typeName?.name ?? `Kho ${c.unitCode}`}{area ? ` ${area.toLocaleString('vi-VN')}m²` : ''}</h2>
                  <p className="muted">Mã kho {c.unitCode} · {c.facilityName}</p>
                </div>
                <span className={`badge ${locked ? 'bad' : ended ? 'muted' : 'ok'}`}>{locked ? 'Khóa do quá hạn' : ended ? 'Đã trả kho' : 'Truy cập bình thường'}</span>
              </div>
              <dl className="spec-grid">
                <div><dt>Cơ sở</dt><dd>{c.facilityName}</dd></div>
                <div><dt>Điều hòa</dt><dd>{type ? (type.hasClimateControl ? 'Có kiểm soát nhiệt độ' : 'Không') : '—'}</dd></div>
                <div><dt>Vị trí</dt><dd>{unit ? `Tầng ${unit.floorNumber}${unit.zoneArea ? ` · ${unit.zoneArea}` : ''}` : '—'}</dd></div>
                <div><dt>Giờ mở cửa</dt><dd>{facility?.operatingHours ?? '—'}</dd></div>
                <div><dt>Kích thước</dt><dd>{type ? `${type.lengthMeters}m × ${type.widthMeters}m × ${type.heightMeters}m` : '—'}</dd></div>
                <div><dt>Trạng thái kho</dt><dd><StatusBadge status={c.unitStatus} /></dd></div>
              </dl>
            </section>

            {locked && (
              <section className="panel alert-panel">
                <h3 className="panel-title"><Icon name="lock" size={18} /> Kho đang bị khóa do quá hạn</h3>
                <p className="muted">Kho bị khóa sau 24 giờ kể từ 20:00 ngày hết hạn. Phí lưu kho quá hạn tính mỗi ngày bằng phí tháng / 30 và được cấn trừ vào tiền cọc. Vui lòng đến cơ sở để trả kho.</p>
                <dl className="summary-lines">
                  <div><dt>Phí quá hạn đã tính</dt><dd>{fmtMoney(c.accumulatedLateFee)}</dd></div>
                  <div><dt>Cọc còn lại sau cấn trừ</dt><dd>{fmtMoney(c.depositBalance)}</dd></div>
                  <div><dt>Còn phải thanh toán</dt><dd className="danger-text">{fmtMoney(c.outstandingLateFee)}</dd></div>
                </dl>
              </section>
            )}
          </>

          <section className="panel stack contract-actions">
            <div><h3 className="panel-title">Thao Tác Hợp Đồng</h3><p className="muted">Gia hạn, trả kho, tạm ngưng và các yêu cầu khác cho hợp đồng {c.contractNumber}.</p></div>
            {showRenew && <RenewalPanel contract={c} renewals={renewals} onChanged={load} />}
            <div className="action-tiles">
              {!ended && <Link to={`/my-units/${c.contractId}/move-in`} className="action-tile"><span className="tile-icon"><Icon name="package" size={18} /></span><b>Đưa đồ vào kho</b><small>Khai báo đồ và lịch chuyển</small></Link>}
              {!ended && <Link to={`/support?contract=${c.contractId}`} className="action-tile"><span className="tile-icon"><Icon name="alert" size={18} /></span><b>Báo sự cố</b><small>Gửi yêu cầu hỗ trợ</small></Link>}
              {canReturnEarly
                ? <button type="button" className={`action-tile ${showEarly ? 'active' : ''}`} aria-expanded={showEarly} onClick={() => setShowEarly(!showEarly)}><span className="tile-icon"><Icon name="logout" size={18} /></span><b>Trả kho sớm</b><small>Trước ngày {fmtDate(c.endDate)}</small></button>
                : !ended && <Link to={`/support?contract=${c.contractId}&topic=return`} className="action-tile"><span className="tile-icon"><Icon name="logout" size={18} /></span><b>Yêu cầu trả kho</b><small>Hẹn ngày trả với cơ sở</small></Link>}
              {!ended && <Link to={`/my-units/${c.contractId}/suspend`} className="action-tile"><span className="tile-icon"><Icon name="clock" size={18} /></span><b>Tạm ngưng hợp đồng</b><small>30–90 ngày</small></Link>}
              <Link to={`/my-units/${c.contractId}/policy`} className="action-tile"><span className="tile-icon"><Icon name="clipboard" size={18} /></span><b>Xem policy hợp đồng</b><small>Điều khoản đang áp dụng</small></Link>
              <Link to="/account/security" className="action-tile"><span className="tile-icon"><Icon name="shield" size={18} /></span><b>Bảo mật & nhật ký</b><small>Lịch sử vào kho, đăng nhập</small></Link>
            </div>
            {showEarly && canReturnEarly && <EarlyReturnPanel contract={c} facility={facility} />}
          </section>
          {/* row 2 left: payments */}
          <section className="panel">
            <div>
              <h3 className="panel-title">Lịch Thanh Toán & Hóa Đơn</h3>
              <p className="muted">{next ? `Kỳ tiếp theo: ${fmtDate(next.due)}` : 'Không còn kỳ thanh toán nào'}</p>
            </div>
            <div className="table-scroll">
              <table className="schedule-table">
                <thead><tr><th>Kỳ thanh toán</th><th>Số tiền</th><th>Ngày đến hạn</th><th>Trạng thái</th><th>Hóa đơn</th></tr></thead>
                <tbody>
                  {schedule.map((r) => (
                    <tr key={r.key}>
                      <td>{r.period}</td>
                      <td className="money">{fmtMoney(r.amount)}</td>
                      <td>{fmtDate(r.due)}</td>
                      <td><span className={`badge ${STATE_BADGE[r.state].tone}`}>{STATE_BADGE[r.state].label}</span></td>
                      <td>{r.invoice ? <Link to="/invoices" className="code">{r.invoice}</Link> : <b className="plain-strong">Chưa phát hành</b>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {schedule.length === 0 && <Empty icon="wallet">Chưa có kỳ thanh toán nào cho hợp đồng này.</Empty>}
            </div>
            <div className="row between wrap">
              <small className="muted">Thanh toán online qua VNPay hoặc tại quầy cơ sở.</small>
              <Link to="/invoices" className="btn soft sm"><Icon name="card" size={14} /> Quản lý thanh toán</Link>
            </div>
          </section>

          </div>
          <div className="stack-lg detail-side">
          {/* row 1 right: the contract */}
          <section className="panel contract-card">
            <h3 className="panel-title">Thông Tin Hợp Đồng</h3>
            <div className="price-box">
              <div className="row between"><small className="muted">Mã hợp đồng</small><b>{c.contractNumber}</b></div>
              <div><b className="price-big">{fmtMoney(c.monthlyRentFee)}</b> <small className="muted">/ tháng</small></div>
            </div>
            <div className="info-row"><span className="muted">Ngày bắt đầu</span><b>{fmtDate(c.startDate)}</b></div>
            <div className="info-row"><span className="muted">Ngày hết hạn</span><b>{fmtDate(c.endDate)}</b></div>
            <div className="info-row"><span className="muted">Thời gian còn lại</span>
              <b className={ended ? '' : left <= 7 ? 'warn-text' : 'cyan'}>{ended ? 'Đã kết thúc' : left > 0 ? `${left} ngày` : left === 0 ? 'Hết hạn hôm nay' : `Quá ${-left} ngày`}</b></div>
            <div className="info-row"><span className="muted">Chu kỳ thanh toán</span><b>Hàng tháng</b></div>
            <div className="info-row"><span className="muted">Tiền cọc</span><b>{fmtMoney(c.depositPaid)}</b></div>
            {c.accumulatedLateFee > 0 && <>
              <div className="info-row"><span className="muted">Phí quá hạn</span><b className="danger-text">{fmtMoney(c.accumulatedLateFee)}</b></div>
              <div className="info-row"><span className="muted">Số dư cọc</span><b>{fmtMoney(c.depositBalance)}</b></div>
            </>}
            {!ended && (
              <div className="row wrap">
                <Link to={`/my-units/${c.contractId}/renew`} className="btn primary"><Icon name="calendar" size={15} /> {pending ? 'Xem yêu cầu gia hạn' : 'Gia hạn hợp đồng'}</Link>
                <button className="btn ghost sm" onClick={() => setShowRenew(!showRenew)}>{showRenew ? 'Ẩn gia hạn nhanh' : 'Gia hạn nhanh'}</button>
              </div>
            )}
            {!readPolicyAcks()[c.contractNumber] && !ended && (
              <div className="notice warn-notice">
                <span className="notice-icon warn"><Icon name="clipboard" size={16} /></span>
                <div className="grow"><b>Bạn chưa xác nhận policy hợp đồng</b><p>Xem lại điều khoản đang áp dụng và tích xác nhận, không cần ký. <Link to={`/my-units/${c.contractId}/policy`} className="link">Xem & xác nhận</Link></p></div>
              </div>
            )}
          </section>

          {/* row 2 right: access */}
          <section className="panel">
            <div>
              <h3 className="panel-title">Quyền Truy Cập</h3>
              <p className="muted">Chỉ hiển thị cho chủ hợp đồng</p>
            </div>
            <div className={`access-state ${locked || ended ? 'off' : 'on'}`}>
              <b>Trạng thái truy cập</b>
              <span>{ended ? 'Đã kết thúc' : locked ? 'Đang khóa' : 'Đang bật'}</span>
            </div>
            <div className="info-row"><span className="muted">Chủ hợp đồng</span><b>{user?.fullName ?? '—'}</b></div>
            <div className="info-row"><span className="muted">Người được ủy quyền</span><b>{people.length} người</b></div>
            <div className="info-row"><span className="muted">Xác thực</span><b>CCCD tại cổng</b></div>
            <div className="info-row"><span className="muted">Khung giờ</span><b>{facility?.operatingHours ?? '—'}</b></div>
            <div className="info-row"><span className="muted">Lần vào gần nhất</span><b>{lastVisit ? fmtTime(lastVisit.entryTime) : 'Chưa có'}</b></div>
            <div className="action-grid">
              {!ended && !locked && <Link to={`/my-units/${c.contractId}/visit`} className="btn primary sm"><Icon name="calendar" size={14} /> Đăng ký vào kho</Link>}
              <Link to={`/my-units?contract=${c.contractId}&tab=people`} className="btn soft sm"><Icon name="users" size={14} /> Quản lý người ủy quyền</Link>
              <Link to={`/my-units?contract=${c.contractId}&tab=history`} className="btn soft sm"><Icon name="shield" size={14} /> Bảo mật & nhật ký</Link>
            </div>
          </section>
          </div>
        </div>
      </div>
    </>
  )
}

const MONTH_CHOICES = [1, 3, 6, 12]

/** Request a renewal: open for the whole term (early renewal) until 20:00 on the end date; the new term continues from the current end date. */
function RenewalPanel({ contract: c, renewals, onChanged }: { contract: Detail; renewals: Renewal[]; onChanged: () => Promise<void> }) {
  const [months, setMonths] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const now = new Date()
  const opensAt = new Date(c.renewalAvailableFrom)
  const closesAt = asLocal(c.endDate)
  closesAt.setHours(20, 0, 0, 0)
  const pending = renewals.find((r) => r.status === 'Pending')
  const windowOpen = c.status === 'Active' && now >= opensAt && now < closesAt

  const submit = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/api/contracts/${c.contractId}/renewals`, { body: { extensionMonths: months } })
      setNotice('Đã gửi yêu cầu gia hạn và tạo hóa đơn. Thanh toán ở mục Hóa Đơn hoặc tại quầy để hoàn tất.')
      await onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="renew-box">
      {pending ? (
        <div className="notice">
          <span className="notice-icon warn"><Icon name="wallet" size={16} /></span>
          <div>
            <b>Yêu cầu gia hạn {pending.extensionMonths} tháng đang chờ thanh toán</b>
            <p>Phí {fmtMoney(pending.renewalFee)} — thanh toán ở <Link to="/invoices" className="link">Hóa Đơn</Link> hoặc tại quầy trước 20:00 ngày {fmtDate(pending.oldEndDate)}. Sau khi thanh toán, ngày hết hạn đổi thành <b>{fmtDate(pending.newEndDate)}</b>.</p>
          </div>
        </div>
      ) : windowOpen ? (
        <div className="stack">
          <b>Chọn thời gian gia hạn</b>
          <small className="muted">Gia hạn sớm không mất ngày nào: thời hạn mới được cộng tiếp từ ngày hết hạn hiện tại.</small>
          <div className="segmented self-start">
            {MONTH_CHOICES.map((m) => (
              <button key={m} className={months === m ? 'active' : ''} onClick={() => setMonths(m)}>{m} tháng</button>
            ))}
          </div>
          <dl className="summary-lines">
            <div><dt>Hết hạn hiện tại</dt><dd>{fmtDate(c.endDate)}</dd></div>
            <div><dt>Hết hạn mới</dt><dd>{fmtDate(addMonths(c.endDate, months))}</dd></div>
            <div><dt>Phí gia hạn ({months} × {fmtMoney(c.monthlyRentFee)})</dt><dd className="cyan">{fmtMoney(months * c.monthlyRentFee)}</dd></div>
          </dl>
          <button className="btn primary block" onClick={submit} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi Yêu Cầu Gia Hạn'}</button>
        </div>
      ) : c.status === 'Active' && now < opensAt ? (
        <p className="hint"><Icon name="calendar" size={15} /> Bạn có thể gửi yêu cầu gia hạn từ ngày <b>{fmtDate(c.renewalAvailableFrom)}</b>.</p>
      ) : (
        <p className="hint"><Icon name="alert" size={15} /> Hợp đồng không còn trong thời gian được gia hạn. Liên hệ cơ sở nếu bạn cần hỗ trợ.</p>
      )}
      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {renewals.length > 0 && (
        <div className="stack-sm">
          <small className="muted"><b>Lịch sử gia hạn</b></small>
          {renewals.map((r) => (
            <div key={r.renewalId} className="info-row">
              <span className="muted">{fmtTime(r.requestedAt)} · {r.extensionMonths} tháng · {fmtMoney(r.renewalFee)}</span>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const EARLY_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  Pending: { label: 'Chờ trả kho', tone: 'warn' },
  Completed: { label: 'Đã trả kho', tone: 'ok' },
  Cancelled: { label: 'Đã hủy', tone: 'muted' },
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Ask to hand the unit back before the end date: pick the day, give a reason and see the fee and the deposit
 * left before sending. While the request is pending it can be cancelled; staff finish it at the facility.
 */
function EarlyReturnPanel({ contract: c, facility }: { contract: Detail; facility: Facility | null }) {
  const navigate = useNavigate()
  const today = isoDay(new Date())
  const lastDay = isoDay(new Date(asLocal(c.endDate).getTime() - DAY))
  const [requests, setRequests] = useState<EarlyReturnRequest[] | null>(null)
  const [date, setDate] = useState(today)
  const [reason, setReason] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [quote, setQuote] = useState<EarlyReturnQuote | null>(null)
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadRequests = useCallback(() => api<EarlyReturnRequest[]>(`/api/contracts/${c.contractId}/early-return-requests`)
    .then(setRequests).catch(() => setRequests([])), [c.contractId])
  useEffect(() => { void loadRequests() }, [loadRequests])
  useEffect(() => {
    if (!date) return
    api<EarlyReturnQuote>(`/api/contracts/${c.contractId}/early-return-quote?returnDate=${date}`)
      .then((q) => { setQuote(q); setQuoteFailed(false) }).catch(() => { setQuote(null); setQuoteFailed(true) })
  }, [c.contractId, date])

  const pending = requests?.find((r) => r.status === 'Pending')
  const errors = {
    date: !date ? 'Vui lòng chọn ngày trả kho' : date < today || date > lastDay ? `Chọn ngày từ hôm nay đến ${fmtDate(lastDay)} (trước ngày hết hạn)` : null,
    reason: textError(reason, 'Lý do trả sớm', 5, 500),
    agreed: agreed ? null : 'Vui lòng xác nhận đã đọc điều kiện trả kho sớm',
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    setError('')
    if (Object.values(errors).some(Boolean)) return
    setBusy(true)
    try {
      await api(`/api/contracts/${c.contractId}/early-return-requests`, { body: { returnDate: date, reason: reason.trim() } })
      // Open the request page: the contract, the early-return policy and the expected refund.
      navigate(`/my-units/${c.contractId}/early-return`)
      return
    } catch (err) {
      // 404/405: the server does not offer early-return requests yet.
      setError(err instanceof ApiError && (err.status === 404 || err.status === 405)
        ? `Chưa gửi được yêu cầu trả kho sớm trực tuyến. Vui lòng liên hệ ${c.facilityName}${facility ? ` (${facility.hotline})` : ''} để hẹn trả kho.`
        : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (r: EarlyReturnRequest) => {
    if (!window.confirm('Hủy yêu cầu trả kho sớm? Hợp đồng sẽ tiếp tục đến ngày hết hạn.')) return
    setError('')
    setNotice('')
    try {
      await api(`/api/contracts/${c.contractId}/early-return-requests/${r.requestId}`, { method: 'DELETE' })
      setNotice('Đã hủy yêu cầu trả kho sớm.')
      await loadRequests()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="renew-box">
      {!requests ? <p className="muted">Đang tải…</p> : pending ? (
        <div className="notice">
          <span className="notice-icon warn"><Icon name="logout" size={16} /></span>
          <div className="grow">
            <b>Yêu cầu trả kho sớm ngày {fmtDate(pending.returnDate)} đang chờ</b>
            <p>Mang CCCD đến {c.facilityName}{facility ? ` (${facility.operatingHours})` : ''} đúng ngày hẹn. Nhân viên kiểm tra kho cùng bạn rồi hoàn cọc sau khi trừ phí trả sớm {fmtMoney(pending.earlyReturnFee)}.</p>
            <p className="muted">Lý do: {pending.reason}</p>
            <div className="row wrap">
              <Link to={`/my-units/${c.contractId}/early-return`} className="btn primary sm"><Icon name="file" size={14} /> Xem chi tiết yêu cầu</Link>
              <button type="button" className="btn outline sm" onClick={() => void cancel(pending)}>Hủy yêu cầu</button>
            </div>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <b>Trả kho trước ngày hết hạn {fmtDate(c.endDate)}</b>
          <ul className="policy-list early-policy">
            <li>Tiền thuê đã trả không được hoàn; hóa đơn tiền thuê chưa thanh toán của các kỳ sau ngày trả kho được hủy.</li>
            <li>Phí trả kho sớm trừ vào tiền cọc {fmtMoney(c.depositPaid)}, phần cọc còn lại hoàn sau khi nhân viên kiểm tra kho đạt.</li>
            <li>Đến trả kho đúng ngày đã hẹn, trước 20:00, mang CCCD của chủ hợp đồng; dọn hết đồ ra khỏi kho.</li>
            <li>Có thể hủy yêu cầu khi nhân viên chưa nhận trả kho.</li>
            <li><Link to={`/my-units/${c.contractId}/policy`} className="link">Xem toàn bộ điều khoản & chính sách hợp đồng</Link></li>
          </ul>
          <FormField label="Ngày bạn đến trả kho" error={tried ? errors.date : null}>
            <input type="date" value={date} min={today} max={lastDay} onChange={(e) => setDate(e.target.value)} aria-invalid={tried && errors.date ? true : undefined} />
          </FormField>
          {quote && !errors.date ? (
            <dl className="summary-lines">
              <div><dt>Trả sớm</dt><dd>{quote.daysEarly} ngày</dd></div>
              <div><dt>Phí trả kho sớm</dt><dd>{fmtMoney(quote.earlyReturnFee)}</dd></div>
              {quote.lateFees > 0 && <div><dt>Phí quá hạn</dt><dd>{fmtMoney(quote.lateFees)}</dd></div>}
              <div><dt>Tiền cọc</dt><dd>{fmtMoney(quote.depositPaid)}</dd></div>
              <div><dt>Dự kiến hoàn cọc</dt><dd className="cyan">{fmtMoney(quote.depositRefundDue)}</dd></div>
            </dl>
          ) : quoteFailed && <p className="hint"><Icon name="wallet" size={15} /> Phí trả sớm theo chính sách của cơ sở, nhân viên báo cụ thể khi bạn đến trả kho.</p>}
          <FormField label="Lý do trả sớm" error={tried ? errors.reason : null} hint={`${reason.trim().length}/500 ký tự`}>
            <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={tried && errors.reason ? true : undefined}
              placeholder="vd: Tôi chuyển nhà sớm, không cần lưu kho nữa" />
          </FormField>
          <label className="check-row"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            Tôi hiểu tiền thuê đã trả không được hoàn và phí trả sớm được trừ vào tiền cọc.</label>
          {tried && errors.agreed && <small className="field-error"><Icon name="alert" size={12} /> {errors.agreed}</small>}
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu trả kho sớm'}</button>
        </form>
      )}
      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {requests && requests.some((r) => r.status !== 'Pending') && (
        <div className="stack-sm">
          <small className="muted"><b>Yêu cầu trước đây</b></small>
          {requests.filter((r) => r.status !== 'Pending').map((r) => (
            <div key={r.requestId} className="info-row">
              <span className="muted">{fmtTime(r.requestedAt)} · trả ngày {fmtDate(r.returnDate)}</span>
              <Badge tone={EARLY_STATUS[r.status]?.tone ?? 'muted'}>{EARLY_STATUS[r.status]?.label ?? r.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
