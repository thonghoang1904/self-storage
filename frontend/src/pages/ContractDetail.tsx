import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Empty, Icon, StatusBadge, UnitArt, splitTypeName } from '../components/ui'
import type { AccessRecord, ContractDetail as Detail, Facility, Invoice, Person, Renewal, StorageUnit, UnitType } from '../types'

/**
 * Figma "customer-storage-contract-detail": the unit and its contract, the contract's invoices,
 * access status, overdue fees / deposit balance and the renewal request (GET /api/contracts/{id},
 * GET/POST /api/contracts/{id}/renewals).
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
const INVOICE_TYPE: Record<string, string> = { DEPOSIT: 'Tiền cọc', RENEWAL: 'Gia hạn', MONTHLY_RENT: 'Tiền thuê', OVERDUE_FINE: 'Phí quá hạn' }

export default function ContractDetail() {
  const id = Number(useParams().id)
  const wantRenew = useLocation().search.includes('renew')
  const [c, setC] = useState<Detail | null>(null)
  const [renewals, setRenewals] = useState<Renewal[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [unit, setUnit] = useState<StorageUnit | null>(null)
  const [type, setType] = useState<UnitType | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [lastVisit, setLastVisit] = useState<AccessRecord | null>(null)
  const [showRenew, setShowRenew] = useState(wantRenew)
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
            <StatusBadge status={c.status} />
            <small>Hợp đồng {c.contractNumber}</small>
          </div>
        </div>
      </section>

      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <div className="detail-grid">
          {/* left column */}
          <div className="stack-lg">
            <section className="panel unit-panel">
              <div className="unit-photo"><UnitArt variant={unit ? unit.unitTypeId - 1 : 2} /></div>
              <div className="row between wrap">
                <div>
                  <h2 className="unit-title">{typeName?.name ?? `Kho ${c.unitCode}`} {typeName?.size && <small>{typeName.size}</small>}</h2>
                  <p className="muted">Mã kho {c.unitCode} · {c.facilityName}</p>
                </div>
                <span className={`badge ${locked ? 'bad' : ended ? 'muted' : 'ok'}`}>{locked ? 'Khóa do quá hạn' : ended ? 'Đã trả kho' : 'Truy cập bình thường'}</span>
              </div>
              <dl className="spec-grid">
                <div><dt>Cơ sở</dt><dd>{c.facilityName}</dd></div>
                <div><dt>Vị trí</dt><dd>{unit ? `Tầng ${unit.floorNumber}${unit.zoneArea ? ` · ${unit.zoneArea}` : ''}` : '—'}</dd></div>
                <div><dt>Kích thước</dt><dd>{type ? `${type.lengthMeters}m × ${type.widthMeters}m × ${type.heightMeters}m` : '—'}</dd></div>
                <div><dt>Điều hòa</dt><dd>{type ? (type.hasClimateControl ? 'Có kiểm soát nhiệt độ' : 'Không') : '—'}</dd></div>
                <div><dt>Giờ mở cửa</dt><dd>{facility?.operatingHours ?? '—'}</dd></div>
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

            <section className="panel">
              <div>
                <h3 className="panel-title">Lịch Thanh Toán & Hóa Đơn</h3>
                <p className="muted">Phí thuê {fmtMoney(c.monthlyRentFee)}/tháng · hết hạn {fmtDate(c.endDate)}</p>
              </div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Khoản</th><th>Số tiền</th><th>Ngày đến hạn</th><th>Trạng thái</th><th>Hóa đơn</th></tr></thead>
                  <tbody>
                    {invoices.map((i) => (
                      <tr key={i.invoiceId}>
                        <td>{INVOICE_TYPE[i.invoiceType] ?? i.invoiceType}<br /><small className="muted">{i.details[0]?.description}</small></td>
                        <td className="money">{fmtMoney(i.totalAmount)}</td>
                        <td>{fmtDate(i.dueDate)}</td>
                        <td><StatusBadge status={i.status} /></td>
                        <td className="code">{i.invoiceNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {invoices.length === 0 && <Empty icon="wallet">Chưa có hóa đơn nào gắn với hợp đồng này.</Empty>}
              </div>
              <div className="row between wrap">
                <small className="muted">Thanh toán online qua VNPay / MoMo hoặc tại quầy cơ sở.</small>
                <Link to="/invoices" className="btn outline sm"><Icon name="card" size={14} /> Quản lý thanh toán</Link>
              </div>
            </section>
          </div>

          {/* right column */}
          <div className="stack-lg">
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
              <div className="info-row"><span className="muted">Lịch trả kho</span><b>20:00 · {fmtDate(c.endDate)}</b></div>
              <div className="info-row"><span className="muted">Tiền cọc</span><b>{fmtMoney(c.depositPaid)}</b></div>
              <div className="info-row"><span className="muted">Phí quá hạn</span><b className={c.accumulatedLateFee > 0 ? 'danger-text' : ''}>{fmtMoney(c.accumulatedLateFee)}</b></div>
              <div className="info-row"><span className="muted">Số dư cọc</span><b>{fmtMoney(c.depositBalance)}</b></div>
              {!ended && (
                <button className="btn primary self-start" onClick={() => setShowRenew(!showRenew)}>
                  <Icon name="calendar" size={15} /> {pending ? 'Xem yêu cầu gia hạn' : 'Gia hạn hợp đồng'}
                </button>
              )}
              {showRenew && <RenewalPanel contract={c} renewals={renewals} onChanged={load} />}
            </section>

            <section className="panel">
              <div>
                <h3 className="panel-title">Quyền Truy Cập</h3>
                <p className="muted">Ra vào bằng CCCD, nhân viên cổng đối chiếu mỗi lượt.</p>
              </div>
              <div className={`access-state ${locked || ended ? 'off' : 'on'}`}>
                <b>Trạng thái truy cập</b>
                <span>{ended ? 'Đã kết thúc' : locked ? 'Đang khóa' : 'Đang bật'}</span>
              </div>
              <div className="info-row"><span className="muted">Xác thực</span><b>CCCD chủ hợp đồng</b></div>
              <div className="info-row"><span className="muted">Người được ủy quyền</span><b>{people.length} người</b></div>
              <div className="info-row"><span className="muted">Khung giờ</span><b>{facility?.operatingHours ?? '—'}</b></div>
              <div className="info-row"><span className="muted">Lần vào gần nhất</span><b>{lastVisit ? fmtTime(lastVisit.entryTime) : 'Chưa có'}</b></div>
              <Link to="/my-units" className="btn outline sm self-start"><Icon name="users" size={14} /> Quản lý người ủy quyền</Link>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}

const MONTH_CHOICES = [1, 3, 6, 12]

/** Request a renewal (open from 7 days before the end date until 20:00 on the end date). */
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
        <p className="hint"><Icon name="calendar" size={15} /> Bạn có thể gửi yêu cầu gia hạn từ ngày <b>{fmtDate(c.renewalAvailableFrom)}</b> (7 ngày trước khi hết hạn).</p>
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
