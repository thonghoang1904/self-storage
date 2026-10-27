import { useCallback, useEffect, useState } from 'react'
import { api, downloadFile, fmtDate, fmtMoney } from '../api'
import { Empty, Icon } from '../components/ui'
import type { OperationsReport, OperationsReportRow, UnitType } from '../types'
import { Metric } from './FacilityOverview'
import { Select } from '../components/Select'

/**
 * Operations manager: revenue across facilities (Figma "revenue-analytics") from
 * GET /api/operations/reports/facilities?fromDate&toDate. Net revenue = payments received minus refunds in the range.
 * Detail by facility × unit type: GET /api/operations/reports/details, exported by .../details.csv.
 * Used by the operations manager (/ops/revenue) and the system administrator (/admin/revenue).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const PRESETS = [
  { key: '7', label: '7 ngày', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [iso(d), iso(new Date())] } },
  { key: '30', label: '30 ngày', range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [iso(d), iso(new Date())] } },
  { key: 'month', label: 'Tháng này', range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)] } },
  { key: 'year', label: 'Năm nay', range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), 0, 1)), iso(d)] } },
] as const

export default function OpsRevenue({ title = 'Doanh Thu' }: { title?: string }) {
  const [[from, to], setRange] = useState<[string, string]>(() => PRESETS[1].range() as [string, string])
  const [preset, setPreset] = useState<string>('30')
  const [report, setReport] = useState<OperationsReport | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!from || !to || from > to) { setError('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày"'); return }
    setError('')
    try {
      setReport(await api<OperationsReport>(`/api/operations/reports/facilities?fromDate=${from}&toDate=${to}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [from, to])
  useEffect(() => { void load() }, [load])

  const rows = [...(report?.facilities ?? [])].sort((a, b) => b.netRevenue - a.netRevenue)
  const top = Math.max(1, ...rows.map((r) => r.netRevenue))
  const total = report?.netRevenue ?? 0
  const occupied = report ? report.rentedUnits + report.overdueLockedUnits : 0
  const occupancy = report?.totalUnits ? Math.round((occupied / report.totalUnits) * 100) : 0
  const days = Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1

  const exportCsv = () => {
    const head = ['Cơ sở', 'Doanh thu thuần', 'Tỷ trọng %', 'Tổng kho', 'Đang thuê', 'Còn trống', 'Bảo trì', 'Khóa quá hạn', 'HĐ hiệu lực', 'HĐ quá hạn', 'Ticket mở']
    const lines = rows.map((r) => [r.facilityName, String(r.netRevenue), total ? ((r.netRevenue / total) * 100).toFixed(1) : '0', String(r.totalUnits), String(r.rentedUnits),
      String(r.availableUnits), String(r.maintenanceUnits), String(r.overdueLockedUnits), String(r.activeContracts), String(r.overdueContracts), String(r.openSupportRequests)])
    const csv = '﻿' + [head, ...lines].map((l) => l.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `doanh-thu-${from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>{title}</h1>
          <p className="muted">Doanh thu thuần theo cơ sở: tiền đã thu trừ tiền đã hoàn trong khoảng thời gian chọn.</p>
        </div>
        <button className="btn outline" onClick={exportCsv} disabled={!rows.length}><Icon name="file" size={15} /> Xuất CSV</button>
      </div>

      <div className="panel filter-bar">
        <div className="segmented">
          {PRESETS.map((p) => (
            <button key={p.key} className={preset === p.key ? 'active' : ''} onClick={() => { setPreset(p.key); setRange(p.range() as [string, string]) }}>{p.label}</button>
          ))}
        </div>
        <div className="date-range">
          <label><span>Từ ngày</span><input type="date" value={from} max={to} onChange={(e) => { setPreset(''); setRange([e.target.value, to]) }} /></label>
          <label><span>Đến ngày</span><input type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => { setPreset(''); setRange([from, e.target.value]) }} /></label>
        </div>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid">
        <Metric icon="wallet" tone="ok" label="Doanh thu thuần" value={fmtMoney(total)} note={`${fmtDate(from)} – ${fmtDate(to)}`} />
        <Metric icon="chart" tone="info" label="Bình quân mỗi ngày" value={fmtMoney(Math.round(total / Math.max(1, days)))} note={`${days} ngày`} />
        <Metric icon="package" tone="info" label="Tỷ lệ lấp đầy" value={`${occupancy}%`} note={report ? `${occupied}/${report.totalUnits} kho · ${report.facilityCount} cơ sở` : '—'} />
        <Metric icon="alert" tone={report?.overdueContracts ? 'bad' : 'ok'} label="Hợp đồng quá hạn" value={String(report?.overdueContracts ?? 0)} note={`${report?.activeContracts ?? 0} hợp đồng đang hiệu lực`} />
      </div>

      <section className="panel">
        <div className="panel-head wrap">
          <h2 className="panel-title">Doanh thu theo cơ sở</h2>
          <small className="muted">Sắp xếp từ cao đến thấp</small>
        </div>
        <div className="revenue-bars">
          {rows.map((r) => (
            <div key={r.facilityId} className="revenue-bar">
              <span className="revenue-name">{r.facilityName}</span>
              <span className="revenue-track"><i style={{ width: `${Math.max(r.netRevenue > 0 ? 2 : 0, (r.netRevenue / top) * 100)}%` }} /></span>
              <b className="money">{fmtMoney(r.netRevenue)}</b>
            </div>
          ))}
          {report && rows.length === 0 && <Empty icon="chart">Chưa có cơ sở nào.</Empty>}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Chi tiết từng cơ sở</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Cơ sở</th><th className="right">Doanh thu thuần</th><th className="right">Tỷ trọng</th><th>Lấp đầy</th><th className="right">HĐ hiệu lực</th><th className="right">HĐ quá hạn</th><th className="right">Ticket mở</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const occ = r.totalUnits ? Math.round(((r.rentedUnits + r.overdueLockedUnits) / r.totalUnits) * 100) : 0
                return (
                  <tr key={r.facilityId}>
                    <td><b>{r.facilityName}</b><br /><small className="muted">{r.totalUnits} kho · {r.availableUnits} trống · {r.maintenanceUnits} bảo trì</small></td>
                    <td className="right money">{fmtMoney(r.netRevenue)}</td>
                    <td className="right">{total ? `${((r.netRevenue / total) * 100).toFixed(1)}%` : '—'}</td>
                    <td><span className="occ"><span className="occ-track"><i style={{ width: `${occ}%` }} /></span>{occ}%</span></td>
                    <td className="right">{r.activeContracts}</td>
                    <td className={`right ${r.overdueContracts ? 'danger-text' : ''}`}>{r.overdueContracts}</td>
                    <td className="right">{r.openSupportRequests}</td>
                  </tr>
                )
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr><td><b>Tổng</b></td><td className="right money"><b>{fmtMoney(total)}</b></td><td className="right">100%</td><td>{occupancy}%</td><td className="right">{report?.activeContracts}</td><td className="right">{report?.overdueContracts}</td><td className="right">{report?.openSupportRequests}</td></tr></tfoot>
            )}
          </table>
        </div>
      </section>

      <ReportDetails from={from} to={to} facilities={rows.map((r) => ({ id: r.facilityId, name: r.facilityName }))} />
    </div>
  )
}

const CONTRACT_STATUSES = [
  { v: '', label: 'Mọi trạng thái HĐ' },
  { v: 'Active', label: 'Đang hiệu lực' },
  { v: 'Overdue', label: 'Quá hạn' },
  { v: 'Renewed', label: 'Đã gia hạn' },
  { v: 'Terminated', label: 'Đã chấm dứt' },
  { v: 'Liquidated', label: 'Đã thanh lý' },
]

/** Facility × unit type breakdown with the same date range, filterable, exportable as the backend's CSV. */
function ReportDetails({ from, to, facilities }: { from: string; to: string; facilities: { id: number; name: string }[] }) {
  const [types, setTypes] = useState<UnitType[]>([])
  const [facilityId, setFacilityId] = useState('')
  const [unitTypeId, setUnitTypeId] = useState('')
  const [contractStatus, setContractStatus] = useState('')
  const [rows, setRows] = useState<OperationsReportRow[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<UnitType[]>('/api/unit-types').then(setTypes).catch(() => {}) }, [])
  const params = () => {
    const p = new URLSearchParams({ fromDate: from, toDate: to })
    if (facilityId) p.set('facilityId', facilityId)
    if (unitTypeId) p.set('unitTypeId', unitTypeId)
    if (contractStatus) p.set('contractStatus', contractStatus)
    return p
  }
  useEffect(() => {
    if (!from || !to || from > to) return
    api<OperationsReportRow[]>(`/api/operations/reports/details?${params()}`).then((r) => { setRows(r); setError('') }).catch((e) => setError((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, facilityId, unitTypeId, contractStatus])

  const exportCsv = async () => {
    setBusy(true)
    try {
      await downloadFile(`/api/operations/reports/details.csv?${params()}`, `bao-cao-chi-tiet-${from}-${to}.csv`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-head wrap">
        <div>
          <h2 className="panel-title">Báo cáo chi tiết theo loại kho</h2>
          <p className="muted">Mỗi dòng là một loại kho tại một cơ sở, cùng khoảng thời gian ở trên.</p>
        </div>
        <button className="btn outline sm" onClick={() => void exportCsv()} disabled={busy}><Icon name="file" size={14} /> {busy ? 'Đang xuất…' : 'Xuất CSV chi tiết'}</button>
      </div>
      <div className="filter-controls">
        <Select id="rd-facility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
          <option value="">Tất cả cơ sở</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <Select id="rd-type" value={unitTypeId} onChange={(e) => setUnitTypeId(e.target.value)}>
          <option value="">Tất cả loại kho</option>
          {types.map((t) => <option key={t.unitTypeId} value={t.unitTypeId}>{t.typeName}</option>)}
        </Select>
        <Select id="rd-status" value={contractStatus} onChange={(e) => setContractStatus(e.target.value)}>
          {CONTRACT_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </Select>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Cơ sở · loại kho</th><th className="right">Kho</th><th className="right">Trống</th><th className="right">Giữ chỗ</th><th className="right">Đang thuê</th><th className="right">Bảo trì</th><th className="right">Khóa</th><th className="right">Lấp đầy</th><th className="right">HĐ hiệu lực / quá hạn</th><th className="right">Doanh thu</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={`${r.facilityId}-${r.unitTypeId}`}>
                <td><b>{r.facilityName}</b><br /><small className="muted">{r.unitTypeName}</small></td>
                <td className="right">{r.totalUnits}</td>
                <td className="right">{r.availableUnits}</td>
                <td className="right">{r.reservedUnits}</td>
                <td className="right">{r.rentedUnits}</td>
                <td className="right">{r.maintenanceUnits}</td>
                <td className="right">{r.overdueLockedUnits}</td>
                <td className="right">{r.occupancyRatePercent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</td>
                <td className="right">{r.activeContracts} / <span className={r.overdueContracts ? 'danger-text' : ''}>{r.overdueContracts}</span></td>
                <td className="right money">{fmtMoney(r.netRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && <Empty icon="chart">Không có dữ liệu khớp bộ lọc.</Empty>}
      </div>
    </section>
  )
}
