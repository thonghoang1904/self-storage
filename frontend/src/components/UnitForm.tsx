import { type FormEvent } from 'react'
import { api, fmtMoney } from '../api'
import { Icon, splitTypeName } from './ui'
import type { StorageUnit, UnitType } from '../types'
import { CODE_FILTER, textError, unitCodeError } from '../validation'
import { FieldNote, useInputFilter } from './form'
import { Select } from './Select'

/**
 * Add / edit a unit of one facility (POST / PUT .../facility-management/facilities/{id}/units), shared by the
 * facility manager's and the system admin's unit pages. A rented, reserved or locked unit can only be renamed:
 * its type and location stay fixed. The price always follows the unit type's listed rate.
 */

export interface UnitFormValue { unitId: number | null; unitTypeId: number; unitCode: string; floorNumber: number; zoneArea: string }
export const EMPTY_UNIT_FORM: UnitFormValue = { unitId: null, unitTypeId: 0, unitCode: '', floorNumber: 1, zoneArea: '' }
/** Statuses where only the unit code may change. */
export const LOCKED_UNIT_STATUSES = ['Rented', 'OverdueLocked', 'Reserved']

export const unitFormOf = (u: StorageUnit): UnitFormValue =>
  ({ unitId: u.unitId, unitTypeId: u.unitTypeId, unitCode: u.unitCode, floorNumber: u.floorNumber, zoneArea: u.zoneArea ?? '' })

/** Validates and saves the form; throws with a message for the user, returns the notice to show on success. */
export async function saveUnit(facilityId: number, form: UnitFormValue, units: StorageUnit[], types: UnitType[]): Promise<string> {
  const type = types.find((t) => t.unitTypeId === form.unitTypeId) ?? types[0]
  if (!type) throw new Error('Vui lòng chọn loại kho')
  const code = form.unitCode.trim().toUpperCase()
  const invalid = unitCodeError(code)
    || (units.some((u) => u.unitCode.toUpperCase() === code && u.unitId !== form.unitId) && `Mã kho ${code} đã có trong cơ sở`)
    || ((!Number.isInteger(form.floorNumber) || form.floorNumber < 1 || form.floorNumber > 100) && 'Tầng phải là số nguyên từ 1 đến 100')
    || textError(form.zoneArea, 'Khu vực', 1, 30, true)
  if (invalid) throw new Error(invalid)
  const body = { unitTypeId: type.unitTypeId, unitCode: code, floorNumber: form.floorNumber, zoneArea: form.zoneArea.trim() || null, monthlyPrice: type.baseMonthlyRate }
  const base = `/api/facility-management/facilities/${facilityId}/units`
  if (!form.unitId) {
    await api(base, { body })
    return `Đã thêm kho ${code}.`
  }
  const before = units.find((u) => u.unitId === form.unitId)
  await api(`${base}/${form.unitId}`, { method: 'PUT', body })
  return before && before.unitCode !== code ? `Đã đổi mã kho ${before.unitCode} thành ${code}.` : `Đã cập nhật kho ${code}.`
}

export function UnitForm({ form, onChange, units, types, busy, onSubmit, onClose }: {
  form: UnitFormValue
  onChange: (form: UnitFormValue) => void
  units: StorageUnit[]
  types: UnitType[]
  busy: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}) {
  const code = useInputFilter(CODE_FILTER)
  const current = units.find((u) => u.unitId === form.unitId)
  const renameOnly = !!current && LOCKED_UNIT_STATUSES.includes(current.status)
  const selectedType = types.find((t) => t.unitTypeId === form.unitTypeId) ?? types[0]
  return (
    <form className="panel" onSubmit={onSubmit}>
      <div className="panel-head">
        <h2 className="panel-title">{current ? `Sửa kho ${current.unitCode}` : 'Thêm kho mới'}</h2>
        <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="form-grid four">
        <label className="field"><span>Mã kho</span>
          <input value={form.unitCode} onChange={(e) => onChange({ ...form, unitCode: code.keep(e.target.value) })} placeholder="vd: B-04" maxLength={30} required autoFocus />
          <FieldNote text={code.hint} />
        </label>
        <label className="field"><span>Loại kho</span>
          <Select value={form.unitTypeId} onChange={(e) => onChange({ ...form, unitTypeId: Number(e.target.value) })} disabled={renameOnly} required>
            {types.map((t) => <option key={t.unitTypeId} value={t.unitTypeId}>{splitTypeName(t.typeName).name}</option>)}
          </Select>
        </label>
        <label className="field"><span>Tầng</span>
          <input type="number" min={1} max={100} value={form.floorNumber} onChange={(e) => onChange({ ...form, floorNumber: Number(e.target.value) || 1 })} disabled={renameOnly} required />
        </label>
        <label className="field"><span>Khu vực</span>
          <input value={form.zoneArea} onChange={(e) => onChange({ ...form, zoneArea: e.target.value })} placeholder="vd: Khu B" maxLength={30} disabled={renameOnly} />
        </label>
      </div>
      {renameOnly && <p className="hint"><Icon name="alert" size={15} /> Kho đang có khách thuê hoặc giữ chỗ: chỉ đổi được mã kho, không đổi loại và vị trí.</p>}
      {selectedType && (
        <p className="hint"><Icon name="wallet" size={15} /> Giá thuê theo bảng giá loại kho: <b>{fmtMoney(selectedType.baseMonthlyRate)}/tháng</b> · {splitTypeName(selectedType.typeName).size}{selectedType.hasClimateControl ? ' · có điều hòa' : ''}</p>
      )}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Đang lưu…' : form.unitId ? 'Lưu thay đổi' : 'Thêm kho'}</button>
      </div>
    </form>
  )
}
