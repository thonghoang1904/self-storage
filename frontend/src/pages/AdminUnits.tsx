import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtMoney } from '../api'
import { Empty, Icon, StatusBadge, splitTypeName } from '../components/ui'
import type { Facility, StorageUnit } from '../types'

/**
 * System administrator: every unit of every facility with its status
 * (GET /api/operations/facilities, GET /api/operations/facilities/{id}/units).
 * Read-only here; units are created and edited by the facility manager, facilities on "Quản lý cơ sở".
 */
const STATUS_TABS = [
  { v: '', label: 'Tất cả' },
  { v: 'Available', label: 'Còn trống' },
  { v: 'Reserved', label: 'Đã giữ chỗ' },
  { v: 'Rented', label: 'Đang thuê' },
  { v: 'Maintenance', label: 'Bảo trì' },
  { v: 'OverdueLocked', label: 'Khóa quá hạn' },
]

export default function AdminUnits() {
  const [params, setParams] = useSearchParams()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const facilityId = Number(params.get('facility')) || facilities[0]?.facilityId || 0
  const facility = facilities.find((f) => f.facilityId === facilityId)

  useEffect(() => {
    api<Facility[]>('/api/operations/facilities').then(setFacilities).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(() => {
    if (!facilityId) return
    setLoading(true)
    api<StorageUnit[]>(`/api/operations/facilities/${facilityId}/units`)
      .then((u) => { setUnits(u); setError('') })
      .catch((e) => { setUnits([]); setError((e as Error).message) })
      .finally(() => setLoading(false))
  }, [facilityId])

  const count = (s: string) => units.filter((u) => u.status === s).length
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return units.filter((u) => (!status || u.status === status)
      && (!k || `${u.unitCode} ${u.zoneArea ?? ''} ${u.unitTypeName}`.toLowerCase().includes(k)))
  }, [units, status, q])

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Kho Lưu Trữ</h1>
          <p className="muted">Mọi kho của từng cơ sở và trạng thái hiện tại. Thêm / sửa kho do quản lý cơ sở thực hiện.</p>
        </div>
        <Link to="/admin/facilities" className="btn outline"><Icon name="building" size={15} /> Quản lý cơ sở</Link>
      </div>

      <div className="panel filter-bar">
        <label className="field inline"><span>Cơ sở</span>
          <select value={facilityId} onChange={(e) => setParams(new URLSearchParams({ facility: e.target.value }))} aria-label="Chọn cơ sở">
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}{f.status !== 'Active' ? ` (${f.status === 'Closed' ? 'đã đóng' : 'tạm ngưng'})` : ''}</option>)}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã kho, khu vực, loại kho…" aria-label="Tìm kho" />
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      {facility && (
        <div className="stat-grid four">
          <div className="stat-card"><span className="muted">Tổng số kho</span><b className="stat-value">{units.length}</b><small className="stat-note info">{facility.address}, {facility.district}</small></div>
          <div className="stat-card"><span className="muted">Đang thuê</span><b className="stat-value">{count('Rented')}</b><small className="stat-note ok">{units.length ? Math.round(count('Rented') / units.length * 100) : 0}% lấp đầy</small></div>
          <div className="stat-card"><span className="muted">Còn trống / giữ chỗ</span><b className="stat-value">{count('Available')} / {count('Reserved')}</b><small className="stat-note info">sẵn sàng cho thuê</small></div>
          <div className="stat-card"><span className="muted">Bảo trì / khóa</span><b className="stat-value">{count('Maintenance')} / {count('OverdueLocked')}</b><small className={`stat-note ${count('OverdueLocked') ? 'bad' : 'ok'}`}>{count('OverdueLocked') ? 'có kho bị khóa do quá hạn' : 'không có kho bị khóa'}</small></div>
        </div>
      )}

      <section className="panel">
        <div className="segmented wrap" role="tablist">
          {STATUS_TABS.map((t) => <button key={t.v} className={status === t.v ? 'active' : ''} onClick={() => setStatus(t.v)}>{t.label}{t.v && <span className="count-pill">{count(t.v)}</span>}</button>)}
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mã kho</th><th>Loại kho</th><th>Tầng · khu</th><th className="right">Giá thuê / tháng</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {shown.map((u) => {
                const t = splitTypeName(u.unitTypeName)
                return (
                  <tr key={u.unitId}>
                    <td><b>{u.unitCode}</b></td>
                    <td>{t.name} <small className="muted">{t.size}</small></td>
                    <td>Tầng {u.floorNumber}{u.zoneArea && ` · ${u.zoneArea}`}</td>
                    <td className="right money">{fmtMoney(u.monthlyPrice)}</td>
                    <td><StatusBadge status={u.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && shown.length === 0 && <Empty icon="package">{units.length ? 'Không có kho nào khớp bộ lọc.' : 'Cơ sở này chưa có kho.'}</Empty>}
          {loading && <p className="muted">Đang tải kho…</p>}
        </div>
      </section>
    </div>
  )
}
