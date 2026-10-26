import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { checkText, firstError } from '../validation'
import { api, fmtTime } from '../api'
import { Badge, Empty, Eyebrow, Icon, StatusBadge } from '../components/ui'
import { SupportCategories, SupportPriorities, type Contract, type SupportChecklistItem, type SupportRequest, type SupportUpdate } from '../types'

const EMPTY_FORM = { contractId: 0, category: 'LockIssue', priority: 'Medium', title: '', description: '' }

/** Customer: send a support request for one of their units and follow how staff handle it. */
export default function Support() {
  const params = new URLSearchParams(useLocation().search)
  const wanted = Number(params.get('contract') ?? 0)
  const askReturn = params.get('topic') === 'return'
  const [contracts, setContracts] = useState<Contract[]>([])
  const [rows, setRows] = useState<SupportRequest[] | null>(null)
  const [form, setForm] = useState(askReturn
    ? { ...EMPTY_FORM, category: 'Other', priority: 'Medium', title: 'Yêu cầu trả kho', description: 'Tôi muốn trả kho và nhận lại tiền cọc. Ngày giờ dự kiến đến trả kho: ' }
    : EMPTY_FORM)
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await api<SupportRequest[]>('/api/support-requests/my'))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    api<Contract[]>('/api/contracts/my').then((cs) => {
      const usable = cs.filter((c) => c.status !== 'Terminated' && c.status !== 'Liquidated')
      setContracts(usable)
      if (usable.length) setForm((f) => ({ ...f, contractId: usable.some((c) => c.contractId === wanted) ? wanted : usable[0].contractId }))
    }).catch(() => {})
  }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setNotice('')
    const problem = firstError(
      form.contractId ? '' : 'Vui lòng chọn hợp đồng / kho cần hỗ trợ',
      checkText(form.title, 'Tiêu đề', 200, false, 5),
      checkText(form.description, 'Mô tả', 4000, false, 10),
    )
    if (problem) return setError(problem)
    setError('')
    setBusy(true)
    try {
      const r = await api<SupportRequest>('/api/support-requests', { body: { ...form, title: form.title.trim(), description: form.description.trim() } })
      setNotice(`Đã gửi yêu cầu ${r.requestCode}. Nhân viên cơ sở sẽ tiếp nhận và cập nhật tại đây.`)
      setForm({ ...EMPTY_FORM, contractId: form.contractId })
      setOpenId(r.requestId)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const open = rows?.filter((r) => r.status === 'Open' || r.status === 'InProgress').length ?? 0

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Eyebrow dark>Tài khoản khách hàng</Eyebrow>
          <h1>Hỗ Trợ & Sự Cố</h1>
          <p>Báo lỗi khóa, thẻ ra vào, kho hư hỏng hay vấn đề thanh toán. Nhân viên cơ sở tiếp nhận và cập nhật tiến độ cho bạn.</p>
        </div>
      </section>

      <div className="container page-body">
        <div className="dash-grid">
          <section className="stack-lg">
            <div className="row between wrap">
              <h2 className="section-title with-icon"><Icon name="history" size={20} className="cyan" /> Yêu Cầu Của Tôi {open > 0 && <span className="pill">{open} đang mở</span>}</h2>
            </div>
            {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
            {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
            <div className="stack">
              {rows?.map((r) => (
                <RequestCard key={r.requestId} request={r} open={openId === r.requestId} onToggle={() => setOpenId(openId === r.requestId ? null : r.requestId)} />
              ))}
              {rows?.length === 0 && <div className="panel"><Empty icon="phone">Bạn chưa gửi yêu cầu hỗ trợ nào.</Empty></div>}
            </div>
          </section>

          <aside className="stack-lg">
            <form className="panel" onSubmit={submit}>
              <h3 className="panel-title"><Icon name="plus" size={18} className="cyan" /> Gửi Yêu Cầu Mới</h3>
              {contracts.length === 0 ? (
                <p className="muted">Bạn cần có hợp đồng thuê kho đang hiệu lực để gửi yêu cầu. <Link to="/rent" className="link">Thuê kho</Link></p>
              ) : (
                <>
                  <label className="field"><span>Kho cần hỗ trợ</span>
                    <select value={form.contractId} onChange={(e) => setForm({ ...form, contractId: Number(e.target.value) })}>
                      {contracts.map((c) => <option key={c.contractId} value={c.contractId}>Kho {c.unitCode} · {c.facilityName} ({c.contractNumber})</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Loại sự cố</span>
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      {Object.entries(SupportCategories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <div className="field"><span>Mức độ</span>
                    <div className="segmented fill">
                      {Object.entries(SupportPriorities).map(([k, v]) => (
                        <button key={k} type="button" className={form.priority === k ? 'active' : ''} onClick={() => setForm({ ...form, priority: k })}>{v.label}</button>
                      ))}
                    </div>
                  </div>
                  <label className="field"><span>Tiêu đề</span>
                    <input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="vd: Ổ khóa kho bị kẹt" required />
                  </label>
                  <label className="field"><span>Mô tả chi tiết</span>
                    <textarea value={form.description} maxLength={4000} rows={4} onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Mô tả sự cố, thời điểm phát hiện, bạn cần nhân viên hỗ trợ gì…" required />
                  </label>
                  <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi Yêu Cầu'}</button>
                </>
              )}
            </form>
            <div className="notice">
              <span className="notice-icon bad"><Icon name="phone" size={16} /></span>
              <div><b>Khẩn cấp?</b><p>Gọi hotline (028) 1234 5678 nếu có cháy, ngập hoặc nghi mất trộm.</p></div>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

/** One request with its handling timeline and checklist (loaded when opened). */
function RequestCard({ request: r, open, onToggle, children }: { request: SupportRequest; open: boolean; onToggle: () => void; children?: ReactNode }) {
  const [updates, setUpdates] = useState<SupportUpdate[] | null>(null)
  const [items, setItems] = useState<SupportChecklistItem[]>([])
  useEffect(() => {
    if (!open) return
    setUpdates(null)
    api<SupportUpdate[]>(`/api/support-requests/${r.requestId}/updates`).then(setUpdates).catch(() => setUpdates([]))
    api<SupportChecklistItem[]>(`/api/support-requests/${r.requestId}/checklist`).then(setItems).catch(() => setItems([]))
  }, [open, r.requestId, r.status])

  const prio = SupportPriorities[r.priority] ?? { label: r.priority, tone: 'muted' as const }
  return (
    <article className={`panel support-card ${open ? 'open' : ''}`}>
      <button type="button" className="support-head" onClick={onToggle}>
        <div className="grow">
          <div className="row wrap">
            <b>{r.title}</b>
            <StatusBadge status={r.status} />
            <Badge tone={prio.tone}>{prio.label}</Badge>
          </div>
          <small className="muted">{r.requestCode} · Kho {r.unitCode} · {SupportCategories[r.category] ?? r.category} · {fmtTime(r.createdAt)}
            {r.assignedStaffName && <> · Nhân viên: {r.assignedStaffName}</>}</small>
        </div>
        <Icon name="arrowRight" size={16} className={`cyan chevron ${open ? 'down' : ''}`} />
      </button>
      {open && (
        <div className="stack">
          <p className="support-desc">{r.description}</p>
          {items.length > 0 && (
            <div className="stack-sm">
              <small className="muted"><b>Các bước xử lý</b> · {items.filter((i) => i.isCompleted).length}/{items.length} đã xong</small>
              <ul className="mini-checklist">
                {items.map((i) => <li key={i.checklistItemId} className={i.isCompleted ? 'done' : ''}><Icon name={i.isCompleted ? 'check' : 'clock'} size={13} /> {i.description}</li>)}
              </ul>
            </div>
          )}
          <ol className="timeline">
            {updates?.map((u) => (
              <li key={u.updateId}>
                <span className="dot" />
                <div>
                  <b>{u.updatedBy}</b> <small className="muted">· {fmtTime(u.createdAt)}</small>
                  {u.newStatus && u.newStatus !== u.previousStatus && <> <StatusBadge status={u.newStatus} /></>}
                  <p>{u.actionMessage}</p>
                </div>
              </li>
            ))}
          </ol>
          {children}
        </div>
      )}
    </article>
  )
}
