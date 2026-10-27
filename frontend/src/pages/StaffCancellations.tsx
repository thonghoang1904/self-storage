import { useCallback, useEffect, useState } from 'react'
import { amountError, transactionCodeError } from '../validation'
import { api, fmtMoney, fmtTime } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon } from '../components/ui'
import { CancellationStatuses, type CancellationRefund, type CancellationRequest, type Invoice } from '../types'

/**
 * Reservation cancellations at the facility (#43): customers ask to cancel a reservation not yet handed over,
 * staff approve or reject (POST /api/facilities/{id}/cancellation-requests/{requestId}/resolve). Approving cancels
 * the reservation; a paid deposit is refunded minus the cancellation fee of the rental policy, recorded here once
 * the money is handed back (POST /api/reservations/{id}/cancellation-refunds).
 */

const TABS = [
  { value: 'Pending', label: 'Chờ duyệt' },
  { value: 'Approved', label: 'Đã duyệt' },
  { value: 'Rejected', label: 'Từ chối' },
  { value: '', label: 'Tất cả' },
]

export default function StaffCancellations() {
  const { facilityId } = useStaffFacility()
  const [tab, setTab] = useState('Pending')
  const [items, setItems] = useState<CancellationRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  /** Deposit already refunded per reservation, from the Refunded payments on its deposit invoice. */
  const [refunded, setRefunded] = useState<Record<number, number>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      const [all, invoices] = await Promise.all([
        api<CancellationRequest[]>(`/api/facilities/${facilityId}/cancellation-requests`),
        api<Invoice[]>(`/api/invoices/facilities/${facilityId}`).catch(() => [] as Invoice[]),
      ])
      setRefunded(Object.fromEntries(invoices.filter((i) => i.invoiceType === 'DEPOSIT' && i.reservationId != null)
        .map((i) => [i.reservationId!, i.payments.filter((p) => p.status === 'Refunded').reduce((n, p) => n + p.amountPaid, 0)])))
      setPendingCount(all.filter((c) => c.status === 'Pending').length)
      setItems(tab ? all.filter((c) => c.status === tab) : all)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId, tab])
  useEffect(() => { void load() }, [load])

  const done = async (msg: string) => { await load(); setError(''); setNotice(msg) }

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Yêu Cầu Hủy Đặt Kho</h1>
        <p className="muted">Duyệt yêu cầu hủy của khách và ghi nhận tiền cọc đã hoàn lại.</p>
      </div>

      <div className="panel filter-bar">
        <div className="segmented" role="tablist">
          {TABS.map((t) => (
            <button key={t.value} className={tab === t.value ? 'active' : ''} onClick={() => { setTab(t.value); setNotice('') }}>
              {t.label}{t.value === 'Pending' && pendingCount > 0 && <span className="count-pill">{pendingCount}</span>}
            </button>
          ))}
        </div>
        <small className="muted">Phí hủy theo chính sách thuê của cơ sở, trừ vào số cọc khách đã trả.</small>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stack">
        {items.map((c) => (
          <CancellationCard key={c.cancellationRequestId} request={c} facilityId={facilityId!}
            remaining={c.approvedRefundAmount != null ? c.approvedRefundAmount - (refunded[c.reservationId] ?? 0) : undefined}
            onResolved={(r) => void done(r.status === 'Approved'
              ? `Đã duyệt hủy ${r.reservationCode}.${r.approvedRefundAmount ? ` Cần hoàn cọc ${fmtMoney(r.approvedRefundAmount)}.` : ' Không có cọc cần hoàn.'}`
              : `Đã từ chối yêu cầu hủy ${r.reservationCode}.`)}
            onRefunded={(f) => { void done(`Đã ghi nhận hoàn ${fmtMoney(f.refundedAmount)}${f.remainingRefund > 0 ? `, còn ${fmtMoney(f.remainingRefund)} chưa hoàn` : ', đã hoàn đủ'}.`) }}
            onError={setError} />
        ))}
        {items.length === 0 && <div className="panel"><Empty icon="clipboard">{tab === 'Pending' ? 'Không có yêu cầu hủy nào chờ duyệt.' : 'Không có yêu cầu nào.'}</Empty></div>}
      </div>
    </div>
  )
}

function CancellationCard({ request: c, facilityId, remaining, onResolved, onRefunded, onError }: {
  request: CancellationRequest
  facilityId: number
  remaining?: number
  onResolved: (r: CancellationRequest) => void
  onRefunded: (f: CancellationRefund) => void
  onError: (m: string) => void
}) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const st = CancellationStatuses[c.status] ?? { label: c.status, tone: 'muted' as const }
  const owed = remaining ?? c.approvedRefundAmount ?? 0

  const resolve = async (approve: boolean) => {
    // A rejection must tell the customer why.
    if (!approve && notes.trim().length < 5) return onError('Từ chối hủy cần ghi rõ lý do cho khách (ít nhất 5 ký tự)')
    onError('')
    setBusy(true)
    try {
      onResolved(await api<CancellationRequest>(`/api/facilities/${facilityId}/cancellation-requests/${c.cancellationRequestId}/resolve`, {
        body: { approve, notes: notes.trim() || null },
      }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel cancel-card">
      <div className="panel-head wrap">
        <div>
          <h3 className="panel-title">{c.reservationCode} <span className={`badge ${st.tone}`}>{st.label}</span></h3>
          <p className="muted">{c.customerName} · gửi lúc {fmtTime(c.requestedAt)}</p>
        </div>
        {c.status === 'Approved' && (
          <div className="right">
            <small className="muted">Cọc được hoàn</small>
            <b className="cancel-amount">{fmtMoney(c.approvedRefundAmount ?? 0)}</b>
          </div>
        )}
      </div>
      <blockquote className="cancel-reason"><Icon name="clipboard" size={14} /> {c.reason}</blockquote>

      {c.status === 'Pending' && (
        <div className="row wrap">
          <input className="grow" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú cho khách (bắt buộc khi từ chối)" />
          <button className="btn ghost danger-text" disabled={busy} onClick={() => resolve(false)}>Từ chối</button>
          <button className="btn primary" disabled={busy} onClick={() => resolve(true)}><Icon name="check" size={15} /> Duyệt hủy</button>
        </div>
      )}

      {c.status !== 'Pending' && (
        <p className="muted">
          {c.resolvedAt && `Xử lý lúc ${fmtTime(c.resolvedAt)}`}{c.resolutionNotes && ` · ${c.resolutionNotes}`}
        </p>
      )}

      {c.status === 'Approved' && (c.approvedRefundAmount ?? 0) > 0 && (
        owed <= 0 ? <p className="ok-text"><Icon name="check" size={14} /> Đã hoàn đủ tiền cọc.</p>
        : refundOpen ? <RefundForm reservationId={c.reservationId} max={owed} onDone={(f) => { setRefundOpen(false); if (f) onRefunded(f) }} onError={onError} />
        : <div className="row"><button className="btn outline sm" onClick={() => setRefundOpen(true)}><Icon name="wallet" size={14} /> Ghi nhận hoàn cọc</button></div>
      )}
    </section>
  )
}

function RefundForm({ reservationId, max, onDone, onError }: { reservationId: number; max: number; onDone: (f: CancellationRefund | null) => void; onError: (m: string) => void }) {
  const [amount, setAmount] = useState(max)
  const [method, setMethod] = useState<'Cash' | 'BankTransfer'>('Cash')
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const invalid = (!Number.isInteger(amount) && 'Số tiền hoàn phải là số nguyên (đồng)')
      || amountError(amount, 'Số tiền hoàn', 1, max)
      || (method === 'BankTransfer' || code.trim() ? transactionCodeError(code) : null)
    if (invalid) { onError(invalid); return }
    onError('')
    setBusy(true)
    try {
      onDone(await api<CancellationRefund>(`/api/reservations/${reservationId}/cancellation-refunds`, {
        body: { amount, paymentMethod: method, transactionCode: code.trim() || null, notes: notes.trim() || null },
      }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="charge-form">
      <div className="form-grid four">
        <label className="field"><span>Số tiền hoàn</span>
          <input type="number" min={1} max={max} step={1000} value={amount || ''} onChange={(e) => setAmount(Math.round(Number(e.target.value) || 0))} />
        </label>
        <label className="field"><span>Hình thức</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as 'Cash' | 'BankTransfer')}>
            <option value="Cash">Tiền mặt</option>
            <option value="BankTransfer">Chuyển khoản</option>
          </select>
        </label>
        <label className="field"><span>Mã giao dịch{method === 'BankTransfer' ? ' *' : ''}</span>
          <input value={code} maxLength={50} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 50))} placeholder={method === 'BankTransfer' ? 'Bắt buộc khi chuyển khoản' : 'Không bắt buộc'} />
        </label>
        <label className="field"><span>Ghi chú</span>
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="row end">
        <button type="button" className="btn ghost sm" onClick={() => onDone(null)}>Hủy</button>
        <button type="button" className="btn primary sm" disabled={busy || amount <= 0} onClick={submit}>{busy ? 'Đang ghi nhận…' : `Đã hoàn ${fmtMoney(amount)}`}</button>
      </div>
    </div>
  )
}
