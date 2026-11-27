import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, fmtMoney } from '../api'
import { Icon, splitTypeName } from './ui'
import { UnitTypePhoto } from './unitPhoto'
import type { StorageUnit, UnitType } from '../types'
import { CODE_FILTER, textError, unitCodeError } from '../validation'
import { FieldNote, useInputFilter } from './form'
import { Select } from './Select'

/**
 * Add / edit a unit of one facility (POST / PUT .../facility-management/facilities/{id}/units), shared by the
 * facility manager's and the system admin's unit pages. A rented, reserved or locked unit can only be renamed:
 * its type and location stay fixed. The price always follows the unit type's listed rate.
 */

export interface UnitFormValue {
  unitId: number | null; unitTypeId: number; unitCode: string; floorNumber: number; zoneArea: string
  /** New photo of this unit to upload after saving, or a request to remove the current one. */
  photo?: File | null; removePhoto?: boolean
}
export const EMPTY_UNIT_FORM: UnitFormValue = { unitId: null, unitTypeId: 0, unitCode: '', floorNumber: 1, zoneArea: '' }
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Same rules as the backend (JPG, PNG or WebP, at most 5 MB). */
export const unitPhotoError = (f: File) => !PHOTO_TYPES.includes(f.type) ? 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP'
  : f.size > 5 * 1024 * 1024 ? 'Ảnh không được vượt quá 5 MB' : f.size === 0 ? 'Tệp ảnh bị rỗng' : ''
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
  const before = units.find((u) => u.unitId === form.unitId)
  const saved = form.unitId
    ? await api<StorageUnit>(`${base}/${form.unitId}`, { method: 'PUT', body })
    : await api<StorageUnit>(base, { body })
  const done = !form.unitId ? `Đã thêm kho ${code}.`
    : before && before.unitCode !== code ? `Đã đổi mã kho ${before.unitCode} thành ${code}.` : `Đã cập nhật kho ${code}.`
  const unitId = saved?.unitId ?? form.unitId
  if (!unitId || (!form.photo && !form.removePhoto)) return done
  // The unit is saved either way; a failed photo upload is reported so it can be tried again from "Sửa".
  try {
    if (form.photo) {
      const fd = new FormData()
      fd.append('file', form.photo)
      await api(`${base}/${unitId}/image`, { body: fd })
      return done.replace(/\.$/, ' kèm ảnh.')
    }
    if (before?.imageUrl) await api(`${base}/${unitId}/image`, { method: 'DELETE' })
    return done.replace(/\.$/, ', đã gỡ ảnh.')
  } catch (e) {
    return `${done} Chưa ${form.photo ? 'tải' : 'gỡ'} được ảnh: ${(e as Error).message}. Bấm "Sửa" ở kho ${code} để thử lại.`
  }
}

/** Photo of one unit: current photo or the new one picked, with change / remove. */
export function UnitPhotoPicker({ form, onChange, current, typePhoto, typeName, typeId }: {
  form: UnitFormValue; onChange: (f: UnitFormValue) => void; current?: string | null; typePhoto?: string | null; typeName?: string; typeId?: number
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!form.photo) { setPreview(null); return }
    const url = URL.createObjectURL(form.photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [form.photo])
  const own = preview ?? (form.removePhoto ? null : current ?? null)
  const pick = (f?: File) => {
    if (!f) return
    const err = unitPhotoError(f)
    setError(err)
    if (!err) onChange({ ...form, photo: f, removePhoto: false })
  }
  return (
    <div className="field">
      <span>Ảnh thực tế của kho này (tùy chọn)</span>
      <div className="unit-photo-picker">
        <div className="unit-type-thumb"><UnitTypePhoto src={own ?? typePhoto} typeName={typeName} typeId={typeId} alt="Ảnh kho" /></div>
        <div className="stack-sm">
          <div className="row wrap">
            <button type="button" className="btn outline sm" onClick={() => input.current?.click()}>
              <Icon name="plus" size={14} /> {own ? 'Đổi ảnh' : 'Chọn ảnh'}
            </button>
            {form.photo && <button type="button" className="btn ghost sm" onClick={() => onChange({ ...form, photo: null })}>Bỏ ảnh vừa chọn</button>}
            {!form.photo && current && !form.removePhoto && (
              <button type="button" className="btn ghost sm danger-text" onClick={() => onChange({ ...form, removePhoto: true })}>Gỡ ảnh hiện tại</button>
            )}
            {form.removePhoto && <button type="button" className="btn ghost sm" onClick={() => onChange({ ...form, removePhoto: false })}>Giữ lại ảnh</button>}
          </div>
          <small className="muted">
            {own ? (form.photo ? 'Ảnh mới sẽ được tải lên khi lưu.' : 'Khách thuê kho này sẽ thấy ảnh này.')
              : form.removePhoto ? 'Ảnh sẽ được gỡ khi lưu; kho dùng lại ảnh của loại kho.'
                : 'Chưa có ảnh riêng: đang dùng ảnh của loại kho. JPG, PNG hoặc WebP, tối đa 5 MB.'}
          </small>
          {error && <small className="danger-text">{error}</small>}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </div>
  )
}

/** Code prefix taken from the zone: "Khu A" → A, "khu vip" → VIP, "B2" → B2 (no tone marks, at most 5 characters). */
export function zonePrefix(zone: string): string {
  return zone.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .replace(/^\s*khu(\s+vuc)?\b/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
}

/** Suggested code for a new unit in `zone`: the zone's prefix, numbered after the highest one there, e.g. A-12 → A-13. */
export function nextUnitCode(units: StorageUnit[], zone: string): string {
  const prefix = zonePrefix(zone)
  if (!prefix) return ''
  const taken = new Set(units.map((u) => u.unitCode.toUpperCase()))
  const numbers = units.filter((u) => u.unitCode.toUpperCase().replace(/-?\d+$/, '') === prefix)
    .map((u) => Number(u.unitCode.match(/(\d+)$/)?.[1] ?? 0))
  let n = Math.max(0, ...numbers) + 1
  while (taken.has(`${prefix}-${String(n).padStart(2, '0')}`)) n++
  return `${prefix}-${String(n).padStart(2, '0')}`
}

export function UnitForm({ form, onChange, units, types, busy, onSubmit, onClose, bare = false }: {
  form: UnitFormValue
  onChange: (form: UnitFormValue) => void
  units: StorageUnit[]
  types: UnitType[]
  busy: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  /** Inside a dialog that already has the title and close button. */
  bare?: boolean
}) {
  const code = useInputFilter(CODE_FILTER)
  const current = units.find((u) => u.unitId === form.unitId)
  const renameOnly = !!current && LOCKED_UNIT_STATUSES.includes(current.status)
  const selectedType = types.find((t) => t.unitTypeId === form.unitTypeId) ?? types[0]
  // A new unit's code follows its zone (Khu A → A-13), until the code is typed by hand.
  const suggested = form.unitId ? '' : nextUnitCode(units, form.zoneArea)
  const edited = useRef(false)
  useEffect(() => {
    if (form.unitId || edited.current || form.unitCode === suggested) return
    onChange({ ...form, unitCode: suggested })
  }, [suggested, form, onChange])
  const isSuggested = !form.unitId && !!suggested && form.unitCode === suggested
  return (
    <form className={bare ? 'stack' : 'panel'} onSubmit={onSubmit}>
      {!bare && (
        <div className="panel-head">
          <h2 className="panel-title">{current ? `Sửa kho ${current.unitCode}` : 'Thêm kho mới'}</h2>
          <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}><Icon name="x" /></button>
        </div>
      )}
      <div className="form-grid four">
        <label className="field"><span>Khu vực</span>
          <input value={form.zoneArea} onChange={(e) => onChange({ ...form, zoneArea: e.target.value })} placeholder="vd: Khu B" maxLength={30} disabled={renameOnly} autoFocus={!form.unitId} />
        </label>
        <label className="field"><span>Mã kho</span>
          <input value={form.unitCode} onChange={(e) => { edited.current = true; onChange({ ...form, unitCode: code.keep(e.target.value) }) }} placeholder={form.unitId ? 'vd: B-04' : 'Nhập khu vực để tự sinh'} maxLength={30} required autoFocus={!!form.unitId} />
          <FieldNote text={code.hint} />
          {isSuggested && !code.hint && <small className="muted">Tự sinh theo khu vực, sửa được.</small>}
        </label>
        <label className="field"><span>Loại kho</span>
          <Select value={form.unitTypeId} onChange={(e) => onChange({ ...form, unitTypeId: Number(e.target.value) })} disabled={renameOnly} required>
            {types.map((t) => <option key={t.unitTypeId} value={t.unitTypeId}>{splitTypeName(t.typeName).name}</option>)}
          </Select>
        </label>
        <label className="field"><span>Tầng</span>
          <input type="number" min={1} max={100} value={form.floorNumber} onChange={(e) => onChange({ ...form, floorNumber: Number(e.target.value) || 1 })} disabled={renameOnly} required />
        </label>
      </div>
      {renameOnly && <p className="hint"><Icon name="alert" size={15} /> Kho đang có khách thuê hoặc giữ chỗ: chỉ đổi được mã kho, không đổi loại và vị trí.</p>}
      <UnitPhotoPicker form={form} onChange={onChange} current={current?.imageUrl} typePhoto={selectedType?.imageUrl}
        typeName={selectedType?.typeName} typeId={selectedType?.unitTypeId} />
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
