import { useEffect, useState } from 'react'
import { api, fmtMoney } from '../api'
import { monthRange } from '../consoleData'
import { Empty, Icon, splitTypeName } from '../components/ui'
import type { OperationsReportRow } from '../types'
import { Metric } from './FacilityOverview'
import { Select } from '../components/Select'

/**
 * Operations manager "Vận Hành Kho": state of the units of every facility, by unit type
 * (GET /api/operations/reports/details for the current month), in the layout of Figma "storage-management".
 * Read-only: units are added and put under maintenance by each facility's manager.
 */

const SEGMENTS = [
  { key: 'availableUnits', label: 'Trống', tone: 'ok' },
  { key: 'reservedUnits', label: 'Giữ chỗ', tone: 'info light' },
  { key: 'rentedUnits', label: 'Đang thuê', tone: 'info' },
  { key: 'maintenanceUnits', label: 'Bảo trì', tone: 'warn' },
  { key: 'overdueLockedUnits', label: 'Khóa quá hạn', tone: 'bad' },
] as const
type Counts = Record<(typeof SEGMENTS)[number]['key'] | 'totalUnits', number>

const sum = (rows: OperationsReportRow[]): Counts => {
  const c = { totalUnits: 0, availableUnits: 0, reservedUnits: 0, rentedUnits: 0, maintenanceUnits: 0, overdueLockedUnits: 0 }
  for (const r of rows) for (const k of Object.keys(c) as (keyof Counts)[]) c[k] += r[k]
  return c
}
const occupancy = (c: Counts) => (c.totalUnits ? Math.round(((c.rentedUnits + c.overdueLockedUnits + c.reservedUnits) / c.totalUnits) * 100) : 0)

export default function OpsStorage() {
  const [rows, setRows] = useState<OperationsReportRow[] | null>(null)
  const [facilityId, setFacilityId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const m = monthRange(0)
    api<OperationsReportRow[]>(`/api/operations/reports/details?fromDate=${m.from}&toDate=${m.to}`).then(setRows).catch((e) => setError((e as Error).message))
  }, [])

  const facilities = [...new Map((rows ?? []).map((r) => [r.facilityId, r.facilityName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const shownFacilities = facilities.filter(([id]) => !facilityId || id === Number(facilityId))
  const shownRows = (rows ?? []).filter((r) => !facilityId || r.facilityId === Number(facilityId))
  const total = sum(shownRows)

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Vận Hành Kho</h1>
          <p className="muted">Tình trạng kho của từng cơ sở theo loại kho: trống, đang thuê, bảo trì và khóa do quá hạn.</p>
        </div>
        <Select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} aria-label="Cơ sở">
          <option value="">Tất cả cơ sở</option>
          {facilities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid">
        <Metric icon="package" tone="info" label="Tổng số kho" value={String(total.totalUnits)} note={`${shownFacilities.length} cơ sở`} />
        <Metric icon="chart" tone="info" label="Tỷ lệ lấp đầy" value={`${occupancy(total)}%`} note={`${total.rentedUnits + total.overdueLockedUnits} đang thuê · ${total.reservedUnits} giữ chỗ`} />
        <Metric icon="check" tone="ok" label="Kho còn trống" value={String(total.availableUnits)} note="sẵn sàng cho khách mới" />
        <Metric icon="alert" tone={total.maintenanceUnits + total.overdueLockedUnits ? 'warn' : 'ok'} label="Bảo trì / khóa" value={String(total.maintenanceUnits + total.overdueLockedUnits)}
          note={`${total.maintenanceUnits} bảo trì · ${total.overdueLockedUnits} khóa quá hạn`} />
      </div>

      {!rows && !error && <p className="muted">Đang tải…</p>}
      {rows && shownFacilities.length === 0 && <section className="panel"><Empty icon="building">Chưa có cơ sở nào.</Empty></section>}

      {shownFacilities.map(([id, name]) => {
        const types = shownRows.filter((r) => r.facilityId === id)
        const c = sum(types)
        return (
          <section key={id} className="panel">
            <div className="panel-head wrap">
              <h2 className="panel-title"><span className="stat-icon info"><Icon name="building" size={16} /></span>{name}</h2>
              <span className="muted">{c.totalUnits} kho · lấp đầy <b>{occupancy(c)}%</b></span>
            </div>
            {c.totalUnits > 0 && (
              <>
                <div className="unit-bar" role="img" aria-label={`Tình trạng kho ${name}`}>
                  {SEGMENTS.map((s) => c[s.key] > 0 ? <span key={s.key} className={s.tone} style={{ flexGrow: c[s.key] }} title={`${s.label}: ${c[s.key]}`} /> : null)}
                </div>
                <div className="unit-legend">{SEGMENTS.map((s) => <span key={s.key}><i className={s.tone} />{s.label} <b>{c[s.key]}</b></span>)}</div>
              </>
            )}
            <div className="table-scroll">
              <table>
                <thead><tr><th>Loại kho</th><th className="right">Tổng</th><th className="right">Trống</th><th className="right">Giữ chỗ</th><th className="right">Đang thuê</th><th className="right">Bảo trì</th><th className="right">Khóa</th><th>Lấp đầy</th><th className="right">Doanh thu tháng</th></tr></thead>
                <tbody>
                  {types.filter((t) => t.totalUnits > 0).map((t) => {
                    const occ = Math.round(t.occupancyRatePercent)
                    return (
                      <tr key={t.unitTypeId}>
                        <td><b>{splitTypeName(t.unitTypeName).name}</b><br /><small className="muted">{splitTypeName(t.unitTypeName).size}</small></td>
                        <td className="right">{t.totalUnits}</td>
                        <td className="right">{t.availableUnits}</td>
                        <td className="right">{t.reservedUnits}</td>
                        <td className="right">{t.rentedUnits}</td>
                        <td className={`right ${t.maintenanceUnits ? 'warn-text' : ''}`}>{t.maintenanceUnits}</td>
                        <td className={`right ${t.overdueLockedUnits ? 'danger-text' : ''}`}>{t.overdueLockedUnits}</td>
                        <td><span className="occ"><span className="occ-track"><i style={{ width: `${occ}%` }} /></span>{occ}%</span></td>
                        <td className="right money">{fmtMoney(t.netRevenue)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {c.totalUnits === 0 && <Empty icon="package">Cơ sở chưa có kho nào.</Empty>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
