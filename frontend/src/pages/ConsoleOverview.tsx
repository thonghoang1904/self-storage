import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import { useAuth } from '../auth'
import { daysUntil, fetchContracts, monthRange, timeAgo } from '../consoleData'
import { Badge, Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import type { AdminContract, OperationsReport, OperationsReportRow } from '../types'
import { Metric } from './FacilityOverview'

/**
 * "Tổng Quan" of the system administrator (/admin) and the operations manager (/ops), Figma "admin-dashboard".
 * Revenue of this month and the last six (GET /api/operations/reports/facilities per month), occupancy by unit
 * type (GET /api/operations/reports/details) and open support tickets. The administrator also sees the latest
 * contracts and those ending within 30 days (GET /api/admin/contracts); the operations manager, who cannot read
 * contracts, sees how each facility is doing instead.
 */

const MONTHS = 6
const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

export default function ConsoleOverview({ admin }: { admin: boolean }) {
  const { user } = useAuth()
  const [trend, setTrend] = useState<{ label: string; report: OperationsReport }[] | null>(null)
  const [types, setTypes] = useState<OperationsReportRow[] | null>(null)
  const [contracts, setContracts] = useState<AdminContract[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const months = Array.from({ length: MONTHS }, (_, i) => monthRange(i - MONTHS + 1))
    Promise.all(months.map((m) => api<OperationsReport>(`/api/operations/reports/facilities?fromDate=${m.from}&toDate=${m.to}`)
      .then((report) => ({ label: m.label, report }))))
      .then(setTrend).catch((e) => setError((e as Error).message))
    const now = monthRange(0)
    api<OperationsReportRow[]>(`/api/operations/reports/details?fromDate=${now.from}&toDate=${now.to}`).then(setTypes).catch((e) => setError((e as Error).message))
    if (admin) {
      Promise.all([fetchContracts('Active'), fetchContracts('Overdue')])
        .then(([a, o]) => setContracts([...a, ...o])).catch((e) => setError((e as Error).message))
    }
  }, [admin])

  const current = trend?.[MONTHS - 1].report
  const previous = trend?.[MONTHS - 2].report
  const change = current && previous?.netRevenue ? ((current.netRevenue - previous.netRevenue) / previous.netRevenue) * 100 : null
  const occupied = current ? current.rentedUnits + current.overdueLockedUnits : 0
  const occupancy = current?.totalUnits ? (occupied / current.totalUnits) * 100 : 0
  const customers = contracts ? new Set(contracts.map((c) => c.customerId)).size : 0
  const today = new Date()

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Xin chào, {user?.fullName}!</h1>
          <p className="muted">Tình hình kho, doanh thu và hợp đồng của toàn hệ thống SafeKeep.</p>
        </div>
        <span className="date-chip"><Icon name="calendar" size={16} /> Hôm nay: {WEEKDAYS[today.getDay()]}, {today.toLocaleDateString('vi-VN')}</span>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid">
        <Metric icon="wallet" tone="ok" label="Doanh thu tháng này" value={fmtMoney(current?.netRevenue ?? 0)}
          note={change === null ? 'đã trừ tiền hoàn' : `${change >= 0 ? '+' : ''}${change.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% so với tháng trước`} />
        <Metric icon="package" tone="info" label="Kho đang sử dụng" value={current ? `${occupied} / ${current.totalUnits}` : '—'}
          note={`${occupancy.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% kho đang có khách`} />
        {admin
          ? <Metric icon="users" tone="info" label="Khách hàng đang thuê" value={contracts ? String(customers) : '—'} note={`${current?.activeContracts ?? 0} hợp đồng hiệu lực`} />
          : <Metric icon="clipboard" tone={current?.overdueContracts ? 'bad' : 'ok'} label="Hợp đồng hiệu lực" value={String(current?.activeContracts ?? 0)}
            note={current?.overdueContracts ? `${current.overdueContracts} hợp đồng quá hạn` : 'không có hợp đồng quá hạn'} />}
        <Metric icon="phone" tone={current?.openSupportRequests ? 'warn' : 'ok'} label="Yêu cầu hỗ trợ" value={String(current?.openSupportRequests ?? 0)}
          note={current?.openSupportRequests ? 'ticket đang chờ xử lý' : 'không có ticket đang mở'} />
      </div>

      <section className="panel">
        <div className="panel-head wrap">
          <div>
            <h2 className="panel-title">Xu Hướng Doanh Thu Tháng</h2>
            <p className="muted">{trend ? `${trend[0].label} – ${trend[MONTHS - 1].label} ${today.getFullYear()}` : 'Đang tải…'}</p>
          </div>
          <span className="unit-legend"><span><i className="info" />Doanh thu thuần</span></span>
        </div>
        {trend && <LineChart points={trend.map((t) => ({ label: t.label, value: t.report.netRevenue }))} />}
      </section>

      <div className="overview-grid">
        <section className="panel">
          <h2 className="panel-title">Tỷ Lệ Lấp Đầy Theo Loại Kho</h2>
          <TypeOccupancy rows={types} />
        </section>
        {admin
          ? <RecentContracts contracts={contracts} />
          : <FacilityHealth report={current} />}
      </div>

      {admin && <ExpiringContracts contracts={contracts} />}
    </div>
  )
}

/** Monthly revenue as a line, the last point (this month) highlighted with its value. */
function LineChart({ points }: { points: { label: string; value: number }[] }) {
  const W = 720, H = 200, PAD = 16
  const max = Math.max(1, ...points.map((p) => p.value))
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1)
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <div className="line-chart">
      <div className="line-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Doanh thu từng tháng">
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="grid" />)}
          <path d={`${line} L${x(points.length - 1)},${H} L${x(0)},${H} Z`} className="area" />
          <path d={line} className="stroke" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <span key={p.label} className={`line-dot ${i === points.length - 1 ? 'current' : ''}`}
            style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.value) / H) * 100}%` }} title={`${p.label}: ${fmtMoney(p.value)}`} />
        ))}
        <span className="line-tip" style={{ top: `${(y(last.value) / H) * 100}%` }}>{last.label} (hiện tại)<b>{fmtMoney(last.value)}</b></span>
      </div>
      <div className="line-labels">{points.map((p, i) => <span key={p.label} className={i === points.length - 1 ? 'current' : ''}>{p.label}</span>)}</div>
    </div>
  )
}

/** Occupied / total units per unit type, summed over every facility. */
function TypeOccupancy({ rows }: { rows: OperationsReportRow[] | null }) {
  if (!rows) return <p className="muted">Đang tải…</p>
  const byType = new Map<number, { name: string; total: number; used: number }>()
  for (const r of rows) {
    const t = byType.get(r.unitTypeId) ?? { name: splitTypeName(r.unitTypeName).name, total: 0, used: 0 }
    t.total += r.totalUnits
    t.used += r.rentedUnits + r.overdueLockedUnits + r.reservedUnits
    byType.set(r.unitTypeId, t)
  }
  const types = [...byType.values()].filter((t) => t.total > 0)
  if (!types.length) return <Empty icon="package">Chưa có kho nào.</Empty>
  return (
    <ul className="type-occ">
      {types.map((t) => {
        const pct = Math.round((t.used / t.total) * 100)
        return (
          <li key={t.name}>
            <div className="row between"><span>{t.name}</span><b>{pct}% ({t.used}/{t.total})</b></div>
            <span className="revenue-track"><i style={{ width: `${pct}%` }} /></span>
          </li>
        )
      })}
    </ul>
  )
}

function RecentContracts({ contracts }: { contracts: AdminContract[] | null }) {
  const recent = [...(contracts ?? [])].sort((a, b) => b.signedDate.localeCompare(a.signedDate)).slice(0, 5)
  return (
    <section className="panel">
      <div className="panel-head wrap">
        <h2 className="panel-title">Hoạt Động Gần Đây</h2>
        <Link to="/admin/contracts" className="link">Hợp đồng <Icon name="arrowRight" size={14} /></Link>
      </div>
      {!contracts && <p className="muted">Đang tải…</p>}
      {contracts && recent.length === 0 && <Empty icon="clipboard">Chưa có hợp đồng nào.</Empty>}
      <ul className="activity-list">
        {recent.map((c) => (
          <li key={c.contractId} className={c.status === 'Overdue' ? 'warn' : ''}>
            <span>Khách hàng <b>{c.customerName}</b> ký hợp đồng <b>{c.contractNumber}</b> thuê kho {c.unitCode} tại {c.facilityName}</span>
            <small>{timeAgo(c.signedDate)}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Operations manager: occupancy and open tickets of every facility this month. */
function FacilityHealth({ report }: { report?: OperationsReport }) {
  const rows = [...(report?.facilities ?? [])].sort((a, b) => b.openSupportRequests - a.openSupportRequests || b.overdueContracts - a.overdueContracts)
  return (
    <section className="panel">
      <div className="panel-head wrap">
        <h2 className="panel-title">Tình Hình Các Cơ Sở</h2>
        <Link to="/ops/facilities" className="link">Cơ sở <Icon name="arrowRight" size={14} /></Link>
      </div>
      {!report && <p className="muted">Đang tải…</p>}
      {report && rows.length === 0 && <Empty icon="building">Chưa có cơ sở nào.</Empty>}
      <ul className="work-list">
        {rows.map((f) => {
          const occ = f.totalUnits ? Math.round(((f.rentedUnits + f.overdueLockedUnits) / f.totalUnits) * 100) : 0
          return (
            <li key={f.facilityId}>
              <span className="grow"><b>{f.facilityName}</b><small>{f.totalUnits} kho · lấp đầy {occ}% · {f.maintenanceUnits} bảo trì</small></span>
              {f.overdueContracts > 0 && <Badge tone="bad">{f.overdueContracts} quá hạn</Badge>}
              <Badge tone={f.openSupportRequests ? 'warn' : 'ok'}>{f.openSupportRequests} ticket</Badge>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ExpiringContracts({ contracts }: { contracts: AdminContract[] | null }) {
  const soon = (contracts ?? [])
    .filter((c) => c.status === 'Overdue' || daysUntil(c.endDate) <= 30)
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
  return (
    <section className="panel">
      <div className="panel-head wrap">
        <div>
          <h2 className="panel-title">Hợp Đồng Sắp Hết Hạn</h2>
          <p className="muted">Hợp đồng quá hạn và hợp đồng kết thúc trong 30 ngày tới.</p>
        </div>
        <Link to="/admin/contracts" className="link">Xem tất cả <Icon name="arrowRight" size={14} /></Link>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Mã HĐ</th><th>Khách hàng</th><th>Kho</th><th>Ngày hết hạn</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {soon.slice(0, 8).map((c) => {
              const days = daysUntil(c.endDate)
              return (
                <tr key={c.contractId}>
                  <td><Link to={`/admin/contracts?search=${encodeURIComponent(c.contractNumber)}`} className="link"><b>{c.contractNumber}</b></Link></td>
                  <td>{c.customerName}</td>
                  <td>{c.unitCode} <small className="muted">· {c.facilityName}</small></td>
                  <td>{fmtDate(c.endDate)}</td>
                  <td>{c.status === 'Overdue' ? <StatusBadge status="Overdue" /> : <Badge tone={days <= 7 ? 'bad' : 'warn'}>{days <= 0 ? 'Hết hạn hôm nay' : `Còn ${days} ngày`}</Badge>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!contracts && <p className="muted">Đang tải…</p>}
        {contracts && soon.length === 0 && <Empty icon="check">Không có hợp đồng nào sắp hết hạn.</Empty>}
      </div>
    </section>
  )
}
