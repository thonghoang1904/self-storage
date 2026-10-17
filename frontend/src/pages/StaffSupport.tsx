import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon } from '../components/ui'
import { SupportPriorities, type SupportRequest } from '../types'
import { RequestCard } from './Support'

const FILTERS = [
  { key: 'active', label: 'Cần xử lý' },
  { key: 'Open', label: 'Mới gửi' },
  { key: 'InProgress', label: 'Đang xử lý' },
  { key: 'done', label: 'Đã xong' },
  { key: 'all', label: 'Tất cả' },
] as const

const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low']

/** Staff: support requests of the facility — take one, post progress, resolve and close it. */
export default function StaffSupport() {
  const { facilityId } = useStaffFacility()
  const [rows, setRows] = useState<SupportRequest[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('active')
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      setRows(await api<SupportRequest[]>(`/api/support-requests/facilities/${facilityId}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  const count = (s: string) => rows.filter((r) => r.status === s).length
  const shown = rows
    .filter((r) => filter === 'all' ? true
      : filter === 'active' ? r.status === 'Open' || r.status === 'InProgress'
      : filter === 'done' ? r.status === 'Resolved' || r.status === 'Closed'
      : r.status === filter)
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.createdAt.localeCompare(b.createdAt))

  return (
    <div className="stack-xl">
      <div className="stat-grid">
        <Stat icon="alert" tone="warn" label="Mới gửi" value={count('Open')} note="chưa ai tiếp nhận" />
        <Stat icon="refresh" tone="info" label="Đang xử lý" value={count('InProgress')} note="đã có nhân viên nhận" />
        <Stat icon="check" tone="ok" label="Đã xử lý" value={count('Resolved') + count('Closed')} note="đã giải quyết / đóng" />
        <Stat icon="lock" tone="bad" label="Khẩn cấp / Cao" value={rows.filter((r) => (r.priority === 'Urgent' || r.priority === 'High') && (r.status === 'Open' || r.status === 'InProgress')).length} note="nên ưu tiên trước" />
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="row between wrap">
        <h2 className="section-title">Yêu cầu hỗ trợ tại cơ sở</h2>
        <div className="segmented">
          {FILTERS.map((f) => <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
      </div>

      <div className="stack">
        {shown.map((r) => (
          <RequestCard key={r.requestId} request={r} open={openId === r.requestId} onToggle={() => setOpenId(openId === r.requestId ? null : r.requestId)}>
            <HandleForm request={r} onDone={async (msg) => { setError(''); setNotice(msg); await load() }} onError={setError} />
          </RequestCard>
        ))}
        {shown.length === 0 && <div className="panel"><Empty icon="check">Không có yêu cầu nào trong mục này.</Empty></div>}
      </div>
      <p className="hint"><Icon name="alert" size={15} /> Ưu tiên: {PRIORITY_ORDER.map((p) => SupportPriorities[p].label).join(' → ')}. Nhân viên đầu tiên cập nhật sẽ là người phụ trách yêu cầu.</p>
    </div>
  )
}

function Stat({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: number; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

/** The status a request can move to next, following the backend rules. */
const nextStatuses = (s: string) =>
  s === 'Open' ? ['InProgress', 'Resolved', 'Closed'] : s === 'InProgress' ? ['InProgress', 'Resolved', 'Closed'] : s === 'Resolved' ? ['Closed'] : []
const ACTION_LABEL: Record<string, string> = { InProgress: 'Tiếp nhận / cập nhật tiến độ', Resolved: 'Đã xử lý xong', Closed: 'Đóng yêu cầu' }

function HandleForm({ request: r, onDone, onError }: { request: SupportRequest; onDone: (msg: string) => Promise<void>; onError: (m: string) => void }) {
  const options = nextStatuses(r.status)
  const [status, setStatus] = useState(options[0] ?? '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setStatus(nextStatuses(r.status)[0] ?? '') }, [r.status])

  if (!options.length) return <p className="muted">Yêu cầu đã đóng.</p>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`/api/support-requests/${r.requestId}`, { method: 'PUT', body: { status, actionMessage: message } })
      setMessage('')
      await onDone(`Đã cập nhật ${r.requestCode}: ${ACTION_LABEL[status]}.`)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="add-person" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Thao tác</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {options.map((s) => <option key={s} value={s}>{ACTION_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="field"><span>Nội dung gửi khách</span>
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} required
            placeholder={status === 'Resolved' ? 'vd: Đã thay ổ khóa mới' : 'vd: Kỹ thuật sẽ kiểm tra lúc 15:00'} />
        </label>
      </div>
      <button className="btn primary sm self-start" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Cập nhật'}</button>
    </form>
  )
}
