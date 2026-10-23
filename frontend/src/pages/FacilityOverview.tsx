import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import { SupportPriorities, type FacilityDashboard, type FacilityWorkQueue } from '../types'

/**
 * Facility manager home (#43, Figma "storage-management"): KPIs of the facility over a date range
 * (GET /api/facilities/{id}/dashboard) and the work of one day (GET /api/facilities/{id}/daily-operations):
 * pick-ups booked, units due back, support tickets still open.
 */

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }

export default function FacilityOverview() {
  const { facilityId, facilities } = useStaffFacility()
  const [from, setFrom] = useState(() => daysAgo(29))
  const [to, setTo] = useState(() => iso(new Date()))
  const [day, setDay] = useState(() => iso(new Date()))
  const [kpi, setKpi] = useState<FacilityDashboard | null>(null)
  const [work, setWork] = useState<FacilityWorkQueue | null>(null)
  const [error, setError] = useState('')

  const loadKpi = useCallback(async () => {
    if (!facilityId) return
    setError('')
    try {
      setKpi(await api<FacilityDashboard>(`/api/facilities/${facilityId}/dashboard?fromDate=${from}&toDate=${to}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId, from, to])
  useEffect(() => { void loadKpi() }, [loadKpi])

  useEffect(() => {
    if (!facilityId) return
    api<FacilityWorkQueue>(`/api/facilities/${facilityId}/daily-operations?date=${day}`).then(setWork).catch((e) => setError((e as Error).message))
  }, [facilityId, day])

  const facility = facilities.find((f) => f.facilityId === facilityId)
  const occupied = kpi ? kpi.rentedUnits + kpi.overdueLockedUnits : 0
  const occupancy = kpi?.totalUnits ? Math.round((occupied / kpi.totalUnits) * 100) : 0
  const isToday = day === iso(new Date())

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Tổng Quan Cơ Sở</h1>
          <p className="muted">{facility ? `${facility.facilityName} · ${facility.address}, ${facility.district}` : 'Tình hình kho, hợp đồng và doanh thu của cơ sở bạn quản lý.'}</p>
        </div>
        <div className="date-range">
          <label><span>Từ ngày</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span>Đến ngày</span><input type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid">
        <Metric icon="chart" tone="info" label="Tỷ lệ lấp đầy" value={`${occupancy}%`} note={kpi ? `${occupied}/${kpi.totalUnits} kho đang có khách` : '—'} />
        <Metric icon="package" tone="ok" label="Kho còn trống" value={String(kpi?.availableUnits ?? 0)} note={kpi?.maintenanceUnits ? `${kpi.maintenanceUnits} kho đang bảo trì` : 'không có kho bảo trì'} />
        <Metric icon="clipboard" tone={kpi?.overdueContracts ? 'bad' : 'ok'} label="Hợp đồng hiệu lực" value={String(kpi?.activeContracts ?? 0)} note={kpi?.overdueContracts ? `${kpi.overdueContracts} hợp đồng quá hạn` : 'không có hợp đồng quá hạn'} />
        <Metric icon="wallet" tone="warn" label="Doanh thu thuần" value={fmtMoney(kpi?.netRevenue ?? 0)} note={kpi ? `${fmtDate(kpi.fromDate)} – ${fmtDate(kpi.toDate)}, đã trừ hoàn tiền` : '—'} />
      </div>

      {kpi && kpi.totalUnits > 0 && (
        <section className="panel">
          <div className="panel-head wrap">
            <h2 className="panel-title">Tình trạng {kpi.totalUnits} kho</h2>
            <Link to="/facility-units" className="link">Quản lý kho <Icon name="arrowRight" size={14} /></Link>
          </div>
          <div className="unit-bar" role="img" aria-label="Tỷ lệ kho theo trạng thái">
            {UNIT_SEGMENTS.map((s) => {
              const n = kpi[s.key]
              return n > 0 ? <span key={s.key} className={s.tone} style={{ flexGrow: n }} title={`${s.label}: ${n}`} /> : null
            })}
          </div>
          <div className="unit-legend">
            {UNIT_SEGMENTS.map((s) => <span key={s.key}><i className={s.tone} />{s.label} <b>{kpi[s.key]}</b></span>)}
            <span><Icon name="phone" size={14} /> Ticket đang mở <b>{kpi.openSupportRequests}</b></span>
          </div>
        </section>
      )}

      <section className="stack">
        <div className="row between wrap">
          <div>
            <h2 className="section-title">Việc {isToday ? 'hôm nay' : `ngày ${fmtDate(day)}`}</h2>
            <p className="muted">Lịch khách đến nhận kho, kho đến hạn trả và ticket hỗ trợ cần xử lý.</p>
          </div>
          <label className="date-range single"><span>Ngày</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        </div>
        <div className="work-grid">
          <WorkColumn icon="key" title="Lịch nhận kho" count={work?.checkIns.length} link="/reservations" linkLabel="Mở đặt kho & nhận kho">
            {work?.checkIns.map((r) => (
              <li key={r.reservationId}>
                <span className="work-time">{r.checkInAppointmentAt ? r.checkInAppointmentAt.slice(11, 16) : '—'}</span>
                <span className="grow"><b>{r.customerName}</b><small>{r.reservationCode} · {splitTypeName(r.unitTypeName).name}</small></span>
                {!r.checkInAppointmentAt && <span className="badge warn">Chưa hẹn giờ</span>}
              </li>
            ))}
            {work && work.checkIns.length === 0 && <Empty icon="calendar">Không có khách hẹn nhận kho.</Empty>}
          </WorkColumn>
          <WorkColumn icon="door" title="Kho đến hạn trả" count={work?.returns.length} link="/staff-return" linkLabel="Mở trả kho & hoàn cọc">
            {work?.returns.map((c) => (
              <li key={c.contractId}>
                <span className="work-time">{c.unitCode}</span>
                <span className="grow"><b>{c.customerName}</b><small>{c.contractNumber} · cọc {fmtMoney(c.depositPaid)}{c.accumulatedLateFee > 0 && ` · phí trễ ${fmtMoney(c.accumulatedLateFee)}`}</small></span>
                <StatusBadge status={c.status} />
              </li>
            ))}
            {work && work.returns.length === 0 && <Empty icon="door">Không có kho đến hạn trả.</Empty>}
          </WorkColumn>
          <WorkColumn icon="phone" title="Ticket đang mở" count={work?.supportRequests.length} link="/staff-support" linkLabel="Mở hỗ trợ khách hàng">
            {work?.supportRequests.map((t) => {
              const p = SupportPriorities[t.priority] ?? { label: t.priority, tone: 'muted' as const }
              return (
                <li key={t.requestId}>
                  <span className="work-time">{t.unitCode || '—'}</span>
                  <span className="grow"><b>{t.title}</b><small>{t.requestCode} · {t.assignedStaffName ?? 'chưa phân công'}</small></span>
                  <span className={`badge ${p.tone}`}>{p.label}</span>
                </li>
              )
            })}
            {work && work.supportRequests.length === 0 && <Empty icon="check">Không có ticket đang mở.</Empty>}
          </WorkColumn>
        </div>
      </section>
    </div>
  )
}

const UNIT_SEGMENTS = [
  { key: 'availableUnits', label: 'Còn trống', tone: 'ok' },
  { key: 'rentedUnits', label: 'Đang cho thuê', tone: 'info' },
  { key: 'maintenanceUnits', label: 'Bảo trì', tone: 'warn' },
  { key: 'overdueLockedUnits', label: 'Khóa quá hạn', tone: 'bad' },
] as const

function WorkColumn({ icon, title, count, link, linkLabel, children }: { icon: string; title: string; count?: number; link: string; linkLabel: string; children: ReactNode }) {
  return (
    <section className="panel work-col">
      <div className="panel-head">
        <h3 className="panel-title"><span className="stat-icon info"><Icon name={icon} size={16} /></span>{title}</h3>
        <span className="count-pill">{count ?? '…'}</span>
      </div>
      <ul className="work-list">{children}</ul>
      <Link to={link} className="link">{linkLabel} <Icon name="arrowRight" size={14} /></Link>
    </section>
  )
}

export function Metric({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: string; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}
