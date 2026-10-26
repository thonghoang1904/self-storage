import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Badge, Icon } from '../components/ui'
import type { EarlyReturnQuote, EarlyReturnRequest } from '../types'
import { ContractStrip, Hero, Loading, useContract } from './ContractPolicy'

/**
 * /my-units/:id/early-return — opened right after the customer sends "Gửi yêu cầu trả kho sớm".
 * Shows the request, the contract it ends, the early-return policy that applies and the expected cost
 * (GET /api/contracts/{id}/early-return-requests, GET .../early-return-quote?returnDate=). The customer can cancel
 * a pending request here (DELETE .../early-return-requests/{requestId}).
 */

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  Pending: { label: 'Chờ trả kho', tone: 'warn' },
  Completed: { label: 'Đã trả kho', tone: 'ok' },
  Cancelled: { label: 'Đã hủy', tone: 'muted' },
}

export default function ContractEarlyReturn() {
  const id = Number(useParams().id)
  const { user } = useAuth()
  const { c, facility, unitType, error: loadError } = useContract(id)
  const [requests, setRequests] = useState<EarlyReturnRequest[] | null>(null)
  const [quote, setQuote] = useState<EarlyReturnQuote | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api<EarlyReturnRequest[]>(`/api/contracts/${id}/early-return-requests`)
    .then(setRequests).catch((e) => { setRequests([]); setError((e as Error).message) }), [id])
  useEffect(() => { void load() }, [load])

  const request = requests?.find((r) => r.status === 'Pending') ?? requests?.[0] ?? null
  const pending = request?.status === 'Pending'
  useEffect(() => {
    if (!pending || !request) { setQuote(null); return }
    api<EarlyReturnQuote>(`/api/contracts/${id}/early-return-quote?returnDate=${request.returnDate}`).then(setQuote).catch(() => setQuote(null))
  }, [id, pending, request?.returnDate]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return <Loading error={loadError} />

  const cancel = async () => {
    if (!request || !window.confirm('Hủy yêu cầu trả kho sớm? Hợp đồng sẽ tiếp tục đến ngày hết hạn.')) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/contracts/${id}/early-return-requests/${request.requestId}`, { method: 'DELETE' })
      setNotice('Đã hủy yêu cầu trả kho sớm. Hợp đồng tiếp tục đến ngày hết hạn.')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const fee = quote?.earlyReturnFee ?? request?.earlyReturnFee ?? 0
  const step = !request ? 0 : request.status === 'Completed' ? 3 : request.status === 'Pending' ? 2 : 0
  const policy = [
    { icon: 'calendar', title: 'Ngày trả kho', text: `Trả kho trước ngày hết hạn ${fmtDate(c.endDate)} là trả sớm. Đến đúng ngày đã hẹn, trong giờ mở cửa${facility ? ` (${facility.operatingHours})` : ''}, chậm nhất 20:00.` },
    { icon: 'wallet', title: 'Tiền thuê đã trả', text: 'Tiền thuê của các kỳ đã thanh toán không được hoàn lại, kể cả khi chưa dùng hết kỳ.' },
    { icon: 'file', title: 'Hóa đơn kỳ sau', text: 'Hóa đơn tiền thuê chưa thanh toán của các kỳ bắt đầu từ ngày trả kho trở đi được hủy. Yêu cầu gia hạn đang chờ thanh toán cũng được hủy.' },
    { icon: 'shield', title: 'Phí trả kho sớm', text: `Phí trả kho sớm ${fmtMoney(fee)} được trừ vào tiền cọc ${fmtMoney(c.depositPaid)}. Nếu còn phí quá hạn, phí này cũng được trừ vào cọc; cọc không đủ thì hệ thống lập hóa đơn phần còn thiếu.` },
    { icon: 'package', title: 'Kiểm tra & dọn kho', text: 'Mang theo CCCD của chủ hợp đồng, dọn hết đồ ra khỏi kho. Nhân viên kiểm tra tường, sàn, cửa và khóa cùng bạn, ghi nhận hư hỏng nếu có.' },
    { icon: 'refresh', title: 'Hoàn cọc', text: 'Phần cọc còn lại được hoàn bằng tiền mặt hoặc chuyển khoản sau khi nhân viên xác nhận kho đạt. Ngày kết thúc hợp đồng đổi thành ngày trả kho thực tế.' },
    { icon: 'x', title: 'Hủy yêu cầu', text: 'Bạn có thể hủy yêu cầu khi nhân viên chưa nhận trả kho; hợp đồng tiếp tục đến ngày hết hạn như cũ.' },
  ]

  return (
    <>
      <Hero c={c} crumb="Trả kho sớm" title="Yêu cầu trả kho sớm"
        subtitle={pending ? `Đã gửi yêu cầu trả kho ${c.unitCode} ngày ${fmtDate(request!.returnDate)}. Xem lại hợp đồng và chính sách trả kho sớm trước khi đến.` : `Chính sách trả kho sớm của hợp đồng ${c.contractNumber}.`} />
      <div className="container page-body">
        <ol className="journey">
          <li className={step >= 2 ? 'done' : 'active'}><span>{step >= 2 ? <Icon name="check" size={14} /> : 1}</span>Gửi yêu cầu</li>
          <li className={step === 3 ? 'done' : step === 2 ? 'active' : 'later'}><span>{step === 3 ? <Icon name="check" size={14} /> : 2}</span>Đến trả kho & kiểm tra</li>
          <li className={step === 3 ? 'done' : 'later'}><span>{step === 3 ? <Icon name="check" size={14} /> : 3}</span>Hoàn cọc</li>
        </ol>

        {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        {requests && (
          <section className="panel policy-success">
            {pending ? (
              <div className="success-block">
                <span className="success-seal"><Icon name="check" size={34} /></span>
                <h2>Đã gửi yêu cầu trả kho sớm!</h2>
                <p className="muted">Hẹn trả kho <b>{c.unitCode}</b> ngày <b>{fmtDate(request!.returnDate)}</b> tại {c.facilityName}. Mang CCCD của {user?.fullName ?? 'chủ hợp đồng'} và dọn hết đồ trước khi nhân viên kiểm tra.</p>
              </div>
            ) : request?.status === 'Completed' ? (
              <div className="success-block">
                <span className="success-seal"><Icon name="check" size={34} /></span>
                <h2>Đã trả kho sớm</h2>
                <p className="muted">Kho {c.unitCode} đã được trả ngày {fmtDate(request.returnDate)}. Nhân viên hoàn phần cọc còn lại tại cơ sở.</p>
              </div>
            ) : (
              <div className="success-block">
                <p className="muted">{request ? 'Yêu cầu trả kho sớm gần nhất đã bị hủy.' : 'Chưa có yêu cầu trả kho sớm cho hợp đồng này.'}</p>
                {c.status === 'Active' && <Link to={`/my-units/${c.contractId}?return=early`} className="btn primary"><Icon name="logout" size={16} /> Gửi yêu cầu trả kho sớm</Link>}
              </div>
            )}
          </section>
        )}

        <ContractStrip c={c} unitType={unitType} />

        <div className="policy-layout">
          <div className="stack-lg">
            {request && (
              <section className="panel stack">
                <div className="row between"><h2 className="panel-title">Chi tiết yêu cầu</h2><Badge tone={STATUS[request.status]?.tone ?? 'muted'}>{STATUS[request.status]?.label ?? request.status}</Badge></div>
                <dl className="movein-grid">
                  <div><dt>Mã yêu cầu</dt><dd>#{request.requestId}</dd></div>
                  <div><dt>Gửi lúc</dt><dd>{fmtTime(request.requestedAt)}</dd></div>
                  <div><dt>Ngày hẹn trả kho</dt><dd>{fmtDate(request.returnDate)} · trước 20:00</dd></div>
                  <div><dt>Người gửi</dt><dd>{request.customerName}</dd></div>
                  <div className="span-2"><dt>Lý do trả sớm</dt><dd>{request.reason}</dd></div>
                </dl>
              </section>
            )}

            <section className="panel stack">
              <h2 className="panel-title">Chi tiết hợp đồng</h2>
              <dl className="movein-grid">
                <div><dt>Mã hợp đồng</dt><dd>{c.contractNumber}</dd></div>
                <div><dt>Chủ hợp đồng</dt><dd>{user?.fullName}</dd></div>
                <div><dt>Kho</dt><dd>{c.unitCode}{unitType && ` · ${unitType}`}</dd></div>
                <div><dt>Cơ sở</dt><dd>{c.facilityName}{facility && <small className="muted block">{facility.address}</small>}</dd></div>
                <div><dt>Ngày bắt đầu</dt><dd>{fmtDate(c.startDate)}</dd></div>
                <div><dt>Ngày hết hạn hiện tại</dt><dd>{fmtDate(c.endDate)}</dd></div>
                {pending && <div><dt>Ngày kết thúc sau khi trả sớm</dt><dd className="cyan">{fmtDate(request!.returnDate)}</dd></div>}
                {pending && quote && <div><dt>Trả sớm</dt><dd>{quote.daysEarly} ngày</dd></div>}
                <div><dt>Tiền thuê</dt><dd>{fmtMoney(c.monthlyRentFee)} / tháng</dd></div>
                <div><dt>Tiền cọc</dt><dd>{fmtMoney(c.depositPaid)}</dd></div>
              </dl>
            </section>

            <section className="panel stack">
              <div><h2 className="panel-title">Chính sách trả kho sớm</h2><p className="muted">Áp dụng cho hợp đồng {c.contractNumber}.</p></div>
              <ol className="early-rules">
                {policy.map((p) => (
                  <li key={p.title}>
                    <span className="notice-icon info"><Icon name={p.icon} size={16} /></span>
                    <div><b>{p.title}</b><p>{p.text}</p></div>
                  </li>
                ))}
              </ol>
              <Link to={`/my-units/${c.contractId}/policy?from=early-return`} className="link with-icon"><Icon name="clipboard" size={14} /> Xem toàn bộ điều khoản & chính sách hợp đồng</Link>
            </section>
          </div>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm quote-card">
              <h3 className="panel-title">Chi phí dự kiến</h3>
              {quote ? <>
                <div className="info-row"><span className="muted">Trả sớm</span><b>{quote.daysEarly} ngày</b></div>
                <div className="info-row"><span className="muted">Phí trả kho sớm</span><b>{fmtMoney(quote.earlyReturnFee)}</b></div>
                {quote.lateFees > 0 && <div className="info-row"><span className="muted">Phí quá hạn</span><b className="danger-text">{fmtMoney(quote.lateFees)}</b></div>}
                <div className="info-row"><span className="muted">Tiền cọc</span><b>{fmtMoney(quote.depositPaid)}</b></div>
                <div className="info-row"><span className="muted">Trừ vào cọc</span><b>− {fmtMoney(quote.depositDeducted)}</b></div>
                {quote.invoicesCancelled > 0 && <div className="info-row"><span className="muted">Hóa đơn tiền thuê được hủy</span><b>{quote.invoicesCancelled}</b></div>}
                <div className="quote-total">
                  <small>Dự kiến hoàn cọc</small>
                  <b>{fmtMoney(quote.depositRefundDue)}</b>
                  <small>{quote.amountStillOwed > 0 ? `Còn phải trả thêm ${fmtMoney(quote.amountStillOwed)}` : 'Không phải trả thêm'}</small>
                </div>
              </> : <>
                <div className="info-row"><span className="muted">Phí trả kho sớm</span><b>{fmtMoney(fee)}</b></div>
                <div className="info-row"><span className="muted">Tiền cọc</span><b>{fmtMoney(c.depositPaid)}</b></div>
                <small className="muted">Số tiền cụ thể nhân viên xác nhận khi bạn đến trả kho.</small>
              </>}
            </section>

            <section className="panel stack-sm">
              <h3 className="panel-title">Khi đến trả kho</h3>
              <ul className="check-list">
                <li><Icon name="check" size={14} /> CCCD của chủ hợp đồng</li>
                <li><Icon name="check" size={14} /> Dọn hết đồ, trả kho sạch</li>
                <li><Icon name="check" size={14} /> Đến trước 20:00 ngày hẹn</li>
                <li><Icon name="check" size={14} /> Số tài khoản nếu muốn hoàn cọc chuyển khoản</li>
              </ul>
              {facility && <small className="muted">{facility.address} · {facility.operatingHours} · {facility.hotline}</small>}
            </section>

            <section className="panel stack-sm">
              {pending && <button type="button" className="btn outline block danger-text" disabled={busy} onClick={() => void cancel()}><Icon name="x" size={15} /> {busy ? 'Đang hủy…' : 'Hủy yêu cầu trả kho sớm'}</button>}
              <button type="button" className="btn ghost block" onClick={() => window.print()}><Icon name="file" size={15} /> In / lưu PDF</button>
              <Link to={`/my-units/${c.contractId}`} className="btn primary block">Về hợp đồng</Link>
              <small className="muted">Cần hỗ trợ? <Link to={`/support?contract=${c.contractId}`} className="link">Gửi yêu cầu hỗ trợ</Link></small>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}
