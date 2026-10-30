import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtMoney, fmtTime } from '../api'
import { Empty, Icon } from '../components/ui'
import { SuspensionStatuses, type ContractSuspension } from '../types'
import { localToday } from '../validation'
import { ContractStrip, Hero, Loading, useContract } from './ContractPolicy'
import { Select } from '../components/Select'

/**
 * Figma "Tạm ngưng hợp đồng giữa kỳ" (96:10415): the customer asks to pause a contract for a period.
 * During the pause nobody can enter the unit, no monthly rent is billed (a holding fee is charged instead) and the end
 * date moves back by the paused days. Staff approve or reject.
 * API (awaiting backend, see docs/API-cho-backend.md): GET/POST /api/contracts/{id}/suspensions,
 * DELETE /api/contracts/{id}/suspensions/{suspensionId}. The in-browser demo implements it.
 */

export const SUSPEND_RULES = { minDays: 30, maxDays: 90, noticeDays: 3, holdingPercent: 30 }
const REASONS = ['Đi công tác / học tập xa', 'Sửa chữa hoặc chuyển nhà', 'Tạm ngưng kinh doanh', 'Lý do tài chính', 'Khác']

const DAY = 86400000
const days = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY) + 1
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** Holding fee: 30% of the daily rent (monthly / 30) per paused day, rounded to the thousand. */
export const holdingFee = (monthly: number, n: number) => Math.round((monthly / 30) * n * SUSPEND_RULES.holdingPercent / 100 / 1000) * 1000

const notReady = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405)
const NOT_READY = 'Chức năng tạm ngưng đang được hoàn thiện. Bạn có thể gửi yêu cầu qua mục Hỗ trợ trong lúc chờ.'

export default function ContractSuspend() {
  const id = Number(useParams().id)
  const { c, renewals, unitType, error } = useContract(id)
  const [rows, setRows] = useState<ContractSuspension[]>([])
  const [apiMissing, setApiMissing] = useState(false)
  const first = localToday(SUSPEND_RULES.noticeDays)
  const [start, setStart] = useState(first)
  const [end, setEnd] = useState(addDays(first, SUSPEND_RULES.minDays - 1))
  const [reason, setReason] = useState(REASONS[0])
  const [notes, setNotes] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(() => api<ContractSuspension[]>(`/api/contracts/${id}/suspensions`)
    .then((r) => { setRows(r); setApiMissing(false) })
    .catch((e) => { if (notReady(e)) setApiMissing(true) }), [id])
  useEffect(() => { void load() }, [load])

  if (!c) return <Loading error={error} />

  const n = start && end && end >= start ? days(start, end) : 0
  const fee = holdingFee(c.monthlyRentFee, n)
  const saved = Math.round(c.monthlyRentFee / 30 * n) - fee
  const newEnd = addDays(c.endDate, n)
  const open = rows.find((r) => r.status === 'Pending' || r.status === 'Approved' || r.status === 'Active')
  const pendingRenewal = renewals.some((r) => r.status === 'Pending')
  const eligible = c.status === 'Active' && !open && !pendingRenewal

  const problem = (): string => {
    if (!start || !end) return 'Vui lòng chọn ngày bắt đầu và ngày kết thúc tạm ngưng'
    if (start < first) return `Ngày bắt đầu phải sau hôm nay ít nhất ${SUSPEND_RULES.noticeDays} ngày (từ ${fmtDate(first)})`
    if (end < start) return 'Ngày kết thúc phải sau ngày bắt đầu'
    if (n < SUSPEND_RULES.minDays || n > SUSPEND_RULES.maxDays) return `Thời gian tạm ngưng từ ${SUSPEND_RULES.minDays} đến ${SUSPEND_RULES.maxDays} ngày (đang chọn ${n} ngày)`
    if (end >= c.endDate) return `Ngày kết thúc phải trước ngày hết hạn hợp đồng ${fmtDate(c.endDate)}`
    if (reason === 'Khác' && notes.trim().length < 5) return 'Vui lòng ghi rõ lý do (ít nhất 5 ký tự)'
    if (notes.trim().length > 500) return 'Ghi chú tối đa 500 ký tự'
    if (!agree) return 'Vui lòng xác nhận đã hiểu ảnh hưởng của việc tạm ngưng'
    return ''
  }

  const submit = async () => {
    const p = problem()
    if (p) return setMsg({ tone: 'bad', text: p })
    setBusy(true)
    setMsg(null)
    try {
      const r = await api<ContractSuspension>(`/api/contracts/${c.contractId}/suspensions`, {
        body: { startDate: start, endDate: end, reason, notes: notes.trim() || null },
      })
      setMsg({ tone: 'ok', text: `Đã gửi yêu cầu tạm ngưng ${r.days} ngày (${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}). Nhân viên cơ sở sẽ duyệt và phản hồi tại đây.` })
      setAgree(false)
      setNotes('')
      await load()
    } catch (e) {
      setMsg({ tone: 'bad', text: notReady(e) ? NOT_READY : (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (r: ContractSuspension) => {
    try {
      await api(`/api/contracts/${c.contractId}/suspensions/${r.suspensionId}`, { method: 'DELETE' })
      setMsg({ tone: 'ok', text: 'Đã hủy yêu cầu tạm ngưng.' })
      await load()
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message })
    }
  }

  const step = !open ? 1 : open.status === 'Pending' ? 2 : 3

  return (
    <>
      <Hero c={c} crumb="Tạm ngưng" title="Tạm ngưng hợp đồng giữa kỳ" subtitle={`Đề nghị tạm ngưng hợp đồng ${c.contractNumber} trong một khoảng thời gian; đồ vẫn được giữ an toàn trong kho.`} />
      <div className="container page-body">
        <ContractStrip c={c} unitType={unitType} />

        <div className="notice warn-notice">
          <span className="notice-icon warn"><Icon name="alert" size={16} /></span>
          <div>
            <b>Điều kiện tạm ngưng</b>
            <p>Tạm ngưng từ {SUSPEND_RULES.minDays} đến {SUSPEND_RULES.maxDays} ngày, bắt đầu sau ít nhất {SUSPEND_RULES.noticeDays} ngày kể từ khi gửi và kết thúc trước ngày hết hạn. Trong thời gian tạm ngưng không vào kho được, thay tiền thuê bằng phí giữ kho {SUSPEND_RULES.holdingPercent}%, và ngày hết hạn được cộng thêm số ngày tạm ngưng.</p>
          </div>
        </div>
        {apiMissing && <p className="alert warn"><Icon name="clock" size={16} />{NOT_READY}</p>}

        <ol className="journey">
          <li className={step > 1 ? 'done' : 'active'}><span>{step > 1 ? <Icon name="check" size={14} /> : 1}</span>Gửi đề nghị</li>
          <li className={step === 2 ? 'active' : step > 2 ? 'done' : 'later'}><span>{step > 2 ? <Icon name="check" size={14} /> : 2}</span>Nhân viên duyệt</li>
          <li className={step === 3 ? 'active' : 'later'}><span>3</span>Tạm ngưng có hiệu lực</li>
        </ol>

        {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}

        <div className="policy-layout">
          <div className="stack-lg">
            <section className="panel stack">
              <div><h2 className="panel-title">Thông tin yêu cầu tạm ngưng</h2><p className="muted">Chọn khoảng thời gian và lý do tạm ngưng.</p></div>
              {!eligible && (
                <p className="alert warn"><Icon name="alert" size={16} />
                  {c.status !== 'Active' ? 'Chỉ hợp đồng đang hoạt động mới tạm ngưng được.'
                    : open ? `Hợp đồng đang có yêu cầu tạm ngưng (${SuspensionStatuses[open.status]?.label ?? open.status}).`
                    : 'Hợp đồng đang có yêu cầu gia hạn chờ thanh toán; hoàn tất gia hạn trước khi tạm ngưng.'}
                </p>
              )}
              <div className="form-grid">
                <label className="field"><span>Ngày bắt đầu tạm ngưng *</span><input type="date" value={start} min={first} max={c.endDate} disabled={!eligible} onChange={(e) => setStart(e.target.value)} /></label>
                <label className="field"><span>Ngày kết thúc *</span><input type="date" value={end} min={start} max={c.endDate} disabled={!eligible} onChange={(e) => setEnd(e.target.value)} /></label>
              </div>
              <span className={`badge ${n >= SUSPEND_RULES.minDays && n <= SUSPEND_RULES.maxDays ? 'info' : 'bad'} self-start`}>{n} ngày tạm ngưng</span>
              <label className="field"><span>Lý do tạm ngưng *</span>
                <Select value={reason} disabled={!eligible} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select>
              </label>
              <label className="field"><span>Ghi chú thêm{reason === 'Khác' ? ' *' : ''}</span>
                <textarea rows={3} maxLength={500} value={notes} disabled={!eligible} onChange={(e) => setNotes(e.target.value)} placeholder="vd: Đi công tác nước ngoài 2 tháng, cần giữ đồ trong kho" />
              </label>
              <label className="check-line">
                <input type="checkbox" checked={agree} disabled={!eligible} onChange={(e) => { setAgree(e.target.checked); setMsg(null) }} />
                <span>Tôi hiểu trong thời gian tạm ngưng sẽ không vào kho được và đồng ý trả phí giữ kho theo đề nghị.</span>
              </label>
            </section>

            <section className="panel stack">
              <h2 className="panel-title">Ảnh hưởng cần được hai bên thống nhất</h2>
              <div className="impact-item"><span className="notice-icon bad"><Icon name="lock" size={16} /></span><div><b>Quyền truy cập kho</b><p>Từ {fmtDate(start)} đến {fmtDate(end)}, chủ hợp đồng và người được ủy quyền không vào kho được. Cần lấy đồ gấp: hủy tạm ngưng hoặc liên hệ cơ sở.</p></div></div>
              <div className="impact-item"><span className="notice-icon warn"><Icon name="wallet" size={16} /></span><div><b>Thanh toán</b><p>Không phát hành hóa đơn tiền thuê trong thời gian tạm ngưng. Thay vào đó là phí giữ kho {fmtMoney(fee)} ({SUSPEND_RULES.holdingPercent}% tiền thuê), thanh toán trước ngày bắt đầu.</p></div></div>
              <div className="impact-item"><span className="notice-icon info"><Icon name="calendar" size={16} /></span><div><b>Thời hạn hợp đồng</b><p>Ngày hết hạn dời từ {fmtDate(c.endDate)} sang {fmtDate(newEnd)} (cộng {n} ngày). Tiền cọc {fmtMoney(c.depositPaid)} giữ nguyên.</p></div></div>
            </section>

            <section className="panel stack-sm">
              <h3 className="panel-title"><Icon name="history" size={18} className="cyan" /> Yêu cầu tạm ngưng đã gửi</h3>
              {rows.map((r) => {
                const st = SuspensionStatuses[r.status] ?? { label: r.status, tone: 'muted' as const }
                return (
                  <div key={r.suspensionId} className="visit-row">
                    <span className={`notice-icon ${st.tone}`}><Icon name="clock" size={15} /></span>
                    <div className="grow">
                      <b>{fmtDate(r.startDate)} – {fmtDate(r.endDate)} · {r.days} ngày · phí giữ kho {fmtMoney(r.holdingFee)}</b>
                      <small className="muted block">{r.reason}{r.notes && ` · ${r.notes}`} · gửi {fmtTime(r.requestedAt)}</small>
                      {r.reviewNotes && <small className="muted block">Ghi chú nhân viên: {r.reviewNotes}</small>}
                    </div>
                    <span className={`badge ${st.tone}`}>{st.label}</span>
                    {r.status === 'Pending' && <button type="button" className="btn ghost sm danger-text" onClick={() => void cancel(r)}>Hủy</button>}
                  </div>
                )
              })}
              {rows.length === 0 && <Empty icon="calendar">Chưa có yêu cầu tạm ngưng nào.</Empty>}
            </section>
          </div>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm quote-card">
              <h3 className="panel-title">Điều kiện đề nghị</h3>
              <span className="badge warn self-start">Đề nghị · chờ duyệt</span>
              <div className="info-row"><span className="muted">Bắt đầu</span><b>{fmtDate(start)}</b></div>
              <div className="info-row"><span className="muted">Kết thúc</span><b>{fmtDate(end)}</b></div>
              <div className="info-row"><span className="muted">Số ngày</span><b>{n} ngày</b></div>
              <div className="quote-total warn">
                <small>Phí giữ kho đề xuất</small>
                <b>{fmtMoney(fee)}</b>
                <small>{SUSPEND_RULES.holdingPercent}% × {fmtMoney(Math.round(c.monthlyRentFee / 30))}/ngày × {n} ngày</small>
              </div>
              <div className="info-row"><span className="muted">Tiết kiệm so với tiền thuê</span><b className="ok-text">{fmtMoney(Math.max(0, saved))}</b></div>
              <div className="info-row"><span className="muted">Hết hạn mới dự kiến</span><b>{fmtDate(newEnd)}</b></div>
              <button type="button" className="btn primary block" disabled={busy || !eligible} onClick={() => void submit()}>
                <Icon name="clock" size={16} /> {busy ? 'Đang gửi…' : 'Gửi đề nghị tạm ngưng'}
              </button>
              <Link to={`/my-units/${c.contractId}`} className="btn ghost block">Hủy / Quay lại hợp đồng</Link>
            </section>
            <section className="panel stack-sm">
              <h3 className="panel-title">Trước khi xác nhận</h3>
              <p className="muted">Nhân viên sẽ kiểm tra công nợ và lịch hẹn của kho trước khi duyệt. Hóa đơn chưa thanh toán cần được thanh toán trước.</p>
              <Link to={`/my-units/${c.contractId}/policy?from=suspend`} className="btn outline block"><Icon name="clipboard" size={15} /> Xem chính sách hợp đồng</Link>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}
