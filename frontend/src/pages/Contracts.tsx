import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Empty, Eyebrow, Icon, StatusBadge } from '../components/ui'
import type { Contract, ContractDetail as Detail, Renewal } from '../types'
import { AuthorizedPeople, History } from './MyUnits'

const DAY = 86400000
const asLocal = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
const daysUntil = (iso: string) => Math.ceil((asLocal(iso).getTime() - new Date().setHours(0, 0, 0, 0)) / DAY)
const addMonths = (iso: string, n: number) => {
  // Clamp to the last day of the month like .NET DateOnly.AddMonths (31/01 + 1 month = 28/02).
  const d = asLocal(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Return appointment: 20:00 on the end date (same rule as the backend). */
const returnAt = (endDate: string) => { const d = asLocal(endDate); d.setHours(20, 0, 0, 0); return d }

/** Customer: every contract with its term, fee and status. */
export function ContractList() {
  const [rows, setRows] = useState<Contract[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'current' | 'all'>('current')

  useEffect(() => {
    api<Contract[]>('/api/contracts/my').then(setRows).catch((e) => setError((e as Error).message))
  }, [])

  const current = (c: Contract) => c.status === 'Active' || c.status === 'Renewed' || c.status === 'Overdue'
  const shown = rows?.filter((c) => filter === 'all' || current(c)) ?? []
  const monthly = rows?.filter(current).reduce((s, c) => s + c.monthlyRentFee, 0) ?? 0

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Eyebrow dark>Tài khoản khách hàng</Eyebrow>
          <h1>Hợp Đồng Của Tôi</h1>
          <p>Theo dõi thời hạn, chi phí và gửi yêu cầu gia hạn cho từng kho bạn đang thuê.</p>
        </div>
      </section>
      <div className="container page-body stack-lg">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <div className="stat-grid three">
          <div className="stat-card">
            <span className="muted">Đang hiệu lực</span>
            <b className="stat-value">{rows?.filter(current).length ?? 0}</b>
            <small className="stat-note ok">hợp đồng</small>
          </div>
          <div className="stat-card">
            <span className="muted">Sắp hết hạn (≤ 7 ngày)</span>
            <b className="stat-value">{rows?.filter((c) => c.status === 'Active' && daysUntil(c.endDate) <= 7).length ?? 0}</b>
            <small className="stat-note warn">có thể gửi yêu cầu gia hạn</small>
          </div>
          <div className="stat-card">
            <span className="muted">Tổng phí thuê / tháng</span>
            <b className="stat-value">{fmtMoney(monthly)}</b>
            <small className="stat-note info">các hợp đồng đang hiệu lực</small>
          </div>
        </div>

        <div className="row between wrap">
          <h2 className="section-title with-icon"><Icon name="clipboard" size={20} className="cyan" /> Danh Sách Hợp Đồng</h2>
          <div className="segmented">
            <button className={filter === 'current' ? 'active' : ''} onClick={() => setFilter('current')}>Đang hiệu lực</button>
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tất cả</button>
          </div>
        </div>

        <div className="table-card">
          <table>
            <thead><tr><th>Mã hợp đồng</th><th>Kho</th><th>Thời hạn</th><th>Phí thuê</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {shown.map((c) => {
                const left = daysUntil(c.endDate)
                return (
                  <tr key={c.contractId}>
                    <td><b>{c.contractNumber}</b></td>
                    <td>Kho {c.unitCode}<br /><small className="muted">{c.facilityName}</small></td>
                    <td>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                      {c.status === 'Active' && left >= 0 && left <= 30 && <><br /><small className="warn-text">còn {left} ngày</small></>}
                    </td>
                    <td>{fmtMoney(c.monthlyRentFee)}/tháng</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="right"><Link to={`/contracts/${c.contractId}`} className="btn outline sm">Chi tiết <Icon name="arrowRight" size={14} /></Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows && shown.length === 0 && <Empty icon="clipboard">{filter === 'current' ? 'Không có hợp đồng nào đang hiệu lực.' : 'Bạn chưa có hợp đồng nào.'}</Empty>}
        </div>
      </div>
    </>
  )
}

/** Customer: one contract — term, money (deposit / late fees), renewal, authorized people, history. */
export function ContractDetail() {
  const id = Number(useParams().id)
  const [c, setC] = useState<Detail | null>(null)
  const [renewals, setRenewals] = useState<Renewal[]>([])
  const [tab, setTab] = useState<'people' | 'history'>('people')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([
        api<Detail>(`/api/contracts/${id}`),
        api<Renewal[]>(`/api/contracts/${id}/renewals`),
      ])
      setC(d)
      setRenewals(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  if (!c) {
    return (
      <div className="container page-body">
        {error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}
        <Link to="/contracts" className="link">← Về danh sách hợp đồng</Link>
      </div>
    )
  }

  const start = asLocal(c.startDate).getTime()
  const end = asLocal(c.endDate).getTime()
  const progress = Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100))
  const left = daysUntil(c.endDate)
  const totalMonths = Math.max(1, Math.round((end - start) / (30 * DAY)))

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Link to="/contracts" className="back-link"><Icon name="arrowRight" size={14} className="flip" /> Hợp đồng của tôi</Link>
          <Eyebrow dark>Chi tiết hợp đồng</Eyebrow>
          <h1>Hợp Đồng {c.contractNumber}</h1>
          <p>Kho {c.unitCode} · {c.facilityName}</p>
        </div>
      </section>

      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <div className="dash-grid">
          <section className="stack-lg">
            <div className="panel">
              <div className="panel-head">
                <h2 className="panel-title"><Icon name="clipboard" size={18} className="cyan" /> Thông Tin Hợp Đồng</h2>
                <StatusBadge status={c.status} />
              </div>
              <div className="term">
                <div className="row between"><small className="muted">{fmtDate(c.startDate)}</small><small className="muted">{fmtDate(c.endDate)}</small></div>
                <div className="term-bar"><span style={{ width: `${progress}%` }} className={c.status === 'Overdue' ? 'bad' : left <= 7 ? 'warn' : ''} /></div>
                <small className={left <= 7 && c.status === 'Active' ? 'warn-text' : 'muted'}>
                  {c.status === 'Terminated' || c.status === 'Liquidated' ? 'Hợp đồng đã kết thúc'
                    : left > 0 ? `Còn ${left} ngày · thời hạn khoảng ${totalMonths} tháng`
                    : left === 0 ? 'Hết hạn hôm nay — lịch trả kho lúc 20:00'
                    : `Đã quá ngày hết hạn ${-left} ngày`}
                </small>
              </div>
              <dl className="kv-grid">
                <div><dt>Mã hợp đồng</dt><dd>{c.contractNumber}</dd></div>
                <div><dt>Cơ sở</dt><dd>{c.facilityName}</dd></div>
                <div><dt>Kho</dt><dd>{c.unitCode} <StatusBadge status={c.unitStatus} /></dd></div>
                <div><dt>Phí thuê</dt><dd className="cyan">{fmtMoney(c.monthlyRentFee)}/tháng</dd></div>
                <div><dt>Ngày bắt đầu</dt><dd>{fmtDate(c.startDate)}</dd></div>
                <div><dt>Ngày hết hạn</dt><dd>{fmtDate(c.endDate)}</dd></div>
                <div><dt>Lịch trả kho</dt><dd>20:00 · {fmtDate(c.endDate)}</dd></div>
                <div><dt>Tiền cọc đã đóng</dt><dd>{fmtMoney(c.depositPaid)}</dd></div>
              </dl>
            </div>

            {c.accumulatedLateFee > 0 && (
              <div className="panel is-bad-panel">
                <h2 className="panel-title"><Icon name="lock" size={18} /> Kho Đang Bị Khóa Do Quá Hạn</h2>
                <p className="muted">Kho bị khóa sau 24 giờ kể từ lịch trả kho. Phí lưu kho quá hạn tính mỗi ngày bằng phí thuê tháng / 30 và được cấn trừ vào tiền cọc. Vui lòng đến cơ sở để trả kho hoặc liên hệ nhân viên.</p>
                <dl className="summary-lines">
                  <div><dt>Phí quá hạn đã tính</dt><dd>{fmtMoney(c.accumulatedLateFee)}</dd></div>
                  <div><dt>Cọc còn lại sau cấn trừ</dt><dd>{fmtMoney(c.depositBalance)}</dd></div>
                  <div><dt>Còn phải thanh toán</dt><dd className="danger-text">{fmtMoney(c.outstandingLateFee)}</dd></div>
                </dl>
              </div>
            )}

            <RenewalPanel contract={c} renewals={renewals} onChanged={load} />

            <div className="panel">
              <div className="tabs">
                <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Icon name="users" size={16} /> Người được ủy quyền</button>
                <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Icon name="history" size={16} /> Lịch sử ra vào</button>
              </div>
              {tab === 'people'
                ? (c.status === 'Terminated' || c.status === 'Liquidated'
                  ? <p className="muted">Hợp đồng đã kết thúc, không thể thay đổi người được ủy quyền.</p>
                  : <AuthorizedPeople contractId={c.contractId} />)
                : <History contractId={c.contractId} />}
            </div>
          </section>

          <aside className="stack-lg">
            <div className="panel">
              <h3 className="aside-title">Chi Phí</h3>
              <dl className="summary-lines">
                <div><dt>Phí thuê hằng tháng</dt><dd>{fmtMoney(c.monthlyRentFee)}</dd></div>
                <div><dt>Tiền cọc</dt><dd>{fmtMoney(c.depositPaid)}</dd></div>
                <div><dt>Phí quá hạn</dt><dd>{fmtMoney(c.accumulatedLateFee)}</dd></div>
                <div><dt>Số dư cọc</dt><dd className="cyan">{fmtMoney(c.depositBalance)}</dd></div>
              </dl>
            </div>
            <div className="stack">
              <h3 className="aside-title">Quy Định Hợp Đồng</h3>
              <div className="notice">
                <span className="notice-icon info"><Icon name="refresh" size={16} /></span>
                <div><b>Gia hạn</b><p>Gửi yêu cầu trong 7 ngày trước ngày hết hạn. Gia hạn có hiệu lực khi nhân viên xác nhận đã thu phí.</p></div>
              </div>
              <div className="notice">
                <span className="notice-icon warn"><Icon name="clock" size={16} /></span>
                <div><b>Trả kho</b><p>Lịch trả kho từ 20:00 ngày hết hạn. Dọn sạch kho, nhân viên kiểm tra và hoàn cọc.</p></div>
              </div>
              <div className="notice">
                <span className="notice-icon bad"><Icon name="lock" size={16} /></span>
                <div><b>Quá hạn</b><p>Sau 24 giờ chưa trả kho, kho bị khóa và tính phí mỗi ngày (phí tháng / 30), cấn trừ vào cọc.</p></div>
              </div>
              <Link to="/support" className="quick-action">
                <span className="feature-icon sm"><Icon name="phone" size={18} /></span>
                <span className="grow"><b>Báo Sự Cố Kho Này</b><small>Gửi yêu cầu hỗ trợ cho nhân viên cơ sở</small></span>
                <Icon name="arrowRight" size={16} className="cyan" />
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

const MONTH_CHOICES = [1, 3, 6, 12]

function RenewalPanel({ contract: c, renewals, onChanged }: { contract: Detail; renewals: Renewal[]; onChanged: () => Promise<void> }) {
  const [months, setMonths] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const now = new Date()
  const opensAt = new Date(c.renewalAvailableFrom)
  const closesAt = returnAt(c.endDate)
  const pending = renewals.find((r) => r.status === 'Pending')
  const windowOpen = c.status === 'Active' && now >= opensAt && now < closesAt

  const submit = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/api/contracts/${c.contractId}/renewals`, { body: { extensionMonths: months } })
      setNotice('Đã gửi yêu cầu gia hạn và tạo hóa đơn. Thanh toán online ở mục Hóa Đơn hoặc trả tại cơ sở để nhân viên xác nhận.')
      await onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title"><Icon name="refresh" size={18} className="cyan" /> Gia Hạn Hợp Đồng</h2>
        {pending && <StatusBadge status="Pending" />}
      </div>

      {pending ? (
        <div className="notice">
          <span className="notice-icon warn"><Icon name="wallet" size={16} /></span>
          <div>
            <b>Yêu cầu gia hạn {pending.extensionMonths} tháng đang chờ thanh toán</b>
            <p>Phí gia hạn {fmtMoney(pending.renewalFee)} — thanh toán ở <Link to="/invoices" className="link">Hóa Đơn</Link> hoặc tại cơ sở. Sau khi thanh toán xong, ngày hết hạn đổi từ {fmtDate(pending.oldEndDate)} sang <b>{fmtDate(pending.newEndDate)}</b>. Hạn chót thanh toán: 20:00 ngày {fmtDate(pending.oldEndDate)}.</p>
          </div>
        </div>
      ) : windowOpen ? (
        <div className="stack">
          <p className="muted">Chọn thời gian gia hạn thêm cho kho {c.unitCode}:</p>
          <div className="segmented self-start">
            {MONTH_CHOICES.map((m) => (
              <button key={m} className={months === m ? 'active' : ''} onClick={() => setMonths(m)}>{m} tháng</button>
            ))}
          </div>
          <dl className="summary-lines">
            <div><dt>Ngày hết hạn hiện tại</dt><dd>{fmtDate(c.endDate)}</dd></div>
            <div><dt>Ngày hết hạn mới</dt><dd>{fmtDate(addMonths(c.endDate, months))}</dd></div>
            <div><dt>Phí gia hạn ({months} × {fmtMoney(c.monthlyRentFee)})</dt><dd className="cyan">{fmtMoney(months * c.monthlyRentFee)}</dd></div>
          </dl>
          <button className="btn primary self-start" onClick={submit} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi Yêu Cầu Gia Hạn'}</button>
        </div>
      ) : c.status === 'Active' && now < opensAt ? (
        <p className="hint"><Icon name="calendar" size={15} /> Bạn có thể gửi yêu cầu gia hạn từ ngày <b>{fmtDate(c.renewalAvailableFrom)}</b> (7 ngày trước khi hết hạn).</p>
      ) : (
        <p className="hint"><Icon name="alert" size={15} /> Hợp đồng không còn trong thời gian được gia hạn. Liên hệ cơ sở nếu bạn cần hỗ trợ.</p>
      )}

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      {renewals.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Gửi lúc</th><th>Gia hạn</th><th>Hết hạn mới</th><th>Phí</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {renewals.map((r) => (
                <tr key={r.renewalId}>
                  <td>{fmtTime(r.requestedAt)}</td>
                  <td>{r.extensionMonths} tháng</td>
                  <td>{fmtDate(r.newEndDate)}</td>
                  <td>{fmtMoney(r.renewalFee)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
