import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, fmtDate } from '../api'
import { parseStaffCode, staffCode } from '../validation'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { FacilityStaff } from '../types'

/**
 * Facility manager: staff assigned to the facility (#43, Figma "staff-management").
 * Lists them (GET .../facility-management/facilities/{id}/staff), assigns an existing Facility Staff account by
 * its user ID (POST) and ends an assignment (DELETE). Accounts themselves are created by the system administrator.
 */
export default function FacilityStaffPage() {
  const { facilityId, facilities } = useStaffFacility()
  const [staff, setStaff] = useState<FacilityStaff[]>([])
  const [q, setQ] = useState('')
  const [userId, setUserId] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      setStaff(await api<FacilityStaff[]>(`/api/facility-management/facilities/${facilityId}/staff`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      setNotice(done)
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const assign = async (e: FormEvent) => {
    e.preventDefault()
    const id = parseStaffCode(userId)
    if (!id) { setError('Mã nhân viên không hợp lệ, vd: NV0004'); return }
    if (await run(() => api(`/api/facility-management/facilities/${facilityId}/staff`, { body: { staffUserId: id } }), 'Đã phân công nhân viên vào cơ sở.')) setUserId('')
  }

  const remove = (s: FacilityStaff) => run(
    () => api(`/api/facility-management/facilities/${facilityId}/staff/${s.userId}`, { method: 'DELETE' }),
    `Đã gỡ ${s.fullName} khỏi cơ sở.`).then(() => setConfirmId(null))

  const facility = facilities.find((f) => f.facilityId === facilityId)
  const shown = staff.filter((s) => !q.trim() || `${staffCode(s.userId)} ${s.fullName} ${s.username} ${s.email}`.toLowerCase().includes(q.trim().toLowerCase()))
  const active = staff.filter((s) => s.status === 'Active').length

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Nhân Viên Cơ Sở</h1>
        <p className="muted">Phân công nhân viên trực cổng, bàn giao và hỗ trợ khách tại {facility?.facilityName ?? 'cơ sở'}.</p>
      </div>

      <div className="stat-grid three">
        <div className="stat-card">
          <div className="row between"><span className="muted">Nhân viên được phân công</span><span className="stat-icon info"><Icon name="users" size={17} /></span></div>
          <b className="stat-value">{staff.length}</b>
          <small className="stat-note info">tại cơ sở này</small>
        </div>
        <div className="stat-card">
          <div className="row between"><span className="muted">Đang hoạt động</span><span className="stat-icon ok"><Icon name="check" size={17} /></span></div>
          <b className="stat-value">{active}</b>
          <small className="stat-note ok">tài khoản đăng nhập được</small>
        </div>
        <div className="stat-card">
          <div className="row between"><span className="muted">Tạm khóa / ngừng</span><span className="stat-icon warn"><Icon name="lock" size={17} /></span></div>
          <b className="stat-value">{staff.length - active}</b>
          <small className="stat-note warn">liên hệ quản trị hệ thống để mở</small>
        </div>
      </div>

      <form className="panel assign-form" onSubmit={assign}>
        <div>
          <h2 className="panel-title"><Icon name="plus" size={18} /> Phân công nhân viên</h2>
          <p className="muted">Nhập mã nhân viên (vd: NV0004) do quản trị hệ thống cấp khi tạo tài khoản Nhân viên cơ sở.</p>
        </div>
        <div className="row wrap">
          <input className="grow" value={userId} maxLength={12} onChange={(e) => setUserId(e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase())} placeholder="Mã nhân viên, vd: NV0004" aria-label="Mã nhân viên" />
          <button className="btn primary" disabled={busy || !userId}>{busy ? 'Đang phân công…' : 'Phân công'}</button>
        </div>
      </form>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <section className="panel">
        <div className="panel-head wrap">
          <h2 className="panel-title">Danh sách nhân viên</h2>
          <span className="input-wrap search-sm">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, tài khoản, email…" />
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nhân viên</th><th>Tài khoản</th><th>Email</th><th>Ngày phân công</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.userId}>
                  <td><span className="row"><span className="avatar sm">{s.fullName.split(' ').slice(-1)[0][0]}</span><b>{s.fullName}</b></span></td>
                  <td className="code">{s.username}<br /><small className="muted">{staffCode(s.userId)}</small></td>
                  <td>{s.email}</td>
                  <td>{fmtDate(s.assignedDate)}</td>
                  <td>{s.status === 'Active' ? <span className="badge ok">Đang hoạt động</span> : <StatusBadge status={s.status} />}</td>
                  <td className="right">
                    {confirmId === s.userId ? (
                      <span className="row end">
                        <small className="muted">Gỡ khỏi cơ sở?</small>
                        <button className="btn danger sm" disabled={busy} onClick={() => void remove(s)}>Gỡ</button>
                        <button className="btn ghost sm" onClick={() => setConfirmId(null)}>Không</button>
                      </span>
                    ) : (
                      <button className="btn ghost sm danger-text" onClick={() => setConfirmId(s.userId)}><Icon name="trash" size={14} /> Gỡ phân công</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <Empty icon="users">{staff.length ? 'Không có nhân viên nào khớp.' : 'Cơ sở chưa có nhân viên được phân công.'}</Empty>}
        </div>
        <small className="muted">Gỡ phân công không xóa tài khoản; nhân viên chỉ mất quyền thao tác tại cơ sở này.</small>
      </section>
    </div>
  )
}
