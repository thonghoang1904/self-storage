import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CITIZEN_ID_FILTER, citizenIdError, fullNameError, NAME_FILTER, normalizePhone, PHONE_FILTER, phoneError, relationshipError } from '../validation'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { depositDueAt, depositMissed, pickupMissed } from '../components/appointment'
import { Empty, Eyebrow, Icon, splitTypeName, StatusBadge } from '../components/ui'
import { ContractUnitArt } from '../components/unitPhoto'
import { DenyReasons, type AccessRecord, type Contract, type Person, type Reservation } from '../types'
import { FormField, useValidatedForm } from '../components/form'

const daysUntil = (iso: string) => Math.ceil((new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)


/**
 * Figma "user-dashboard": rented units, quick actions and latest notices.
 * The authorized-person / entry-history panel opens from the contract page (?contract=&tab=).
 */
/** Share of the contract term already used, for the thin bar under the dates. */
const termPct = (start: string, end: string) => {
  const s = new Date(start).getTime(), e = new Date(end).getTime()
  if (!(e > s)) return 100
  return Math.min(100, Math.max(0, ((Date.now() - s) / (e - s)) * 100))
}

export default function MyUnits() {
  const { user } = useAuth()
  const query = new URLSearchParams(useLocation().search)
  const wantedContract = Number(query.get('contract') ?? 0)
  const wantedTab = query.get('tab') === 'history' ? 'history' : query.get('tab') === 'people' ? 'people' : null
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
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
  }, [])

  const active = contracts?.filter((c) => c.status === 'Active' || c.status === 'Renewed').length ?? 0
  const open = contracts?.find((c) => c.contractId === openId)
  // Units the customer still holds; contracts that have ended (returned or liquidated) are not listed here.
  const current = contracts?.filter((c) => c.status === 'Active' || c.status === 'Renewed' || c.status === 'Overdue')
  const openReservations = reservations.filter((r) => r.status === 'PendingDeposit' || r.status === 'Confirmed')

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

        {openReservations.length > 0 && (
          <section className="stack">
            <h2 className="section-title with-icon"><Icon name="clipboard" size={20} className="cyan" /> Đơn Đặt Kho Đang Xử Lý</h2>
            <div className="order-cards">
              {openReservations.map((r) => <OrderCard key={r.reservationId} r={r} />)}
            </div>
          </section>
        )}

        <section className="stack">
          <div className="row between wrap">
            <h2 className="section-title with-icon"><Icon name="package" size={20} className="cyan" /> Kho Lưu Trữ Của Tôi {active > 0 && <span className="pill">{active} Đang Hoạt Động</span>}</h2>
          </div>
          <div className="my-unit-grid">
            {current?.map((c) => {
              const left = daysUntil(c.endDate)
              return (
                <article key={c.contractId} className="my-unit-card">
                  <Link to={`/my-units/${c.contractId}`} className="my-unit-media" aria-label={`Chi tiết kho ${c.unitCode}`}>
                    <ContractUnitArt facilityId={c.facilityId} unitCode={c.unitCode} />
                    <span className="tag-dark">{c.unitCode}</span>
                    <span className="tag-status"><StatusBadge status={c.status} /></span>
                  </Link>
                  <div className="my-unit-body">
                    <div>
                      <h3><Link to={`/my-units/${c.contractId}`} className="my-unit-title">Kho {c.unitCode}</Link></h3>
                      <small className="muted">{c.facilityName}</small>
                    </div>
                    <div className="my-unit-facts">
                      <div><small>Chi phí</small><b>{fmtMoney(c.monthlyRentFee)}<span>/tháng</span></b></div>
                      <div><small>Hết hạn</small><b>{fmtDate(c.endDate)}</b></div>
                    </div>
                    <div className="my-unit-term">
                      <div className="row between">
                        <small className="muted">Từ {fmtDate(c.startDate)}</small>
                        {c.status === 'Active' && left >= 0 && <small className={left <= 45 ? 'warn-text' : 'muted'}>còn {left} ngày</small>}
                      </div>
                      <span className="term-bar"><i style={{ width: `${termPct(c.startDate, c.endDate)}%` }} /></span>
                    </div>
                    <div className="my-unit-actions">
                      {(c.status === 'Active' || c.status === 'Renewed') && <Link to={`/visit?contract=${c.contractId}`} className="btn primary sm"><Icon name="calendar" size={14} /> Vào kho</Link>}
                      {c.status === 'Active' && <Link to={`/my-units/${c.contractId}/renew`} className="btn outline sm"><Icon name="refresh" size={14} /> Gia hạn</Link>}
                    </div>
                    <div className="my-unit-foot">
                      <Link to={`/my-units/${c.contractId}`} className="link with-icon">Chi tiết hợp đồng <Icon name="arrowRight" size={14} /></Link>
                      {c.status === 'Active' && left > 0 && <Link to={`/my-units/${c.contractId}?return=early`} className="danger-text link-plain">Trả kho sớm</Link>}
                    </div>
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
          {current && current.length === 0 && <p className="muted">{contracts?.length ? 'Bạn không còn kho nào đang thuê.' : 'Bạn chưa có hợp đồng thuê kho nào. Sau khi đặt cọc, nhân viên sẽ bàn giao kho và hợp đồng sẽ hiện ở đây.'}</p>}
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
              <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Icon name="users" size={16} /> Người vào kho</button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Icon name="history" size={16} /> Lịch sử ra vào</button>
            </div>
            {tab === 'people' ? <AuthorizedPeople contractId={open.contractId} /> : <History contractId={open.contractId} />}
          </section>
        )}

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
      citizenId: (v) => citizenIdError(v) ?? (people.some((p) => p.citizenId === v) ? 'Người có số CCCD này đã có trong danh sách' : null),
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
      <p className="muted">Thêm người được vào kho thay bạn (người nhà, bạn bè, nhân viên, bên vận chuyển). Họ vào kho khi xuất trình CCCD của chính họ cho nhân viên.</p>
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
        {people.length === 0 && <Empty icon="users">Chưa có người vào kho nào.</Empty>}
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
            <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu người vào kho'}</button>
            <button className="btn ghost sm" type="button" onClick={() => { setAdding(false); form.reset() }}>Hủy</button>
          </div>
        </form>
      ) : (
        <button className="btn outline sm self-start" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Thêm người vào kho</button>
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

/**
 * A reservation on its way to a unit, shown like an order tracker: deposit → pickup time → handover, with the one
 * thing the customer has to do next as the main button (not hidden among notifications).
 */
function OrderCard({ r }: { r: Reservation }) {
  const lateDeposit = depositMissed(r)
  const latePickup = pickupMissed(r)
  const step = r.status === 'PendingDeposit' ? 0 : r.checkInAppointmentAt ? 2 : 1
  const steps = ['Thanh toán cọc', 'Đặt lịch nhận kho', 'Nhận kho tại cơ sở']
  return (
    <article className={`order-card ${lateDeposit || latePickup ? 'late' : step < 2 ? 'todo' : ''}`}>
      <div className="row between wrap">
        <div><b className="code">{r.reservationCode}</b><small className="muted block">{splitTypeName(r.unitTypeName).name} · {r.facilityName} · nhận kho {fmtDate(r.expectedStartDate)}</small></div>
        <StatusBadge status={r.status} />
      </div>
      <ol className="order-steps">
        {steps.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'current' : ''}><span>{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{t}</li>)}
      </ol>
      {lateDeposit ? <p className="alert bad"><Icon name="alert" size={16} />Quá hạn đặt cọc, đơn sẽ tự hủy. Bạn có thể đặt kho lại.</p>
        : latePickup ? <p className="alert bad"><Icon name="alert" size={16} />Đã quá 20:00 ngày {fmtDate(r.expectedStartDate)} mà chưa nhận kho; đơn sẽ tự hủy, cọc hoàn sau khi trừ phí hủy.</p>
        : step === 0 ? (
          <div className="order-next">
            <span>Thanh toán <b>{fmtMoney(r.depositAmount)}</b> trước <b>{fmtTime(depositDueAt(r))}</b> để giữ kho.</span>
            <Link to={`/invoices?reservation=${r.reservationId}`} className="btn primary"><Icon name="wallet" size={16} /> Thanh toán cọc</Link>
          </div>
        ) : step === 1 ? (
          <div className="order-next">
            <span>Đã nhận cọc. <b>Chọn giờ đến nhận kho</b> trong ngày {fmtDate(r.expectedStartDate)}, trước 20:00.</span>
            <Link to={`/reservations/${r.reservationId}/pickup`} className="btn primary"><Icon name="calendar" size={16} /> Đặt lịch nhận kho</Link>
          </div>
        ) : (
          <div className="order-next">
            <span>Hẹn nhận kho lúc <b>{fmtTime(r.checkInAppointmentAt!)}</b>. Mang CCCD đến đúng giờ để nhân viên bàn giao kho.</span>
            <Link to={`/reservations/${r.reservationId}/pickup`} className="btn outline"><Icon name="calendar" size={16} /> Đổi giờ</Link>
          </div>
        )}
    </article>
  )
}
