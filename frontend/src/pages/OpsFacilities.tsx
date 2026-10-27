import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, fmtDate } from '../api'
import { Badge, Empty, Icon } from '../components/ui'
import type { Facility, FacilityReport, OperationsReport } from '../types'
import { FormField, useValidatedForm } from '../components/form'
import { hotlineError, localToday, normalizePhone, PHONE_FILTER, operatingHoursError, textError } from '../validation'
import { Select } from '../components/Select'

/**
 * #44 Operations manager, Figma "facility-branch-management": every facility (GET /api/operations/facilities)
 * with its occupancy, vacant/maintenance units and net revenue of the last 30 days from the operations report
 * (GET /api/operations/reports/facilities). Adds a facility (POST) or edits one, status included (PUT).
 * "Xuất báo cáo" downloads the list shown as CSV.
 */

const STATUS: Record<string, string> = { Active: 'Đang hoạt động', Maintenance: 'Đang bảo trì', Closed: 'Ngừng hoạt động' }

/** Occupied units are rented ones plus the ones locked for an overdue rent. */
const occupied = (r?: FacilityReport) => (r ? r.rentedUnits + r.overdueLockedUnits : 0)
const occupancy = (r?: FacilityReport) => (r && r.totalUnits ? Math.round((occupied(r) / r.totalUnits) * 100) : 0)

/** "128.500.000" -> "128,5 triệu", as on the Figma cards. */
const fmtMillions = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu` : `${n.toLocaleString('vi-VN')}đ`

/** "Quận 7" -> "Q7", "TP. Thủ Đức" -> "TĐ": the short mark on each facility card. */
const markOf = (f: Facility) => {
  const letters = f.district.split(/[\s.]+/).filter(Boolean).map((w) => w[0].toUpperCase())
  return letters.slice(-2).join('') || f.facilityName.slice(0, 2).toUpperCase()
}
const codeOf = (f: Facility) => `CS-${markOf(f)}-${String(f.facilityId).padStart(2, '0')}`

/** The badge on a card: the facility status first, then how full it is. */
function badgeOf(f: Facility, r?: FacilityReport): { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' } {
  if (f.status === 'Maintenance') return { label: 'Đang bảo trì', tone: 'warn' }
  if (f.status === 'Closed') return { label: 'Ngừng hoạt động', tone: 'muted' }
  if (!r?.totalUnits) return { label: 'Chưa có kho', tone: 'muted' }
  const pct = occupancy(r)
  if (pct >= 90) return { label: 'Gần đầy', tone: 'warn' }
  if (pct < 70) return { label: 'Cần thúc đẩy', tone: 'info' }
  return { label: 'Hoạt động tốt', tone: 'ok' }
}

export default function OpsFacilities() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [report, setReport] = useState<OperationsReport | null>(null)
  const [q, setQ] = useState('')
  const [area, setArea] = useState('all')
  const [status, setStatus] = useState('all')
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([
        api<Facility[]>('/api/operations/facilities'),
        api<OperationsReport>('/api/operations/reports/facilities'),
      ])
      setFacilities(f)
      setReport(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const reportOf = useCallback((id: number) => report?.facilities.find((r) => r.facilityId === id), [report])
  const areas = useMemo(() => [...new Set(facilities.map((f) => f.city))].sort(), [facilities])
  const shown = useMemo(() => facilities
    .filter((f) => area === 'all' || f.city === area)
    .filter((f) => status === 'all' || f.status === status)
    .filter((f) => {
      const s = q.trim().toLowerCase()
      if (!s) return true
      return [f.facilityName, codeOf(f), f.address, f.district].some((v) => v.toLowerCase().includes(s))
    }), [facilities, area, status, q])

  const done = async (msg: string) => { setCreating(false); setEditId(null); setError(''); setNotice(msg); await load() }

  const exportCsv = () => {
    const rows = [['Mã', 'Cơ sở', 'Địa chỉ', 'Quận/Huyện', 'Thành phố', 'Trạng thái', 'Tổng kho', 'Đang thuê', 'Kho trống', 'Bảo trì', 'Lấp đầy (%)', 'Doanh thu 30 ngày']]
    for (const f of shown) {
      const r = reportOf(f.facilityId)
      rows.push([codeOf(f), f.facilityName, f.address, f.district, f.city, STATUS[f.status] ?? f.status,
        String(r?.totalUnits ?? 0), String(occupied(r)), String(r?.availableUnits ?? 0), String(r?.maintenanceUnits ?? 0),
        String(occupancy(r)), String(r?.netRevenue ?? 0)])
    }
    const csv = rows.map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    // BOM so Excel reads the Vietnamese text as UTF-8.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `co-so-${localToday()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalOccupied = report ? report.rentedUnits + report.overdueLockedUnits : 0
  const totalPct = report?.totalUnits ? (totalOccupied / report.totalUnits) * 100 : 0

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Cơ Sở & Chi Nhánh</h1>
          <p className="muted">Theo dõi công suất, tỷ lệ lấp đầy và hiệu quả vận hành toàn hệ thống.</p>
        </div>
        <button className="btn primary" onClick={() => { setNotice(''); setEditId(null); setCreating(true) }}><Icon name="building" size={16} /> Thêm cơ sở</button>
      </div>

      <div className="stat-grid">
        <Metric icon="building" tone="info" label="Tổng cơ sở" value={String(facilities.length)}
          note={`${facilities.filter((f) => f.status === 'Active').length} đang hoạt động`} />
        <Metric icon="package" tone="info" label="Tổng công suất" value={`${(report?.totalUnits ?? 0).toLocaleString('vi-VN')} kho`}
          note={`${totalOccupied.toLocaleString('vi-VN')} kho đang thuê`} />
        <Metric icon="chart" tone="ok" label="Tỷ lệ lấp đầy" value={`${totalPct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`} note="trên toàn hệ thống" />
        <Metric icon="wallet" tone="ok" label="Doanh thu 30 ngày" value={fmtMillions(report?.netRevenue ?? 0)}
          note={report ? `${fmtDate(report.fromDate)} – ${fmtDate(report.toDate)}` : ''} />
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên hoặc mã cơ sở..." />
          </span>
          <Select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Khu vực">
            <option value="all">Khu vực: Tất cả</option>
            {areas.map((a) => <option key={a} value={a}>Khu vực: {a}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="all">Trạng thái: Tất cả</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>Trạng thái: {v}</option>)}
          </Select>
        </div>
        <button className="btn outline" onClick={exportCsv} disabled={shown.length === 0}><Icon name="file" size={15} /> Xuất báo cáo</button>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      {creating && <FacilityForm onCancel={() => setCreating(false)} onDone={done} />}

      <section className="panel">
        <div>
          <h2 className="panel-title">Danh sách cơ sở</h2>
          <p className="muted">Số kho cập nhật theo thời gian thực, doanh thu tính trong 30 ngày gần nhất.</p>
        </div>
        <div className="stack">
          {shown.map((f) => {
            const r = reportOf(f.facilityId)
            const pct = occupancy(r)
            const badge = badgeOf(f, r)
            return (
              <div key={f.facilityId} className="stack">
                <div className="ops-facility-card">
                  <span className="facility-mark">{markOf(f)}</span>
                  <div className="facility-id">
                    <b>{f.facilityName}</b>
                    <small className="cyan">{codeOf(f)}</small>
                    <small className="muted">{f.address}, {f.district}</small>
                  </div>
                  <div className="occupancy">
                    <div className="row between"><small className="muted">Lấp đầy</small><b>{pct}%</b></div>
                    <div className="occupancy-track"><i className={pct >= 90 ? 'warn' : ''} style={{ width: `${pct}%` }} /></div>
                    <small className="muted">Công suất: {(r?.totalUnits ?? 0).toLocaleString('vi-VN')} kho</small>
                  </div>
                  <div className="facility-metrics">
                    <span><small>DOANH THU 30 NGÀY</small><b>{fmtMillions(r?.netRevenue ?? 0)}</b></span>
                    <span><small>KHO TRỐNG</small><b className="ok">{r?.availableUnits ?? 0}</b></span>
                    <span><small>BẢO TRÌ</small><b className="warn">{r?.maintenanceUnits ?? 0}</b></span>
                  </div>
                  <div className="facility-actions">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <button className="btn outline sm" onClick={() => { setNotice(''); setCreating(false); setEditId(editId === f.facilityId ? null : f.facilityId) }}>
                      <Icon name="arrowRight" size={14} /> Quản lý chi tiết
                    </button>
                  </div>
                </div>
                {editId === f.facilityId && (
                  <FacilityForm key={`${f.facilityId}-${f.status}`} facility={f} onCancel={() => setEditId(null)} onDone={done} />
                )}
              </div>
            )
          })}
          {shown.length === 0 && <Empty icon="building">Không có cơ sở nào khớp bộ lọc.</Empty>}
        </div>
      </section>

      {report && (
        <div className="summary-band">
          <span>Toàn hệ thống: <b>{totalOccupied.toLocaleString('vi-VN')} kho đang thuê</b> • {report.availableUnits.toLocaleString('vi-VN')} kho trống • {report.maintenanceUnits.toLocaleString('vi-VN')} kho bảo trì</span>
          {report.overdueContracts > 0 && <span className="muted">{report.overdueContracts} hợp đồng quá hạn</span>}
        </div>
      )}
    </div>
  )
}

function Metric({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: string; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

/** Add a facility, or edit one when `facility` is given (status can only be changed when editing). */
function FacilityForm({ facility, onCancel, onDone }: { facility?: Facility; onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const form = useValidatedForm(
    {
      facilityName: facility?.facilityName ?? '',
      address: facility?.address ?? '',
      district: facility?.district ?? '',
      city: facility?.city ?? 'TP. Hồ Chí Minh',
      hotline: facility?.hotline ?? '',
      operatingHours: facility?.operatingHours ?? '06:00 - 22:00',
      status: facility?.status ?? 'Active',
    },
    {
      facilityName: (v) => textError(v, 'Tên cơ sở', 3, 150),
      address: (v) => textError(v, 'Địa chỉ', 5, 255),
      district: (v) => textError(v, 'Quận / Huyện', 2, 100),
      city: (v) => textError(v, 'Thành phố', 2, 100),
      hotline: hotlineError,
      operatingHours: operatingHoursError,
    },
    { hotline: PHONE_FILTER },
  )
  const f = form.values
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.validateAll()) return
    setBusy(true)
    const body = {
      facilityName: f.facilityName.trim(), address: f.address.trim(), district: f.district.trim(),
      city: f.city.trim(), hotline: normalizePhone(f.hotline), operatingHours: f.operatingHours.trim().replace(/\s*-\s*/, ' - '),
    }
    try {
      if (facility) {
        await api(`/api/operations/facilities/${facility.facilityId}`, { method: 'PUT', body: { ...body, status: f.status } })
        await onDone(`Đã cập nhật ${body.facilityName}.`)
      } else {
        await api('/api/operations/facilities', { body })
        await onDone(`Đã thêm cơ sở ${body.facilityName}. Quản lý cơ sở sẽ thêm kho cho cơ sở này.`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={facility ? 'add-person' : 'panel'} onSubmit={submit} noValidate>
      <h3 className="panel-title"><Icon name="building" size={18} className="cyan" /> {facility ? `Quản lý ${facility.facilityName}` : 'Thêm cơ sở'}</h3>
      <div className="form-grid">
        <FormField label="Tên cơ sở" error={form.error('facilityName')}><input {...form.field('facilityName')} maxLength={150} placeholder="SafeKeep Bình Thạnh" /></FormField>
        <FormField label="Hotline" error={form.error('hotline')}><input {...form.field('hotline')} inputMode="tel" placeholder="02812345678" /></FormField>
        <FormField label="Địa chỉ" error={form.error('address')}><input {...form.field('address')} maxLength={255} placeholder="240 Điện Biên Phủ" /></FormField>
        <FormField label="Quận / Huyện" error={form.error('district')}><input {...form.field('district')} maxLength={100} placeholder="Quận Bình Thạnh" /></FormField>
        <FormField label="Thành phố" error={form.error('city')}><input {...form.field('city')} maxLength={100} /></FormField>
        <FormField label="Giờ hoạt động" error={form.error('operatingHours')} hint="vd: 06:00 - 22:00 hoặc 24/7"><input {...form.field('operatingHours')} maxLength={100} /></FormField>
        {facility && (
          <label className="field"><span>Trạng thái</span>
            <Select value={f.status} onChange={(e) => form.setValue('status', e.target.value)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
        )}
      </div>
      {facility && f.status !== 'Active' && f.status !== facility.status && (
        <p className="alert bad"><Icon name="alert" size={16} />Khách sẽ không đặt được kho mới tại cơ sở này khi không còn ở trạng thái "Đang hoạt động".</p>
      )}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : facility ? 'Lưu thay đổi' : 'Thêm cơ sở'}</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  )
}
