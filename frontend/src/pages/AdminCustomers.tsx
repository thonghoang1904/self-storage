import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtMoney } from '../api'
import { Empty, Icon, StatusBadge } from '../components/ui'
import { Roles, type AdminContract, type AdminUser } from '../types'

/**
 * System administrator: customer accounts (GET /api/admin/users, role Storage Customer), each with their contracts
 * (GET /api/admin/contracts?customerId=). Lock / unlock an account with PUT /api/admin/users/{id}/status.
 */
const mask = (s: string | null) => (s ? `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : '—')

export default function AdminCustomers() {
  const [rows, setRows] = useState<AdminUser[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [openId, setOpenId] = useState<number | null>(null)
  const [contracts, setContracts] = useState<Record<number, AdminContract[]>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(() => api<AdminUser[]>('/api/admin/users')
    .then((u) => setRows(u.filter((x) => x.roleName === Roles.Customer)))
    .catch((e) => setMsg({ tone: 'bad', text: (e as Error).message })), [])
  useEffect(() => { void load() }, [load])

  const toggle = (u: AdminUser) => {
    const next = openId === u.userId ? null : u.userId
    setOpenId(next)
    if (next && !contracts[u.userId]) {
      api<AdminContract[]>(`/api/admin/contracts?customerId=${u.userId}&pageSize=100`)
        .then((cs) => setContracts((m) => ({ ...m, [u.userId]: cs }))).catch(() => setContracts((m) => ({ ...m, [u.userId]: [] })))
    }
  }

  const setAccount = async (u: AdminUser, next: 'Active' | 'Inactive') => {
    if (next === 'Inactive' && !window.confirm(`Khóa tài khoản ${u.fullName}? Khách sẽ không đăng nhập được cho đến khi mở lại.`)) return
    setBusy(u.userId)
    setMsg(null)
    try {
      await api(`/api/admin/users/${u.userId}/status`, { method: 'PUT', body: { status: next } })
      setMsg({ tone: 'ok', text: `${next === 'Active' ? 'Đã mở khóa' : 'Đã khóa'} tài khoản ${u.username}.` })
      await load()
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return rows.filter((u) => (status === 'all' || u.status === status)
      && (!k || `${u.fullName} ${u.username} ${u.email} ${u.phoneNumber} ${u.citizenId ?? ''}`.toLowerCase().includes(k)))
  }, [rows, q, status])

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Khách Hàng</h1>
        <p className="muted">Tài khoản khách thuê kho và hợp đồng của từng người. Sửa hồ sơ khách ở mục Nhân Viên (lọc vai trò Khách hàng).</p>
      </div>

      <div className="stat-grid three">
        <div className="stat-card"><span className="muted">Tổng khách hàng</span><b className="stat-value">{rows.length}</b><small className="stat-note info">tài khoản đã đăng ký</small></div>
        <div className="stat-card"><span className="muted">Đang hoạt động</span><b className="stat-value">{rows.filter((u) => u.status === 'Active').length}</b><small className="stat-note ok">đăng nhập được</small></div>
        <div className="stat-card"><span className="muted">Bị khóa</span><b className="stat-value">{rows.filter((u) => u.status !== 'Active').length}</b><small className="stat-note warn">không đăng nhập được</small></div>
      </div>

      <div className="panel filter-bar">
        <div className="segmented" role="tablist">
          {[['all', 'Tất cả'], ['Active', 'Hoạt động'], ['Inactive', 'Đã khóa']].map(([v, l]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, tài khoản, email, SĐT, CCCD…" aria-label="Tìm khách hàng" />
      </div>
      {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}

      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Khách hàng</th><th>Liên hệ</th><th>CCCD</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {shown.map((u) => (
                <Fragment key={u.userId}>
                  <tr>
                    <td><button type="button" className="link-btn" aria-expanded={openId === u.userId} onClick={() => toggle(u)}><b>{u.fullName}</b></button><br /><small className="muted">{u.username} · ID {u.userId}</small></td>
                    <td>{u.email}<br /><small className="muted">{u.phoneNumber}</small></td>
                    <td className="code">{mask(u.citizenId)}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="right">
                      <div className="row end">
                        <button type="button" className="btn ghost sm" onClick={() => toggle(u)}>{openId === u.userId ? 'Ẩn hợp đồng' : 'Xem hợp đồng'}</button>
                        {u.status === 'Active'
                          ? <button type="button" className="btn ghost sm danger-text" disabled={busy !== null} onClick={() => void setAccount(u, 'Inactive')}>Khóa</button>
                          : <button type="button" className="btn outline sm" disabled={busy !== null} onClick={() => void setAccount(u, 'Active')}>Mở khóa</button>}
                      </div>
                    </td>
                  </tr>
                  {openId === u.userId && (
                    <tr className="sub-row"><td colSpan={5}>
                      {!contracts[u.userId] ? <p className="muted">Đang tải hợp đồng…</p>
                        : contracts[u.userId].length === 0 ? <p className="muted">Khách chưa có hợp đồng nào.</p>
                        : (
                          <div className="stack-sm">
                            {contracts[u.userId].map((c) => (
                              <div key={c.contractId} className="info-row">
                                <span><b>{c.contractNumber}</b> <small className="muted">· kho {c.unitCode} · {c.facilityName} · {fmtDate(c.startDate)} – {fmtDate(c.endDate)} · {fmtMoney(c.monthlyRentFee)}/tháng</small></span>
                                <StatusBadge status={c.status} />
                              </div>
                            ))}
                            <Link to="/admin/contracts" className="link fine">Quản lý hợp đồng →</Link>
                          </div>
                        )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <Empty icon="users">Không có khách hàng nào khớp bộ lọc.</Empty>}
        </div>
      </section>
    </div>
  )
}
