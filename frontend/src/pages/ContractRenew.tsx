import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Icon } from '../components/ui'
import type { Renewal } from '../types'
import { ContractStrip, Hero, Loading, useContract } from './ContractPolicy'
import { TERMS_VERSION } from './Terms'

/**
 * Figma "Gia hạn hợp đồng giữa kỳ" (96:10226): pick 1–12 more months, compare old and new end dates, read the renewal
 * policy and send the request (POST /api/contracts/{id}/renewals). The backend creates a RENEWAL invoice; the new end
 * date takes effect once it is paid. Early renewal is allowed any time while the contract is active.
 */

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
/** Same as .NET DateOnly.AddMonths: clamp to the last day of the month. */
function addMonths(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ContractRenew() {
  const id = Number(useParams().id)
  const { c, renewals, unitType, error, reload } = useContract(id)
  const [months, setMonths] = useState(3)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  if (!c) return <Loading error={error} />

  const pending = renewals.find((r) => r.status === 'Pending')
  const closesAt = new Date(`${c.endDate}T20:00:00`)
  const open = c.status === 'Active' && new Date() < closesAt
  const newEnd = addMonths(c.endDate, months)
  const fee = months * c.monthlyRentFee
  const step = pending ? 2 : 1

  const submit = async () => {
    if (!agree) return setMsg({ tone: 'bad', text: 'Vui lòng xác nhận đã đọc chính sách gia hạn' })
    setBusy(true)
    setMsg(null)
    try {
      const r = await api<Renewal>(`/api/contracts/${c.contractId}/renewals`, { body: { extensionMonths: months } })
      setMsg({ tone: 'ok', text: `Đã gửi yêu cầu gia hạn ${r.extensionMonths} tháng và tạo hóa đơn ${fmtMoney(r.renewalFee)}. Thanh toán để ngày hết hạn đổi thành ${fmtDate(r.newEndDate)}.` })
      setAgree(false)
      await reload()
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Hero c={c} crumb="Gia hạn" title="Gia hạn hợp đồng giữa kỳ" subtitle={`Chọn thời gian gia hạn cho hợp đồng ${c.contractNumber} bất cứ lúc nào khi hợp đồng còn hiệu lực.`} />
      <div className="container page-body">
        <ContractStrip c={c} unitType={unitType} />

        <ol className="journey">
          <li className={step > 1 ? 'done' : 'active'}><span>{step > 1 ? <Icon name="check" size={14} /> : 1}</span>Chọn thời gian</li>
          <li className={step === 2 ? 'active' : 'later'}><span>2</span>Thanh toán phí gia hạn</li>
          <li className="later"><span>3</span>Gia hạn có hiệu lực</li>
        </ol>

        {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}

        <div className="policy-layout">
          <div className="stack-lg">
            <section className="panel stack">
              <div><h2 className="panel-title">Thời gian muốn gia hạn</h2><p className="muted">Thời hạn mới cộng tiếp từ ngày hết hạn hiện tại, không mất ngày nào khi gia hạn sớm.</p></div>
              <div className="row between"><b>Số tháng gia hạn</b><span className="badge info">1 – 12 tháng</span></div>
              <div className="month-grid" role="radiogroup" aria-label="Số tháng gia hạn">
                {MONTHS.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={months === m} className={months === m ? 'active' : ''} disabled={!!pending || !open} onClick={() => setMonths(m)}>{m}</button>
                ))}
              </div>
              <div className="term-compare">
                <div><small className="muted">Hết hạn hiện tại</small><b>{fmtDate(c.endDate)}</b><small className="muted">Trả kho trước 20:00</small></div>
                <Icon name="arrowRight" size={20} />
                <div className="new"><small className="muted">Hết hạn sau gia hạn</small><b>{fmtDate(pending ? pending.newEndDate : newEnd)}</b><small className="muted">+{pending ? pending.extensionMonths : months} tháng</small></div>
              </div>
              <div className="notice info-notice">
                <span className="notice-icon info"><Icon name="calendar" size={16} /></span>
                <div><b>Gia hạn sớm được áp dụng</b><p>Có thể gửi bất cứ lúc nào khi hợp đồng còn hiệu lực, chậm nhất 20:00 ngày {fmtDate(c.endDate)}. Ngày hết hạn mới chỉ có hiệu lực sau khi hóa đơn gia hạn được thanh toán.</p></div>
              </div>
            </section>

            <section className="panel stack">
              <h2 className="panel-title">Xem chính sách & bước tiếp theo</h2>
              <div className="info-row"><span className="muted">Chính sách áp dụng</span><b>Điều khoản hợp đồng · phiên bản {TERMS_VERSION}</b></div>
              <Link to={`/my-units/${c.contractId}/policy`} className="btn outline self-start"><Icon name="clipboard" size={15} /> Xem policy hợp đồng</Link>
              <label className="check-line">
                <input type="checkbox" checked={agree} disabled={!!pending || !open} onChange={(e) => { setAgree(e.target.checked); setMsg(null) }} />
                <span>Tôi đã đọc chính sách gia hạn và đồng ý thanh toán phí gia hạn theo báo giá.</span>
              </label>
              <small className="muted">Sau khi gửi, hệ thống tạo hóa đơn gia hạn; thanh toán qua VNPay hoặc tại quầy.</small>
            </section>

            {renewals.length > 0 && (
              <section className="panel stack-sm">
                <h3 className="panel-title"><Icon name="history" size={18} className="cyan" /> Lịch sử gia hạn</h3>
                {renewals.map((r) => (
                  <div key={r.renewalId} className="info-row">
                    <span className="muted">{fmtTime(r.requestedAt)} · {r.extensionMonths} tháng · {fmtMoney(r.renewalFee)} · đến {fmtDate(r.newEndDate)}</span>
                    <span className={`badge ${r.status === 'Paid' ? 'ok' : r.status === 'Pending' ? 'warn' : 'muted'}`}>{r.status === 'Paid' ? 'Đã thanh toán' : r.status === 'Pending' ? 'Chờ thanh toán' : r.status === 'Rejected' ? 'Từ chối' : r.status}</span>
                  </div>
                ))}
              </section>
            )}
          </div>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm quote-card">
              <h3 className="panel-title">Báo giá gia hạn</h3>
              <span className={`badge ${pending ? 'warn' : 'info'} self-start`}>{pending ? 'Chờ thanh toán' : 'Bản nháp · chưa gửi'}</span>
              <div className="info-row"><span className="muted">Giá thuê tháng</span><b>{fmtMoney(c.monthlyRentFee)}</b></div>
              <div className="info-row"><span className="muted">Số tháng gia hạn</span><b>{pending ? pending.extensionMonths : months} tháng</b></div>
              <div className="info-row"><span className="muted">Từ ngày</span><b>{fmtDate(c.endDate)}</b></div>
              <div className="info-row"><span className="muted">Đến ngày</span><b>{fmtDate(pending ? pending.newEndDate : newEnd)}</b></div>
              <div className="info-row"><span className="muted">Hạn thanh toán</span><b>20:00 {fmtDate(c.endDate)}</b></div>
              <div className="quote-total">
                <small>Tổng phí gia hạn</small>
                <b>{fmtMoney(pending ? pending.renewalFee : fee)}</b>
                <small>{pending ? pending.extensionMonths : months} × {fmtMoney(c.monthlyRentFee)} · tiền cọc giữ nguyên {fmtMoney(c.depositPaid)}</small>
              </div>
              {pending ? (
                <Link to={pending.invoiceId ? `/invoices/${pending.invoiceId}` : '/invoices'} className="btn primary block"><Icon name="wallet" size={16} /> Thanh toán phí gia hạn</Link>
              ) : (
                <button type="button" className="btn primary block" disabled={busy || !open} onClick={() => void submit()}>
                  <Icon name="calendar" size={16} /> {busy ? 'Đang gửi…' : 'Gửi yêu cầu gia hạn'}
                </button>
              )}
              {!open && !pending && <small className="danger-text">Hợp đồng không còn trong thời gian được gia hạn.</small>}
              <Link to={`/my-units/${c.contractId}`} className="btn ghost block">Quay lại hợp đồng</Link>
            </section>
            <small className="muted">Cần hỗ trợ? <Link to={`/support?contract=${c.contractId}`} className="link">Gửi yêu cầu hỗ trợ</Link></small>
          </aside>
        </div>
      </div>
    </>
  )
}
