import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtTime } from '../api'
import { useAuth } from '../auth'
import { useStaffFacility } from '../components/layout'
import type { Facility } from '../types'
import { Empty, Icon, StatusBadge } from '../components/ui'
import { SupportCategories, SupportPriorities, type SupportChecklistItem, type SupportRequest, type SupportUpdate } from '../types'
import { Select } from '../components/Select'

/**
 * Figma "support-incident-management": metrics, filters, ticket list on the left and the selected
 * ticket on the right (summary, information, checklist, activity, internal note, actions).
 * Status flow enforced by the API: Open → InProgress → Resolved (all checklist items done) → Closed.
 */

const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low']

export default function StaffSupport() {
  const { facilityId } = useStaffFacility()
  return <SupportWorkspace facilityId={facilityId} />
}

/**
 * Admin "Hỗ trợ khách hàng": every facility's tickets (GET /api/admin/support-requests), with the same status flow
 * and checklist as staff, plus a reply that does not change the status (POST .../{id}/messages).
 */
export function AdminSupport() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  useEffect(() => { api<Facility[]>('/api/operations/facilities').then(setFacilities).catch(() => setFacilities([])) }, [])
  return <SupportWorkspace admin facilityId={facilityId} facilities={facilities} onFacility={setFacilityId} />
}

function SupportWorkspace({ admin = false, facilityId, facilities = [], onFacility }: {
  admin?: boolean
  facilityId: number | null | undefined
  facilities?: Facility[]
  onFacility?: (id: number | null) => void
}) {
  const base = admin ? '/api/admin/support-requests' : '/api/support-requests'
  const [rows, setRows] = useState<SupportRequest[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'active' | 'Open' | 'InProgress' | 'Resolved' | 'Closed' | 'all'>('active')
  const [priority, setPriority] = useState('all')
  const [category, setCategory] = useState('all')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!admin && !facilityId) return
    try {
      setRows(await api<SupportRequest[]>(admin
        ? `/api/admin/support-requests?pageSize=200${facilityId ? `&facilityId=${facilityId}` : ''}`
        : `/api/support-requests/facilities/${facilityId}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [admin, facilityId])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => rows
    .filter((r) => status === 'all' ? true : status === 'active' ? r.status === 'Open' || r.status === 'InProgress' : r.status === status)
    .filter((r) => priority === 'all' || r.priority === priority)
    .filter((r) => category === 'all' || r.category === category)
    .filter((r) => {
      const s = q.trim().toLowerCase()
      return !s || [r.requestCode, r.title, r.unitCode, r.description, r.customerName ?? ''].some((v) => v.toLowerCase().includes(s))
    })
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.createdAt.localeCompare(b.createdAt)),
  [rows, status, priority, category, q])

  useEffect(() => {
    if (!shown.some((r) => r.requestId === selectedId)) setSelectedId(shown[0]?.requestId ?? null)
  }, [shown, selectedId])

  const selected = rows.find((r) => r.requestId === selectedId) ?? null
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const urgent = rows.filter((r) => (r.priority === 'Urgent' || r.priority === 'High') && (r.status === 'Open' || r.status === 'InProgress')).length

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Hỗ Trợ & Sự Cố</h1>
          <p className="muted">{admin
            ? 'Toàn bộ ticket của khách ở mọi cơ sở: theo dõi, phản hồi khách và xử lý thay khi cần.'
            : 'Tiếp nhận ticket của khách tại cơ sở, làm theo checklist và cập nhật tiến độ cho khách.'}</p>
        </div>
        <button className="btn outline" onClick={() => void load()}><Icon name="refresh" size={15} /> Làm mới</button>
      </div>

      <div className="stat-grid">
        <Metric icon="alert" tone="warn" label="Mới gửi" value={count('Open')} note="chưa ai tiếp nhận" />
        <Metric icon="refresh" tone="info" label="Đang xử lý" value={count('InProgress')} note="đã có nhân viên phụ trách" />
        <Metric icon="lock" tone="bad" label="Khẩn cấp / Cao" value={urgent} note="nên ưu tiên trước" />
        <Metric icon="check" tone="ok" label="Đã xử lý / đóng" value={count('Resolved') + count('Closed')} note="đã hoàn tất checklist" />
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={admin ? 'Tìm mã ticket, tiêu đề, kho, khách…' : 'Tìm mã ticket, tiêu đề, kho…'} />
          </span>
          {admin && (
            <Select value={facilityId ?? ''} onChange={(e) => onFacility?.(e.target.value ? Number(e.target.value) : null)} aria-label="Cơ sở">
              <option value="">Mọi cơ sở</option>
              {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
            </Select>
          )}
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Cần xử lý</option>
            <option value="Open">Mới gửi</option>
            <option value="InProgress">Đang xử lý</option>
            <option value="Resolved">Đã xử lý</option>
            <option value="Closed">Đã đóng</option>
            <option value="all">Tất cả trạng thái</option>
          </Select>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="all">Mọi mức độ</option>
            {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{SupportPriorities[p].label}</option>)}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">Mọi loại sự cố</option>
            {Object.entries(SupportCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <button className="btn ghost" onClick={() => { setQ(''); setStatus('active'); setPriority('all'); setCategory('all') }}><Icon name="x" size={15} /> Xóa bộ lọc</button>
      </div>

      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="ticket-workspace">
        <section className="panel">
          <div>
            <h2 className="panel-title">Danh sách ticket</h2>
            <p className="muted">{shown.length} ticket · sắp theo mức độ ưu tiên rồi thời gian gửi</p>
          </div>
          <div className="ticket-list">
            {shown.map((r) => {
              const p = SupportPriorities[r.priority] ?? { label: r.priority, tone: 'muted' as const }
              return (
                <button key={r.requestId} type="button" className={`ticket-item ${r.requestId === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(r.requestId)}>
                  <span className="row between wrap"><small className="code">{r.requestCode}</small><span className="row"><span className={`badge ${p.tone}`}>{p.label}</span><StatusBadge status={r.status} /></span></span>
                  <b>{r.title}</b>
                  <small className="muted clamp-2">{r.description}</small>
                  <small className="muted">{admin && r.facilityName ? `${r.facilityName} · ` : ''}Kho {r.unitCode}{admin && r.customerName ? ` · ${r.customerName}` : ''} · {SupportCategories[r.category] ?? r.category} · {fmtTime(r.createdAt)}{r.assignedStaffName ? ` · ${r.assignedStaffName}` : ''}</small>
                </button>
              )
            })}
            {shown.length === 0 && <Empty icon="check">Không có ticket nào khớp bộ lọc.</Empty>}
          </div>
        </section>

        {selected
          ? <TicketDetail key={selected.requestId} ticket={selected} onChanged={load} base={base} admin={admin} />
          : <section className="panel"><Empty icon="clipboard">Chọn một ticket để xem chi tiết.</Empty></section>}
      </div>
    </div>
  )
}

function Metric({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: number; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

function TicketDetail({ ticket: t, onChanged, base, admin }: { ticket: SupportRequest; onChanged: () => Promise<void>; base: string; admin: boolean }) {
  const [items, setItems] = useState<SupportChecklistItem[]>([])
  const [updates, setUpdates] = useState<SupportUpdate[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadDetail = useCallback(async () => {
    const [c, u] = await Promise.all([
      api<SupportChecklistItem[]>(`${base}/${t.requestId}/checklist`).catch(() => []),
      api<SupportUpdate[]>(`${base}/${t.requestId}/updates`).catch(() => []),
    ])
    setItems(c)
    setUpdates(u)
  }, [base, t.requestId])
  useEffect(() => { void loadDetail() }, [loadDetail, t.status])

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setError('')
    setNotice('')
    setBusy(key)
    try {
      await fn()
      setNotice(done)
      await Promise.all([onChanged(), loadDetail()])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const setStatus = (status: string, fallback: string, done: string) => {
    const message = note.trim() || fallback
    return run(status, async () => {
      await api(`${base}/${t.requestId}`, { method: 'PUT', body: { status, actionMessage: message } })
      setNote('')
    }, done)
  }

  const toggle = (item: SupportChecklistItem) => run(`item-${item.checklistItemId}`,
    () => api(`${base}/${t.requestId}/checklist/${item.checklistItemId}`, { method: 'PUT', body: { isCompleted: !item.isCompleted, notes: item.notes } }),
    item.isCompleted ? 'Đã bỏ đánh dấu mục checklist.' : 'Đã hoàn tất mục checklist.')

  const p = SupportPriorities[t.priority] ?? { label: t.priority, tone: 'muted' as const }
  const doneCount = items.filter((i) => i.isCompleted).length
  const allDone = items.length > 0 && doneCount === items.length
  // The staff API lets only the staff member who took the ticket update it (the list gives the name, not the id);
  // an admin may act on any ticket.
  const { user } = useAuth()
  const othersTicket = !admin && !!t.assignedStaffName && t.assignedStaffName !== user?.fullName

  // Admin only: reply to the customer without moving the status (closed tickets take no replies).
  const reply = () => run('reply', async () => {
    await api(`${base}/${t.requestId}/messages`, { body: { message: note.trim() } })
    setNote('')
  }, 'Đã gửi phản hồi cho khách.')
  const editable = t.status === 'InProgress' && !othersTicket

  return (
    <section className="panel ticket-detail">
      <h2 className="panel-title">Chi tiết ticket</h2>
      <div className="row between"><StatusBadge status={t.status} /><span className={`badge ${p.tone}`}>{p.label}</span></div>
      <div>
        <h3 className="issue-title">{t.title}</h3>
        <p className="muted">{t.description}</p>
      </div>
      <div className="info-box">
        <div className="info-row"><span className="muted">Mã ticket</span><b>{t.requestCode}</b></div>
        {admin && t.facilityName && <div className="info-row"><span className="muted">Cơ sở</span><b>{t.facilityName}</b></div>}
        {admin && t.customerName && <div className="info-row"><span className="muted">Khách hàng</span><b>{t.customerName}</b></div>}
        <div className="info-row"><span className="muted">Kho</span><b>{t.unitCode}</b></div>
        <div className="info-row"><span className="muted">Loại sự cố</span><b>{SupportCategories[t.category] ?? t.category}</b></div>
        <div className="info-row"><span className="muted">Gửi lúc</span><b>{fmtTime(t.createdAt)}</b></div>
        <div className="info-row"><span className="muted">Nhân viên phụ trách</span><b>{t.assignedStaffName ?? 'Chưa có'}</b></div>
      </div>

      <div className="stack-sm">
        <div className="row between"><b>Checklist xử lý</b><small className="muted">{doneCount}/{items.length} mục</small></div>
        {items.map((i) => (
          <label key={i.checklistItemId} className={`check-item sm ${i.isCompleted ? 'done' : ''} ${editable ? '' : 'readonly'}`}>
            <input type="checkbox" checked={i.isCompleted} disabled={!editable || busy !== ''} onChange={() => void toggle(i)} />
            <span className="grow"><b>{i.description}</b>
              {i.isCompleted && <small className="muted">{i.completedByStaff ?? ''}{i.completedAt ? ` · ${fmtTime(i.completedAt)}` : ''}</small>}
            </span>
          </label>
        ))}
        {!editable && t.status === 'Open' && <p className="hint"><Icon name="alert" size={15} /> Tiếp nhận ticket để bắt đầu làm checklist.</p>}
      </div>

      <div className="stack-sm">
        <b>Hoạt động</b>
        <ol className="timeline">
          {updates.map((u) => (
            <li key={u.updateId}>
              <span className="dot" />
              <div><b>{u.updatedBy}</b> <small className="muted">· {fmtTime(u.createdAt)}</small>
                {u.newStatus && u.newStatus !== u.previousStatus && <> <StatusBadge status={u.newStatus} /></>}
                <p>{u.actionMessage}</p></div>
            </li>
          ))}
        </ol>
      </div>

      <hr className="divider-line" />
      {othersTicket && t.status !== 'Closed' && (
        <p className="alert info"><Icon name="user" size={16} />Ticket do {t.assignedStaffName} phụ trách, chỉ người phụ trách cập nhật được.</p>
      )}
      {t.status !== 'Closed' && !othersTicket && (
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000}
          placeholder={t.status === 'Open' ? 'Ghi chú gửi khách khi tiếp nhận (không bắt buộc)…' : 'Ghi chú tiến độ / kết quả gửi khách…'} />
      )}
      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      {admin && t.status !== 'Closed' && (
        <button className="btn outline self-start" disabled={busy !== '' || !note.trim() || note.trim().length > 1000} onClick={() => void reply()}>
          <Icon name="mail" size={15} /> Gửi phản hồi (giữ trạng thái)
        </button>
      )}
      {t.status === 'Open' && (
        <button className="btn primary self-start" disabled={busy !== ''} onClick={() => void setStatus('InProgress', 'Nhân viên đã tiếp nhận yêu cầu và đang xử lý.', `Đã tiếp nhận ${t.requestCode}.`)}>
          <Icon name="user" size={15} /> Tiếp nhận ticket
        </button>
      )}
      {t.status === 'InProgress' && !othersTicket && (
        <>
          <div className="row wrap">
            <button className="btn outline" disabled={busy !== '' || !note.trim()} onClick={() => void setStatus('InProgress', '', 'Đã gửi cập nhật tiến độ cho khách.')}>
              <Icon name="refresh" size={15} /> Cập nhật tiến độ
            </button>
          </div>
          <button className="btn primary self-start" disabled={busy !== '' || !allDone} onClick={() => void setStatus('Resolved', 'Sự cố đã được xử lý xong.', `Đã đánh dấu ${t.requestCode} đã xử lý.`)}>
            <Icon name="check" size={15} /> Đánh dấu đã xử lý
          </button>
          {!allDone && <small className="muted">Hoàn tất toàn bộ checklist để đánh dấu đã xử lý.</small>}
        </>
      )}
      {t.status === 'Resolved' && !othersTicket && (
        <button className="btn primary self-start" disabled={busy !== ''} onClick={() => void setStatus('Closed', 'Ticket đã được đóng.', `Đã đóng ${t.requestCode}.`)}>
          <Icon name="lock" size={15} /> Đóng ticket
        </button>
      )}
    </section>
  )
}
