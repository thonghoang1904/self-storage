import { useCallback, useEffect, useState } from 'react'
import { api, fmtTime } from '../api'
import { Empty, Icon } from '../components/ui'
import { EmailStatuses, type EmailOutboxMessage } from '../types'

/**
 * System administrator: invoice and receipt emails (GET /api/admin/email-outbox).
 * They are queued with the invoice or payment and sent by a background worker, retried up to 8 times.
 * A message that failed every attempt can be queued again (POST .../{id}/retry).
 */

const TABS = [
  { v: '', label: 'Tất cả' },
  { v: 'Failed', label: 'Gửi lỗi' },
  { v: 'Pending', label: 'Chờ gửi' },
  { v: 'Processing', label: 'Đang gửi' },
  { v: 'Sent', label: 'Đã gửi' },
]
const PAGE_SIZE = 50
const kindOf = (key: string) => key.startsWith('payment-received:') ? 'Biên nhận thanh toán' : key.startsWith('invoice-issued:') ? 'Thông báo hóa đơn' : key

export default function AdminEmails() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<EmailOutboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (status) p.set('status', status)
    try {
      setRows(await api<EmailOutboxMessage[]>(`/api/admin/email-outbox?${p}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, page])
  useEffect(() => { void load() }, [load])

  const retry = async (m: EmailOutboxMessage) => {
    setBusyId(m.emailOutboxMessageId)
    setError('')
    try {
      await api(`/api/admin/email-outbox/${m.emailOutboxMessageId}/retry`, { method: 'POST' })
      setNotice(`Đã xếp lại thư gửi ${m.recipientEmail}; hệ thống sẽ gửi trong ít phút.`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Email Hệ Thống</h1>
          <p className="muted">Thư báo hóa đơn và biên nhận thanh toán gửi cho khách. Hệ thống tự gửi lại tối đa 8 lần; chỉ cần xử lý thư đã lỗi hết các lần.</p>
        </div>
        <button className="btn outline" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={15} /> Làm mới</button>
      </div>

      <div className="panel filter-bar">
        <div className="segmented" role="tablist">
          {TABS.map((t) => <button key={t.v} className={status === t.v ? 'active' : ''} onClick={() => { setStatus(t.v); setPage(1); setNotice('') }}>{t.label}</button>)}
        </div>
        <small className="muted">Thư gửi lỗi thường do cấu hình Gmail SMTP hoặc địa chỉ nhận sai.</small>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Thời gian</th><th>Loại thư</th><th>Người nhận · tiêu đề</th><th className="right">Số lần</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => {
                const st = EmailStatuses[m.status] ?? { label: m.status, tone: 'muted' as const }
                return (
                  <tr key={m.emailOutboxMessageId}>
                    <td>{fmtTime(m.createdAt)}{m.sentAt && <><br /><small className="muted">gửi {fmtTime(m.sentAt)}</small></>}</td>
                    <td>{kindOf(m.eventKey)}<br /><small className="muted code">{m.eventKey}</small></td>
                    <td><b>{m.recipientEmail}</b><br /><small className="muted">{m.subject}</small>
                      {m.lastError && <><br /><small className="danger-text">{m.lastError}</small></>}</td>
                    <td className="right">{m.attemptCount}</td>
                    <td><span className={`badge ${st.tone}`}>{st.label}</span>
                      {m.status === 'Pending' && <><br /><small className="muted">lần tới {fmtTime(m.nextAttemptAt)}</small></>}</td>
                    <td className="right">
                      {m.status === 'Failed' && (
                        <button className="btn outline sm" disabled={busyId !== null} onClick={() => void retry(m)}>
                          <Icon name="refresh" size={14} /> {busyId === m.emailOutboxMessageId ? 'Đang xếp…' : 'Gửi lại'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <Empty icon="mail">{status === 'Failed' ? 'Không có thư nào gửi lỗi.' : 'Chưa có thư nào.'}</Empty>}
        </div>
        <div className="row between wrap">
          <small className="muted">Trang {page} · {rows.length} thư</small>
          <div className="pager">
            <button className="icon-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Trang trước"><Icon name="arrowRight" size={14} className="flip" /></button>
            <button className="active">{page}</button>
            <button className="icon-btn" disabled={rows.length < PAGE_SIZE} onClick={() => setPage(page + 1)} aria-label="Trang sau"><Icon name="arrowRight" size={14} /></button>
          </div>
        </div>
      </section>
    </div>
  )
}
