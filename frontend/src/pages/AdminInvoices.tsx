import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { InvoiceView } from '../components/InvoiceView'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { Facility, Invoice } from '../types'

/**
 * System administrator: every invoice in the system (GET /api/admin/invoices), filtered by facility, status, type,
 * creation date and a free search (invoice, customer, contract, reservation, unit or transaction code).
 * Clicking a row loads that invoice (GET /api/admin/invoices/{id}) with its lines and payments.
 * The API pages by 50; "Trang sau" is offered while a full page came back.
 */

interface AdminInvoicePayment {
  paymentId: number
  paymentMethod: string
  transactionCode: string | null
  amountPaid: number
  paymentDate: string
  status: string
  paymentNotes: string | null
  receivedByStaffId: number | null
  receivedByStaffName: string | null
}
interface AdminInvoice {
  invoiceId: number
  invoiceNumber: string
  invoiceType: string
  status: string
  customerId: number
  customerName: string
  customerEmail: string
  customerPhoneNumber: string
  facilityId: number | null
  facilityName: string | null
  contractId: number | null
  contractNumber: string | null
  reservationId: number | null
  reservationCode: string | null
  unitCode: string | null
  subTotal: number
  discountAmount: number
  totalAmount: number
  paidAmount: number
  refundedAmount: number
  dueDate: string
  createdAt: string
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  collectedByStaffId: number | null
  collectedByStaffName: string | null
  details: Invoice['details']
  payments: AdminInvoicePayment[]
}

const PAGE = 50
const TYPES: Record<string, string> = {
  DEPOSIT: 'Tiền cọc', MONTHLY_RENT: 'Tiền thuê tháng', RENEWAL: 'Gia hạn', OVERDUE_FINE: 'Phí quá hạn', EXTRA_CHARGE: 'Phụ phí',
}
const STATUSES: Record<string, string> = { Unpaid: 'Chưa thanh toán', Paid: 'Đã thanh toán', Overdue: 'Quá hạn', Cancelled: 'Đã hủy' }

/** What the invoice belongs to, for the list and the dialog. */
function targetOf(i: AdminInvoice) {
  const doc = i.contractNumber ? `HĐ ${i.contractNumber}` : i.reservationCode ? `Đơn ${i.reservationCode}` : ''
  return [doc, i.unitCode && `kho ${i.unitCode}`].filter(Boolean).join(' · ')
}

export default function AdminInvoices() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminInvoice[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const badRange = !!from && !!to && from > to

  useEffect(() => { api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {}) }, [])

  const load = useCallback(() => {
    if (badRange) { setRows([]); return }
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE) })
    if (facilityId) p.set('facilityId', facilityId)
    if (status) p.set('status', status)
    if (type) p.set('invoiceType', type)
    if (from) p.set('from', `${from}T00:00:00`)
    if (to) p.set('to', `${to}T23:59:59`)
    if (search) p.set('search', search)
    setError('')
    api<AdminInvoice[]>(`/api/admin/invoices?${p}`).then(setRows).catch((e) => { setRows([]); setError((e as Error).message) })
  }, [facilityId, status, type, from, to, search, page, badRange])
  useEffect(() => { load() }, [load])
  // Search runs after typing stops so each key press is not a request.
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1) }, 400); return () => clearTimeout(t) }, [q])

  const shown = rows ?? []
  const total = shown.reduce((t, i) => t + i.totalAmount, 0)
  const paid = shown.reduce((t, i) => t + i.paidAmount, 0)
  const owing = shown.filter((i) => i.status === 'Unpaid' || i.status === 'Overdue').reduce((t, i) => t + Math.max(0, i.totalAmount - i.paidAmount), 0)
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Hóa Đơn</h1>
        <p className="muted">Mọi hóa đơn trong hệ thống: tiền cọc, tiền thuê, gia hạn, phụ phí và phí quá hạn.</p>
      </div>

      <section className="panel stack">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} maxLength={50} onChange={(e) => setQ(e.target.value)} placeholder="Số hóa đơn, khách hàng, hợp đồng, mã kho, mã giao dịch…" />
          </span>
          <Select value={facilityId} onChange={(e) => resetPage(setFacilityId)(e.target.value)} aria-label="Cơ sở">
            <option value="">Mọi cơ sở</option>
            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
          </Select>
          <Select value={type} onChange={(e) => resetPage(setType)(e.target.value)} aria-label="Loại hóa đơn">
            <option value="">Mọi loại</option>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="row"><span className="muted">Từ</span><input type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} /></label>
          <label className="row"><span className="muted">Đến</span><input type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} /></label>
        </div>
        {badRange && <p className="alert bad"><Icon name="alert" size={16} />Ngày bắt đầu không được sau ngày kết thúc.</p>}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        {rows !== null && rows.length > 0 && (
          <div className="invoice-sum">
            <span><small className="muted">Hóa đơn trên trang</small><b>{rows.length}</b></span>
            <span><small className="muted">Tổng giá trị</small><b>{fmtMoney(total)}</b></span>
            <span><small className="muted">Đã thu</small><b className="ok">{fmtMoney(paid)}</b></span>
            <span><small className="muted">Còn phải thu</small><b className={owing ? 'bad' : ''}>{fmtMoney(owing)}</b></span>
          </div>
        )}

        {rows === null ? <p className="muted">Đang tải…</p> : rows.length === 0 ? <Empty icon="file">Không có hóa đơn nào khớp bộ lọc.</Empty> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Hóa đơn</th><th>Khách hàng</th><th>Cơ sở / thuộc</th><th>Ngày lập</th><th>Hạn</th><th className="right">Tổng</th><th className="right">Đã thu</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.invoiceId} className="row-click" onClick={() => setOpenId(i.invoiceId)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(i.invoiceId) }}>
                    <td><b>{i.invoiceNumber}</b><br /><small className="muted">{TYPES[i.invoiceType] ?? i.invoiceType}</small></td>
                    <td>{i.customerName}<br /><small className="muted">{i.customerPhoneNumber}</small></td>
                    <td>{i.facilityName ?? '—'}<br /><small className="muted">{targetOf(i) || '—'}</small></td>
                    <td>{fmtDate(i.createdAt)}</td>
                    <td>{fmtDate(i.dueDate)}</td>
                    <td className="right"><b>{fmtMoney(i.totalAmount)}</b></td>
                    <td className="right">{fmtMoney(i.paidAmount)}{i.refundedAmount > 0 && <><br /><small className="muted">hoàn {fmtMoney(i.refundedAmount)}</small></>}</td>
                    <td><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(page > 1 || shown.length === PAGE) && (
          <div className="row end">
            <button className="btn ghost sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Trang trước</button>
            <span className="muted">Trang {page}</span>
            <button className="btn ghost sm" disabled={shown.length < PAGE} onClick={() => setPage(page + 1)}>Trang sau</button>
          </div>
        )}
      </section>

      {openId !== null && <InvoiceDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function InvoiceDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [inv, setInv] = useState<AdminInvoice | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<AdminInvoice>(`/api/admin/invoices/${id}`).then(setInv).catch((e) => setError((e as Error).message)) }, [id])

  // InvoiceView takes the customer-side shape; the admin DTO names the collector differently.
  const view: Invoice | null = inv && {
    ...inv,
    payments: inv.payments.map((p) => ({ ...p, receivedByStaff: p.receivedByStaffName })),
  }
  return (
    <Modal title={inv ? `Hóa đơn ${inv.invoiceNumber}` : 'Hóa đơn'} onClose={onClose} wide>
      {error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : !inv || !view ? <p className="muted">Đang tải…</p> : (
        <div className="stack">
          <InvoiceView invoice={view} customer={`${inv.customerName} · ${inv.customerPhoneNumber}`} target={[inv.facilityName, targetOf(inv)].filter(Boolean).join(' · ') || undefined} />
          <div className="info-box">
            <div className="info-row"><span className="muted">Email khách</span><b>{inv.customerEmail}</b></div>
            <div className="info-row"><span className="muted">Đã thu</span><b>{fmtMoney(inv.paidAmount)}</b></div>
            {inv.refundedAmount > 0 && <div className="info-row"><span className="muted">Đã hoàn cho khách</span><b>{fmtMoney(inv.refundedAmount)}</b></div>}
            {inv.collectedByStaffName && <div className="info-row"><span className="muted">Nhân viên thu</span><b>{inv.collectedByStaffName}</b></div>}
          </div>
        </div>
      )}
    </Modal>
  )
}
