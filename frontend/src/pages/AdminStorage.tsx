import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import { daysUntil, fetchContracts, monthRange } from '../consoleData'
import { Badge, Empty, Icon, splitTypeName } from '../components/ui'
import type { AdminContract, Facility, OperationsReport, StorageUnit } from '../types'
import { Select } from '../components/Select'

/**
 * System administrator "Kho Lưu Trữ" (Figma "storage-management"): units of every facility as cards or a table.
 * Free units come from the catalog (GET /api/facilities/{id}/units?status=Available), rented ones from live
 * contracts (GET /api/admin/contracts), the totals strip from GET /api/operations/reports/facilities.
 * The API gives the administrator no list of units under maintenance or reserved, so those only appear as counts.
 */

interface Tile {
  key: string
  unitCode: string
  facilityId: number
  facilityName: string
  status: 'Available' | 'Active' | 'Overdue'
  price: number
  typeName?: string
  floor?: string
  contract?: AdminContract
}

const STATUS = {
  Available: { label: 'Trống', tone: 'ok' },
  Active: { label: 'Đang thuê', tone: 'info' },
  Overdue: { label: 'Quá hạn', tone: 'bad' },
} as const
const PAGE_SIZE = 9

export default function AdminStorage() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [free, setFree] = useState<(StorageUnit & { facilityId: number; facilityName: string })[] | null>(null)
  const [contracts, setContracts] = useState<AdminContract[] | null>(null)
  const [report, setReport] = useState<OperationsReport | null>(null)
  const [search, setSearch] = useState('')
  const [facilityId, setFacilityId] = useState('')
  const [status, setStatus] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    const fail = (e: unknown) => setError((e as Error).message)
    api<Facility[]>('/api/facilities').then(async (list) => {
      setFacilities(list)
      // A closed facility answers 404: it simply has no free unit to show.
      const units = await Promise.all(list.map((f) => api<StorageUnit[]>(`/api/facilities/${f.facilityId}/units?status=Available`)
        .then((us) => us.map((u) => ({ ...u, facilityId: f.facilityId, facilityName: f.facilityName }))).catch(() => [])))
      setFree(units.flat())
    }).catch(fail)
    Promise.all([fetchContracts('Active'), fetchContracts('Overdue')]).then(([a, o]) => setContracts([...a, ...o])).catch(fail)
    const m = monthRange(0)
    api<OperationsReport>(`/api/operations/reports/facilities?fromDate=${m.from}&toDate=${m.to}`).then(setReport).catch(fail)
  }, [])

  const tiles = useMemo<Tile[]>(() => [
    ...(contracts ?? []).map((c) => ({ key: `c${c.contractId}`, unitCode: c.unitCode, facilityId: c.facilityId, facilityName: c.facilityName,
      status: c.status as Tile['status'], price: c.monthlyRentFee, contract: c })),
    ...(free ?? []).map((u) => ({ key: `u${u.unitId}`, unitCode: u.unitCode, facilityId: u.facilityId, facilityName: u.facilityName,
      status: 'Available' as const, price: u.monthlyPrice, typeName: splitTypeName(u.unitTypeName).name, floor: `Tầng ${u.floorNumber}${u.zoneArea ? ` · ${u.zoneArea}` : ''}` })),
  ].sort((a, b) => a.facilityName.localeCompare(b.facilityName) || a.unitCode.localeCompare(b.unitCode)), [contracts, free])

  const term = search.trim().toLowerCase()
  const shown = tiles.filter((t) => (!facilityId || t.facilityId === Number(facilityId)) && (!status || t.status === status)
    && (!term || t.unitCode.toLowerCase().includes(term) || t.contract?.customerName.toLowerCase().includes(term) || t.contract?.contractNumber.toLowerCase().includes(term)))
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageTiles = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const loading = !contracts || !free
  const filter = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPage(1) }

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Quản Lý Kho Lưu Trữ</h1>
        <p className="muted">Theo dõi kho trống, kho đang cho thuê và hợp đồng của từng kho ở mọi cơ sở.</p>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={search} onChange={filter(setSearch)} placeholder="Tìm mã kho, khách hàng, số hợp đồng…" />
          </span>
          <Select value={facilityId} onChange={filter(setFacilityId)} aria-label="Cơ sở">
            <option value="">Cơ sở: Tất cả</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </Select>
          <Select value={status} onChange={filter(setStatus)} aria-label="Trạng thái">
            <option value="">Trạng thái: Tất cả</option>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
        </div>
        <div className="segmented view-toggle" role="group" aria-label="Kiểu hiển thị">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Dạng thẻ"><Icon name="grid" size={16} /></button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="Dạng bảng"><Icon name="menu" size={16} /></button>
        </div>
      </div>

      {loading && <p className="muted">Đang tải danh sách kho…</p>}
      {!loading && shown.length === 0 && <section className="panel"><Empty icon="package">Không có kho nào khớp bộ lọc.</Empty></section>}

      {view === 'grid' ? (
        <div className="unit-tiles">
          {pageTiles.map((t) => <UnitTile key={t.key} tile={t} />)}
        </div>
      ) : pageTiles.length > 0 && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Mã kho</th><th>Cơ sở</th><th>Khách thuê / loại kho</th><th>Ngày hết hạn</th><th className="right">Đơn giá tháng</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {pageTiles.map((t) => (
                  <tr key={t.key}>
                    <td><b>{t.unitCode}</b></td>
                    <td>{t.facilityName}</td>
                    <td>{t.contract ? <Link className="link" to={`/admin/contracts?search=${encodeURIComponent(t.contract.contractNumber)}`}>{t.contract.customerName}</Link> : <span className="muted">{t.typeName} · {t.floor}</span>}</td>
                    <td>{t.contract ? fmtDate(t.contract.endDate) : '—'}</td>
                    <td className="right money">{fmtMoney(t.price)}</td>
                    <td><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></td>
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

      {report && (
        <div className="panel summary-strip">
          <span><i className="info" />Tổng số kho: <b>{report.totalUnits}</b></span>
          <span><i className="info dark" />Đang thuê: <b>{report.rentedUnits + report.overdueLockedUnits}</b></span>
          <span><i className="ok" />Trống: <b>{report.availableUnits}</b></span>
          <span><i className="warn" />Bảo trì: <b>{report.maintenanceUnits}</b></span>
        </div>
      )}
      <p className="muted small-note">Kho đang bảo trì hoặc đã giữ chỗ chỉ hiện số lượng ở trên; quản lý từng kho đó ở mục Kho từng cơ sở.</p>
    </div>
  )
}

function UnitTile({ tile: t }: { tile: Tile }) {
  const s = STATUS[t.status]
  const c = t.contract
  const days = c ? daysUntil(c.endDate) : 0
  return (
    <article className="unit-tile">
      <div className="row between">
        <h3><span className="stat-icon info"><Icon name="package" size={15} /></span>{t.unitCode}</h3>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <dl>
        <div><dt>Cơ sở</dt><dd>{t.facilityName}</dd></div>
        {c ? (
          <>
            <div><dt>Khách thuê</dt><dd>{c.customerName}</dd></div>
            <div><dt>Ngày hết hạn</dt><dd className={days <= 30 ? 'danger-text' : ''}>{fmtDate(c.endDate)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Loại không gian</dt><dd>{t.typeName}</dd></div>
            <p className="muted">{t.floor} · sẵn sàng bàn giao khách hàng mới</p>
          </>
        )}
      </dl>
      <div className="row between unit-tile-foot">
        <div><small>ĐƠN GIÁ THÁNG</small><b>{fmtMoney(t.price)}</b></div>
        {c && <Link className="btn outline sm" to={`/admin/contracts?search=${encodeURIComponent(c.contractNumber)}`}>Hợp đồng</Link>}
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
