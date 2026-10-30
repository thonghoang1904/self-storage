import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtMoney } from '../api'
import { Empty, Icon, StatusBadge, splitTypeName } from '../components/ui'
import type { Facility, StorageUnit, UnitType } from '../types'
import { Select } from '../components/Select'
import { EMPTY_UNIT_FORM, LOCKED_UNIT_STATUSES, saveUnit, UnitForm, unitFormOf, type UnitFormValue } from '../components/UnitForm'

/**
 * System administrator: every unit of every facility with its status
 * (GET /api/operations/facilities, GET /api/operations/facilities/{id}/units), and the same unit management as the
 * facility manager at any facility (POST / PUT / DELETE .../facility-management/facilities/{id}/units, PUT .../status):
 * add, rename (also a rented unit), edit type/location, maintenance, delete. Facilities are on "Quản lý cơ sở".
 */
const STATUS_TABS = [
  { v: '', label: 'Tất cả' },
  { v: 'Available', label: 'Còn trống' },
  { v: 'Reserved', label: 'Đã giữ chỗ' },
  { v: 'Rented', label: 'Đang thuê' },
  { v: 'UnderMaintenance', label: 'Bảo trì' },
  { v: 'OverdueLocked', label: 'Khóa quá hạn' },
]

export default function AdminUnits() {
  const [params, setParams] = useSearchParams()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [types, setTypes] = useState<UnitType[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<UnitFormValue | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const facilityId = Number(params.get('facility')) || facilities[0]?.facilityId || 0
  const facility = facilities.find((f) => f.facilityId === facilityId)

  useEffect(() => {
    api<Facility[]>('/api/operations/facilities').then(setFacilities).catch((e) => setError((e as Error).message))
    api<UnitType[]>('/api/unit-types').then(setTypes).catch(() => {})
  }, [])
  const load = useCallback(async () => {
    if (!facilityId) return
    setLoading(true)
    try {
      setUnits(await api<StorageUnit[]>(`/api/operations/facilities/${facilityId}/units`))
    } catch (e) {
      setUnits([])
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  /** Runs an action; the notice is `done`, or else the message the action returns. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await fn()
      setNotice(done ?? String(result))
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const unitsPath = `/api/facility-management/facilities/${facilityId}/units`

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form || !facilityId) return
    const ok = await run(() => saveUnit(facilityId, form, units, types))
    if (ok) setForm(null)
  }
  const setUnitStatus = (u: StorageUnit, next: 'Available' | 'UnderMaintenance') => run(
    () => api(`${unitsPath}/${u.unitId}/status`, { method: 'PUT', body: { status: next } }),
    next === 'UnderMaintenance' ? `Kho ${u.unitCode} đã chuyển sang bảo trì.` : `Kho ${u.unitCode} đã hoạt động trở lại.`)
  // DELETE only works for an empty or maintenance unit that never had a contract, reservation or ticket (else 409).
  const removeUnit = async (u: StorageUnit) => {
    const ok = await run(() => api(`${unitsPath}/${u.unitId}`, { method: 'DELETE' }), `Đã xóa kho ${u.unitCode}.`)
    if (ok) setRemoving(null)
  }
  const edit = (next: UnitFormValue) => { setForm(next); setError(''); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }

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
          <p className="muted">Mọi kho của từng cơ sở và trạng thái hiện tại. Thêm, đổi mã, sửa vị trí, bảo trì hoặc xóa kho.</p>
        </div>
        <span className="row">
          <Link to="/admin/facilities" className="btn outline"><Icon name="building" size={15} /> Quản lý cơ sở</Link>
          <button className="btn primary" disabled={!types.length || facility?.status !== 'Active'}
            title={facility && facility.status !== 'Active' ? 'Chỉ thêm kho được tại cơ sở đang hoạt động' : undefined}
            onClick={() => edit({ ...EMPTY_UNIT_FORM, unitTypeId: types[0]?.unitTypeId ?? 0 })}>
            <Icon name="plus" size={16} /> Thêm kho
          </button>
        </span>
      </div>

      {form && <UnitForm form={form} onChange={setForm} units={units} types={types} busy={busy} onSubmit={save} onClose={() => setForm(null)} />}

      <div className="panel filter-bar">
        <label className="field inline"><span>Cơ sở</span>
          <Select value={facilityId} onChange={(e) => { setForm(null); setRemoving(null); setError(''); setNotice(''); setParams(new URLSearchParams({ facility: e.target.value })) }} aria-label="Chọn cơ sở">
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}{f.status !== 'Active' ? ` (${f.status === 'Closed' ? 'đã đóng' : 'tạm ngưng'})` : ''}</option>)}
          </Select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã kho, khu vực, loại kho…" aria-label="Tìm kho" />
      </div>
      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      {facility && (
        <div className="stat-grid four">
          <div className="stat-card"><span className="muted">Tổng số kho</span><b className="stat-value">{units.length}</b><small className="stat-note info">{facility.address}, {facility.district}</small></div>
          <div className="stat-card"><span className="muted">Đang thuê</span><b className="stat-value">{count('Rented')}</b><small className="stat-note ok">{units.length ? Math.round(count('Rented') / units.length * 100) : 0}% lấp đầy</small></div>
          <div className="stat-card"><span className="muted">Còn trống / giữ chỗ</span><b className="stat-value">{count('Available')} / {count('Reserved')}</b><small className="stat-note info">sẵn sàng cho thuê</small></div>
          <div className="stat-card"><span className="muted">Bảo trì / khóa</span><b className="stat-value">{count('UnderMaintenance')} / {count('OverdueLocked')}</b><small className={`stat-note ${count('OverdueLocked') ? 'bad' : 'ok'}`}>{count('OverdueLocked') ? 'có kho bị khóa do quá hạn' : 'không có kho bị khóa'}</small></div>
        </div>
      )}

      <section className="panel">
        <div className="segmented wrap" role="tablist">
          {STATUS_TABS.map((t) => <button key={t.v} className={status === t.v ? 'active' : ''} onClick={() => setStatus(t.v)}>{t.label}{t.v && <span className="count-pill">{count(t.v)}</span>}</button>)}
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mã kho</th><th>Loại kho</th><th>Tầng · khu</th><th className="right">Giá thuê / tháng</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
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
                    <td className="right">
                      <span className="row end">
                        {u.status === 'Available' && (
                          <button className="btn outline sm" disabled={busy} onClick={() => setUnitStatus(u, 'UnderMaintenance')}><Icon name="settings" size={14} /> Bảo trì</button>
                        )}
                        {u.status === 'UnderMaintenance' && (
                          <button className="btn primary sm" disabled={busy} onClick={() => setUnitStatus(u, 'Available')}><Icon name="check" size={14} /> Hoạt động lại</button>
                        )}
                        <button className="icon-action" title={LOCKED_UNIT_STATUSES.includes(u.status) ? 'Kho đang có khách: chỉ đổi được mã kho' : 'Sửa kho'} disabled={busy} onClick={() => edit(unitFormOf(u))}>
                          <Icon name="edit" size={15} />
                        </button>
                        {(u.status === 'Available' || u.status === 'UnderMaintenance') && removing !== u.unitId && (
                          <button className="icon-action" title="Xóa kho" disabled={busy} onClick={() => { setRemoving(u.unitId); setError(''); setNotice('') }}>
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                        {removing === u.unitId && (
                          <>
                            <small>Xóa kho {u.unitCode}?</small>
                            <button className="btn danger sm" disabled={busy} onClick={() => void removeUnit(u)}>Xóa</button>
                            <button className="btn ghost sm" disabled={busy} onClick={() => setRemoving(null)}>Không</button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && shown.length === 0 && <Empty icon="package">{units.length ? 'Không có kho nào khớp bộ lọc.' : 'Cơ sở này chưa có kho.'}</Empty>}
          {loading && <p className="muted">Đang tải kho…</p>}
        </div>
        <small className="muted">Kho đang cho thuê, giữ chỗ hoặc khóa quá hạn chỉ đổi được mã kho. Chỉ xóa được kho chưa từng có hợp đồng, đơn đặt hay yêu cầu hỗ trợ; nếu không, hãy chuyển sang bảo trì.</small>
      </section>
    </div>
  )
}
