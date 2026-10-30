import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, fmtMoney } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import type { StorageUnit, UnitType } from '../types'
import { Metric } from './FacilityOverview'
import { Select } from '../components/Select'
import { EMPTY_UNIT_FORM, LOCKED_UNIT_STATUSES, saveUnit, UnitForm, unitFormOf, type UnitFormValue } from '../components/UnitForm'

/**
 * Facility manager: the units of the facility (#43, Figma "storage-management").
 * Lists them (GET .../facility-management/facilities/{id}/units), adds one (POST), edits code/type/floor/zone (PUT;
 * a rented or reserved unit can only be renamed) and moves a free unit in or out of maintenance (PUT .../status).
 * The price always follows the unit type's listed rate, which only the operations manager changes.
 */

export default function FacilityUnits() {
  const { facilityId } = useStaffFacility()
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [types, setTypes] = useState<UnitType[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [typeId, setTypeId] = useState(0)
  const [form, setForm] = useState<UnitFormValue | null>(null)
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

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form || !facilityId) return
    const ok = await run(() => saveUnit(facilityId, form, units, types))
    if (ok) setForm(null)
  }

  const setUnitStatus = (u: StorageUnit, next: 'Available' | 'UnderMaintenance') => run(
    () => api(`/api/facility-management/facilities/${facilityId}/units/${u.unitId}/status`, { method: 'PUT', body: { status: next } }),
    next === 'UnderMaintenance' ? `Kho ${u.unitCode} đã chuyển sang bảo trì.` : `Kho ${u.unitCode} đã hoạt động trở lại.`)

  // DELETE only works for an empty or maintenance unit that never had a contract, reservation or ticket;
  // otherwise the API answers 409 and the unit should go to maintenance instead.
  const [removing, setRemoving] = useState<number | null>(null)
  const removeUnit = async (u: StorageUnit) => {
    const ok = await run(() => api(`/api/facility-management/facilities/${facilityId}/units/${u.unitId}`, { method: 'DELETE' }), `Đã xóa kho ${u.unitCode}.`)
    if (ok) setRemoving(null)
  }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Kho Lưu Trữ</h1>
          <p className="muted">Thêm kho mới, sửa vị trí và đưa kho vào bảo trì khi cần sửa chữa.</p>
        </div>
        <button className="btn primary" disabled={!types.length} onClick={() => { setForm({ ...EMPTY_UNIT_FORM, unitTypeId: types[0]?.unitTypeId ?? 0 }); setError(''); setNotice('') }}>
          <Icon name="plus" size={16} /> Thêm kho
        </button>
      </div>

      <div className="stat-grid">
        <Metric icon="package" tone="info" label="Tổng số kho" value={String(units.length)} note={`${types.length} loại kho`} />
        <Metric icon="check" tone="ok" label="Còn trống" value={String(count('Available'))} note="sẵn sàng cho thuê" />
        <Metric icon="users" tone="info" label="Đang cho thuê" value={String(count('Rented') + count('Reserved'))} note={count('OverdueLocked') ? `${count('OverdueLocked')} kho khóa do quá hạn` : 'không có kho bị khóa'} />
        <Metric icon="settings" tone="warn" label="Đang bảo trì" value={String(count('UnderMaintenance'))} note="không nhận khách mới" />
      </div>

      {form && <UnitForm form={form} onChange={setForm} units={units} types={types} busy={busy} onSubmit={save} onClose={() => setForm(null)} />}

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
                const locked = LOCKED_UNIT_STATUSES.includes(u.status)
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
                        <button className="icon-action" title={locked ? 'Kho đang có khách: chỉ đổi được mã kho' : 'Sửa kho'} disabled={busy}
                          onClick={() => { setForm(unitFormOf(u)); setError(''); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
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
          {shown.length === 0 && <Empty icon="package">{units.length ? 'Không có kho nào khớp bộ lọc.' : 'Cơ sở chưa có kho nào.'}</Empty>}
        </div>
        <small className="muted">Kho đang cho thuê, giữ chỗ hoặc khóa quá hạn chỉ đổi được mã kho, không chuyển bảo trì được. Đưa kho vào bảo trì bị chặn nếu làm thiếu chỗ cho các đơn đã đặt.</small>
      </section>
    </div>
  )
}
