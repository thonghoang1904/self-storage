import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { checkCitizenId, checkEmail, checkPassword, checkPhone, checkText, checkUsername, digitsOnly, firstError } from '../validation'
import { api, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Badge, Empty, Icon } from '../components/ui'
import { roleLabel, Roles, type ActivityLog, type AdminUser, type Facility, type RoleInfo } from '../types'

/**
 * #45 System Admin, Figma "staff-management": the system's staff accounts (GET /api/admin/users), adding
 * one with its facilities (POST /api/admin/users), changing role (PUT .../role) or status (PUT .../status)
 * edits name, email, phone and CCCD (PUT .../profile) and shows its activity log (GET .../activity). The API has no delete and no department/position fields, so the
 * red action deactivates the account and the Figma "Phòng Ban / Chức Vụ" columns show role and phone.
 * The API refuses changing your own role/status and leaving no active administrator; its message is shown.
 */

// Figma: "Đang Làm" green, "Nghỉ Phép" amber, "Đã Nghỉ" red.
const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  Active: { label: 'Đang Làm', tone: 'ok' },
  Suspended: { label: 'Tạm Khóa', tone: 'warn' },
  Inactive: { label: 'Đã Nghỉ', tone: 'bad' },
}
const statusOfAccount = (s: string) => STATUS[s] ?? { label: s, tone: 'warn' as const }

/** Only facility staff and facility managers are assigned to facilities. */
const FACILITY_ROLES: string[] = [Roles.Staff, Roles.Manager]
const isStaffAccount = (u: AdminUser) => u.roleName !== Roles.Customer
const PAGE_SIZE = 6

const initials = (name: string) => name.split(' ').filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase()

export default function AdminUsers() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('staff')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      // The API pages at most 200 accounts per call; filters below run on this list.
      const [u, r, f] = await Promise.all([
        api<AdminUser[]>('/api/admin/users?pageSize=200'),
        api<RoleInfo[]>('/api/admin/roles'),
        api<Facility[]>('/api/facilities').catch(() => []),
      ])
      setUsers(u)
      setRoles(r)
      setFacilities(f)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => users
    .filter((u) => roleFilter === 'all' || (roleFilter === 'staff' ? isStaffAccount(u) : u.roleId === Number(roleFilter)))
    .filter((u) => status === 'all' || u.status === status)
    .filter((u) => {
      const s = q.trim().toLowerCase()
      if (!s) return true
      return [u.username, u.fullName, u.email, u.phoneNumber, u.citizenId ?? ''].some((v) => v.toLowerCase().includes(s))
    }), [users, roleFilter, status, q])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const from = shown.length ? (current - 1) * PAGE_SIZE + 1 : 0

  const done = async (msg: string) => { setCreating(false); setEditId(null); setError(''); setNotice(msg); await load() }
  const editing = users.find((u) => u.userId === editId)

  const deactivate = async (u: AdminUser) => {
    if (!window.confirm(`Cho nghỉ việc và khóa tài khoản ${u.fullName}? Tài khoản sẽ không đăng nhập được nữa.`)) return
    try {
      await api(`/api/admin/users/${u.userId}/status`, { method: 'PUT', body: { status: 'Inactive' } })
      await done(`Đã khóa tài khoản ${u.username}.`)
    } catch (e) {
      setNotice('')
      setError((e as Error).message)
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Quản Lý Nhân Viên</h1>
          <p className="muted">Quản lý phân quyền, vai trò vận hành và trạng thái hoạt động của nhân sự.</p>
        </div>
        <button className="btn primary" onClick={() => { setNotice(''); setEditId(null); setCreating(true) }}><Icon name="plus" size={16} /> Thêm Nhân Viên</button>
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Tìm theo tên, email..." />
          </span>
          <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1) }} aria-label="Vai trò">
            <option value="staff">Vai Trò: Tất Cả Nhân Sự</option>
            {roles.map((r) => <option key={r.roleId} value={r.roleId}>Vai Trò: {roleLabel(r.roleName)}</option>)}
            <option value="all">Mọi tài khoản (kể cả khách)</option>
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Trạng thái">
            <option value="all">Trạng Thái: Tất Cả</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>Trạng Thái: {v.label}</option>)}
          </select>
        </div>
        <button className="btn ghost" onClick={() => { setQ(''); setRoleFilter('staff'); setStatus('all'); setPage(1) }}>Đặt lại bộ lọc</button>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      {creating && <CreateUserForm roles={roles} facilities={facilities} onCancel={() => setCreating(false)} onDone={done} />}

      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Avatar</th><th>Họ Tên</th><th>Email</th><th>Vai Trò</th><th>Số Điện Thoại</th><th>Trạng Thái</th><th className="right">Hành Động</th></tr></thead>
            <tbody>
              {pageRows.map((u) => {
                const st = statusOfAccount(u.status)
                const isMe = u.userId === me?.userId
                return (
                  <tr key={u.userId}>
                    <td><span className="avatar sm">{initials(u.fullName)}</span></td>
                    <td><b>{u.fullName}</b>{isMe && <small className="muted"> (bạn)</small>}<br /><small className="muted">{u.username}</small></td>
                    <td className="muted">{u.email}</td>
                    <td><b>{roleLabel(u.roleName)}</b></td>
                    <td className="muted">{u.phoneNumber}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="right">
                      <div className="row end">
                        <button className="icon-action" title="Sửa vai trò, trạng thái và xem lịch sử" aria-label={`Sửa ${u.fullName}`}
                          onClick={() => { setNotice(''); setCreating(false); setEditId(editId === u.userId ? null : u.userId) }}><Icon name="edit" size={14} /></button>
                        <button className="icon-action danger" title={isMe ? 'Không thể tự khóa tài khoản của mình' : 'Cho nghỉ việc, khóa tài khoản'} aria-label={`Khóa ${u.fullName}`}
                          disabled={isMe || u.status === 'Inactive'} onClick={() => void deactivate(u)}><Icon name="trash" size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {pageRows.length === 0 && <Empty icon="users">Không có nhân viên nào khớp bộ lọc.</Empty>}
        </div>
        {editing && (
          <EditUserForm key={`${editing.userId}-${editing.roleId}-${editing.status}`} user={editing} roles={roles} isMe={editing.userId === me?.userId} onCancel={() => setEditId(null)} onDone={done} />
        )}
        <div className="row between wrap">
          <small className="muted">Hiển thị <b>{from}-{from + pageRows.length - (pageRows.length ? 1 : 0)}</b> trong số <b>{shown.length}</b> bản ghi</small>
          <div className="pager">
            <button className="pager-text" disabled={current <= 1} onClick={() => setPage(current - 1)}>Trước</button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} className={p === current ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="pager-text" disabled={current >= pages} onClick={() => setPage(current + 1)}>Sau</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function CreateUserForm({ roles, facilities, onCancel, onDone }: { roles: RoleInfo[]; facilities: Facility[]; onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const staffRoles = roles.filter((r) => r.roleName !== Roles.Customer)
  const [f, setF] = useState({ username: '', password: '', fullName: '', email: '', phoneNumber: '', citizenId: '' })
  const [roleId, setRoleId] = useState(() => roles.find((r) => r.roleName === Roles.Staff)?.roleId ?? staffRoles[0]?.roleId ?? 0)
  const [facilityIds, setFacilityIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const roleName = roles.find((r) => r.roleId === roleId)?.roleName ?? ''
  const needsFacility = FACILITY_ROLES.includes(roleName)
  const toggle = (id: number) => setFacilityIds(facilityIds.includes(id) ? facilityIds.filter((x) => x !== id) : [...facilityIds, id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const problem = firstError(
      checkText(f.fullName, 'Họ tên', 100, false, 2),
      checkEmail(f.email),
      checkPhone(f.phoneNumber),
      f.citizenId.trim() ? checkCitizenId(f.citizenId) : '',
      checkUsername(f.username),
      checkPassword(f.password),
    )
    if (problem) { setError(problem); return }
    if (needsFacility && facilityIds.length === 0) { setError('Hãy chọn ít nhất một cơ sở cho nhân viên / quản lý cơ sở.'); return }
    setBusy(true)
    try {
      const created = await api<AdminUser>('/api/admin/users', {
        body: {
          username: f.username.trim(),
          password: f.password,
          fullName: f.fullName.trim(),
          email: f.email.trim(),
          phoneNumber: digitsOnly(f.phoneNumber),
          citizenId: digitsOnly(f.citizenId) || null,
          roleId,
          // The API rejects an empty list; leave it out for roles without facilities.
          facilityIds: needsFacility ? facilityIds : undefined,
        },
      })
      await onDone(`Đã thêm nhân viên ${created.fullName} (${roleLabel(created.roleName)}).`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2 className="panel-title"><Icon name="plus" size={18} className="cyan" /> Thêm Nhân Viên</h2>
      <div className="form-grid">
        <label className="field"><span>Họ tên</span><input value={f.fullName} onChange={set('fullName')} required maxLength={100} /></label>
        <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set('email')} required maxLength={100} /></label>
        <label className="field"><span>Tên đăng nhập</span><input value={f.username} onChange={set('username')} required minLength={3} maxLength={50} autoComplete="off" /></label>
        <label className="field"><span>Mật khẩu ban đầu</span><input type="password" value={f.password} onChange={set('password')} required minLength={8} maxLength={100} autoComplete="new-password" placeholder="Ít nhất 8 ký tự" /></label>
        <label className="field"><span>Số điện thoại</span><input value={f.phoneNumber} onChange={set('phoneNumber')} required maxLength={20} /></label>
        <label className="field"><span>CCCD (không bắt buộc)</span><input value={f.citizenId} onChange={set('citizenId')} maxLength={25} /></label>
        <label className="field"><span>Vai trò</span>
          <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
            {staffRoles.map((r) => <option key={r.roleId} value={r.roleId}>{roleLabel(r.roleName)}</option>)}
          </select>
        </label>
      </div>
      {needsFacility && (
        <div className="field">
          <span>Phân công cơ sở</span>
          <div className="row wrap">
            {facilities.map((fa) => (
              <label key={fa.facilityId} className="check-row"><input type="checkbox" checked={facilityIds.includes(fa.facilityId)} onChange={() => toggle(fa.facilityId)} /> {fa.facilityName}</label>
            ))}
          </div>
        </div>
      )}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang thêm…' : 'Thêm nhân viên'}</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  )
}

function EditUserForm({ user, roles, isMe, onCancel, onDone }: { user: AdminUser; roles: RoleInfo[]; isMe: boolean; onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const [roleId, setRoleId] = useState(user.roleId)
  const [status, setStatus] = useState(user.status)
  const [profile, setProfile] = useState({ fullName: user.fullName, email: user.email, phoneNumber: user.phoneNumber, citizenId: user.citizenId ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const newRoleName = roles.find((r) => r.roleId === roleId)?.roleName ?? ''
  const losesFacilities = FACILITY_ROLES.includes(user.roleName) && !FACILITY_ROLES.includes(newRoleName)
  const profileChanged = profile.fullName.trim() !== user.fullName || profile.email.trim() !== user.email
    || profile.phoneNumber.trim() !== user.phoneNumber || profile.citizenId.trim() !== (user.citizenId ?? '')
  const changed = roleId !== user.roleId || status !== user.status || profileChanged
  const setP = (k: keyof typeof profile) => (e: { target: { value: string } }) => setProfile({ ...profile, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (profileChanged) {
        const problem = firstError(
          checkText(profile.fullName, 'Họ tên', 100, false, 2),
          checkEmail(profile.email),
          checkPhone(profile.phoneNumber),
          profile.citizenId.trim() ? checkCitizenId(profile.citizenId) : '',
        )
        if (problem) throw new Error(problem)
        await api(`/api/admin/users/${user.userId}/profile`, { method: 'PUT', body: {
          fullName: profile.fullName.trim(), email: profile.email.trim(), phoneNumber: digitsOnly(profile.phoneNumber),
          citizenId: digitsOnly(profile.citizenId) || null } })
      }
      if (roleId !== user.roleId) await api(`/api/admin/users/${user.userId}/role`, { method: 'PUT', body: { roleId } })
      if (status !== user.status) await api(`/api/admin/users/${user.userId}/status`, { method: 'PUT', body: { status } })
      await onDone(`Đã cập nhật tài khoản ${user.username}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="add-person">
      <div className="row between">
        <h3 className="panel-title"><Icon name="edit" size={18} className="cyan" /> {user.fullName}</h3>
        <button className="icon-btn" aria-label="Đóng" onClick={onCancel}><Icon name="x" /></button>
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>Họ và tên</span><input id="edit-fullname" value={profile.fullName} maxLength={100} onChange={setP('fullName')} required /></label>
          <label className="field"><span>Email</span><input id="edit-email" type="email" value={profile.email} maxLength={100} onChange={setP('email')} required /></label>
          <label className="field"><span>Số điện thoại</span><input id="edit-phone" value={profile.phoneNumber} maxLength={20} onChange={setP('phoneNumber')} required /></label>
          <label className="field"><span>Số CCCD</span><input id="edit-cccd" value={profile.citizenId} maxLength={25} onChange={setP('citizenId')} placeholder="Không bắt buộc" /></label>
        </div>
        {isMe && <p className="muted">Bạn không thể tự đổi vai trò hay trạng thái của chính mình.</p>}
        <div className="form-grid">
          <label className="field"><span>Vai trò</span>
            <select value={roleId} disabled={isMe} onChange={(e) => setRoleId(Number(e.target.value))}>
              {roles.map((r) => <option key={r.roleId} value={r.roleId}>{roleLabel(r.roleName)}</option>)}
            </select>
          </label>
          <label className="field"><span>Trạng thái</span>
            <select value={status} disabled={isMe} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
        </div>
        {losesFacilities && <p className="alert bad"><Icon name="alert" size={16} />Đổi sang vai trò này sẽ kết thúc mọi phân công cơ sở hiện tại của tài khoản.</p>}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <div className="row">
          <button className="btn primary sm" type="submit" disabled={busy || !changed}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
          <button className="btn ghost sm" type="button" onClick={onCancel}>Hủy</button>
        </div>
      </form>
      <ActivityLogTable userId={user.userId} />
    </div>
  )
}

function ActivityLogTable({ userId }: { userId: number }) {
  const [logs, setLogs] = useState<ActivityLog[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<ActivityLog[]>(`/api/admin/users/${userId}/activity?take=100`)
      .then(setLogs)
      .catch((e) => setError((e as Error).message))
  }, [userId])

  return (
    <div className="stack-sm">
      <b className="row"><Icon name="history" size={16} className="cyan" /> Lịch sử thao tác (do tài khoản này thực hiện)</b>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {logs && logs.length === 0 && <Empty icon="history">Chưa có thao tác nào được ghi lại.</Empty>}
      {logs && logs.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Thời gian</th><th>Hành động</th><th>Chi tiết</th><th>IP</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.logId}>
                  <td>{fmtTime(l.createdAt)}</td>
                  <td className="code">{l.action}</td>
                  <td>{l.details ?? '—'}</td>
                  <td><small className="muted">{l.ipAddress ?? '—'}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
