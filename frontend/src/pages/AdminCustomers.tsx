import { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { daysUntil, fetchContracts } from '../consoleData'
import { Badge, Empty, Icon, StatusBadge } from '../components/ui'
import { Modal } from '../components/Modal'
import { Roles, type AdminContract, type AdminUser, type Facility, type RoleInfo } from '../types'
import { StatChip, scrollToList } from '../components/StatCard'
import { Pager } from './AdminStorage'
import { Select } from '../components/Select'

/**
 * System administrator "Khách Hàng" (Figma "customer-contract-management"): every customer account
 * (GET /api/admin/users?roleId=<customer>) with the contracts they hold (GET /api/admin/contracts),
 * so the administrator sees who rents what, until when, and who needs a call (overdue or ending soon).
 */

type Standing = 'overdue' | 'soon' | 'renting' | 'none'
const STANDING: Record<Standing, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  overdue: { label: 'Quá hạn', tone: 'bad' },
  soon: { label: 'Sắp hết hạn', tone: 'warn' },
  renting: { label: 'Đang thuê', tone: 'ok' },
  none: { label: 'Chưa thuê kho', tone: 'muted' },
}
const PAGE_SIZE = 10

interface Row { user: AdminUser; contracts: AdminContract[]; next?: AdminContract; standing: Standing }

export default function AdminCustomers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [contracts, setContracts] = useState<AdminContract[] | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [search, setSearch] = useState('')
  const [standing, setStanding] = useState('')
  const [facilityId, setFacilityId] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  // The customer whose contracts are shown in a dialog over the list.
  const [viewing, setViewing] = useState<AdminUser | null>(null)

  useEffect(() => {
    const fail = (e: unknown) => setError((e as Error).message)
    api<RoleInfo[]>('/api/admin/roles').then(async (roles) => {
      const roleId = roles.find((r) => r.roleName === Roles.Customer)?.roleId
      const list: AdminUser[] = []
      for (let page = 1; page <= 20; page++) {
        const rows = await api<AdminUser[]>(`/api/admin/users?page=${page}&pageSize=200${roleId ? `&roleId=${roleId}` : ''}`)
        list.push(...rows)
        if (rows.length < 200) break
      }
      setUsers(list.filter((u) => u.roleName === Roles.Customer))
    }).catch(fail)
    Promise.all([fetchContracts('Active'), fetchContracts('Overdue')]).then(([a, o]) => setContracts([...a, ...o])).catch(fail)
    api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {})
  }, [])

  const rows = useMemo<Row[]>(() => (users ?? []).map((user) => {
    const own = (contracts ?? []).filter((c) => c.customerId === user.userId).sort((a, b) => a.endDate.localeCompare(b.endDate))
    const next = own.find((c) => c.status === 'Overdue') ?? own[0]
    const standing: Standing = !next ? 'none' : next.status === 'Overdue' ? 'overdue' : daysUntil(next.endDate) <= 30 ? 'soon' : 'renting'
    return { user, contracts: own, next, standing }
  }), [users, contracts])

  const term = search.trim().toLowerCase()
  // Besides the four standings, the cards filter on: active accounts, customers renting anything, and the ones needing action.
  const matches = (r: Row) => !standing ? true : standing === 'active' ? r.user.status === 'Active'
    : standing === 'any' ? r.contracts.length > 0 : standing === 'attention' ? r.standing === 'overdue' || r.standing === 'soon' : r.standing === standing
  const shown = rows.filter((r) => matches(r)
    && (!facilityId || r.contracts.some((c) => c.facilityId === Number(facilityId)))
    && (!term || [r.user.fullName, r.user.email, r.user.phoneNumber, r.user.username, ...r.contracts.map((c) => c.contractNumber)]
      .some((v) => v.toLowerCase().includes(term))))
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const filter = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPage(1) }

  const active = rows.filter((r) => r.user.status === 'Active').length
  const renting = rows.filter((r) => r.contracts.length > 0).length
  const liveContracts = contracts?.length ?? 0
  const overdue = rows.filter((r) => r.standing === 'overdue').length
  const soon = rows.filter((r) => r.standing === 'soon').length
  const loading = !users || !contracts
  const pick = (k: string) => { setStanding(standing === k ? '' : k); setSearch(''); setPage(1); scrollToList('customer-list') }

  return (
    <div className="stack-xl">
      <div className="page-top">
        <div>
          <h1>Quản Lý Khách Hàng</h1>
          <p className="muted">Theo dõi hồ sơ khách hàng và kho đang thuê của từng người.</p>
        </div>
        {/* Each counter filters the customer list; clicking the active one again shows everyone. */}
        <div className="stat-chips">
          <StatChip icon="users" tone="info" label="đang hoạt động" value={active} extra={`${rows.length} tài khoản`} active={standing === 'active'} onClick={() => pick('active')} />
          <StatChip icon="package" tone="ok" label="đang thuê kho" value={renting} extra={`${liveContracts} hợp đồng`} active={standing === 'any'} onClick={() => pick('any')} />
          <StatChip icon="alert" tone={overdue + soon ? 'bad' : 'ok'} label="cần xử lý" value={overdue + soon} extra={`${overdue} quá hạn · ${soon} sắp hết`} active={standing === 'attention'} onClick={() => pick('attention')} />
        </div>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {viewing && <CustomerContracts customer={viewing} onClose={() => setViewing(null)} />}


      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={search} onChange={filter(setSearch)} placeholder="Tìm tên, email, SĐT, số hợp đồng…" />
          </span>
          <Select value={standing} onChange={filter(setStanding)} aria-label="Tình trạng">
            <option value="">Tình trạng: Tất cả</option>
            <option value="active">Tài khoản đang hoạt động</option>
            <option value="any">Đang có hợp đồng</option>
            <option value="attention">Cần xử lý</option>
            {Object.entries(STANDING).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
          <Select value={facilityId} onChange={filter(setFacilityId)} aria-label="Cơ sở">
            <option value="">Cơ sở: Tất cả</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </Select>
        </div>
        <button className="btn outline" onClick={() => { setSearch(''); setStanding(''); setFacilityId(''); setPage(1) }}>Đặt lại bộ lọc</button>
      </div>

      <section className="panel" id="customer-list">
        <div>
          <h2 className="panel-title">Danh sách khách hàng</h2>
          <p className="muted">Mỗi khách hiện hợp đồng cần chú ý nhất: quá hạn trước, rồi hợp đồng hết hạn sớm nhất.</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Khách hàng</th><th>Liên hệ</th><th>Hợp đồng</th><th>Kho đang thuê</th><th>Hết hạn</th><th>Tình trạng</th><th>Hành động</th></tr></thead>
            <tbody>
              {shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(({ user: u, contracts: own, next, standing: st }) => (
                <tr key={u.userId}>
                  <td><b>{u.fullName}</b><br /><small className="cyan">KH-{u.userId} · {u.username}</small>{u.status !== 'Active' && <> <Badge tone="muted">{u.status === 'Suspended' ? 'Bị khóa' : 'Ngưng'}</Badge></>}</td>
                  <td>{u.email}<br /><small className="muted">{u.phoneNumber}</small></td>
                  <td>{next ? <><b>{next.contractNumber}</b>{own.length > 1 && <small className="muted"> +{own.length - 1}</small>}</> : '—'}</td>
                  <td>{next ? <>{next.unitCode} <small className="muted">· {next.facilityName}</small></> : '—'}</td>
                  <td>{next ? fmtDate(next.endDate) : '—'}</td>
                  <td><Badge tone={STANDING[st].tone}>{st === 'soon' && next ? `Còn ${Math.max(0, daysUntil(next.endDate))} ngày` : STANDING[st].label}</Badge></td>
                  <td>{own.length > 0
                    ? <button type="button" className="link-btn link nowrap" onClick={() => setViewing(u)}>Xem hợp đồng</button>
                    : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="muted">Đang tải…</p>}
          {!loading && shown.length === 0 && <Empty icon="users">Không có khách hàng nào khớp bộ lọc.</Empty>}
        </div>
        {shown.length > 0 && (
          <div className="row between wrap">
            <small className="muted">Hiển thị {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, shown.length)} trong số <b>{shown.length}</b> khách hàng</small>
            <Pager page={current} pages={pages} onPage={setPage} />
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Every contract of one customer (GET /api/admin/contracts?customerId=, all statuses, newest first) in a dialog:
 * customer contact, then one card per contract with unit, period, rent, deposit and how long is left.
 */
function CustomerContracts({ customer: u, onClose }: { customer: AdminUser; onClose: () => void }) {
  const [rows, setRows] = useState<AdminContract[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<AdminContract[]>(`/api/admin/contracts?customerId=${u.userId}&pageSize=100`).then(setRows).catch((e) => setError((e as Error).message))
  }, [u.userId])
  const live = (rows ?? []).filter((c) => c.status === 'Active' || c.status === 'Overdue' || c.status === 'Renewed')
  return (
    <Modal title={`Hợp đồng của ${u.fullName}`} onClose={onClose} wide>
      <div className="info-box">
        <div className="info-row"><span className="muted">Mã khách</span><b>KH-{u.userId} · {u.username}</b></div>
        <div className="info-row"><span className="muted">Email</span><b>{u.email}</b></div>
        <div className="info-row"><span className="muted">Số điện thoại</span><b>{u.phoneNumber}</b></div>
        {rows && <div className="info-row"><span className="muted">Hợp đồng</span><b>{live.length} đang hiệu lực · {rows.length} tất cả</b></div>}
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {!rows && !error && <p className="muted">Đang tải…</p>}
      {rows?.length === 0 && <Empty icon="file">Khách chưa có hợp đồng nào.</Empty>}
      <div className="stack-sm">
        {rows?.map((c) => {
          const left = daysUntil(c.endDate)
          const ended = c.status === 'Terminated' || c.status === 'Liquidated'
          return (
            <div key={c.contractId} className="contract-row">
              <div className="row between wrap">
                <b className="code">{c.contractNumber}</b>
                <span className="row">
                  {!ended && <small className={left < 0 ? 'danger-text' : left <= 30 ? 'warn-text' : 'muted'}>{left < 0 ? `Quá hạn ${-left} ngày` : `Còn ${left} ngày`}</small>}
                  <StatusBadge status={c.status} />
                </span>
              </div>
              <div className="contract-row-grid">
                <span><small className="muted">Kho</small><b>{c.unitCode} · {c.facilityName}</b></span>
                <span><small className="muted">Thời hạn</small><b>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</b></span>
                <span><small className="muted">Giá thuê</small><b>{fmtMoney(c.monthlyRentFee)}/tháng</b></span>
                <span><small className="muted">Tiền cọc</small><b>{fmtMoney(c.depositPaid)}</b></span>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
