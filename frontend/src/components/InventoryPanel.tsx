import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtTime } from '../api'
import { Badge, Empty, Icon } from './ui'
import { StoredItemStatuses, type ContractInventory, type StoredItem } from '../types'

/**
 * "Tồn kho & mức lưu trữ" of one contract: how full the unit is (stored + waiting to move in) and the items in it.
 * One panel for the three readers, each through its own endpoint:
 * - customer: GET /api/contracts/{id}/items; edits an item (PUT), changes its photo (POST …/image),
 *   deletes an item still waiting to move in (DELETE);
 * - staff: GET /api/gate/facilities/{fid}/contracts/{id}/items; confirms items taken out (POST …/items/{itemId}/remove)
 *   and records items brought in at the counter (POST …/items);
 * - admin: GET /api/admin/contracts/{id}/items, read only.
 * Errors are the backend's Vietnamese ProblemDetails messages, shown as they come (400 size/volume, 403, 404, 409).
 */

type Mode = 'customer' | 'staff' | 'admin'
type Filter = 'active' | 'Stored' | 'PendingMoveIn' | 'history'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Đang hiệu lực' },
  { key: 'Stored', label: 'Đang lưu' },
  { key: 'PendingMoveIn', label: 'Chờ đưa vào' },
  { key: 'history', label: 'Cả lịch sử' },
]
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO = 5 * 1024 * 1024

export const fmtM3 = (n: number) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
/** More than 2 decimals (the backend keeps cm with 2). */
const tooPrecise = (d: number) => Math.abs(Math.round(d * 100) - d * 100) > 1e-6
const fmtCm = (n: number) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
const num = (s: string) => { const n = Number(s.trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN }

/** Fill bar: stored and waiting volume side by side; orange past 80%, red when the unit is over its volume. */
export function CapacityBar({ inv, extraM3 = 0 }: { inv: ContractInventory; extraM3?: number }) {
  const total = inv.unitVolumeM3 || 0
  const pct = (v: number) => (total > 0 ? Math.min(100, (v / total) * 100) : 0)
  const used = inv.storedVolumeM3 + inv.pendingVolumeM3 + extraM3
  const over = total > 0 && used > total + 1e-9
  const usedPct = total > 0 ? Math.round((used / total) * 100) : 0
  return (
    <div className="stack-sm">
      <div className="capacity-bar" role="progressbar" aria-valuenow={Math.min(usedPct, 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Mức lấp đầy kho">
        <i className={`stored ${over ? 'over' : usedPct > 80 ? 'high' : ''}`} style={{ width: `${pct(inv.storedVolumeM3)}%` }} />
        <i className={`pending ${over ? 'over' : ''}`} style={{ width: `${pct(inv.pendingVolumeM3)}%` }} />
        {extraM3 > 0 && <i className={`extra ${over ? 'over' : ''}`} style={{ width: `${pct(extraM3)}%` }} />}
      </div>
      <small className={over ? 'danger-text' : usedPct > 80 ? 'warn-text' : 'muted'}>
        {usedPct}% · Đang lưu {fmtM3(inv.storedVolumeM3)} m³ · Chờ đưa vào {fmtM3(inv.pendingVolumeM3)} m³
        {extraM3 > 0 && ` · Đợt này ${fmtM3(extraM3)} m³`} · Còn trống {fmtM3(Math.max(0, total - used))} m³ / Tổng {fmtM3(total)} m³
      </small>
    </div>
  )
}

export function InventoryPanel({ mode, contractId, facilityId, canEdit = false, canAddAtFacility = false, moveInLink }: {
  mode: Mode
  contractId: number
  facilityId?: number
  /** Customer: the contract is still running (Active/Overdue), so items can be changed. */
  canEdit?: boolean
  /** Staff: the contract is active and the unit is neither locked nor under maintenance. */
  canAddAtFacility?: boolean
  /** Customer: shortcut to register a move-in, when the contract is active and not locked. */
  moveInLink?: string | null
}) {
  const [filter, setFilter] = useState<Filter>(mode === 'admin' ? 'history' : 'active')
  const [inv, setInv] = useState<ContractInventory | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<{ id: number; kind: 'edit' | 'remove' } | null>(null)
  const [adding, setAdding] = useState(false)

  const base = mode === 'customer' ? `/api/contracts/${contractId}/items`
    : mode === 'staff' ? `/api/gate/facilities/${facilityId}/contracts/${contractId}/items`
    : `/api/admin/contracts/${contractId}/items`
  const query = filter === 'history' ? '?includeHistory=true' : filter === 'active' ? '' : `?status=${filter}`

  const load = useCallback(async () => {
    if (mode === 'staff' && !facilityId) return
    setLoading(true)
    try {
      setInv(await api<ContractInventory>(`${base}${query}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [base, query, mode, facilityId])
  useEffect(() => { void load() }, [load])

  const done = async (msg: string) => { setOpen(null); setAdding(false); setNotice(msg); await load() }

  return (
    <div className="stack inventory-panel">
      {inv && <CapacityBar inv={inv} />}
      <div className="row between wrap">
        <div className="segmented" role="tablist" aria-label="Lọc đồ vật">
          {FILTERS.map((f) => <button key={f.key} type="button" className={filter === f.key ? 'active' : ''} onClick={() => { setFilter(f.key); setOpen(null) }}>{f.label}</button>)}
        </div>
        <span className="row">
          {mode === 'customer' && moveInLink && <Link to={moveInLink} className="btn outline sm"><Icon name="package" size={14} /> Đưa thêm đồ vào kho</Link>}
          {mode === 'staff' && canAddAtFacility && !adding && <button type="button" className="btn outline sm" onClick={() => { setNotice(''); setAdding(true) }}><Icon name="plus" size={14} /> Ghi nhận thêm đồ</button>}
        </span>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={15} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={15} />{error}</p>}
      {adding && facilityId && <AddItemForm url={`/api/gate/facilities/${facilityId}/contracts/${contractId}/items`} onCancel={() => setAdding(false)} onDone={done} />}

      {loading && !inv && <p className="muted">Đang tải đồ vật…</p>}
      {inv && inv.items.length === 0 && <Empty icon="package">Kho hiện chưa có đồ vật nào.</Empty>}
      {inv && inv.items.length > 0 && (
        <div className="table-scroll">
          <table className="inventory-table">
            <thead><tr><th>Ảnh</th><th>Món đồ</th><th className="right">SL</th><th>Kích thước (cm)</th><th className="right">Thể tích</th><th>Trạng thái</th><th>Thời gian</th>{mode !== 'admin' && <th />}</tr></thead>
            <tbody>
              {inv.items.map((it) => {
                const st = StoredItemStatuses[it.status] ?? { label: it.status, tone: 'muted' as const }
                const live = it.status === 'Stored' || it.status === 'PendingMoveIn'
                return (
                  <Fragment key={it.storedItemId}>
                    <tr>
                      <td>{it.imageUrl
                        ? <a href={it.imageUrl} target="_blank" rel="noreferrer" className="item-thumb-link" title="Bấm để xem ảnh gốc"><img src={it.imageUrl} alt={it.itemName} className="item-thumb" loading="lazy" /></a>
                        : <span className="muted">—</span>}</td>
                      <td><b>{it.itemName}</b>{it.category && <><br /><small className="muted">{it.category}</small></>}{it.notes && <><br /><small className="muted">{it.notes}</small></>}</td>
                      <td className="right">{it.quantity}</td>
                      <td className="nowrap">{fmtCm(it.lengthCm)} × {fmtCm(it.widthCm)} × {fmtCm(it.heightCm)}</td>
                      <td className="right nowrap">{fmtM3(it.totalVolumeM3)} m³</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="nowrap"><small>
                        {it.movedInAt ? `Vào ${fmtTime(it.movedInAt)}` : `Khai báo ${fmtTime(it.createdAt)}`}
                        {it.removedAt && <><br />Ra {fmtTime(it.removedAt)}</>}
                      </small></td>
                      {mode === 'customer' && (
                        <td className="nowrap">
                          {canEdit && live && <CustomerActions contractId={contractId} item={it} onEdit={() => { setNotice(''); setOpen(open?.id === it.storedItemId ? null : { id: it.storedItemId, kind: 'edit' }) }} onDone={done} onError={setError} />}
                        </td>
                      )}
                      {mode === 'staff' && (
                        <td className="nowrap">
                          {it.status === 'Stored' && <button type="button" className="btn outline sm" onClick={() => { setNotice(''); setOpen(open?.id === it.storedItemId ? null : { id: it.storedItemId, kind: 'remove' }) }}><Icon name="door" size={14} /> Lấy ra</button>}
                        </td>
                      )}
                    </tr>
                    {open?.id === it.storedItemId && (
                      <tr className="inventory-form-row"><td colSpan={8}>
                        {open.kind === 'edit'
                          ? <EditItemForm url={`/api/contracts/${contractId}/items/${it.storedItemId}`} item={it} onCancel={() => setOpen(null)} onDone={done} />
                          : <RemoveItemForm url={`/api/gate/facilities/${facilityId}/contracts/${contractId}/items/${it.storedItemId}/remove`} item={it} onCancel={() => setOpen(null)} onDone={done} />}
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Customer row actions: edit, change the photo, delete an item still waiting to move in. */
function CustomerActions({ contractId, item, onEdit, onDone, onError }: {
  contractId: number; item: StoredItem; onEdit: () => void; onDone: (m: string) => Promise<void>; onError: (m: string) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!PHOTO_TYPES.includes(f.type)) { onError('Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP'); return }
    if (f.size > MAX_PHOTO) { onError('Ảnh tải lên không được vượt quá 5 MB'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      await api<StoredItem>(`/api/contracts/${contractId}/items/${item.storedItemId}/image`, { body: fd })
      await onDone(`Đã cập nhật ảnh "${item.itemName}".`)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Xóa "${item.itemName}" khỏi lịch chuyển đồ?`)) return
    setBusy(true)
    try {
      await api(`/api/contracts/${contractId}/items/${item.storedItemId}`, { method: 'DELETE' })
      await onDone(`Đã xóa "${item.itemName}".`)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="row">
      <button type="button" className="link-btn" disabled={busy} onClick={onEdit}><Icon name="settings" size={14} /> Sửa</button>
      <button type="button" className="link-btn" disabled={busy} onClick={() => file.current?.click()}><Icon name="plus" size={14} /> {item.imageUrl ? 'Đổi ảnh' : 'Thêm ảnh'}</button>
      <input ref={file} type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={(e) => { void pick(e) }} />
      {item.status === 'PendingMoveIn' && <button type="button" className="link-btn danger-text" disabled={busy} onClick={() => { void remove() }}><Icon name="trash" size={14} /> Xóa</button>}
    </span>
  )
}

/**
 * Customer edit (PUT /api/contracts/{id}/items/{itemId}). Once the item is in the unit, only its name, category and
 * notes change: the backend answers 409 to a new quantity or size, so those fields are locked here.
 */
function EditItemForm({ url, item, onCancel, onDone }: { url: string; item: StoredItem; onCancel: () => void; onDone: (m: string) => Promise<void> }) {
  const sizeLocked = item.status !== 'PendingMoveIn'
  const [f, setF] = useState({
    itemName: item.itemName, category: item.category ?? '', notes: item.notes ?? '',
    quantity: String(item.quantity), lengthCm: String(item.lengthCm), widthCm: String(item.widthCm), heightCm: String(item.heightCm),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  const save = async () => {
    const q = num(f.quantity), l = num(f.lengthCm), w = num(f.widthCm), h = num(f.heightCm)
    const problem = !f.itemName.trim() ? 'Vui lòng nhập tên món đồ'
      : f.itemName.trim().length > 100 ? 'Tên món đồ tối đa 100 ký tự'
      : f.category.length > 80 ? 'Loại đồ tối đa 80 ký tự'
      : f.notes.length > 300 ? 'Ghi chú tối đa 300 ký tự'
      : !Number.isInteger(q) || q < 1 || q > 999 ? 'Số lượng mỗi món phải từ 1 đến 999'
      : [l, w, h].some((d) => !(d >= 0.1 && d <= 2000)) ? 'Mỗi chiều kích thước từ 0,1 đến 2000 cm'
        : [l, w, h].some(tooPrecise) ? 'Kích thước chỉ nhập tối đa 2 chữ số thập phân (cm)' : ''
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      await api<StoredItem>(url, {
        method: 'PUT',
        body: { itemName: f.itemName.trim(), category: f.category.trim() || null, quantity: q, lengthCm: l, widthCm: w, heightCm: h, notes: f.notes.trim() || null, imageUrl: item.imageUrl },
      })
      await onDone(`Đã cập nhật "${f.itemName.trim()}".`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm inventory-form">
      <div className="form-grid">
        <label className="field"><span>Tên món đồ *</span><input value={f.itemName} maxLength={100} onChange={(e) => set('itemName', e.target.value)} /></label>
        <label className="field"><span>Loại đồ</span><input value={f.category} maxLength={80} onChange={(e) => set('category', e.target.value)} /></label>
        <label className="field"><span>Số lượng</span><input type="number" min={1} max={999} value={f.quantity} disabled={sizeLocked} onChange={(e) => set('quantity', e.target.value)} /></label>
        <label className="field"><span>Dài × Rộng × Cao (cm)</span>
          <span className="dims">
            <input inputMode="decimal" aria-label="Dài (cm)" value={f.lengthCm} disabled={sizeLocked} onChange={(e) => set('lengthCm', e.target.value)} /><span>×</span>
            <input inputMode="decimal" aria-label="Rộng (cm)" value={f.widthCm} disabled={sizeLocked} onChange={(e) => set('widthCm', e.target.value)} /><span>×</span>
            <input inputMode="decimal" aria-label="Cao (cm)" value={f.heightCm} disabled={sizeLocked} onChange={(e) => set('heightCm', e.target.value)} />
          </span>
        </label>
      </div>
      <label className="field"><span>Ghi chú</span><input value={f.notes} maxLength={300} onChange={(e) => set('notes', e.target.value)} /></label>
      {sizeLocked && <small className="muted">Món đã ở trong kho: chỉ sửa được tên, loại đồ và ghi chú. Muốn lấy bớt hoặc thêm đồ, vui lòng làm với nhân viên tại cơ sở.</small>}
      {error && <p className="alert bad"><Icon name="alert" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => { void save() }}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Hủy</button>
      </div>
    </div>
  )
}

/** Staff: the customer takes some or all of an item out (POST …/items/{itemId}/remove). */
function RemoveItemForm({ url, item, onCancel, onDone }: { url: string; item: StoredItem; onCancel: () => void; onDone: (m: string) => Promise<void> }) {
  const [qty, setQty] = useState(String(item.quantity))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const q = Number(qty)
    if (!Number.isInteger(q) || q < 1 || q > item.quantity) { setError(`Số lượng lấy ra phải từ 1 đến ${item.quantity}`); return }
    if (notes.length > 300) { setError('Ghi chú tối đa 300 ký tự'); return }
    setBusy(true)
    setError('')
    try {
      await api<StoredItem>(url, { body: { quantityToRemove: q, notes: notes.trim() || null } })
      await onDone(q === item.quantity ? `Đã xác nhận lấy ra toàn bộ "${item.itemName}".` : `Đã xác nhận lấy ra ${q}/${item.quantity} "${item.itemName}".`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm inventory-form">
      <div className="form-grid">
        <label className="field"><span>Số lượng lấy ra (tối đa {item.quantity})</span><input type="number" min={1} max={item.quantity} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="field"><span>Ghi chú</span><input value={notes} maxLength={300} placeholder="vd: khách lấy về nhà" onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => { void save() }}>{busy ? 'Đang lưu…' : 'Xác nhận lấy ra'}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Hủy</button>
      </div>
    </div>
  )
}

/** Staff: items brought in at the counter, recorded as Stored (POST …/items); the backend checks the unit's room. */
function AddItemForm({ url, onCancel, onDone }: { url: string; onCancel: () => void; onDone: (m: string) => Promise<void> }) {
  const [f, setF] = useState({ name: '', category: '', quantity: '1', lengthCm: '', widthCm: '', heightCm: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  const save = async () => {
    const q = num(f.quantity), l = num(f.lengthCm), w = num(f.widthCm), h = num(f.heightCm)
    const problem = !f.name.trim() ? 'Vui lòng nhập tên món đồ'
      : !Number.isInteger(q) || q < 1 || q > 999 ? 'Số lượng mỗi món phải từ 1 đến 999'
      : [l, w, h].some((d) => !(d >= 0.1 && d <= 2000)) ? 'Nhập đủ 3 chiều, mỗi chiều từ 0,1 đến 2000 cm'
      : [l, w, h].some(tooPrecise) ? 'Kích thước chỉ nhập tối đa 2 chữ số thập phân (cm)'
      : f.notes.length > 300 ? 'Ghi chú tối đa 300 ký tự' : ''
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      await api<StoredItem>(url, { body: { name: f.name.trim(), quantity: q, lengthCm: l, widthCm: w, heightCm: h, category: f.category.trim() || null, notes: f.notes.trim() || null } })
      await onDone(`Đã ghi nhận "${f.name.trim()}" vào kho.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm inventory-form panel-tint">
      <b>Ghi nhận đồ khách mang vào tại cơ sở</b>
      <div className="form-grid">
        <label className="field"><span>Tên món đồ *</span><input value={f.name} maxLength={100} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>Loại đồ</span><input value={f.category} maxLength={80} onChange={(e) => set('category', e.target.value)} /></label>
        <label className="field"><span>Số lượng *</span><input type="number" min={1} max={999} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></label>
        <label className="field"><span>Dài × Rộng × Cao (cm) *</span>
          <span className="dims">
            <input inputMode="decimal" aria-label="Dài (cm)" value={f.lengthCm} onChange={(e) => set('lengthCm', e.target.value)} /><span>×</span>
            <input inputMode="decimal" aria-label="Rộng (cm)" value={f.widthCm} onChange={(e) => set('widthCm', e.target.value)} /><span>×</span>
            <input inputMode="decimal" aria-label="Cao (cm)" value={f.heightCm} onChange={(e) => set('heightCm', e.target.value)} />
          </span>
        </label>
      </div>
      <label className="field"><span>Ghi chú</span><input value={f.notes} maxLength={300} onChange={(e) => set('notes', e.target.value)} /></label>
      {error && <p className="alert bad"><Icon name="alert" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => { void save() }}>{busy ? 'Đang lưu…' : 'Ghi nhận vào kho'}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Hủy</button>
      </div>
    </div>
  )
}
