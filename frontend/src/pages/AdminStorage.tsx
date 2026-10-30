import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import { daysUntil, fetchContracts } from '../consoleData'
import { Badge, Empty, Icon, splitTypeName } from '../components/ui'
import { EMPTY_UNIT_FORM, LOCKED_UNIT_STATUSES, saveUnit, UnitForm, unitFormOf, type UnitFormValue } from '../components/UnitForm'
import type { AdminContract, Facility, StorageUnit, UnitType } from '../types'
import { Select } from '../components/Select'

/**
 * System administrator "Kho Lưu Trữ" (Figma "storage-management"): every unit of every facility as cards or a table,
 * and where units are added, edited, put under maintenance and deleted.
 * - units: GET /api/operations/facilities/{id}/units for each facility (all statuses);
 * - who rents a unit: its live contract (GET /api/admin/contracts, Active and Overdue);
 * - changes: FacilityManagementController (POST/PUT/DELETE .../facilities/{id}/units, PUT .../units/{id}/status),
 *   through the shared UnitForm / saveUnit. The API enforces the rules; the buttons only appear where it allows them:
 *   rented, reserved or locked units can only be renamed; only empty or maintenance units can be deleted, and only if
 *   they never had a contract, reservation or support request; only empty units go under maintenance.
 */

type Unit = StorageUnit & { facilityId: number; facilityName: string }
interface Tile { unit: Unit; status: StatusKey; contract?: AdminContract }

const STATUS = {
  Available: { label: 'Trống', tone: 'ok' },
  Reserved: { label: 'Giữ chỗ', tone: 'info' },
  Rented: { label: 'Đang thuê', tone: 'info' },
  Overdue: { label: 'Quá hạn', tone: 'bad' },
  OverdueLocked: { label: 'Khóa quá hạn', tone: 'bad' },
  UnderMaintenance: { label: 'Bảo trì', tone: 'warn' },
} as const
type StatusKey = keyof typeof STATUS
const PAGE_SIZE = 9

export default function AdminStorage() {
  const [params] = useSearchParams()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [contracts, setContracts] = useState<AdminContract[] | null>(null)
  const [types, setTypes] = useState<UnitType[]>([])
  // ?facility=<id>&q=<unit code> (links from the overview and the old "Kho từng cơ sở" page) open filtered.
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const [facilityId, setFacilityId] = useState(() => params.get('facility') ?? '')
  const [status, setStatus] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // The unit form, with the facility it belongs to (chosen when adding, fixed when editing).
  const [form, setForm] = useState<{ facilityId: number; value: UnitFormValue } | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

  const load = useCallback(async () => {
    const list = await api<Facility[]>('/api/operations/facilities')
    setFacilities(list)
    const all = await Promise.all(list.map((f) => api<StorageUnit[]>(`/api/operations/facilities/${f.facilityId}/units`)
      .then((us) => us.map((u) => ({ ...u, facilityId: f.facilityId, facilityName: f.facilityName })))))
    setUnits(all.flat())
    const [a, o] = await Promise.all([fetchContracts('Active'), fetchContracts('Overdue')])
    setContracts([...a, ...o])
  }, [])
  useEffect(() => {
    load().catch((e) => setError((e as Error).message))
    api<UnitType[]>('/api/unit-types').then(setTypes).catch(() => {})
  }, [load])

  const tiles = useMemo<Tile[]>(() => (units ?? []).map((unit) => {
    const contract = contracts?.find((c) => c.unitId === unit.unitId)
    const key = (contract?.status === 'Overdue' && unit.status === 'Rented' ? 'Overdue' : unit.status) as StatusKey
    return { unit, contract, status: STATUS[key] ? key : 'Available' }
  }).sort((a, b) => a.unit.facilityName.localeCompare(b.unit.facilityName) || a.unit.unitCode.localeCompare(b.unit.unitCode)), [units, contracts])

  const term = search.trim().toLowerCase()
  const inFacility = tiles.filter((t) => !facilityId || t.unit.facilityId === Number(facilityId))
  const shown = inFacility.filter((t) => (!status || t.status === status)
    && (!term || [t.unit.unitCode, t.unit.zoneArea ?? '', t.unit.unitTypeName, t.contract?.customerName ?? '', t.contract?.contractNumber ?? '']
      .some((v) => v.toLowerCase().includes(term))))
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageTiles = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const count = (k: StatusKey) => inFacility.filter((t) => t.status === k).length
  const loading = !units || !contracts
  const filter = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPage(1) }
  const activeFacilities = facilities.filter((f) => f.status === 'Active')

  /** Runs a change, shows its notice or the API's message, then reloads the units. */
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
  const unitPath = (u: Unit) => `/api/facility-management/facilities/${u.facilityId}/units/${u.unitId}`
  const openForm = (next: { facilityId: number; value: UnitFormValue }) => {
    setForm(next)
    setRemoving(null)
    setError('')
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const add = () => {
    const fid = activeFacilities.some((f) => f.facilityId === Number(facilityId)) ? Number(facilityId) : activeFacilities[0]?.facilityId
    if (fid) openForm({ facilityId: fid, value: { ...EMPTY_UNIT_FORM, unitTypeId: types[0]?.unitTypeId ?? 0 } })
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    const same = (units ?? []).filter((u) => u.facilityId === form.facilityId)
    if (await run(() => saveUnit(form.facilityId, form.value, same, types))) setForm(null)
  }
  const setUnitStatus = (u: Unit, next: 'Available' | 'UnderMaintenance') => run(
    () => api(`${unitPath(u)}/status`, { method: 'PUT', body: { status: next } }),
    next === 'UnderMaintenance' ? `Kho ${u.unitCode} đã chuyển sang bảo trì.` : `Kho ${u.unitCode} đã hoạt động trở lại.`)
  const removeUnit = async (u: Unit) => {
    if (await run(() => api(unitPath(u), { method: 'DELETE' }), `Đã xóa kho ${u.unitCode} (${u.facilityName}).`)) setRemoving(null)
  }
  const actions: Actions = {
    busy,
    removing,
    edit: (u) => openForm({ facilityId: u.facilityId, value: unitFormOf(u) }),
    setStatus: (u, next) => void setUnitStatus(u, next),
    askRemove: (id) => { setRemoving(id); setError(''); setNotice('') },
    remove: (u) => void removeUnit(u),
  }
  const formUnits = form ? (units ?? []).filter((u) => u.facilityId === form.facilityId) : []
  const formFacility = facilities.find((f) => f.facilityId === form?.facilityId)

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Quản Lý Kho Lưu Trữ</h1>
          <p className="muted">Mọi kho của các cơ sở: khách đang thuê, hạn hợp đồng; thêm, sửa, bảo trì hoặc xóa kho.</p>
        </div>
        <button className="btn primary" disabled={!types.length || !activeFacilities.length || busy} onClick={add}
          title={activeFacilities.length ? undefined : 'Chỉ thêm kho được tại cơ sở đang hoạt động'}>
          <Icon name="plus" size={16} /> Thêm kho
        </button>
      </div>

      {form && (
        <div className="stack-sm">
          {form.value.unitId ? (
            <p className="muted">Cơ sở: <b>{formFacility?.facilityName}</b></p>
          ) : (
            <label className="field inline"><span>Thêm vào cơ sở</span>
              <Select value={form.facilityId} onChange={(e) => setForm({ ...form, facilityId: Number(e.target.value) })} aria-label="Cơ sở của kho mới">
                {activeFacilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
              </Select>
            </label>
          )}
          <UnitForm form={form.value} onChange={(value) => setForm({ ...form, value })} units={formUnits} types={types} busy={busy}
            onSubmit={save} onClose={() => setForm(null)} />
        </div>
      )}

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={search} onChange={filter(setSearch)} placeholder="Tìm mã kho, khu vực, khách hàng, số hợp đồng…" />
          </span>
          <Select value={facilityId} onChange={filter(setFacilityId)} aria-label="Cơ sở">
            <option value="">Cơ sở: Tất cả</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}{f.status !== 'Active' ? ` (${f.status === 'Closed' ? 'đã đóng' : 'tạm ngưng'})` : ''}</option>)}
          </Select>
          <Select value={status} onChange={filter(setStatus)} aria-label="Trạng thái">
            <option value="">Trạng thái: Tất cả</option>
            {(Object.keys(STATUS) as StatusKey[]).map((k) => <option key={k} value={k}>{STATUS[k].label} ({count(k)})</option>)}
          </Select>
        </div>
        <div className="segmented view-toggle" role="group" aria-label="Kiểu hiển thị">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Dạng thẻ"><Icon name="grid" size={16} /></button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="Dạng bảng"><Icon name="menu" size={16} /></button>
        </div>
      </div>

      {loading && !error && <p className="muted">Đang tải danh sách kho…</p>}
      {!loading && shown.length === 0 && <section className="panel"><Empty icon="package">{inFacility.length ? 'Không có kho nào khớp bộ lọc.' : 'Chưa có kho nào.'}</Empty></section>}

      {view === 'grid' ? (
        <div className="unit-tiles">
          {pageTiles.map((t) => <UnitTile key={t.unit.unitId} tile={t} actions={actions} />)}
        </div>
      ) : pageTiles.length > 0 && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Mã kho</th><th>Cơ sở</th><th>Khách thuê / loại kho</th><th>Ngày hết hạn</th><th className="right">Đơn giá tháng</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
              <tbody>
                {pageTiles.map((t) => (
                  <tr key={t.unit.unitId}>
                    <td><b>{t.unit.unitCode}</b></td>
                    <td>{t.unit.facilityName}</td>
                    <td>{t.contract ? <Link className="link" to={`/admin/contracts?search=${encodeURIComponent(t.contract.contractNumber)}`}>{t.contract.customerName}</Link>
                      : <span className="muted">{splitTypeName(t.unit.unitTypeName).name} · Tầng {t.unit.floorNumber}{t.unit.zoneArea ? ` · ${t.unit.zoneArea}` : ''}</span>}</td>
                    <td>{t.contract ? fmtDate(t.contract.endDate) : '—'}</td>
                    <td className="right money">{fmtMoney(t.contract?.monthlyRentFee ?? t.unit.monthlyPrice)}</td>
                    <td><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></td>
                    <td className="right"><UnitActions tile={t} actions={actions} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <div className="row between wrap">
          <small className="muted">Hiển thị {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, shown.length)} trong số <b>{shown.length}</b> kho</small>
          <Pager page={current} pages={pages} onPage={setPage} />
        </div>
      )}

      {!loading && (
        <div className="panel summary-strip">
          <span><i className="info" />Tổng số kho: <b>{inFacility.length}</b></span>
          <span><i className="info dark" />Đang thuê: <b>{count('Rented') + count('Overdue') + count('OverdueLocked')}</b></span>
          <span><i className="ok" />Trống: <b>{count('Available')}</b></span>
          <span><i className="info" />Giữ chỗ: <b>{count('Reserved')}</b></span>
          <span><i className="warn" />Bảo trì: <b>{count('UnderMaintenance')}</b></span>
        </div>
      )}
      <p className="muted small-note">Kho đang thuê, giữ chỗ hoặc khóa quá hạn chỉ đổi được mã kho. Chỉ xóa được kho trống hoặc đang bảo trì chưa từng có hợp đồng, đơn đặt hay yêu cầu hỗ trợ; nếu không, hãy chuyển sang bảo trì.</p>
    </div>
  )
}

interface Actions {
  busy: boolean
  removing: number | null
  edit: (u: Unit) => void
  setStatus: (u: Unit, next: 'Available' | 'UnderMaintenance') => void
  askRemove: (unitId: number | null) => void
  remove: (u: Unit) => void
}

/** The buttons a unit allows (the API refuses the rest): edit always; maintenance and delete only without a tenant. */
function UnitActions({ tile: { unit: u, contract }, actions: a }: { tile: Tile; actions: Actions }) {
  const free = !contract && (u.status === 'Available' || u.status === 'UnderMaintenance')
  if (a.removing === u.unitId) {
    return (
      <span className="row end wrap">
        <small>Xóa kho {u.unitCode}?</small>
        <button className="btn danger sm" disabled={a.busy} onClick={() => a.remove(u)}>Xóa</button>
        <button className="btn ghost sm" disabled={a.busy} onClick={() => a.askRemove(null)}>Không</button>
      </span>
    )
  }
  return (
    <span className="row end wrap">
      {contract && <Link className="btn outline sm" to={`/admin/contracts?search=${encodeURIComponent(contract.contractNumber)}`}>Hợp đồng</Link>}
      {free && u.status === 'Available' && <button className="btn ghost sm" disabled={a.busy} onClick={() => a.setStatus(u, 'UnderMaintenance')}>Bảo trì</button>}
      {free && u.status === 'UnderMaintenance' && <button className="btn ghost sm" disabled={a.busy} onClick={() => a.setStatus(u, 'Available')}>Hoạt động lại</button>}
      <button className="btn ghost sm" disabled={a.busy} onClick={() => a.edit(u)}
        title={LOCKED_UNIT_STATUSES.includes(u.status) ? 'Kho đang có khách hoặc giữ chỗ: chỉ đổi được mã kho' : 'Sửa kho'}>Sửa</button>
      {free && <button className="btn ghost sm danger-text" disabled={a.busy} onClick={() => a.askRemove(u.unitId)}>Xóa</button>}
    </span>
  )
}

function UnitTile({ tile: t, actions }: { tile: Tile; actions: Actions }) {
  const s = STATUS[t.status]
  const c = t.contract
  const u = t.unit
  const days = c ? daysUntil(c.endDate) : 0
  return (
    <article className="unit-tile">
      <div className="row between">
        <h3><span className="stat-icon info"><Icon name="package" size={15} /></span>{u.unitCode}</h3>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <dl>
        <div><dt>Cơ sở</dt><dd>{u.facilityName}</dd></div>
        {c ? (
          <>
            <div><dt>Khách thuê</dt><dd>{c.customerName}</dd></div>
            <div><dt>Ngày hết hạn</dt><dd className={days <= 30 ? 'danger-text' : ''}>{fmtDate(c.endDate)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Loại không gian</dt><dd>{splitTypeName(u.unitTypeName).name}</dd></div>
            <p className="muted">Tầng {u.floorNumber}{u.zoneArea ? ` · ${u.zoneArea}` : ''}{t.status === 'Available' ? ' · sẵn sàng bàn giao khách hàng mới' : ''}</p>
          </>
        )}
      </dl>
      <div className="row between unit-tile-foot">
        <div><small>ĐƠN GIÁ THÁNG</small><b>{fmtMoney(c?.monthlyRentFee ?? u.monthlyPrice)}</b></div>
        <UnitActions tile={t} actions={actions} />
      </div>
    </article>
  )
}

/** Numbered pages: first, last and the two around the current one. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  return (
    <div className="pager">
      <button className="pager-text" disabled={page <= 1} onClick={() => onPage(page - 1)}>Trước</button>
      {nums.map((n, i) => (
        <span key={n} className="row">
          {i > 0 && n - nums[i - 1] > 1 && <span className="muted">…</span>}
          <button className={n === page ? 'active' : ''} onClick={() => onPage(n)}>{n}</button>
        </span>
      ))}
      <button className="pager-text" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sau</button>
    </div>
  )
}
