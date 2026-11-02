import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, fmtDate, fmtMoney, fmtTime } from '../api'
import { Icon } from '../components/ui'
import { SuspensionStatuses, type ContractSuspension } from '../types'
import { localToday } from '../validation'
import { ContractStrip, Hero, Loading, useContract } from './ContractPolicy'

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
const NOT_SENT = 'Chưa gửi được yêu cầu tạm ngưng. Vui lòng thử lại sau hoặc liên hệ cơ sở.'

export default function ContractSuspend() {
  const id = Number(useParams().id)
  const { c, renewals, unitType, error } = useContract(id)
  const [rows, setRows] = useState<ContractSuspension[]>([])
  const first = localToday(SUSPEND_RULES.noticeDays)
  const [start, setStart] = useState(first)
  const [end, setEnd] = useState(addDays(first, SUSPEND_RULES.minDays - 1))
  const [reason, setReason] = useState(REASONS[0])
  const [notes, setNotes] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(() => api<ContractSuspension[]>(`/api/contracts/${id}/suspensions`)
    .then(setRows)
    .catch(() => setRows([])), [id])
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
      setMsg({ tone: 'bad', text: notReady(e) ? NOT_SENT : (e as Error).message })
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

  const lengths = [SUSPEND_RULES.minDays, 60, SUSPEND_RULES.maxDays]
  const pickLength = (k: number) => { setEnd(addDays(start, k - 1)); setMsg(null) }
  const nOk = n >= SUSPEND_RULES.minDays && n <= SUSPEND_RULES.maxDays

  return (
    <>
      <Hero c={c} crumb="Tạm ngưng" title="Tạm ngưng hợp đồng" subtitle={`Tạm dừng thuê kho ${c.unitCode} một thời gian, đồ vẫn được giữ trong kho.`} />
      <div className="container page-body">
        <ContractStrip c={c} unitType={unitType} />

        <ol className="journey">
          <li className={step > 1 ? 'done' : 'active'}><span>{step > 1 ? <Icon name="check" size={14} /> : 1}</span>Gửi đề nghị</li>
          <li className={step === 2 ? 'active' : step > 2 ? 'done' : 'later'}><span>{step > 2 ? <Icon name="check" size={14} /> : 2}</span>Nhân viên duyệt</li>
          <li className={step === 3 ? 'active' : 'later'}><span>3</span>Tạm ngưng có hiệu lực</li>
        </ol>

        {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}

        <div className="policy-layout">
          <div className="stack-lg">
            <section className="panel stack">
              <div><h2 className="panel-title">Thời gian tạm ngưng</h2><p className="muted">Từ {SUSPEND_RULES.minDays} đến {SUSPEND_RULES.maxDays} ngày, bắt đầu từ {fmtDate(first)} trở đi và kết thúc trước {fmtDate(c.endDate)}.</p></div>
              {!eligible && (
                <p className="alert warn"><Icon name="alert" size={16} />
                  {c.status !== 'Active' ? 'Chỉ hợp đồng đang hoạt động mới tạm ngưng được.'
                    : open ? `Hợp đồng đang có yêu cầu tạm ngưng (${SuspensionStatuses[open.status]?.label ?? open.status}).`
                    : 'Hợp đồng đang có yêu cầu gia hạn chờ thanh toán; hoàn tất gia hạn trước khi tạm ngưng.'}
                </p>
              )}
              <div className="segmented self-start">
                {lengths.map((k) => <button key={k} type="button" disabled={!eligible} className={n === k ? 'active' : ''} onClick={() => pickLength(k)}>{k} ngày</button>)}
              </div>
              <div className="form-grid">
                <label className="field"><span>Ngày bắt đầu *</span><input type="date" value={start} min={first} max={c.endDate} disabled={!eligible} onChange={(e) => { setStart(e.target.value); setMsg(null) }} /></label>
                <label className="field"><span>Ngày kết thúc *</span><input type="date" value={end} min={start} max={c.endDate} disabled={!eligible} onChange={(e) => { setEnd(e.target.value); setMsg(null) }} /></label>
              </div>
              <small className={nOk ? 'muted' : 'danger-text'}>Đang chọn <b>{n} ngày</b>{!nOk && ` · cần từ ${SUSPEND_RULES.minDays} đến ${SUSPEND_RULES.maxDays} ngày`}</small>
            </section>

            <section className="panel stack">
              <h2 className="panel-title">Lý do</h2>
              <div className="suspend-reasons">
                {REASONS.map((r) => <button key={r} type="button" disabled={!eligible} className={reason === r ? 'active' : ''} onClick={() => setReason(r)}>{r}</button>)}
              </div>
              <label className="field"><span>Ghi chú thêm{reason === 'Khác' ? ' *' : ' (không bắt buộc)'}</span>
                <textarea rows={3} maxLength={500} value={notes} disabled={!eligible} onChange={(e) => setNotes(e.target.value)} placeholder="vd: Đi công tác nước ngoài 2 tháng, cần giữ đồ trong kho" />
              </label>
            </section>

            {rows.length > 0 && (
              <section className="panel stack-sm">
                <h3 className="panel-title"><Icon name="history" size={18} className="cyan" /> Yêu cầu đã gửi</h3>
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
              </section>
            )}
          </div>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm quote-card">
              <h3 className="panel-title">Tóm tắt</h3>
              <div className="info-row"><span className="muted">Tạm ngưng</span><b>{fmtDate(start)} – {fmtDate(end)}</b></div>
              <div className="info-row"><span className="muted">Số ngày</span><b>{n} ngày</b></div>
              <div className="quote-total warn">
                <small>Phí giữ kho</small>
                <b>{fmtMoney(fee)}</b>
                <small>{SUSPEND_RULES.holdingPercent}% tiền thuê · thay cho tiền thuê các ngày tạm ngưng</small>
              </div>
              <div className="info-row"><span className="muted">Tiết kiệm so với tiền thuê</span><b className="ok-text">{fmtMoney(Math.max(0, saved))}</b></div>
              <div className="info-row"><span className="muted">Hết hạn mới</span><b>{fmtDate(newEnd)}</b></div>
              <ul className="suspend-impacts">
                <li><Icon name="lock" size={14} /> Không vào kho được trong thời gian tạm ngưng</li>
                <li><Icon name="wallet" size={14} /> Phí giữ kho thanh toán trước ngày bắt đầu</li>
                <li><Icon name="calendar" size={14} /> Hết hạn dời thêm {n} ngày, tiền cọc giữ nguyên</li>
              </ul>
              <label className="check-line">
                <input type="checkbox" checked={agree} disabled={!eligible} onChange={(e) => { setAgree(e.target.checked); setMsg(null) }} />
                <span>Tôi đồng ý với các điều trên.</span>
              </label>
              <button type="button" className="btn primary block" disabled={busy || !eligible} onClick={() => void submit()}>
                <Icon name="clock" size={16} /> {busy ? 'Đang gửi…' : 'Gửi đề nghị tạm ngưng'}
              </button>
              <Link to={`/my-units/${c.contractId}`} className="btn ghost block">Quay lại hợp đồng</Link>
              <Link to={`/my-units/${c.contractId}/policy?from=suspend`} className="link with-icon center-self"><Icon name="clipboard" size={14} /> Xem chính sách hợp đồng</Link>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}
