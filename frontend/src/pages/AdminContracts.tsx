import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { AdminContract, Facility } from '../types'
import { Select } from '../components/Select'

/**
 * System administrator: contracts across all facilities, view only (AdminContractsController).
 * Search and filter (GET /api/admin/contracts) and open one (GET .../{id}). Hand-overs, returns and every change go
 * through the facility staff screens, renewals and invoices.
 */

const STATUSES = [
  { v: '', label: 'Tất cả trạng thái' },
  { v: 'Active', label: 'Đang hiệu lực' },
  { v: 'Overdue', label: 'Quá hạn' },
  { v: 'Renewed', label: 'Đã gia hạn' },
  { v: 'Terminated', label: 'Đã chấm dứt' },
  { v: 'Liquidated', label: 'Đã thanh lý' },
]
const PAGE_SIZE = 20

export default function AdminContracts() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState('')
  const [status, setStatus] = useState('')
  // Other admin screens link here with ?search=<contract number or email> to open on that customer.
  const [params] = useSearchParams()
  const [search, setSearch] = useState(() => params.get('search') ?? '')
  const [query, setQuery] = useState(() => params.get('search') ?? '')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminContract[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (facilityId) p.set('facilityId', facilityId)
    if (status) p.set('status', status)
    if (query) p.set('search', query)
    try {
      setRows(await api<AdminContract[]>(`/api/admin/contracts?${p}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [facilityId, status, query, page])
  useEffect(() => { void load() }, [load])

  const submitSearch = (e: FormEvent) => { e.preventDefault(); setPage(1); setQuery(search.trim()) }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Hợp Đồng Toàn Hệ Thống</h1>
          <p className="muted">Tra cứu và xem hợp đồng của mọi cơ sở (chỉ xem).</p>
        </div>
      </div>

      <form className="panel filter-bar" onSubmit={submitSearch}>
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input id="contract-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Số hợp đồng, tên hoặc email khách, mã kho…" />
          </span>
          <Select id="contract-facility" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setPage(1) }}>
            <option value="">Tất cả cơ sở</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </Select>
          <Select id="contract-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </Select>
        </div>
        <button className="btn outline" type="submit">Tìm</button>
      </form>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Số hợp đồng</th><th>Khách hàng</th><th>Cơ sở · kho</th><th>Thời hạn</th><th className="right">Giá thuê</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.contractId} className={openId === c.contractId ? 'selected' : ''}>
                  <td className="code">{c.contractNumber}</td>
                  <td><b>{c.customerName}</b><br /><small className="muted">{c.customerEmail} · {c.customerPhoneNumber}</small></td>
                  <td>{c.facilityName}<br /><small className="muted">Kho {c.unitCode}</small></td>
                  <td>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                  <td className="right money">{fmtMoney(c.monthlyRentFee)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="right"><button className="btn ghost sm" onClick={() => setOpenId(openId === c.contractId ? null : c.contractId)}>{openId === c.contractId ? 'Đóng' : 'Chi tiết'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <Empty icon="file">Không có hợp đồng nào khớp bộ lọc.</Empty>}
        </div>
        <div className="row between wrap">
          <small className="muted">Trang {page} · {rows.length} hợp đồng</small>
          <div className="pager">
            <button className="icon-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Trang trước"><Icon name="arrowRight" size={14} className="flip" /></button>
            <button className="active">{page}</button>
            <button className="icon-btn" disabled={rows.length < PAGE_SIZE} onClick={() => setPage(page + 1)} aria-label="Trang sau"><Icon name="arrowRight" size={14} /></button>
          </div>
        </div>
      </section>

      {openId && <div id="contract-panel" className="scroll-target"><ContractPanel key={openId} contractId={openId} onClose={() => setOpenId(null)} /></div>}
    </div>
  )
}

function ContractPanel({ contractId, onClose }: { contractId: number; onClose: () => void }) {
  const [c, setC] = useState<AdminContract | null>(null)
  const [error, setError] = useState('')

  // Contracts are read-only here: dates and prices only change through renewals and invoices.
  useEffect(() => {
    api<AdminContract>(`/api/admin/contracts/${contractId}`).then((x) => {
      setC(x)
    }).catch((e) => setError((e as Error).message))
  }, [contractId])
  // The contract opens under the table: bring it into view (again once loaded) so "Chi tiết" visibly opens it.
  const loaded = c !== null
  useEffect(() => {
    document.getElementById('contract-panel')?.scrollIntoView({ block: 'start' })
  }, [contractId, loaded])

  if (!c) return <section className="panel">{error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}</section>

  return (
    <section className="panel admin-contract">
      <div className="panel-head wrap">
        <div>
          <h2 className="panel-title">{c.contractNumber} <StatusBadge status={c.status} /></h2>
          <p className="muted">Ký ngày {fmtTime(c.signedDate)}</p>
        </div>
        <button className="icon-btn" aria-label="Đóng" onClick={onClose}><Icon name="x" /></button>
      </div>
      <dl className="kv-grid">
        <div><dt>Khách hàng</dt><dd>{c.customerName}</dd></div>
        <div><dt>Liên hệ</dt><dd>{c.customerEmail} · {c.customerPhoneNumber}</dd></div>
        <div><dt>Cơ sở · kho</dt><dd>{c.facilityName} · {c.unitCode}</dd></div>
        <div><dt>Thời hạn</dt><dd>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</dd></div>
        <div><dt>Giá thuê</dt><dd>{fmtMoney(c.monthlyRentFee)}/tháng</dd></div>
        <div><dt>Tiền cọc</dt><dd>{fmtMoney(c.depositPaid)}</dd></div>
      </dl>

      {c.termsConditions && (
        <div className="stack-sm">
          <h3 className="panel-title">Điều khoản riêng của hợp đồng</h3>
          <p className="support-desc">{c.termsConditions}</p>
        </div>
      )}
    </section>
  )
}
