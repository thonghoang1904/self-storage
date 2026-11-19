import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CITIZEN_ID_FILTER, citizenIdError, fullNameError, NAME_FILTER, normalizePhone, PHONE_FILTER, phoneError, relationshipError } from '../validation'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { depositDueAt, depositMissed, pickupMissed } from '../components/appointment'
import { Empty, Eyebrow, Icon, splitTypeName, StatusBadge } from '../components/ui'
import { ContractUnitArt } from '../components/unitPhoto'
import { DenyReasons, type AccessRecord, type CancellationRequest, type Contract, type Person, type Reservation } from '../types'
import { FormField, useValidatedForm } from '../components/form'
import { Modal } from '../components/Modal'

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
  const tab = wantedTab ?? 'people'
  const [error, setError] = useState('')

  useEffect(() => {
    api<Contract[]>('/api/contracts/my').then((cs) => {
      setContracts(cs)
      if (wantedTab && cs.some((c) => c.contractId === wantedContract)) {
        setOpenId(wantedContract)
      }
    }).catch((e) => setError((e as Error).message))
    api<Reservation[]>('/api/reservations/my').then(setReservations).catch(() => {})
  }, [])

  const active = contracts?.filter((c) => c.status === 'Active' || c.status === 'Renewed').length ?? 0
  const open = contracts?.find((c) => c.contractId === openId)
  // Units the customer still holds; contracts that have ended (returned or liquidated) are not listed here.
  const current = contracts?.filter((c) => c.status === 'Active' || c.status === 'Renewed' || c.status === 'Overdue')
  const openReservations = reservations.filter((r) => r.status === 'PendingDeposit' || r.status === 'Confirmed')
  const monthly = current?.reduce((sum, c) => sum + c.monthlyRentFee, 0) ?? 0
  // The unit whose term ends first: what the customer most likely has to act on next.
  const soonest = current?.filter((c) => c.status !== 'Overdue').sort((a, b) => a.endDate.localeCompare(b.endDate))[0]
  const overdue = current?.filter((c) => c.status === 'Overdue').length ?? 0

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Eyebrow dark>Kho của tôi</Eyebrow>
          <h1>Xin Chào, {user?.fullName}!</h1>
          <p>Kho đang thuê, thời hạn, người được vào kho và đơn đặt kho của bạn.</p>
        </div>
      </section>

      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        {current && current.length > 0 && (
          <div className="cd-summary mu-summary">
            <div className="cd-tile">
              <small>Kho đang thuê</small>
              <b>{current.length} kho</b>
              <small className={overdue ? 'danger-text' : 'muted'}>{overdue ? `${overdue} kho quá hạn` : `${active} đang hoạt động`}</small>
            </div>
            <div className="cd-tile">
              <small>Tổng phí thuê</small>
              <b>{fmtMoney(monthly)}<span>/tháng</span></b>
              <small className="muted">Thanh toán theo từng hợp đồng</small>
            </div>
            <div className="cd-tile">
              <small>Hết hạn gần nhất</small>
              <b>{soonest ? fmtDate(soonest.endDate) : '—'}</b>
              {soonest
                ? <small className={daysUntil(soonest.endDate) <= 45 ? 'warn-text' : 'muted'}>Kho {soonest.unitCode} · còn {Math.max(0, daysUntil(soonest.endDate))} ngày</small>
                : <small className="muted">Không có</small>}
            </div>
            <div className="cd-tile">
              <small>Đơn đặt kho</small>
              <b>{openReservations.length} đơn</b>
              <small className="muted">{openReservations.length ? 'Đang chờ nhận kho' : 'Không có đơn đang xử lý'}</small>
            </div>
          </div>
        )}

        {openReservations.length > 0 && (
          <section className="stack">
            <h2 className="section-title with-icon"><Icon name="clipboard" size={20} className="cyan" /> Đơn Đặt Kho Đang Xử Lý</h2>
            <div className="order-cards">
              {openReservations.map((r) => <OrderCard key={r.reservationId} r={r} onChanged={() => api<Reservation[]>('/api/reservations/my').then(setReservations).catch(() => {})} />)}
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
                    <ContractUnitArt facilityId={c.facilityId} unitCode={c.unitCode} contractId={c.contractId} />
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
                      <Link to={`/my-units/${c.contractId}`} className="link with-icon">Chi tiết <Icon name="arrowRight" size={14} /></Link>
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
          <Modal wide onClose={() => setOpenId(null)} title={`${tab === 'people' ? 'Người vào kho' : 'Lịch sử ra vào'} · Kho ${open.unitCode}`}>
            <div className="stack">
              <small className="muted">{open.facilityName} · HĐ {open.contractNumber} · {fmtDate(open.startDate)} – {fmtDate(open.endDate)}</small>
              {tab === 'people' ? <AuthorizedPeople contractId={open.contractId} /> : <History contractId={open.contractId} />}
            </div>
          </Modal>
        )}
      </div>
    </>
  )
}

export function AuthorizedPeople({ contractId }: { contractId: number }) {
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
      <p className="muted">Người được vào kho thay bạn (người nhà, bạn bè, bên vận chuyển…). Khi đến, họ xuất trình CCCD của chính họ cho nhân viên.</p>
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

export function History({ contractId }: { contractId: number }) {
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
function OrderCard({ r, onChanged }: { r: Reservation; onChanged: () => void }) {
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
      {!lateDeposit && !latePickup && <ReservationCancel r={r} onChanged={onChanged} />}
    </article>
  )
}

/**
 * Cancel a reservation before handover: an unpaid one is cancelled at once; a paid one (Confirmed, before 20:00 of
 * the pickup day) needs a request that staff approve, refunding the deposit minus the cancellation fee.
 */
function ReservationCancel({ r, onChanged }: { r: Reservation; onChanged: () => void }) {
  const [requests, setRequests] = useState<CancellationRequest[] | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmed = r.status === 'Confirmed'
  const beforeDeadline = Date.now() < new Date(`${r.expectedStartDate}T20:00:00`).getTime()
  useEffect(() => {
    if (confirmed) api<CancellationRequest[]>(`/api/reservations/${r.reservationId}/cancellation-requests/my`).then(setRequests).catch(() => setRequests([]))
  }, [r.reservationId, confirmed])

  if (r.status === 'PendingDeposit') {
    const cancel = async () => {
      if (!window.confirm(`Hủy đơn ${r.reservationCode}? Kho sẽ được mở lại cho người khác đặt.`)) return
      setBusy(true); setError('')
      try { await api(`/api/reservations/${r.reservationId}/cancel`, { method: 'POST' }); onChanged() }
      catch (e) { setError((e as Error).message) } finally { setBusy(false) }
    }
    return (
      <div className="row wrap">
        <button type="button" className="btn ghost sm danger-text" disabled={busy} onClick={cancel}><Icon name="x" size={15} /> Hủy đặt kho</button>
        {error && <small className="field-error">{error}</small>}
      </div>
    )
  }
  if (!confirmed || !beforeDeadline || !requests) return null
  const pending = requests.find((x) => x.status === 'Pending')
  if (pending) return <p className="alert warn"><Icon name="clock" size={16} />Đang chờ nhân viên duyệt yêu cầu hủy đơn (gửi lúc {fmtTime(pending.requestedAt)}).</p>
  const rejected = requests[0]?.status === 'Rejected' ? requests[0] : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = reason.trim()
    if (!text) { setError('Vui lòng nhập lý do hủy'); return }
    if (text.length > 1000) { setError('Lý do tối đa 1000 ký tự'); return }
    setBusy(true); setError('')
    try {
      await api(`/api/reservations/${r.reservationId}/cancellation-requests`, { method: 'POST', body: { reason: text } })
      setOpen(false); setReason('')
      setRequests(await api<CancellationRequest[]>(`/api/reservations/${r.reservationId}/cancellation-requests/my`))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="stack">
      {rejected && <p className="alert info"><Icon name="alert" size={16} />Yêu cầu hủy trước đã bị từ chối{rejected.resolutionNotes ? `: ${rejected.resolutionNotes}` : '.'}</p>}
      {!open ? (
        <div className="row wrap"><button type="button" className="btn ghost sm danger-text" onClick={() => setOpen(true)}><Icon name="x" size={15} /> Yêu cầu hủy & hoàn cọc</button></div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <label className="field">
            <span>Lý do hủy</span>
            <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} placeholder="Ví dụ: thay đổi kế hoạch chuyển nhà" />
          </label>
          <small className="muted">Nhân viên sẽ duyệt và hoàn cọc sau khi trừ phí hủy theo chính sách. Hạn gửi: trước 20:00 ngày {fmtDate(r.expectedStartDate)}.</small>
          {error && <small className="field-error">{error}</small>}
          <div className="row wrap">
            <button type="submit" className="btn danger" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu hủy'}</button>
            <button type="button" className="btn ghost" onClick={() => { setOpen(false); setError('') }}>Thôi</button>
          </div>
        </form>
      )}
    </div>
  )
}
