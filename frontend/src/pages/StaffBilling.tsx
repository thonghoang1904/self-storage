import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { checkText, firstError, localToday, transactionCodeError } from '../validation'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { depositDueAt, depositMissed } from '../components/appointment'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { Invoice, Reservation, StaffContract } from '../types'
import { Select } from '../components/Select'

/**
 * Staff billing: invoices of the facility (GET /api/invoices/facilities/{id}) and recording a cash or
 * bank-transfer payment actually received (POST /api/invoices/{id}/payments). Paying a deposit invoice
 * confirms the reservation; paying a renewal invoice extends the contract (handled by the API).
 * Same layout family as the Figma "renewals-overdue" screen.
 */

const TYPE_LABEL: Record<string, string> = {
  DEPOSIT: 'Tiền cọc', RENEWAL: 'Gia hạn', MONTHLY_RENT: 'Tiền thuê', OVERDUE_FINE: 'Phí quá hạn',
}
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t
const PAGE_SIZE = 8

export default function StaffBilling() {
  const { facilityId } = useStaffFacility()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [contracts, setContracts] = useState<StaffContract[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'due' | 'Unpaid' | 'Overdue' | 'Paid' | 'Cancelled' | 'all'>('due')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      const [i, c, r] = await Promise.all([
        api<Invoice[]>(`/api/invoices/facilities/${facilityId}`),
        api<StaffContract[]>(`/api/contracts/facilities/${facilityId}`).catch(() => []),
        api<Reservation[]>(`/api/facilities/${facilityId}/reservations`).catch(() => []),
      ])
      setInvoices(i)
      setContracts(c)
      setReservations(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  /** Who and what an invoice is for, from the contract or reservation it belongs to. */
  const ref = useCallback((inv: Invoice) => {
    const c = inv.contractId ? contracts.find((x) => x.contractId === inv.contractId) : undefined
    const r = inv.reservationId ? reservations.find((x) => x.reservationId === inv.reservationId) : undefined
    return {
      customer: c?.customerName ?? r?.customerName ?? '—',
      phone: c?.customerPhone ?? '',
      target: c ? `HĐ ${c.contractNumber} · Kho ${c.unitCode}` : r ? `Đơn ${r.reservationCode}` : '',
    }
  }, [contracts, reservations])

  const shown = useMemo(() => invoices
    .filter((i) => status === 'all' ? true : status === 'due' ? i.status === 'Unpaid' || i.status === 'Overdue' : i.status === status)
    .filter((i) => type === 'all' || i.invoiceType === type)
    .filter((i) => {
      const s = q.trim().toLowerCase()
      if (!s) return true
      const r = ref(i)
      return [i.invoiceNumber, r.customer, r.phone, r.target].some((v) => v.toLowerCase().includes(s))
    }), [invoices, status, type, q, ref])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const due = invoices.filter((i) => i.status === 'Unpaid' || i.status === 'Overdue')
  const today = localToday()
  const paidToday = invoices.flatMap((i) => i.payments).filter((p) => p.status === 'Success' && p.paymentDate.slice(0, 10) === today)

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Hóa Đơn & Thu Tiền</h1>
          <p className="muted">Xem hóa đơn của cơ sở, ghi nhận tiền mặt hoặc chuyển khoản khách đã trả tại quầy.</p>
        </div>
        <button className="btn outline" onClick={() => void load()}><Icon name="refresh" size={15} /> Làm mới</button>
      </div>

      <div className="stat-grid">
        <Metric icon="wallet" tone="warn" label="Chờ thanh toán" value={String(due.length)} note={`${fmtMoney(due.reduce((s, i) => s + i.totalAmount, 0))} cần thu`} />
        <Metric icon="alert" tone="bad" label="Quá hạn thanh toán" value={String(invoices.filter((i) => i.status === 'Overdue').length)} note="cần nhắc khách" />
        <Metric icon="check" tone="ok" label="Đã thu hôm nay" value={String(paidToday.length)} note={fmtMoney(paidToday.reduce((s, p) => s + p.amountPaid, 0))} />
        <Metric icon="refresh" tone="info" label="Hóa đơn gia hạn chờ thu" value={String(due.filter((i) => i.invoiceType === 'RENEWAL').length)} note="thu xong là tự gia hạn" />
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Tìm số hóa đơn, khách hàng, mã HĐ / đơn…" />
          </span>
          <Select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1) }}>
            <option value="due">Chờ thanh toán</option>
            <option value="Unpaid">Chưa thanh toán</option>
            <option value="Overdue">Quá hạn</option>
            <option value="Paid">Đã thanh toán</option>
            <option value="Cancelled">Đã hủy</option>
            <option value="all">Tất cả trạng thái</option>
          </Select>
          <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
            <option value="all">Mọi loại hóa đơn</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <button className="btn ghost" onClick={() => { setQ(''); setStatus('due'); setType('all'); setPage(1) }}><Icon name="x" size={15} /> Xóa bộ lọc</button>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <section className="panel">
        <div>
          <h2 className="panel-title">Danh sách hóa đơn</h2>
          <p className="muted">Chỉ ghi nhận khi đã nhận đủ tiền thực tế. Hóa đơn đang có giao dịch trực tuyến chờ xác nhận sẽ bị từ chối ghi nhận.</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Số hóa đơn</th><th>Khách hàng</th><th>Nội dung</th><th>Hạn thanh toán</th><th>Số tiền</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
            <tbody>
              {pageRows.map((inv) => {
                const r = ref(inv)
                // A deposit can no longer be taken once its reservation is past the deposit time (the API refuses).
                const reservation = inv.invoiceType === 'DEPOSIT' && inv.reservationId ? reservations.find((x) => x.reservationId === inv.reservationId) : undefined
                const lateDeposit = !!reservation && depositMissed(reservation)
                const payable = (inv.status === 'Unpaid' || inv.status === 'Overdue') && !lateDeposit
                const paid = inv.payments.find((p) => p.status === 'Success')
                return (
                  <tr key={inv.invoiceId}>
                    <td className="code">{inv.invoiceNumber}<br /><small className="muted">{typeLabel(inv.invoiceType)}</small></td>
                    <td><b>{r.customer}</b>{r.phone && <><br /><small className="muted">{r.phone}</small></>}</td>
                    <td>{inv.details[0]?.description ?? '—'}{r.target && <><br /><small className="muted">{r.target}</small></>}</td>
                    <td>{reservation && reservation.status === 'PendingDeposit' ? fmtTime(depositDueAt(reservation)) : fmtDate(inv.dueDate)}</td>
                    <td className="money">{fmtMoney(inv.totalAmount)}</td>
                    <td><StatusBadge status={inv.status} />{paid && <><br /><small className="muted">{paid.paymentMethod === 'Cash' ? 'Tiền mặt' : paid.paymentMethod} · {fmtTime(paid.paymentDate)}</small></>}</td>
                    <td className="right">
                      {payable
                        ? <button className="btn primary sm" onClick={() => setOpenId(openId === inv.invoiceId ? null : inv.invoiceId)}><Icon name="wallet" size={14} /> Ghi nhận thu tiền</button>
                        : lateDeposit ? <small className="danger-text">Quá hạn cọc, khách cần đặt lại</small> : <small className="muted">—</small>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {pageRows.length === 0 && <Empty icon="wallet">Không có hóa đơn nào khớp bộ lọc.</Empty>}
        </div>
        {openId && (() => {
          const inv = invoices.find((i) => i.invoiceId === openId)
          return inv ? <PaymentForm key={inv.invoiceId} invoice={inv} customer={ref(inv).customer} onCancel={() => setOpenId(null)}
            onDone={async (msg) => { setOpenId(null); setError(''); setNotice(msg); await load() }} /> : null
        })()}
        <div className="row between wrap">
          <small className="muted">Hiển thị {pageRows.length} / {shown.length} hóa đơn</small>
          <div className="pager">
            <button className="icon-btn" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Trang trước"><Icon name="arrowRight" size={14} className="flip" /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} className={p === current ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="icon-btn" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Trang sau"><Icon name="arrowRight" size={14} /></button>
          </div>
        </div>
      </section>

      <div className="panel collection-note">
        <div>
          <b>Sau khi ghi nhận</b>
          <p className="muted">Hóa đơn cọc đã thu → đơn đặt kho chuyển "Chờ bàn giao kho". Hóa đơn gia hạn đã thu → hợp đồng tự gia hạn đến ngày mới.</p>
        </div>
      </div>
    </div>
  )
}

function Metric({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: string; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

function PaymentForm({ invoice: inv, customer, onCancel, onDone }: { invoice: Invoice; customer: string; onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const [method, setMethod] = useState<'Cash' | 'BankTransfer'>('Cash')
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = firstError(
      checkText(notes, 'Ghi chú', 255, true),
      confirmed ? '' : `Vui lòng xác nhận đã nhận đủ ${fmtMoney(inv.totalAmount)}`,
    )
    if (problem) return setError(problem)
    setError('')
    // A bank transfer needs its reference to reconcile; cash may carry an optional receipt number.
    const invalid = method === 'BankTransfer' || code.trim() ? transactionCodeError(code) : null
    if (invalid) { setError(invalid); return }
    setBusy(true)
    try {
      await api(`/api/invoices/${inv.invoiceId}/payments`, {
        body: { paymentMethod: method, amountPaid: inv.totalAmount, transactionCode: code.trim() || null, paymentNotes: notes.trim() || null },
      })
      await onDone(`Đã ghi nhận ${fmtMoney(inv.totalAmount)} cho hóa đơn ${inv.invoiceNumber} (${typeLabel(inv.invoiceType).toLowerCase()}).`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="add-person" onSubmit={submit}>
      <h3 className="panel-title"><Icon name="wallet" size={18} className="cyan" /> Ghi nhận thu tiền · {inv.invoiceNumber}</h3>
      <p className="muted">Khách {customer} · {inv.details[0]?.description} · Số tiền phải thu đúng <b>{fmtMoney(inv.totalAmount)}</b>.</p>
      <div className="form-grid">
        <label className="field"><span>Hình thức</span>
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="Cash">Tiền mặt tại quầy</option>
            <option value="BankTransfer">Chuyển khoản</option>
          </Select>
        </label>
        <label className="field"><span>Mã giao dịch {method === 'BankTransfer' ? '' : '(không bắt buộc)'}</span>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 50))} required={method === 'BankTransfer'} placeholder={method === 'BankTransfer' ? 'Mã chuyển khoản ngân hàng' : ''} />
        </label>
      </div>
      <label className="field"><span>Ghi chú</span><input value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} placeholder="Không bắt buộc" /></label>
      <label className="check-row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Tôi đã nhận đủ {fmtMoney(inv.totalAmount)} từ khách</label>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={busy || !confirmed}>{busy ? 'Đang ghi nhận…' : 'Xác nhận đã thu'}</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  )
}
