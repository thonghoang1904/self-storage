import { useCallback, useEffect, useState } from 'react'
import { api, fmtMoney, fmtTime } from '../api'
import { Select } from '../components/Select'
import { Empty, Icon } from '../components/ui'

/**
 * Admin "Giao dịch & nhật ký": system counters (GET /api/admin/dashboard), every payment for reconciling with
 * VNPay/MoMo statements (GET /api/admin/payments) and the activity log (GET /api/admin/activity-logs).
 * Both lists are paged by the API (50 a page); "Trang sau" is offered while a full page came back.
 */

interface Dashboard {
  generatedAt: string
  totalUsers: number
  activeUsers: number
  facilities: number
  totalUnits: number
  availableUnits: number
  rentedUnits: number
  activeContracts: number
  overdueContracts: number
  openSupportRequests: number
  pendingPayments: number
  pendingEmails: number
  failedEmails: number
  revenueThisMonth: number
}
interface AdminPayment {
  paymentId: number
  invoiceId: number
  invoiceNumber: string
  customerId: number
  customerName: string
  paymentMethod: string
  status: string
  amountPaid: number
  paymentDate: string
  transactionCode: string | null
}
interface ActivityLog {
  logId: number
  userId: number | null
  username: string | null
  action: string
  details: string | null
  ipAddress: string | null
  createdAt: string
}

const PAGE = 50
const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  Pending: { label: 'Đang chờ', tone: 'warn' },
  Success: { label: 'Thành công', tone: 'ok' },
  Failed: { label: 'Thất bại', tone: 'bad' },
  Refunded: { label: 'Đã hoàn (hủy đặt kho)', tone: 'muted' },
  RefundDue: { label: 'Chờ hoàn tiền', tone: 'bad' },
  Reversed: { label: 'Đã hoàn cho khách', tone: 'muted' },
}
const METHODS: Record<string, string> = {
  VNPay: 'VNPay', MoMo: 'MoMo', BankTransfer: 'Chuyển khoản', Cash: 'Tiền mặt', CreditCard: 'Thẻ', DepositOffset: 'Cấn trừ cọc',
}

export default function AdminSystem() {
  const [tab, setTab] = useState<'payments' | 'logs'>('payments')
  const [dash, setDash] = useState<Dashboard | null>(null)
  useEffect(() => { api<Dashboard>('/api/admin/dashboard').then(setDash).catch(() => setDash(null)) }, [])

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Giao Dịch & Nhật Ký</h1>
        <p className="muted">Đối soát mọi giao dịch thanh toán và xem lại thao tác trong hệ thống.</p>
      </div>
      {dash && (
        <div className="stat-grid">
          <Stat icon="wallet" tone="ok" label="Doanh thu tháng này" value={fmtMoney(dash.revenueThisMonth)} note="đã trừ khoản hoàn, không tính cấn trừ cọc" />
          <Stat icon="clock" tone="warn" label="Giao dịch đang chờ" value={String(dash.pendingPayments)} note="chờ cổng thanh toán xác nhận" />
          <Stat icon="file" tone="info" label="Hợp đồng" value={`${dash.activeContracts} hiệu lực`} note={`${dash.overdueContracts} quá hạn`} />
          <Stat icon="building" tone="info" label="Kho" value={`${dash.rentedUnits}/${dash.totalUnits} đang thuê`} note={`${dash.availableUnits} trống · ${dash.facilities} cơ sở`} />
          <Stat icon="phone" tone="warn" label="Yêu cầu hỗ trợ mở" value={String(dash.openSupportRequests)} note="mới gửi hoặc đang xử lý" />
          <Stat icon="users" tone="info" label="Tài khoản" value={`${dash.activeUsers}/${dash.totalUsers}`} note="đang hoạt động" />
          <Stat icon="mail" tone={dash.failedEmails ? 'bad' : 'ok'} label="Email" value={`${dash.pendingEmails} chờ gửi`} note={`${dash.failedEmails} gửi lỗi`} />
        </div>
      )}
      <section className="panel stack">
        <div className="tabs">
          <button className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}><Icon name="wallet" size={16} /> Giao dịch</button>
          <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}><Icon name="history" size={16} /> Nhật ký hoạt động</button>
        </div>
        {tab === 'payments' ? <Payments /> : <Logs />}
      </section>
    </div>
  )
}

function Stat({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: string; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

function Paging({ page, more, onPage }: { page: number; more: boolean; onPage: (p: number) => void }) {
  if (page === 1 && !more) return null
  return (
    <div className="row end">
      <button className="btn ghost sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Trang trước</button>
      <span className="muted">Trang {page}</span>
      <button className="btn ghost sm" disabled={!more} onClick={() => onPage(page + 1)}>Trang sau</button>
    </div>
  )
}

function Payments() {
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminPayment[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE) })
    if (status) p.set('status', status)
    if (method) p.set('method', method)
    if (search) p.set('search', search)
    setError('')
    api<AdminPayment[]>(`/api/admin/payments?${p}`).then(setRows).catch((e) => { setRows([]); setError((e as Error).message) })
  }, [status, method, search, page])
  useEffect(() => { load() }, [load])
  // Search runs after typing stops so each key press is not a request.
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1) }, 400); return () => clearTimeout(t) }, [q])

  return (
    <>
      <div className="filter-controls">
        <span className="input-wrap grow-2">
          <Icon name="search" size={16} className="input-lead" />
          <input value={q} maxLength={50} onChange={(e) => setQ(e.target.value)} placeholder="Số hóa đơn hoặc mã giao dịch…" />
        </span>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {Object.entries(PAY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1) }} aria-label="Phương thức">
          <option value="">Mọi phương thức</option>
          {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {rows === null ? <p className="muted">Đang tải…</p> : rows.length === 0 ? <Empty icon="wallet">Không có giao dịch nào khớp bộ lọc.</Empty> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Thời gian</th><th>Hóa đơn</th><th>Khách hàng</th><th>Phương thức</th><th className="right">Số tiền</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const st = PAY_STATUS[p.status] ?? { label: p.status, tone: 'muted' }
                return (
                  <tr key={p.paymentId}>
                    <td>{fmtTime(p.paymentDate)}</td>
                    <td><b>{p.invoiceNumber}</b>{p.transactionCode && <><br /><small className="muted code">{p.transactionCode}</small></>}</td>
                    <td>{p.customerName}</td>
                    <td>{METHODS[p.paymentMethod] ?? p.paymentMethod}</td>
                    <td className="right"><b>{fmtMoney(p.amountPaid)}</b></td>
                    <td><span className={`badge ${st.tone}`}>{st.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Paging page={page} more={(rows?.length ?? 0) === PAGE} onPage={setPage} />
    </>
  )
}

function Logs() {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<ActivityLog[] | null>(null)
  const [error, setError] = useState('')
  const badRange = !!from && !!to && from > to

  const load = useCallback(() => {
    if (badRange) { setRows([]); return }
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE) })
    if (action) p.set('action', action)
    if (from) p.set('from', `${from}T00:00:00`)
    if (to) p.set('to', `${to}T23:59:59`)
    setError('')
    api<ActivityLog[]>(`/api/admin/activity-logs?${p}`).then(setRows).catch((e) => { setRows([]); setError((e as Error).message) })
  }, [action, from, to, page, badRange])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setTimeout(() => { setAction(q.trim()); setPage(1) }, 400); return () => clearTimeout(t) }, [q])

  return (
    <>
      <div className="filter-controls">
        <span className="input-wrap grow-2">
          <Icon name="search" size={16} className="input-lead" />
          <input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Loại thao tác, vd: Login, Payment, Refund…" />
        </span>
        <label className="row"><span className="muted">Từ</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} /></label>
        <label className="row"><span className="muted">Đến</span><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} /></label>
      </div>
      {badRange && <p className="alert bad"><Icon name="alert" size={16} />Ngày bắt đầu không được sau ngày kết thúc.</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {rows === null ? <p className="muted">Đang tải…</p> : rows.length === 0 ? <Empty icon="history">Không có thao tác nào khớp bộ lọc.</Empty> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Thao tác</th><th>Chi tiết</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.logId}>
                  <td>{fmtTime(l.createdAt)}</td>
                  <td>{l.username ?? (l.userId ? `#${l.userId}` : 'Hệ thống')}</td>
                  <td><span className="code">{l.action}</span></td>
                  <td><small>{l.details ?? '—'}</small></td>
                  <td><small className="muted">{l.ipAddress ?? '—'}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paging page={page} more={(rows?.length ?? 0) === PAGE} onPage={setPage} />
    </>
  )
}
