import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, fmtMoney } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import type { StorageUnit, UnitType } from '../types'
import { Metric } from './FacilityOverview'
import { CODE_FILTER, textError, unitCodeError } from '../validation'
import { FieldNote, useInputFilter } from '../components/form'
import { Select } from '../components/Select'

/**
 * Facility manager: the units of the facility (#43, Figma "storage-management").
 * Lists them (GET .../facility-management/facilities/{id}/units), adds one (POST), edits code/type/floor/zone (PUT)
 * and moves a free unit in or out of maintenance (PUT .../status). The price always follows the unit type's
 * listed rate, which only the operations manager changes.
 */

interface Form { unitId: number | null; unitTypeId: number; unitCode: string; floorNumber: number; zoneArea: string }
const EMPTY: Form = { unitId: null, unitTypeId: 0, unitCode: '', floorNumber: 1, zoneArea: '' }
const LOCKED = ['Rented', 'OverdueLocked', 'Reserved']

export default function FacilityUnits() {
  const { facilityId } = useStaffFacility()
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [types, setTypes] = useState<UnitType[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [typeId, setTypeId] = useState(0)
  const [form, setForm] = useState<Form | null>(null)
  const code = useInputFilter(CODE_FILTER)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      setUnits(await api<StorageUnit[]>(`/api/facility-management/facilities/${facilityId}/units`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { api<UnitType[]>('/api/unit-types').then(setTypes).catch(() => {}) }, [])

  const count = (s: string) => units.filter((u) => u.status === s).length
  const shown = units.filter((u) => (status === 'all' || u.status === status) && (!typeId || u.unitTypeId === typeId)
    && (!q.trim() || `${u.unitCode} ${u.zoneArea ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      setNotice(done)
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form || !facilityId) return
    const type = types.find((t) => t.unitTypeId === form.unitTypeId) ?? types[0]
    if (!type) { setError('Vui lòng chọn loại kho'); return }
    const code = form.unitCode.trim().toUpperCase()
    const invalid = unitCodeError(code)
      || (units.some((u) => u.unitCode.toUpperCase() === code && u.unitId !== form.unitId) && `Mã kho ${code} đã có trong cơ sở`)
      || ((!Number.isInteger(form.floorNumber) || form.floorNumber < 1 || form.floorNumber > 100) && 'Tầng phải là số nguyên từ 1 đến 100')
      || textError(form.zoneArea, 'Khu vực', 1, 30, true)
    if (invalid) { setError(invalid); return }
    const body = { unitTypeId: type.unitTypeId, unitCode: code, floorNumber: form.floorNumber, zoneArea: form.zoneArea.trim() || null, monthlyPrice: type.baseMonthlyRate }
    const base = `/api/facility-management/facilities/${facilityId}/units`
    const ok = await run(
      () => form.unitId ? api(`${base}/${form.unitId}`, { method: 'PUT', body }) : api(base, { body }),
      form.unitId ? `Đã cập nhật kho ${body.unitCode}.` : `Đã thêm kho ${body.unitCode}.`)
    if (ok) setForm(null)
  }

  const setUnitStatus = (u: StorageUnit, next: 'Available' | 'UnderMaintenance') => run(
    () => api(`/api/facility-management/facilities/${facilityId}/units/${u.unitId}/status`, { method: 'PUT', body: { status: next } }),
    next === 'UnderMaintenance' ? `Kho ${u.unitCode} đã chuyển sang bảo trì.` : `Kho ${u.unitCode} đã hoạt động trở lại.`)

  const selectedType = types.find((t) => t.unitTypeId === form?.unitTypeId) ?? (form ? types[0] : undefined)

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Kho Lưu Trữ</h1>
          <p className="muted">Thêm kho mới, sửa vị trí và đưa kho vào bảo trì khi cần sửa chữa.</p>
        </div>
        <button className="btn primary" disabled={!types.length} onClick={() => { setForm({ ...EMPTY, unitTypeId: types[0]?.unitTypeId ?? 0 }); setError(''); setNotice('') }}>
          <Icon name="plus" size={16} /> Thêm kho
        </button>
      </div>

      <div className="stat-grid">
        <Metric icon="package" tone="info" label="Tổng số kho" value={String(units.length)} note={`${types.length} loại kho`} />
        <Metric icon="check" tone="ok" label="Còn trống" value={String(count('Available'))} note="sẵn sàng cho thuê" />
        <Metric icon="users" tone="info" label="Đang cho thuê" value={String(count('Rented') + count('Reserved'))} note={count('OverdueLocked') ? `${count('OverdueLocked')} kho khóa do quá hạn` : 'không có kho bị khóa'} />
        <Metric icon="settings" tone="warn" label="Đang bảo trì" value={String(count('UnderMaintenance'))} note="không nhận khách mới" />
      </div>

      {form && (
        <form className="panel" onSubmit={save}>
          <div className="panel-head">
            <h2 className="panel-title">{form.unitId ? `Sửa kho ${units.find((u) => u.unitId === form.unitId)?.unitCode ?? ''}` : 'Thêm kho mới'}</h2>
            <button type="button" className="icon-btn" aria-label="Đóng" onClick={() => setForm(null)}><Icon name="x" /></button>
          </div>
          <div className="form-grid four">
            <label className="field"><span>Mã kho</span>
              <input value={form.unitCode} onChange={(e) => setForm({ ...form, unitCode: code.keep(e.target.value) })} placeholder="vd: B-04" maxLength={30} required autoFocus />
              <FieldNote text={code.hint} />
            </label>
            <label className="field"><span>Loại kho</span>
              <Select value={form.unitTypeId} onChange={(e) => setForm({ ...form, unitTypeId: Number(e.target.value) })} required>
                {types.map((t) => <option key={t.unitTypeId} value={t.unitTypeId}>{splitTypeName(t.typeName).name}</option>)}
              </Select>
            </label>
            <label className="field"><span>Tầng</span>
              <input type="number" min={1} max={100} value={form.floorNumber} onChange={(e) => setForm({ ...form, floorNumber: Number(e.target.value) || 1 })} required />
            </label>
            <label className="field"><span>Khu vực</span>
              <input value={form.zoneArea} onChange={(e) => setForm({ ...form, zoneArea: e.target.value })} placeholder="vd: Khu B" maxLength={30} />
            </label>
          </div>
          {selectedType && (
            <p className="hint"><Icon name="wallet" size={15} /> Giá thuê theo bảng giá loại kho: <b>{fmtMoney(selectedType.baseMonthlyRate)}/tháng</b> · {splitTypeName(selectedType.typeName).size}{selectedType.hasClimateControl ? ' · có điều hòa' : ''}</p>
          )}
          <div className="row end">
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Hủy</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Đang lưu…' : form.unitId ? 'Lưu thay đổi' : 'Thêm kho'}</button>
          </div>
        </form>
      )}

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã kho, khu vực…" />
          </span>
          <Select value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
            <option value={0}>Tất cả loại kho</option>
            {types.map((t) => <option key={t.unitTypeId} value={t.unitTypeId}>{splitTypeName(t.typeName).name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            <option value="Available">Còn trống</option>
            <option value="Rented">Đang cho thuê</option>
            <option value="UnderMaintenance">Đang bảo trì</option>
            <option value="OverdueLocked">Khóa do quá hạn</option>
          </Select>
        </div>
        <button className="btn ghost" onClick={() => { setQ(''); setStatus('all'); setTypeId(0) }}>Xóa bộ lọc</button>
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mã kho</th><th>Loại kho</th><th>Vị trí</th><th>Giá thuê</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
            <tbody>
              {shown.map((u) => {
                const locked = LOCKED.includes(u.status)
                return (
                  <tr key={u.unitId}>
                    <td className="code">{u.unitCode}</td>
                    <td>{splitTypeName(u.unitTypeName).name}<br /><small className="muted">{splitTypeName(u.unitTypeName).size}</small></td>
                    <td>Tầng {u.floorNumber}{u.zoneArea && ` · ${u.zoneArea}`}</td>
                    <td className="money">{fmtMoney(u.monthlyPrice)}<small className="muted">/tháng</small></td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="right">
                      <span className="row end">
                        {u.status === 'Available' && (
                          <button className="btn outline sm" disabled={busy} onClick={() => setUnitStatus(u, 'UnderMaintenance')}><Icon name="settings" size={14} /> Bảo trì</button>
                        )}
                        {u.status === 'UnderMaintenance' && (
                          <button className="btn primary sm" disabled={busy} onClick={() => setUnitStatus(u, 'Available')}><Icon name="check" size={14} /> Hoạt động lại</button>
                        )}
                        <button className="icon-action" title={locked ? 'Kho đang có khách, không sửa được' : 'Sửa kho'} disabled={locked || busy}
                          onClick={() => { setForm({ unitId: u.unitId, unitTypeId: u.unitTypeId, unitCode: u.unitCode, floorNumber: u.floorNumber, zoneArea: u.zoneArea ?? '' }); setError(''); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                          <Icon name="edit" size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {shown.length === 0 && <Empty icon="package">{units.length ? 'Không có kho nào khớp bộ lọc.' : 'Cơ sở chưa có kho nào.'}</Empty>}
        </div>
        <small className="muted">Kho đang cho thuê, giữ chỗ hoặc khóa quá hạn không sửa và không chuyển bảo trì được. Đưa kho vào bảo trì bị chặn nếu làm thiếu chỗ cho các đơn đã đặt.</small>
      </section>
    </div>
  )
}
