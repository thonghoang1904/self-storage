import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { daysUntil, fetchContracts } from '../consoleData'
import { Badge, Empty, Icon } from '../components/ui'
import { Roles, type AdminContract, type AdminUser, type Facility, type RoleInfo } from '../types'
import { Metric } from './FacilityOverview'
import { Pager } from './AdminStorage'

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
  const shown = rows.filter((r) => (!standing || r.standing === standing)
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

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Quản Lý Khách Hàng & Hợp Đồng</h1>
        <p className="muted">Theo dõi hồ sơ khách hàng, kho đang thuê và hạn hợp đồng của từng người.</p>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid">
        <Metric icon="users" tone="info" label="Khách hàng đang hoạt động" value={String(active)} note={`${rows.length} tài khoản khách hàng`} />
        <Metric icon="file" tone="ok" label="Hợp đồng hiệu lực" value={String(liveContracts)} note={renting ? `${(liveContracts / renting).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} hợp đồng / khách đang thuê` : 'chưa có khách đang thuê'} />
        <Metric icon="package" tone="info" label="Khách đang thuê kho" value={String(renting)} note={`${rows.length - renting} khách chưa thuê kho`} />
        <Metric icon="alert" tone={overdue + soon ? 'bad' : 'ok'} label="Cần xử lý" value={String(overdue + soon)} note={`${overdue} quá hạn • ${soon} sắp hết hạn`} />
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={search} onChange={filter(setSearch)} placeholder="Tìm tên, email, SĐT, số hợp đồng…" />
          </span>
          <select value={standing} onChange={filter(setStanding)} aria-label="Tình trạng">
            <option value="">Tình trạng: Tất cả</option>
            {Object.entries(STANDING).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <select value={facilityId} onChange={filter(setFacilityId)} aria-label="Cơ sở">
            <option value="">Cơ sở: Tất cả</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </select>
        </div>
        <button className="btn outline" onClick={() => { setSearch(''); setStanding(''); setFacilityId(''); setPage(1) }}>Đặt lại bộ lọc</button>
      </div>

      <section className="panel">
        <div>
          <h2 className="panel-title">Danh sách khách hàng & hợp đồng</h2>
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
                    ? <Link className="link nowrap" to={`/admin/contracts?search=${encodeURIComponent(own.length > 1 ? u.email : next!.contractNumber)}`}>Xem hợp đồng</Link>
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
