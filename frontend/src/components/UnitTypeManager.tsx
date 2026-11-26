import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney } from '../api'
import { useAuth } from '../auth'
import { checkMoney, checkText, firstError } from '../validation'
import { Badge, Empty, Icon, splitTypeName } from './ui'
import { resetUnitTypeImages, UnitTypePhoto } from './unitPhoto'
import { Roles, type Facility, type UnitType } from '../types'

/**
 * "Loại kho & Hình ảnh", the same block for the system administrator (/admin/facilities) and the operations
 * manager (/ops/policies): every unit type (GET /api/operations/unit-types) with its photo, size, volume, climate
 * control, prices and description; add or edit one (POST / PUT /api/operations/unit-types[/{id}]) with an optional
 * photo (POST /api/operations/unit-types/{id}/image, FormData "file"; DELETE …/image removes it); delete a type
 * nothing uses (DELETE /api/operations/unit-types/{id}, 409 when units or reservations use it).
 * A new type can only be booked once a facility has a unit of it, so its creation ends with that reminder.
 */

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO = 5 * 1024 * 1024
const m3 = (n: number) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })

export function UnitTypeManager({ query = '', onChanged }: { query?: string; onChanged?: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === Roles.Admin
  const [types, setTypes] = useState<UnitType[] | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [created, setCreated] = useState<UnitType | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setTypes(await api<UnitType[]>('/api/operations/unit-types'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
    api<Facility[]>('/api/operations/facilities').then((fs) => setFacilities(fs.filter((f) => f.status !== 'Closed'))).catch(() => {})
  }, [load])

  const saved = async (msg: string, newType?: UnitType) => {
    setEditing(null)
    setNotice(msg)
    setCreated(newType ?? null)
    resetUnitTypeImages()
    await load()
    onChanged?.()
  }

  const s = query.trim().toLowerCase()
  const shown = useMemo(() => (types ?? []).filter((t) => !s || t.typeName.toLowerCase().includes(s) || (t.description ?? '').toLowerCase().includes(s)), [types, s])

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted">{types ? `${types.length} loại kho` : 'Đang tải loại kho…'} · ảnh JPG, PNG hoặc WebP, tối đa 5 MB.</p>
        {editing !== 'new' && <button type="button" className="btn primary sm" onClick={() => { setNotice(''); setCreated(null); setEditing('new') }}><Icon name="plus" size={14} /> Thêm loại kho</button>}
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={15} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={15} />{error}</p>}

      {created && (
        <div className="notice info-notice">
          <span className="notice-icon info"><Icon name="building" size={15} /></span>
          <div className="stack-sm">
            <b>Tạo ô kho cho loại "{splitTypeName(created.typeName).name}" để khách đặt được</b>
            <p>Mỗi cơ sở cần ít nhất 1 ô kho thuộc loại này. Chưa có ô kho thì trang Thuê kho vẫn hiện loại mới nhưng ở trạng thái "Hết chỗ".</p>
            {isAdmin ? (
              <div className="chip-row">
                {facilities.map((f) => <Link key={f.facilityId} to={`/admin/storage?facility=${f.facilityId}`} className="btn outline sm"><Icon name="plus" size={13} /> Thêm ô kho tại {f.facilityName}</Link>)}
              </div>
            ) : <p className="muted">Quản lý từng cơ sở thêm ô kho ở trang Kho của cơ sở (hoặc Admin ở trang Kho Lưu Trữ).</p>}
          </div>
        </div>
      )}

      {editing === 'new' && <UnitTypeForm onCancel={() => setEditing(null)} onSaved={saved} />}

      {types && shown.length === 0 && <Empty icon="package">{types.length ? 'Không có loại kho nào khớp bộ lọc.' : 'Chưa có loại kho nào.'}</Empty>}
      <div className="policy-list">
        {shown.map((t) => {
          const { name, size } = splitTypeName(t.typeName)
          return (
            <article key={t.unitTypeId} className="policy-item unit-type-item">
              <div className="unit-type-row">
                <div className="unit-type-thumb"><UnitTypePhoto src={t.imageUrl} typeName={t.typeName} typeId={t.unitTypeId} alt={name} /></div>
                <div className="stack-sm grow">
                  <div className="row between wrap">
                    <span className="row"><span className="code-chip">LK-{String(t.unitTypeId).padStart(2, '0')}</span>{t.hasClimateControl && <Badge tone="info">Điều hòa</Badge>}{!t.imageUrl && <Badge tone="warn">Chưa có ảnh</Badge>}</span>
                    <b className="policy-amount">{fmtMoney(t.baseMonthlyRate)}<small>/tháng</small></b>
                  </div>
                  <b className="policy-title">{name} <small className="muted">{size}</small></b>
                  <small className="muted">{t.lengthMeters} × {t.widthMeters} × {t.heightMeters} m · {m3(t.volumeCubicMeters || t.lengthMeters * t.widthMeters * t.heightMeters)} m³</small>
                  {t.description && <small className="muted">{t.description}</small>}
                </div>
              </div>
              <div className="row between wrap">
                <span />
                <button type="button" className="link-btn" onClick={() => { setNotice(''); setCreated(null); setEditing(editing === t.unitTypeId ? null : t.unitTypeId) }}><Icon name="settings" size={14} /> {editing === t.unitTypeId ? 'Đóng' : 'Sửa loại kho & ảnh'}</button>
              </div>
              {editing === t.unitTypeId && <UnitTypeForm key={t.unitTypeId} type={t} onCancel={() => setEditing(null)} onSaved={saved} />}
            </article>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Add or edit a unit type. Sizes are inside measurements in metres, length/width 0.1–30 and height 0.1–15 with at most 2 decimals (SaveUnitTypeRequest).
 * The type is saved first; its photo goes after it, so a failed upload keeps the type and says to upload again.
 */
/** Add/edit form for one unit type (with its photo); also used from the "Thêm kho mới" dialog. */
export function UnitTypeForm({ type, onCancel, onSaved }: { type?: UnitType; onCancel: () => void; onSaved: (m: string, created?: UnitType) => Promise<void> }) {
  const [f, setF] = useState(() => ({
    typeName: type?.typeName ?? '',
    lengthMeters: String(type?.lengthMeters ?? ''),
    widthMeters: String(type?.widthMeters ?? ''),
    heightMeters: String(type?.heightMeters ?? ''),
    hasClimateControl: type?.hasClimateControl ?? false,
    baseMonthlyRate: String(type?.baseMonthlyRate ?? ''),
    description: type?.description ?? '',
  }))
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dropImage, setDropImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    if (!PHOTO_TYPES.includes(picked.type)) { setError('Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP'); return }
    if (picked.size > MAX_PHOTO) { setError('Ảnh tải lên không được vượt quá 5 MB'); return }
    setError('')
    setFile(picked)
    setDropImage(false)
    setPreview(URL.createObjectURL(picked))
  }

  const dim = (v: string, label: string, max: number) => {
    const n = Number(v)
    if (!v.trim() || !Number.isFinite(n) || n < 0.1 || n > max) return `${label} từ 0,1 đến ${max} m`
    return Math.round(n * 100) / 100 === n ? '' : `${label} tối đa 2 chữ số thập phân`
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const monthlyRaw = f.baseMonthlyRate.trim()
    const monthly = monthlyRaw ? Number(monthlyRaw) : NaN
    const monthlyError = !monthlyRaw
      ? 'Vui lòng nhập giá theo tháng'
      : !Number.isFinite(monthly) || !Number.isInteger(monthly)
        ? 'Giá theo tháng phải là số tiền nguyên (đồng)'
        : checkMoney(monthly, 'Giá theo tháng', 1000)

    const body = {
      typeName: f.typeName.trim(),
      lengthMeters: Number(f.lengthMeters), widthMeters: Number(f.widthMeters), heightMeters: Number(f.heightMeters),
      hasClimateControl: f.hasClimateControl,
      baseMonthlyRate: monthly,
      description: f.description.trim() || null,
    }
    const problem = firstError(
      checkText(f.typeName, 'Tên loại kho', 100, false, 2),
      dim(f.lengthMeters, 'Chiều dài', 30), dim(f.widthMeters, 'Chiều rộng', 30), dim(f.heightMeters, 'Chiều cao', 15),
      monthlyError,
      checkText(f.description, 'Mô tả', 500, true),
    )
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    let savedType: UnitType
    try {
      savedType = await api<UnitType>(type ? `/api/operations/unit-types/${type.unitTypeId}` : '/api/operations/unit-types',
        { method: type ? 'PUT' : 'POST', body })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
      return
    }
    const what = `loại kho "${body.typeName}"`
    try {
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        await api<UnitType>(`/api/operations/unit-types/${savedType.unitTypeId}/image`, { body: fd })
      } else if (dropImage && type?.imageUrl) {
        await api<UnitType>(`/api/operations/unit-types/${savedType.unitTypeId}/image`, { method: 'DELETE' })
      }
    } catch (err) {
      await onSaved(`Đã lưu ${what} nhưng chưa ${file ? 'tải' : 'gỡ'} được ảnh: ${(err as Error).message}. Bấm "Sửa loại kho & ảnh" để thử lại.`, type ? undefined : savedType)
      return
    }
    await onSaved(`Đã ${type ? 'cập nhật' : 'thêm'} ${what}${file ? ' kèm ảnh' : dropImage ? ', đã gỡ ảnh' : ''}.`, type ? undefined : savedType)
  }

  const remove = async () => {
    if (!type || !window.confirm(`Xóa loại kho "${type.typeName}"? Chỉ xóa được khi chưa có ô kho hay đơn đặt chỗ nào thuộc loại này.`)) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/operations/unit-types/${type.unitTypeId}`, { method: 'DELETE' })
      await onSaved(`Đã xóa loại kho "${type.typeName}".`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const shownImage = preview ?? (dropImage ? null : type?.imageUrl ?? null)
  return (
    <form className="policy-form" onSubmit={(e) => { void submit(e) }} noValidate>
      <h4>{type ? 'Sửa loại kho' : 'Thêm loại kho'}</h4>
      <div className="form-grid">
        <label className="field"><span>Tên loại kho *</span><input value={f.typeName} maxLength={100} placeholder="VD: Kho Siêu Lớn XL (4.0m x 5.0m)" onChange={(e) => set('typeName', e.target.value)} required /></label>
        <label className="field"><span>Mô tả</span><input value={f.description} maxLength={500} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="field"><span>Chiều dài (m) *</span><input type="number" min={0.1} max={30} step="0.01" value={f.lengthMeters} onChange={(e) => set('lengthMeters', e.target.value)} required /></label>
        <label className="field"><span>Chiều rộng (m) *</span><input type="number" min={0.1} max={30} step="0.01" value={f.widthMeters} onChange={(e) => set('widthMeters', e.target.value)} required /></label>
        <label className="field"><span>Chiều cao (m) *</span><input type="number" min={0.1} max={15} step="0.01" value={f.heightMeters} onChange={(e) => set('heightMeters', e.target.value)} required /></label>
        <label className="field"><span>Giá theo tháng (đ) *</span><input type="number" min={1000} step={1} value={f.baseMonthlyRate} onChange={(e) => set('baseMonthlyRate', e.target.value)} required /></label>
      </div>
      <label className="check-line"><input type="checkbox" checked={f.hasClimateControl} onChange={(e) => set('hasClimateControl', e.target.checked)} /><span>Có điều hòa kiểm soát nhiệt độ, độ ẩm</span></label>
      <div className="field">
        <span>Ảnh loại kho (tùy chọn)</span>
        <div className="unit-type-row">
          <div className="unit-type-thumb"><UnitTypePhoto src={shownImage} typeName={f.typeName} typeId={type?.unitTypeId} alt="Ảnh xem trước" /></div>
          <div className="stack-sm">
            <label className="btn outline sm"><Icon name="plus" size={13} /> {shownImage ? 'Đổi ảnh' : 'Chọn ảnh'}<input type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={pick} /></label>
            {file && <button type="button" className="link-btn" onClick={() => { setFile(null); setPreview(null) }}>Bỏ ảnh vừa chọn</button>}
            {!file && type?.imageUrl && !dropImage && <button type="button" className="link-btn danger-text" onClick={() => setDropImage(true)}><Icon name="trash" size={13} /> Gỡ ảnh hiện tại</button>}
            {dropImage && <small className="muted">Ảnh sẽ được gỡ khi bấm Lưu. <button type="button" className="link-btn" onClick={() => setDropImage(false)}>Giữ lại</button></small>}
            <small className="muted">JPG, PNG hoặc WebP, tối đa 5 MB. Chưa có ảnh thì dùng ảnh minh họa theo kích thước.</small>
          </div>
        </div>
      </div>
      {type && <small className="muted">Loại kho đang có hợp đồng hoặc đơn đặt chỗ hiệu lực thì chỉ đổi được tên, mô tả, giá và ảnh.</small>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row wrap">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Hủy</button>
        {type && <button type="button" className="link-btn danger-text" disabled={busy} onClick={() => { void remove() }}><Icon name="trash" size={14} /> Xóa loại kho này</button>}
      </div>
    </form>
  )
}
