import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CITIZEN_ID_FILTER, citizenIdError, fullNameError, NAME_FILTER, normalizePhone, PHONE_FILTER, phoneError, relationshipError } from '../validation'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { AppointmentPicker, depositDueAt, depositMissed, pickupMissed } from '../components/appointment'
import { Empty, Eyebrow, Icon, splitTypeName, StatusBadge, UnitArt } from '../components/ui'
import { DenyReasons, type AccessRecord, type Contract, type Facility, type Invoice, type Person, type Reservation } from '../types'
import { FormField, useValidatedForm } from '../components/form'

const daysUntil = (iso: string) => Math.ceil((new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)

const ago = (iso: string) => {
  const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000)
  return d <= 0 ? 'Hôm nay' : d === 1 ? '1 ngày trước' : `${d} ngày trước`
}
const PAY_STATE: Record<string, { label: string; tone: string }> = {
  Paid: { label: 'Đã Thanh Toán', tone: 'ok' },
  Unpaid: { label: 'Chờ Thanh Toán', tone: 'warn' },
  Overdue: { label: 'Quá Hạn', tone: 'bad' },
  Cancelled: { label: 'Đã Hủy', tone: 'muted' },
}

/** Short line like the Figma rows, e.g. "Kho A-02 – Tiền thuê tháng 09/2026". */
function payLabel(i: Invoice, unit?: string) {
  const where = unit ? `Kho ${unit} – ` : ''
  const p = i.billingPeriodStart ?? i.dueDate
  switch (i.invoiceType) {
    case 'MONTHLY_RENT': return `${where}Tiền thuê tháng ${p.slice(5, 7)}/${p.slice(0, 4)}`
    case 'RENEWAL': return `${where}Gia hạn ${String(i.details[0]?.quantity ?? '').padStart(2, '0')} tháng`
    case 'DEPOSIT': return 'Tiền cọc đặt kho'
    default: return `${where}${i.details[0]?.description ?? i.invoiceType}`
  }
}

/**
 * Figma "user-dashboard": rented units, payment history, quick actions and latest notices.
 * The authorized-person / entry-history panel opens from the contract page (?contract=&tab=).
 */
export default function MyUnits() {
  const { user } = useAuth()
  const query = new URLSearchParams(useLocation().search)
  const wantedContract = Number(query.get('contract') ?? 0)
  const wantedTab = query.get('tab') === 'history' ? 'history' : query.get('tab') === 'people' ? 'people' : null
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [tab, setTab] = useState<'people' | 'history'>(wantedTab ?? 'people')
  const [error, setError] = useState('')

  useEffect(() => {
    api<Contract[]>('/api/contracts/my').then((cs) => {
      setContracts(cs)
      if (wantedTab && cs.some((c) => c.contractId === wantedContract)) {
        setOpenId(wantedContract)
        setTimeout(() => document.getElementById('contract-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      }
    }).catch((e) => setError((e as Error).message))
    api<Reservation[]>('/api/reservations/my').then(setReservations).catch(() => {})
    api<Invoice[]>('/api/invoices/my').then(setInvoices).catch(() => setInvoices([]))
    api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {})
  }, [])

  const active = contracts?.filter((c) => c.status === 'Active' || c.status === 'Renewed').length ?? 0
  const open = contracts?.find((c) => c.contractId === openId)
  const openReservations = reservations.filter((r) => r.status === 'PendingDeposit' || r.status === 'Confirmed')
  const ending = contracts?.filter((c) => c.status === 'Active' && daysUntil(c.endDate) <= 45) ?? []
  const unpaid = invoices?.filter((i) => i.status === 'Unpaid' || i.status === 'Overdue') ?? []
  const history = [...(invoices ?? [])].sort((a, b) => (b.payments[0]?.paymentDate ?? b.createdAt).localeCompare(a.payments[0]?.paymentDate ?? a.createdAt)).slice(0, 5)
  const unitOf = (i: Invoice) => contracts?.find((c) => c.contractId === i.contractId)?.unitCode

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Eyebrow dark>Tài khoản khách hàng thân thiết</Eyebrow>
          <h1>Xin Chào, {user?.fullName}!</h1>
          <p>Quản lý kho lưu trữ của bạn · Theo dõi hóa đơn, thời hạn và cập nhật dịch vụ.</p>
        </div>
      </section>

      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <section className="stack">
          <div className="row between wrap">
            <h2 className="section-title with-icon"><Icon name="package" size={20} className="cyan" /> Kho Lưu Trữ Của Tôi {active > 0 && <span className="pill">{active} Đang Hoạt Động</span>}</h2>
            <Link to="/rent" className="btn primary sm"><Icon name="plus" size={15} /> Đăng ký thuê kho</Link>
          </div>
          <div className="my-unit-grid">
            {contracts?.map((c, i) => {
              const left = daysUntil(c.endDate)
              return (
                <article key={c.contractId} className="my-unit-card">
                  <div className="my-unit-media">
                    <UnitArt variant={(i + 1) % 4} />
                    <span className="tag-dark">{c.unitCode}</span>
                    <span className="tag-status"><StatusBadge status={c.status} /></span>
                  </div>
                  <div className="my-unit-body">
                    <h3>Kho {c.unitCode} <small>· {c.facilityName}</small></h3>
                    <ul className="meta-list">
                      <li><Icon name="calendar" size={14} /> Bắt đầu: {fmtDate(c.startDate)}</li>
                      <li><Icon name="clock" size={14} /> Hết hạn: <b>{fmtDate(c.endDate)}</b>{c.status === 'Active' && left >= 0 && left <= 45 && <span className="warn-text"> · còn {left} ngày</span>}</li>
                      <li><Icon name="card" size={14} /> Chi phí: <b className="cyan">{fmtMoney(c.monthlyRentFee)}/tháng</b></li>
                    </ul>
                    <div className="row">
                      {c.status === 'Active' && <Link to={`/my-units/${c.contractId}/renew`} className="btn primary sm grow">Gia Hạn</Link>}
                      <Link to={`/my-units/${c.contractId}`} className="btn outline sm grow">Chi Tiết</Link>
                    </div>
                    {(c.status === 'Active' || c.status === 'Renewed') && (
                      <div className="row">
                        <Link to={`/my-units/${c.contractId}/visit`} className="btn ghost sm grow"><Icon name="calendar" size={14} /> Đăng Ký Vào Kho</Link>
                        <Link to={`/my-units/${c.contractId}/move-in`} className="btn ghost sm grow"><Icon name="package" size={14} /> Đưa Đồ Vào Kho</Link>
                      </div>
                    )}
                    {c.status === 'Active' && left > 0 && (
                      <Link to={`/my-units/${c.contractId}?return=early`} className="btn ghost sm block"><Icon name="logout" size={14} /> Trả Kho Sớm</Link>
                    )}
                  </div>
                </article>
              )
            })}
            <Link to="/rent" className="add-unit-card">
              <span className="add-circle"><Icon name="plus" size={22} /></span>
              <b>Thuê Thêm Kho</b>
              <small>Mở rộng không gian lưu trữ dễ dàng chỉ với vài bước đơn giản</small>
            </Link>
          </div>
          {contracts && contracts.length === 0 && <p className="muted">Bạn chưa có hợp đồng thuê kho nào. Sau khi đặt cọc, nhân viên sẽ bàn giao kho và hợp đồng sẽ hiện ở đây.</p>}
        </section>

        {open && (
          <section className="panel" id="contract-detail">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Kho {open.unitCode} · {open.facilityName}</h2>
                <p className="muted">HĐ {open.contractNumber} · {fmtDate(open.startDate)} – {fmtDate(open.endDate)}</p>
              </div>
              <span className="row"><StatusBadge status={open.status} /><button className="icon-btn" aria-label="Đóng" onClick={() => setOpenId(null)}><Icon name="x" /></button></span>
            </div>
            <div className="tabs">
              <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Icon name="users" size={16} /> Người được ủy quyền</button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Icon name="history" size={16} /> Lịch sử ra vào</button>
            </div>
            {tab === 'people' ? <AuthorizedPeople contractId={open.contractId} /> : <History contractId={open.contractId} />}
          </section>
        )}

        <div className="dash-grid">
          <section className="panel">
            <div className="row between wrap">
              <h2 className="section-title with-icon"><Icon name="card" size={20} className="cyan" /> Lịch Sử Thanh Toán</h2>
              <Link to="/invoices" className="link">Xem Tất Cả</Link>
            </div>
            <div className="table-scroll">
              <table className="pay-history">
                <thead><tr><th>Mã giao dịch</th><th>Kho lưu trữ</th><th>Số tiền</th><th>Ngày giao dịch</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
                <tbody>
                  {history.map((i) => {
                    const st = PAY_STATE[i.status] ?? { label: i.status, tone: 'muted' }
                    const unit = unitOf(i)
                    return (
                      <tr key={i.invoiceId}>
                        <td className="code">{i.invoiceNumber}</td>
                        <td>{payLabel(i, unit)}</td>
                        <td className="money">{fmtMoney(i.totalAmount)}</td>
                        <td>{fmtDate((i.payments[0]?.paymentDate ?? i.dueDate).slice(0, 10))}</td>
                        <td><span className={`badge ${st.tone}`}>{st.label}</span></td>
                        <td><Link to="/invoices" className="link">{i.status === 'Paid' ? 'Xem hóa đơn' : 'Thanh toán'}</Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {invoices?.length === 0 && <Empty icon="wallet">Chưa có giao dịch nào.</Empty>}
            </div>
          </section>

          <aside className="stack-lg">
            <div className="stack">
              <h3 className="aside-title">Thao Tác Nhanh</h3>
              <Link to="/rent" className="quick-action">
                <span className="feature-icon sm"><Icon name="package" size={18} /></span>
                <span className="grow"><b>Đặt Thêm Kho</b><small>Thuê thêm kho bảo mật cao</small></span>
                <Icon name="arrowRight" size={16} className="cyan" />
              </Link>
              <Link to="/support" className="quick-action">
                <span className="feature-icon sm"><Icon name="phone" size={18} /></span>
                <span className="grow"><b>Liên Hệ Hỗ Trợ</b><small>Báo sự cố, theo dõi nhân viên xử lý</small></span>
                <Icon name="arrowRight" size={16} className="cyan" />
              </Link>
            </div>

            <div className="stack">
              <h3 className="aside-title">Thông Báo Mới Nhất</h3>
              {unpaid.slice(0, 3).map((i) => (
                <div key={`i${i.invoiceId}`} className="notice">
                  <span className="notice-icon warn"><Icon name="wallet" size={16} /></span>
                  <div className="grow">
                    <div className="notice-head"><b>Yêu cầu thanh toán</b><small>{ago(i.createdAt)}</small></div>
                    <p>{unitOf(i) ? `Kho ${unitOf(i)}` : 'Hóa đơn'} {i.invoiceNumber} cần thanh toán {fmtMoney(i.totalAmount)} trước ngày {fmtDate(i.dueDate)}. <Link to="/invoices" className="link">Thanh toán</Link></p>
                  </div>
                </div>
              ))}
              {openReservations.map((r) => (
                <div key={`r${r.reservationId}`} className="notice">
                  <span className="notice-icon warn"><Icon name="calendar" size={16} /></span>
                  <div className="grow">
                    <div className="notice-head"><b>{depositMissed(r) ? 'Quá hạn đặt cọc' : pickupMissed(r) ? 'Quá hạn nhận kho' : r.status === 'PendingDeposit' ? 'Chờ đặt cọc' : r.checkInAppointmentAt ? 'Đã hẹn nhận kho' : 'Đặt lịch nhận kho'}</b><small>Nhận kho {fmtDate(r.expectedStartDate)}</small></div>
                    <p>
                      Đơn {r.reservationCode} ({splitTypeName(r.unitTypeName).name}, {r.facilityName})
                      {depositMissed(r) ? ' không được đặt cọc kịp nên sẽ tự hủy. Bạn có thể đặt kho lại.'
                        : pickupMissed(r) ? ` đã quá 20:00 ngày ${fmtDate(r.expectedStartDate)} mà chưa nhận kho nên sẽ tự hủy; tiền cọc được hoàn sau khi trừ phí hủy.`
                        : r.status === 'PendingDeposit' ? ` cần đặt cọc ${fmtMoney(r.depositAmount)} trước ${fmtTime(depositDueAt(r))}.`
                        : r.checkInAppointmentAt ? ` — đến cơ sở đúng giờ hẹn để nhân viên bàn giao kho.`
                        : ` đã nhận cọc. Chọn giờ đến nhận kho trong ngày ${fmtDate(r.expectedStartDate)}, nhân viên chỉ bàn giao từ giờ hẹn.`}
                    </p>
                    {r.status === 'Confirmed' && !pickupMissed(r) && (
                      <AppointmentPicker reservation={r} operatingHours={facilities.find((f) => f.facilityName === r.facilityName)?.operatingHours}
                        onSaved={(u) => setReservations((rs) => rs.map((x) => (x.reservationId === u.reservationId ? u : x)))} />
                    )}
                  </div>
                </div>
              ))}
              {ending.map((c) => (
                <div key={`c${c.contractId}`} className="notice">
                  <span className="notice-icon bad"><Icon name="alert" size={16} /></span>
                  <div className="grow">
                    <div className="notice-head"><b>Cảnh báo hết hạn hợp đồng</b><small>Còn {daysUntil(c.endDate)} ngày</small></div>
                    <p>Kho {c.unitCode} của bạn sắp kết thúc thời hạn thuê vào ngày {fmtDate(c.endDate)}. <Link to={`/my-units/${c.contractId}/renew`} className="link">Gửi yêu cầu gia hạn</Link></p>
                  </div>
                </div>
              ))}
              {unpaid.length + openReservations.length + ending.length === 0 && <p className="muted">Không có thông báo mới.</p>}
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

function AuthorizedPeople({ contractId }: { contractId: number }) {
  const [people, setPeople] = useState<Person[]>([])
  const form = useValidatedForm(
    { fullName: '', citizenId: '', phoneNumber: '', relationship: '' },
    {
      fullName: fullNameError,
      // The same person cannot be authorized twice on one contract.
      citizenId: (v) => citizenIdError(v) ?? (people.some((p) => p.citizenId === v) ? 'Người có số CCCD này đã được ủy quyền' : null),
      phoneNumber: phoneError,
      relationship: relationshipError,
    },
    { fullName: NAME_FILTER, citizenId: CITIZEN_ID_FILTER, phoneNumber: PHONE_FILTER, relationship: NAME_FILTER },
  )
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const base = `/api/contracts/${contractId}/authorized-persons`

  const load = () => api<Person[]>(base).then(setPeople).catch((e) => setError((e as Error).message))
  useEffect(() => {
    setError('')
    void load()
  }, [contractId])

  const [busy, setBusy] = useState(false)
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    if (!form.validateAll()) return
    const f = form.values
    setBusy(true)
    try {
      await api(base, {
        body: { fullName: f.fullName.trim(), citizenId: f.citizenId, phoneNumber: normalizePhone(f.phoneNumber), relationship: f.relationship.trim() || null },
      })
      form.reset()
      setAdding(false)
      void load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (p: Person) => {
    setConfirmId(null)
    try {
      await api(`${base}/${p.authorizedPersonId}`, { method: 'DELETE' })
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="stack">
      <p className="muted">Bạn có thể ủy quyền cho bất kỳ ai (người nhà, bạn bè, nhân viên, bên vận chuyển). Họ vào kho thay bạn khi xuất trình CCCD của chính họ cho nhân viên.</p>
      <div className="person-list">
        {people.map((p) => (
          <div key={p.authorizedPersonId} className="person-row">
            <span className="avatar sm">{p.fullName.split(' ').slice(-1)[0][0]}</span>
            <div className="grow">
              <b>{p.fullName}</b> {p.relationship && <span className="pill muted">{p.relationship}</span>}
              <small className="muted block">CCCD {p.citizenId} · SĐT {p.phoneNumber}</small>
            </div>
            {confirmId === p.authorizedPersonId ? (
              <span className="row">
                <button className="btn danger sm" onClick={() => revoke(p)}>Thu hồi quyền</button>
                <button className="btn ghost sm" onClick={() => setConfirmId(null)}>Giữ lại</button>
              </span>
            ) : (
              <button className="btn ghost sm danger-text" onClick={() => setConfirmId(p.authorizedPersonId)}>Thu hồi</button>
            )}
          </div>
        ))}
        {people.length === 0 && <Empty icon="users">Chưa ủy quyền cho ai.</Empty>}
      </div>
      {adding ? (
        <form onSubmit={add} className="add-person" noValidate>
          <div className="form-grid">
            <FormField label="Họ tên" error={form.error('fullName')}><input {...form.field('fullName')} maxLength={100} placeholder="Nguyễn Thị Bình" autoFocus /></FormField>
            <FormField label="Số CCCD" error={form.error('citizenId')}><input {...form.field('citizenId')} inputMode="numeric" placeholder="12 chữ số" /></FormField>
            <FormField label="Số điện thoại" error={form.error('phoneNumber')}><input {...form.field('phoneNumber')} inputMode="tel" placeholder="0912345678" /></FormField>
            <FormField label="Quan hệ (không bắt buộc)" error={form.error('relationship')}><input {...form.field('relationship')} maxLength={50} placeholder="vd: Người nhà, bạn bè, nhân viên, bên vận chuyển" /></FormField>
          </div>
          <div className="row">
            <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu người được ủy quyền'}</button>
            <button className="btn ghost sm" type="button" onClick={() => { setAdding(false); form.reset() }}>Hủy</button>
          </div>
        </form>
      ) : (
        <button className="btn outline sm self-start" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Thêm người được ủy quyền</button>
      )}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
    </div>
  )
}

function History({ contractId }: { contractId: number }) {
  const [rows, setRows] = useState<AccessRecord[] | null>(null)
  useEffect(() => {
    setRows(null)
    api<AccessRecord[]>(`/api/contracts/${contractId}/access-history`).then(setRows).catch(() => setRows([]))
  }, [contractId])

  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Người vào</th><th>Kết quả</th><th>Vào</th><th>Ra</th><th>Nhân viên</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.accessRecordId}>
              <td><b>{r.visitorName}</b>{(r.companionCount ?? 0) > 0 && <small className="muted"> +{r.companionCount} người đi cùng</small>}{r.purpose && <><br /><small className="muted">{r.purpose}</small></>}</td>
              <td>{r.result === 'Granted'
                ? <span className="badge ok">Được vào</span>
                : <span className="badge bad">Từ chối · {DenyReasons[r.denyReason ?? 'Other'] ?? r.denyReason}</span>}</td>
              <td>{fmtTime(r.entryTime)}</td>
              <td>{r.exitTime ? fmtTime(r.exitTime) : r.result === 'Granted' ? <span className="badge info">Đang ở trong</span> : '—'}</td>
              <td>{r.verifiedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <Empty icon="history">Chưa có lượt ra vào.</Empty>}
    </div>
  )
}
