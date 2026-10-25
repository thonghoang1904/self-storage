import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { AdminContract, Facility, ReturnUnitResult, StorageUnit } from '../types'

/**
 * System administrator: contracts across all facilities (AdminContractsController).
 * Search and filter (GET /api/admin/contracts), open one (GET .../{id}), change the end date or terms of an
 * active contract (PUT .../{id}), hand a unit back (POST /api/admin/contracts/{id}/return) and create a contract
 * from a paid reservation (POST /api/admin/contracts/from-reservations/{id}/check-in).
 * Start date, rent and payments are never edited directly; the API refuses and its message is shown.
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
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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

  const done = async (msg: string) => { setNotice(msg); setError(''); await load() }
  const submitSearch = (e: FormEvent) => { e.preventDefault(); setPage(1); setQuery(search.trim()) }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Hợp Đồng Toàn Hệ Thống</h1>
          <p className="muted">Tra cứu hợp đồng mọi cơ sở, sửa ngày kết thúc hoặc điều khoản, trả kho và lập hợp đồng từ đơn đã cọc.</p>
        </div>
        <button className="btn primary" onClick={() => { setCreating(!creating); setNotice('') }}><Icon name="plus" size={16} /> Lập hợp đồng từ đơn đặt kho</button>
      </div>

      {creating && <CreateFromReservation facilities={facilities} onCancel={() => setCreating(false)} onDone={async (m) => { setCreating(false); await done(m) }} />}

      <form className="panel filter-bar" onSubmit={submitSearch}>
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input id="contract-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Số hợp đồng, tên hoặc email khách, mã kho…" />
          </span>
          <select id="contract-facility" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setPage(1) }}>
            <option value="">Tất cả cơ sở</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </select>
          <select id="contract-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
        <button className="btn outline" type="submit">Tìm</button>
      </form>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
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

      {openId && <ContractPanel key={openId} contractId={openId} onClose={() => setOpenId(null)} onDone={done} />}
    </div>
  )
}

function ContractPanel({ contractId, onClose, onDone }: { contractId: number; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const [c, setC] = useState<AdminContract | null>(null)
  const [endDate, setEndDate] = useState('')
  const [terms, setTerms] = useState('')
  const [returning, setReturning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<AdminContract>(`/api/admin/contracts/${contractId}`).then((x) => {
      setC(x)
      setEndDate(x.endDate)
      setTerms(x.termsConditions ?? '')
    }).catch((e) => setError((e as Error).message))
  }, [contractId])

  if (!c) return <section className="panel">{error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}</section>

  const editable = c.status === 'Active'
  const changed = endDate !== c.endDate || terms.trim() !== (c.termsConditions ?? '')

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const x = await api<AdminContract>(`/api/admin/contracts/${c.contractId}`, { method: 'PUT', body: { endDate, termsConditions: terms.trim() || null } })
      setC(x)
      await onDone(`Đã cập nhật hợp đồng ${x.contractNumber}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

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

      <form className="stack" onSubmit={save}>
        <h3 className="panel-title">Chỉnh sửa hợp đồng</h3>
        {!editable && <p className="muted">Chỉ sửa được hợp đồng đang hiệu lực; hợp đồng quá hạn xử lý theo luồng quá hạn.</p>}
        <div className="form-grid">
          <label className="field"><span>Ngày kết thúc</span>
            <input id="admin-end-date" type="date" value={endDate} min={c.startDate} disabled={!editable} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
          <div className="field"><span>Không sửa trực tiếp</span><p className="muted">Ngày bắt đầu, giá thuê và thanh toán chỉ thay đổi qua gia hạn, hóa đơn.</p></div>
        </div>
        <label className="field"><span>Điều khoản riêng của hợp đồng</span>
          <textarea id="admin-terms" rows={4} maxLength={4000} value={terms} disabled={!editable} onChange={(e) => setTerms(e.target.value)} placeholder="Để trống nếu dùng điều khoản chung" />
        </label>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        {editable && <div className="row"><button className="btn primary sm" disabled={busy || !changed}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>}
      </form>

      {(c.status === 'Active' || c.status === 'Overdue') && (
        returning
          ? <ReturnForm contract={c} onCancel={() => setReturning(false)} onDone={async (m) => { setReturning(false); await onDone(m) }} />
          : <div className="row"><button className="btn outline sm" onClick={() => setReturning(true)}><Icon name="door" size={14} /> Trả kho cho hợp đồng này</button></div>
      )}
    </section>
  )
}

function ReturnForm({ contract: c, onCancel, onDone }: { contract: AdminContract; onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const [notes, setNotes] = useState('')
  const [allRemoved, setAllRemoved] = useState(false)
  const [staffNotes, setStaffNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!notes.trim()) { setError('Vui lòng ghi tình trạng kho khi nhận lại'); return }
    setBusy(true)
    setError('')
    try {
      const r = await api<ReturnUnitResult>(`/api/admin/contracts/${c.contractId}/return`, {
        body: { unitConditionNotes: notes.trim(), allItemsRemoved: allRemoved, staffNotes: staffNotes.trim() || null },
      })
      await onDone(`Đã trả kho ${c.unitCode} (${c.contractNumber}). Cọc cần hoàn ${fmtMoney(r.depositRefundDue)}${r.lateFeesStillOwed > 0 ? `, khách còn nợ ${fmtMoney(r.lateFeesStillOwed)}` : ''}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="charge-form" onSubmit={submit}>
      <b>Trả kho {c.unitCode} · {c.contractNumber}</b>
      <label className="field"><span>Tình trạng kho khi nhận lại</span>
        <textarea id="return-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="vd: kho sạch, không hư hỏng" required />
      </label>
      <label className="check-row"><input id="return-all-removed" type="checkbox" checked={allRemoved} onChange={(e) => setAllRemoved(e.target.checked)} /><span>Khách đã dọn hết đồ ra khỏi kho</span></label>
      <label className="field"><span>Ghi chú nội bộ</span><input id="return-staff-notes" maxLength={500} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} /></label>
      <small className="muted">Chỉ trả kho được từ 20:00 ngày hết hạn và khi đã dọn hết đồ; phí quá hạn trừ vào cọc, phần vượt lập hóa đơn.</small>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Hủy</button>
        <button className="btn primary sm" disabled={busy}>{busy ? 'Đang xử lý…' : 'Xác nhận trả kho'}</button>
      </div>
    </form>
  )
}

function CreateFromReservation({ facilities, onCancel, onDone }: { facilities: Facility[]; onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const [reservationId, setReservationId] = useState('')
  const [facilityId, setFacilityId] = useState('')
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [unitId, setUnitId] = useState('')
  const [notes, setNotes] = useState('Tình trạng kho bình thường khi bàn giao')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setUnits([])
    setUnitId('')
    if (!facilityId) return
    api<StorageUnit[]>(`/api/facilities/${facilityId}/units?status=Available`).then(setUnits).catch(() => {})
  }, [facilityId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ contractNumber: string }>(`/api/admin/contracts/from-reservations/${Number(reservationId)}/check-in`, {
        body: { unitId: Number(unitId), unitConditionNotes: notes.trim() },
      })
      await onDone(`Đã lập hợp đồng ${r.contractNumber}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Lập hợp đồng từ đơn đặt kho</h2>
          <p className="muted">Đơn phải đã thanh toán đủ cọc, khách đã đặt lịch nhận kho và đã đến giờ hẹn. Chọn kho trống đúng loại khách đã đặt.</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Đóng" onClick={onCancel}><Icon name="x" /></button>
      </div>
      <div className="form-grid four">
        <label className="field"><span>Mã đơn đặt kho (ID)</span><input id="ci-reservation" inputMode="numeric" value={reservationId} onChange={(e) => setReservationId(e.target.value.replace(/\D/g, ''))} required /></label>
        <label className="field"><span>Cơ sở</span>
          <select id="ci-facility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required>
            <option value="">Chọn cơ sở</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </select>
        </label>
        <label className="field"><span>Kho trống</span>
          <select id="ci-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} required disabled={!units.length}>
            <option value="">{facilityId ? (units.length ? 'Chọn kho' : 'Không có kho trống') : 'Chọn cơ sở trước'}</option>
            {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitCode} · {u.unitTypeName}</option>)}
          </select>
        </label>
        <label className="field"><span>Tình trạng khi bàn giao</span><input id="ci-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} required /></label>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onCancel}>Hủy</button>
        <button className="btn primary" disabled={busy || !reservationId || !unitId}>{busy ? 'Đang lập…' : 'Bàn giao & lập hợp đồng'}</button>
      </div>
    </form>
  )
}
