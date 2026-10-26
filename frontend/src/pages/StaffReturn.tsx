import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useStaffFacility } from '../components/layout'
import { FormField } from '../components/form'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { EarlyReturnQuote, EarlyReturnRequest, OverdueSummary, ReturnUnitResult, StaffContract } from '../types'
import { amountError, textError, transactionCodeError } from '../validation'

/**
 * Figma "storage-return-inspection": find a contract, check its return schedule and deposit,
 * walk the inspection checklist, complete the return (POST /api/contracts/{id}/return) and
 * refund the deposit (POST /api/contracts/{id}/deposit-refunds).
 * Before the end date the return is an early return: GET /api/contracts/{id}/early-return-quote shows the fee
 * and the deposit left, and the return is sent with earlyReturn and the customer's reason. Customers who asked to
 * return early from their contract page are listed from GET /api/contracts/facilities/{id}/early-return-requests.
 */

const CHECKLIST = [
  ['Kho đã được dọn sạch', 'Không còn đồ đạc, thùng hàng của khách bên trong kho'],
  ['Không còn rác thải', 'Khách đã mang đi bao bì, rác, vật dụng bỏ lại'],
  ['Tường, sàn, trần nguyên vẹn', 'Không trầy xước nặng, thủng, ẩm mốc do sử dụng'],
  ['Cửa và ổ khóa hoạt động tốt', 'Cửa đóng mở bình thường, khóa không hư hỏng'],
  ['Đã thu lại chìa khóa / thẻ', 'Khách bàn giao lại chìa khóa, thẻ ra vào (nếu có)'],
  ['Thiết bị điện đã tắt', 'Đèn, ổ cắm, điều hòa trong kho đã tắt'],
  ['Khách đã ra khỏi cơ sở', 'Không còn lượt ra vào đang mở của hợp đồng này'],
] as const

const sinceText = (from: Date) => {
  const ms = Date.now() - from.getTime()
  if (ms < 0) {
    const h = Math.ceil(-ms / 3600000)
    return h > 48 ? `Còn ${Math.ceil(h / 24)} ngày nữa mới đến lịch` : `Còn ${h} giờ nữa mới đến lịch`
  }
  const h = Math.floor(ms / 3600000)
  return h >= 48 ? `Đã quá lịch ${Math.floor(h / 24)} ngày` : `Đã quá lịch ${h} giờ ${Math.floor((ms % 3600000) / 60000)} phút`
}

export default function StaffReturn() {
  const { facilityId } = useStaffFacility()
  const navigate = useNavigate()
  const search = new URLSearchParams(useLocation().search)
  const wanted = Number(search.get('contract') ?? 0)

  const [contracts, setContracts] = useState<StaffContract[]>([])
  const [overdue, setOverdue] = useState<OverdueSummary[]>([])
  const [requests, setRequests] = useState<EarlyReturnRequest[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(wanted || null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      const [c, o] = await Promise.all([
        api<StaffContract[]>(`/api/contracts/facilities/${facilityId}`),
        api<OverdueSummary[]>(`/api/contracts/facilities/${facilityId}/overdue`),
      ])
      setContracts(c)
      setOverdue(o)
      // Customers' early-return requests: optional, the page works without them.
      api<EarlyReturnRequest[]>(`/api/contracts/facilities/${facilityId}/early-return-requests`).then(setRequests).catch(() => setRequests([]))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (wanted) setSelectedId(wanted) }, [wanted])

  const now = new Date()
  const due = contracts.filter((c) => (c.status === 'Active' || c.status === 'Overdue') && new Date(c.returnAppointment) <= now)
  const selected = contracts.find((c) => c.contractId === selectedId) ?? null
  const pick = (id: number) => { setSelectedId(id); navigate(`/staff-return?contract=${id}`, { replace: true }) }

  const find = (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    const s = query.trim().toLowerCase()
    if (!s) return
    const hit = contracts.find((c) => c.contractNumber.toLowerCase() === s || c.unitCode.toLowerCase() === s)
      ?? contracts.find((c) => [c.contractNumber, c.unitCode, c.customerName, c.customerPhone].some((v) => v.toLowerCase().includes(s)))
    if (!hit) return setError('Không tìm thấy hợp đồng tại cơ sở này. Thử mã hợp đồng, mã kho hoặc số điện thoại.')
    setSelectedId(hit.contractId)
    navigate(`/staff-return?contract=${hit.contractId}`, { replace: true })
  }

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Kiểm Tra Trả Kho</h1>
          <p className="muted">Đối chiếu hợp đồng, kiểm tra tình trạng kho, hoàn tất trả kho và hoàn cọc cho khách.</p>
        </div>
        <Link to="/staff-contracts" className="btn outline"><Icon name="clipboard" size={15} /> Danh sách gia hạn & quá hạn</Link>
      </div>

      <section className="panel">
        <div>
          <h2 className="panel-title">Tìm hợp đồng cần trả kho</h2>
          <p className="muted">Nhập mã hợp đồng, mã kho hoặc số điện thoại của khách. Trả trước 20:00 ngày hết hạn được tính là trả kho sớm.</p>
        </div>
        <form className="lookup-row" onSubmit={find}>
          <label className="field grow"><span>Mã hợp đồng / mã kho / SĐT</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="vd: HD-DEMO-0004 hoặc C-02" />
          </label>
          <button className="btn primary" type="submit"><Icon name="search" size={15} /> Tìm hợp đồng</button>
          <button className="btn outline" type="button" onClick={() => { setQuery(''); setSelectedId(null); navigate('/staff-return', { replace: true }) }}>Làm mới</button>
        </form>
        {due.length > 0 && (
          <div className="quick-tries">
            <span className="muted">Đến lịch trả kho:</span>
            {due.map((c) => (
              <button key={c.contractId} type="button" className={`chip ${c.contractId === selectedId ? 'active' : ''}`}
                onClick={() => pick(c.contractId)}>
                {c.contractNumber} · {c.unitCode}
              </button>
            ))}
          </div>
        )}
        {requests.length > 0 && (
          <div className="quick-tries">
            <span className="muted">Khách hẹn trả sớm:</span>
            {requests.map((r) => (
              <button key={r.requestId} type="button" className={`chip ${r.contractId === selectedId ? 'active' : ''}`} onClick={() => pick(r.contractId)}>
                {r.unitCode} · {r.customerName} · {fmtDate(r.returnDate)}
              </button>
            ))}
          </div>
        )}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      </section>

      {selected
        ? <Inspection key={selected.contractId} contract={selected} overdue={overdue.find((o) => o.contractId === selected.contractId)}
            request={requests.find((r) => r.contractId === selected.contractId)} onChanged={load} />
        : <div className="panel"><Empty icon="door">Chọn một hợp đồng để bắt đầu kiểm tra trả kho.</Empty></div>}
    </div>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="info-row"><span className="muted">{label}</span><b>{children}</b></div>
}

function Inspection({ contract: c, overdue, request, onChanged }: {
  contract: StaffContract; overdue?: OverdueSummary; request?: EarlyReturnRequest; onChanged: () => Promise<void>
}) {
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST.map(() => false))
  const [damage, setDamage] = useState('')
  const [staffNotes, setStaffNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<ReturnUnitResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Early return: the customer's reason, the quote from the API and the "customer was told" confirmation.
  const [reason, setReason] = useState(request?.reason ?? '')
  const [informed, setInformed] = useState(false)
  const [quote, setQuote] = useState<EarlyReturnQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const appointment = new Date(c.returnAppointment)
  const live = c.status === 'Active' || c.status === 'Overdue'
  const returned = c.status === 'Terminated' || !!result
  const early = !returned && live && appointment > new Date()
  useEffect(() => {
    if (!early) return
    api<EarlyReturnQuote>(`/api/contracts/${c.contractId}/early-return-quote`)
      .then((q) => { setQuote(q); setQuoteError('') })
      .catch(() => setQuoteError('Chưa tính được phí trả sớm; hệ thống áp dụng theo chính sách khi hoàn tất.'))
  }, [early, c.contractId])

  const earlyFee = result?.earlyReturnFee ?? (early ? quote?.earlyReturnFee ?? 0 : 0)
  const lateFee = result ? result.lateFeesDeducted + result.lateFeesStillOwed - (result.earlyReturnFee ?? 0) : overdue?.accumulatedLateFee ?? 0
  const charges = lateFee + earlyFee
  const deducted = result ? result.lateFeesDeducted : Math.min(c.depositPaid, charges)
  const refundDue = result ? result.depositRefundDue : Math.max(0, c.depositPaid - charges)
  const stillOwed = result ? result.lateFeesStillOwed : Math.max(0, charges - c.depositPaid)
  const allChecked = checked.every(Boolean)

  // Checked on submit and, once the staff member tried, live under each field.
  const errors = {
    reason: early ? textError(reason, 'Lý do trả sớm', 5, 500) : null,
    damage: textError(damage, 'Mô tả hư hỏng', 5, 1000, true),
    staffNotes: textError(staffNotes, 'Ghi chú', 0, 500, true),
  }
  const shown = (k: keyof typeof errors) => (showErrors ? errors[k] : null)
  const ready = allChecked && confirmed && (!early || informed)

  const complete = async () => {
    setError('')
    setShowErrors(true)
    if (Object.values(errors).some(Boolean)) return
    setBusy(true)
    try {
      const notes = [
        `Kiểm tra ${CHECKLIST.length}/${CHECKLIST.length} mục đạt.`,
        damage.trim() ? `Hư hỏng / ghi chú: ${damage.trim()}` : 'Không ghi nhận hư hỏng.',
        early ? `Trả kho sớm trước hạn ${fmtDate(c.endDate)}. Lý do: ${reason.trim()}` : '',
      ].filter(Boolean).join(' ')
      const res = await api<ReturnUnitResult>(`/api/contracts/${c.contractId}/return`, {
        body: {
          unitConditionNotes: notes, allItemsRemoved: true, staffNotes: staffNotes.trim() || null,
          ...(early ? { earlyReturn: true, earlyReturnReason: reason.trim() } : {}),
        },
      })
      setResult(res)
      await onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="summary-grid">
        <section className="panel">
          <h3 className="panel-title">Hợp đồng</h3>
          <div className="row between"><b className="contract-no sm">{c.contractNumber}</b><StatusBadge status={result ? result.status : c.status} /></div>
          <Info label="Khách hàng">{c.customerName}</Info>
          <Info label="Số điện thoại">{c.customerPhone}</Info>
          <Info label="Kho">{c.unitCode} · <StatusBadge status={result ? result.unitStatus : c.unitStatus} /></Info>
          <Info label="Thời hạn">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</Info>
        </section>
        <section className="panel">
          <h3 className="panel-title">Lịch trả kho</h3>
          <Info label="Ngày hết hạn">{fmtDate(c.endDate)}</Info>
          <Info label="Giờ hẹn trả kho">{fmtTime(c.returnAppointment)}</Info>
          <Info label="Khóa kho nếu chưa trả">{fmtTime(new Date(appointment.getTime() + 86400000).toISOString())}</Info>
          <Info label="Phí thuê tháng">{fmtMoney(c.monthlyRentFee)}</Info>
          <div className={`inspection-timer ${appointment <= new Date() ? (overdue ? 'bad' : 'ok') : 'muted'}`}>
            <Icon name="clock" size={16} />
            {returned ? `Đã trả kho${result ? ' lúc ' + fmtTime(result.returnedAt) : ''}` : early ? `${sinceText(appointment)} · trả lúc này là trả kho sớm` : sinceText(appointment)}
          </div>
        </section>
        <section className="panel">
          <h3 className="panel-title">Tiền cọc</h3>
          <Info label="Tiền cọc đã đóng">{fmtMoney(c.depositPaid)}</Info>
          <Info label="Phí quá hạn">{overdue ? `${fmtMoney(lateFee)} (${overdue.daysOverdue} ngày)` : fmtMoney(lateFee)}</Info>
          {(early || earlyFee > 0) && <Info label="Phí trả kho sớm">{quote || result ? fmtMoney(earlyFee) : 'Theo chính sách'}</Info>}
          <Info label="Cấn trừ vào cọc">{fmtMoney(deducted)}</Info>
          <Info label="Còn hoàn cho khách">{fmtMoney(refundDue)}</Info>
          <span className={`badge ${stillOwed > 0 ? 'bad' : refundDue > 0 ? 'info' : 'ok'} self-start`}>
            {stillOwed > 0 ? `Khách còn nợ ${fmtMoney(stillOwed)}` : refundDue > 0 ? 'Cần hoàn cọc sau trả kho' : 'Không còn khoản phải hoàn'}
          </span>
        </section>
      </div>

      <div className="inspection-grid">
        <section className="panel">
          <div>
            <h3 className="panel-title"><Icon name="clipboard" size={18} className="cyan" /> Danh mục kiểm tra kho {c.unitCode}</h3>
            <p className="muted">Đánh dấu từng mục sau khi kiểm tra cùng khách. Cần đạt đủ {CHECKLIST.length} mục mới hoàn tất trả kho.</p>
          </div>
          {CHECKLIST.map(([label, detail], i) => (
            <label key={label} className={`check-item ${checked[i] || returned ? 'done' : ''}`}>
              <input type="checkbox" checked={checked[i] || returned} disabled={returned}
                onChange={(e) => setChecked(checked.map((v, j) => (j === i ? e.target.checked : v)))} />
              <span className="grow"><b>{label}</b><small className="muted">{detail}</small></span>
              <span className={`badge ${checked[i] || returned ? 'ok' : 'muted'}`}>{checked[i] || returned ? 'Đạt' : 'Chưa kiểm tra'}</span>
            </label>
          ))}
          <FormField label={<b>Ghi nhận hư hỏng (nếu có)</b>} error={shown('damage')} className="damage-record">
            <textarea rows={3} maxLength={1000} value={damage} disabled={returned} onChange={(e) => setDamage(e.target.value)}
              aria-invalid={shown('damage') ? true : undefined} placeholder="Mô tả vị trí, mức độ hư hỏng… Để trống nếu kho bình thường." />
          </FormField>
        </section>

        <div className="stack-lg">
          <section className="panel">
            <div className="row between">
              <h3 className="panel-title">Biên bản trả kho</h3>
              <span className={`badge ${returned ? 'ok' : allChecked ? 'info' : 'warn'}`}>{returned ? 'Đã hoàn tất' : allChecked ? 'Sẵn sàng' : `${checked.filter(Boolean).length}/${CHECKLIST.length} mục`}</span>
            </div>
            <Info label="Kết quả kiểm tra">{returned ? 'Đạt' : allChecked ? 'Đạt đủ mục' : 'Đang kiểm tra'}</Info>
            <Info label="Hư hỏng">{damage.trim() ? 'Có ghi nhận' : 'Không'}</Info>
            <Info label="Phí quá hạn còn phải thu">{fmtMoney(stillOwed)}</Info>
            <FormField label="Ghi chú nhân viên" error={shown('staffNotes')}>
              <textarea rows={2} maxLength={500} value={staffNotes} disabled={returned} onChange={(e) => setStaffNotes(e.target.value)} placeholder="Không bắt buộc" />
            </FormField>
            {early && (
              <div className="early-return">
                <p className="alert warn"><Icon name="alert" size={16} />
                  Khách trả kho trước ngày hết hạn {fmtDate(c.endDate)}{quote ? ` (${quote.daysEarly} ngày)` : ''}. Tiền thuê đã trả không được hoàn
                  {quote?.invoicesCancelled ? `, ${quote.invoicesCancelled} hóa đơn tiền thuê chưa thanh toán sẽ được hủy` : ''}; phí trả sớm trừ vào cọc.
                </p>
                {request && <p className="hint"><Icon name="calendar" size={15} /> Khách đã gửi yêu cầu lúc {fmtTime(request.requestedAt)}, hẹn trả ngày {fmtDate(request.returnDate)}.</p>}
                {quoteError && <p className="hint"><Icon name="clock" size={15} /> {quoteError}</p>}
                <FormField label="Lý do trả sớm *" error={shown('reason')} hint={`${reason.trim().length}/500 ký tự`}>
                  <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                    aria-invalid={shown('reason') ? true : undefined} placeholder="vd: Khách chuyển nhà sớm, không cần lưu kho nữa" />
                </FormField>
                <label className="check-row"><input type="checkbox" checked={informed} onChange={(e) => setInformed(e.target.checked)} />
                  Đã báo khách: không hoàn tiền thuê còn lại, phí trả sớm {quote ? fmtMoney(quote.earlyReturnFee) + ' ' : ''}trừ vào cọc</label>
              </div>
            )}
            {!returned && live && (
              <>
                <label className="check-row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Tôi xác nhận đã kiểm tra kho cùng khách</label>
                {!allChecked && <p className="hint"><Icon name="clipboard" size={15} /> Đánh dấu đủ {CHECKLIST.length} mục kiểm tra để hoàn tất.</p>}
                <button className={`btn block ${early ? 'warn' : 'primary'}`} disabled={busy || !ready} onClick={complete}>
                  {busy ? 'Đang lưu…' : early ? 'Hoàn tất trả kho sớm' : 'Hoàn tất trả kho'}
                </button>
              </>
            )}
            {result && (
              <p className="alert ok"><Icon name="check" size={16} />
                Đã trả kho{result.earlyReturnFee ? ` sớm (phí ${fmtMoney(result.earlyReturnFee)})` : ''}. Cấn trừ {fmtMoney(result.lateFeesDeducted)}, cần hoàn {fmtMoney(result.depositRefundDue)}{result.lateFeesStillOwed > 0 ? `, đã lập hóa đơn phí còn nợ ${fmtMoney(result.lateFeesStillOwed)}` : ''}.
              </p>
            )}
            {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          </section>

          <RefundCard contract={c} returned={returned} refundDue={refundDue} />
        </div>
      </div>
    </>
  )
}

function RefundCard({ contract: c, returned, refundDue }: { contract: StaffContract; returned: boolean; refundDue: number }) {
  const [method, setMethod] = useState<'Cash' | 'BankTransfer'>('Cash')
  const [amount, setAmount] = useState(String(refundDue))
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  useEffect(() => { setAmount(String(remaining ?? refundDue)) }, [refundDue, remaining])

  const left = remaining ?? refundDue
  const refund = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const value = Number(amount)
    const invalid = (!Number.isInteger(value) && 'Số tiền hoàn phải là số nguyên (đồng)')
      || amountError(value, 'Số tiền hoàn', 1, left)
      || (method === 'BankTransfer' || code.trim() ? transactionCodeError(code) : null)
    if (invalid) { setError(invalid); return }
    setBusy(true)
    try {
      const res = await api<{ refundedAmount: number; remainingRefund: number; refundedAt: string }>(`/api/contracts/${c.contractId}/deposit-refunds`, {
        body: { paymentMethod: method, amount: Number(amount), transactionCode: code.trim() || null, notes: notes.trim() || null },
      })
      setRemaining(res.remainingRefund)
      setDone(`Đã hoàn ${fmtMoney(res.refundedAmount)} lúc ${fmtTime(res.refundedAt)}. Còn lại ${fmtMoney(res.remainingRefund)}.`)
      setConfirmed(false)
      setCode('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={refund}>
      <div className="row between">
        <h3 className="panel-title">Hoàn cọc</h3>
        <span className={`badge ${!returned ? 'muted' : left > 0 ? 'warn' : 'ok'}`}>{!returned ? 'Chờ trả kho' : left > 0 ? 'Chưa hoàn' : 'Đã hoàn đủ'}</span>
      </div>
      <Info label="Tiền cọc">{fmtMoney(c.depositPaid)}</Info>
      <Info label="Có thể hoàn">{fmtMoney(left)}</Info>
      <Info label="Hình thức">{method === 'Cash' ? 'Tiền mặt tại quầy' : 'Chuyển khoản'}</Info>
      {returned && left > 0 && (
        <>
          <div className="form-grid">
            <label className="field"><span>Hình thức hoàn</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="Cash">Tiền mặt</option>
                <option value="BankTransfer">Chuyển khoản</option>
              </select>
            </label>
            <label className="field"><span>Số tiền hoàn (đ)</span>
              <input type="number" min={1} max={left} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
          </div>
          {method === 'BankTransfer' && (
            <label className="field"><span>Mã giao dịch</span><input value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 50))} required placeholder="Mã chuyển khoản ngân hàng" /></label>
          )}
          <label className="field"><span>Ghi chú</span><input value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} placeholder="Không bắt buộc" /></label>
          <label className="check-row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Khách đã nhận đủ số tiền hoàn cọc</label>
          <div className="row">
            <button className="btn primary grow" type="submit" disabled={busy || !confirmed}>{busy ? 'Đang ghi nhận…' : 'Xác nhận hoàn cọc'}</button>
            <button className="btn outline" type="button" onClick={() => setAmount(String(left))}>Hoàn toàn bộ</button>
          </div>
        </>
      )}
      {!returned && <p className="hint"><Icon name="wallet" size={15} /> Hoàn cọc sau khi đã hoàn tất trả kho.</p>}
      {done && <p className="alert ok"><Icon name="check" size={16} />{done}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
    </form>
  )
}
