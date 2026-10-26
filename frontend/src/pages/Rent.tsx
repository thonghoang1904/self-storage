import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { PageHero } from '../components/layout'
import { AppointmentPicker, depositDueAt, depositMissed, pickupMissed } from '../components/appointment'
import { Empty, Icon, splitTypeName, StatusBadge, UnitArt } from '../components/ui'
import { TermsList, TERMS_VERSION, termsHref } from './Terms'
import { CancellationStatuses, type Availability, type CancellationRequest, type Facility, type Reservation, type UnitType } from '../types'
import { CODE_FILTER, localToday, promoCodeError, textError } from '../validation'
import { FieldNote, useInputFilter } from '../components/form'

const DURATIONS = [1, 3, 6, 12]
const SIGN_KEY = 'ss_signed_contracts'
interface SignedRecord { at: string; version: string }
/** Acceptance stays in this browser only: the API has no endpoint to store it. */
const readSigned = (): Record<string, SignedRecord> => {
  try { return JSON.parse(localStorage.getItem(SIGN_KEY) ?? '{}') as Record<string, SignedRecord> } catch { return {} }
}
const saveSigned = (code: string, rec: SignedRecord) => {
  try { localStorage.setItem(SIGN_KEY, JSON.stringify({ ...readSigned(), [code]: rec })) } catch { /* private mode */ }
}
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Customer: choose a facility and unit size, reserve it, and follow reservations. */
export default function Rent() {
  const { user } = useAuth()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  const [types, setTypes] = useState<UnitType[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // After 19:00 there is no time left to pay and pick up today: default to tomorrow.
  const [startDate, setStartDate] = useState(() => { if (new Date().getHours() < 19) return todayIso(); const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` })
  const [months, setMonths] = useState(6)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const promo = useInputFilter(CODE_FILTER)
  /** Latest cancellation request of each reservation that can still have one. */
  const [cancellations, setCancellations] = useState<Record<number, CancellationRequest | undefined>>({})
  const [cancelling, setCancelling] = useState<number | null>(null)
  // Step 3: read the contract terms and agree before the reservation (and its deposit invoice) is created.
  const [signing, setSigning] = useState(false)
  const navigate = useNavigate()
  const [agreed, setAgreed] = useState(false)
  const signedList = readSigned()

  const loadReservations = () => api<Reservation[]>('/api/reservations/my').then((rs) => {
    setReservations(rs)
    rs.filter((r) => ['PendingDeposit', 'Confirmed', 'Cancelled'].includes(r.status)).forEach((r) => {
      api<CancellationRequest[]>(`/api/reservations/${r.reservationId}/cancellation-requests/my`)
        .then((list) => setCancellations((m) => ({ ...m, [r.reservationId]: list[0] })))
        .catch(() => {})
    })
  }).catch(() => {})

  useEffect(() => {
    api<UnitType[]>('/api/unit-types').then(setTypes).catch(() => {})
    api<Facility[]>('/api/facilities').then((fs) => {
      setFacilities(fs)
      if (fs.length) setFacilityId(fs[0].facilityId)
    }).catch((e) => setError((e as Error).message))
    void loadReservations()
  }, [])

  useEffect(() => {
    if (!facilityId) return
    api<Availability[]>(`/api/facilities/${facilityId}/availability`).then((a) => {
      setAvailability(a)
      // Keep the choice if still bookable here, otherwise preselect the first size with room.
      setSelectedId((cur) => (a.some((x) => x.unitTypeId === cur && x.availableUnits > 0) ? cur : a.find((x) => x.availableUnits > 0)?.unitTypeId ?? null))
    }).catch((e) => setError((e as Error).message))
  }, [facilityId])

  const facility = facilities.find((f) => f.facilityId === facilityId)
  const selected = availability.find((a) => a.unitTypeId === selectedId)
  const selectedType = types.find((t) => t.unitTypeId === selectedId)
  const total = selected ? selected.baseMonthlyRate * months : 0

  const signError = !agreed ? 'Vui lòng đọc và đồng ý với điều khoản hợp đồng' : ''

  const openSigning = () => {
    // Check what the customer typed before showing the contract to sign.
    const invalid = (!startDate && 'Vui lòng chọn ngày bắt đầu thuê')
      || (startDate < todayIso() && 'Ngày bắt đầu thuê không được ở quá khứ')
      || ((months < 1 || months > 60) && 'Số tháng thuê phải từ 1 đến 60')
      || promoCodeError(promoCode)
    if (invalid) { setError(invalid); return }
    setError('')
    setSigning(true)
    setTimeout(() => document.getElementById('sign-contract')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const reserve = async () => {
    if (!facilityId || !selected) return
    const dateProblem = checkStartDate(startDate)
    if (dateProblem) { setError(dateProblem); return }
    const promoProblem = promoCodeError(promoCode)
    if (promoProblem) { setError(promoProblem); return }
    if (signError) { setError(signError); return }
    setError('')
    setBusy(true)
    try {
      const r = await api<Reservation>('/api/reservations', {
        body: { facilityId, unitTypeId: selected.unitTypeId, expectedStartDate: startDate, durationMonths: months, promoCode: promoCode.trim() || null },
      })
      saveSigned(r.reservationCode, { at: new Date().toISOString(), version: TERMS_VERSION })
      // Agreed and reserved: go straight to paying the deposit.
      navigate(`/invoices?reservation=${r.reservationId}&code=${encodeURIComponent(r.reservationCode)}&deadline=${encodeURIComponent(depositDueAt(r))}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHero center eyebrow="Đặt kho nhanh chóng · chỉ trong 4 bước" title="Đặt Kho Lưu Trữ SafeKeep">
        Chọn cơ sở và kích thước kho, đồng ý điều khoản hợp đồng rồi thanh toán cọc. Đơn được giữ 24 giờ (không quá 20:00 ngày bắt đầu) để bạn đặt cọc.
      </PageHero>

      <div className="container page-body">
        <div className="checkout-grid">
          <div className="stack-xl">
            <ol className="stepper">
              <li className="active"><span>1</span><div><small>Bước 1</small><b>Chọn kho</b></div></li>
              <li className={selected ? 'active' : ''}><span>2</span><div><small>Bước 2</small><b>Thời gian thuê</b></div></li>
              <li className={signing ? 'active' : ''}><span>3</span><div><small>Bước 3</small><b>Điều khoản</b></div></li>
              <li><span>4</span><div><small>Bước 4</small><b>Thanh toán cọc</b></div></li>
            </ol>

            <section className="stack">
              <div>
                <h2 className="section-title">Bước 1: Chọn Cơ Sở & Kích Thước Kho</h2>
                <p className="muted">Hãy chọn loại diện tích phù hợp nhất với nhu cầu thực tế của bạn.</p>
              </div>
              <div className="facility-tabs" role="tablist">
                {facilities.map((f) => (
                  <button key={f.facilityId} role="tab" aria-selected={f.facilityId === facilityId}
                    className={f.facilityId === facilityId ? 'active' : ''} onClick={() => setFacilityId(f.facilityId)}>
                    <Icon name="building" size={16} />
                    <span><b>{f.facilityName}</b><small>{f.district} · {f.operatingHours}</small></span>
                  </button>
                ))}
              </div>
              {facility && <p className="meta"><Icon name="pin" size={14} /> {facility.address}, {facility.district}, {facility.city} · Hotline {facility.hotline}</p>}

              <div className="size-list">
                {availability.map((a, i) => {
                  const t = types.find((x) => x.unitTypeId === a.unitTypeId)
                  const { name, size } = splitTypeName(a.typeName)
                  const isSel = a.unitTypeId === selectedId
                  const soldOut = a.availableUnits === 0
                  return (
                    <div key={a.unitTypeId} className={`size-row ${isSel ? 'selected' : ''} ${soldOut ? 'disabled' : ''}`}
                      onClick={() => !soldOut && setSelectedId(a.unitTypeId)}>
                      <div className="size-thumb"><UnitArt variant={i} /></div>
                      <div className="size-info">
                        <div className="row between wrap">
                          <h3>{name} {t && <span className="cyan">{(t.lengthMeters * t.widthMeters).toLocaleString('vi-VN')}m²</span>}</h3>
                          {soldOut ? <span className="pill muted">Hết chỗ</span> : <span className="pill">Còn {a.availableUnits} kho</span>}
                        </div>
                        <p className="meta"><Icon name="size" size={14} /> {size}{t ? ` · Cao ${t.heightMeters}m` : ''}{t?.hasClimateControl ? ' · Có điều hòa' : ''}</p>
                        <div className="row between wrap">
                          <span className="price"><b>{fmtMoney(a.baseMonthlyRate)}</b><small>/tháng</small></span>
                          <button className={`btn sm ${isSel ? 'primary' : 'outline'}`} disabled={soldOut}
                            onClick={(e) => { e.stopPropagation(); setSelectedId(a.unitTypeId) }}>
                            {isSel ? 'Đã Chọn' : 'Chọn Kho'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="stack">
              <div>
                <h2 className="section-title">Bước 2: Thông Tin Người Thuê</h2>
                <p className="muted">Hợp đồng sẽ đứng tên tài khoản đang đăng nhập. Nhân viên đối chiếu CCCD trong hồ sơ khi bạn đến nhận kho.</p>
              </div>
              <div className="info-card">
                <span className="feature-icon"><Icon name="user" size={20} /></span>
                <div className="grow stack-sm">
                  <b>{user?.fullName}</b>
                  <span className="meta">Tài khoản {user?.username}</span>
                </div>
                <label className="field compact">
                  <span>Ngày bắt đầu thuê</span>
                  <input type="date" min={todayIso()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
              </div>
            </section>
          </div>

          <aside className="order-summary">
            <h3>Thông Tin Đơn Hàng</h3>
            {selected ? (
              <div className="summary-item">
                <div className="row between"><b>{splitTypeName(selected.typeName).name}</b><b className="cyan">{fmtMoney(selected.baseMonthlyRate)}</b></div>
                <small className="muted">{facility?.facilityName}{selectedType?.hasClimateControl ? ' · Điều hòa nhiệt độ' : ''}</small>
              </div>
            ) : <p className="muted">Chọn một kích thước kho còn trống.</p>}

            <div className="stack-sm">
              <span className="label">Thời gian thuê</span>
              <div className="duration-grid">
                {DURATIONS.map((m) => (
                  <button key={m} className={m === months ? 'active' : ''} onClick={() => setMonths(m)}>
                    <b>{m} Tháng</b>
                  </button>
                ))}
              </div>
              <label className="row between custom-months">
                <span className="muted">Số tháng khác</span>
                <input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
              </label>
            </div>

            <dl className="summary-lines">
              <div><dt>Đơn giá</dt><dd>{selected ? `${fmtMoney(selected.baseMonthlyRate)}/tháng` : '—'}</dd></div>
              <div><dt>Thời gian thuê</dt><dd>{months} tháng</dd></div>
              <div><dt>Bắt đầu từ</dt><dd>{fmtDate(startDate)}</dd></div>
              <div><dt>Tiền cọc (1 tháng)</dt><dd>{selected ? fmtMoney(selected.baseMonthlyRate) : '—'}</dd></div>
            </dl>
            <label className="field compact promo-field">
              <span>Mã khuyến mãi (nếu có)</span>
              <input value={promoCode} onChange={(e) => setPromoCode(promo.keep(e.target.value))} placeholder="vd: WELCOME10" maxLength={30} />
              <FieldNote text={promo.hint} />
            </label>
            <div className="summary-total"><span>Tạm Tính</span><b>{fmtMoney(total)}</b></div>
            {promoCode.trim() && <p className="fine-print">Mã chỉ dành cho lần thuê đầu tiên; mức giảm được trừ vào tiền thuê tháng đầu và hiện sau khi giữ chỗ.</p>}
            {error && !signing && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
            <button className="btn primary block lg" disabled={!selected || busy || signing} onClick={openSigning}>
              {signing ? 'Xem điều khoản bên dưới ↓' : 'Tiếp Tục: Điều Khoản Hợp Đồng'}
            </button>
            <p className="fine-print">Đơn được giữ 24 giờ, không quá 20:00 ngày bắt đầu thuê. Muốn đổi ý, bạn gửi yêu cầu hủy ở bảng đơn đặt kho; cọc được hoàn sau khi trừ phí hủy theo chính sách.</p>
          </aside>
        </div>

        {signing && selected && (
          <section className="panel sign-panel" id="sign-contract">
            <div className="panel-head wrap">
              <div>
                <h2 className="section-title">Bước 3: Điều Khoản Hợp Đồng Thuê Kho</h2>
                <p className="muted">Đọc điều khoản và tick đồng ý. Sau đó đơn được giữ chỗ và bạn chuyển sang thanh toán cọc.</p>
              </div>
              <button type="button" className="icon-btn" aria-label="Đóng" onClick={() => { setSigning(false); setError('') }}><Icon name="x" /></button>
            </div>
            <div className="sign-grid">
              <div className="stack">
                <dl className="kv-grid contract-summary">
                  <div><dt>Bên thuê</dt><dd>{user?.fullName}</dd></div>
                  <div><dt>Tài khoản</dt><dd>{user?.username}</dd></div>
                  <div><dt>Cơ sở</dt><dd>{facility?.facilityName}</dd></div>
                  <div><dt>Loại kho</dt><dd>{splitTypeName(selected.typeName).name}</dd></div>
                  <div><dt>Bắt đầu</dt><dd>{fmtDate(startDate)}</dd></div>
                  <div><dt>Thời hạn</dt><dd>{months} tháng</dd></div>
                  <div><dt>Giá thuê</dt><dd>{fmtMoney(selected.baseMonthlyRate)}/tháng</dd></div>
                  <div><dt>Tiền cọc dự kiến</dt><dd>{fmtMoney(selected.baseMonthlyRate)}</dd></div>
                  {promoCode.trim() && <div><dt>Mã khuyến mãi</dt><dd>{promoCode.trim()}</dd></div>}
                </dl>
                <div className="terms-box" tabIndex={0} aria-label="Điều khoản hợp đồng">
                  <TermsList compact />
                </div>
                <Link to={termsHref({ newTab: true, label: 'Đóng & quay lại đặt kho' })} target="_blank" className="link">Mở trang điều khoản đầy đủ <Icon name="arrowRight" size={14} /></Link>
              </div>
              <div className="stack sign-side">
                <label className="check-row">
                  <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setError('') }} />
                  <span>Tôi đã đọc, hiểu và đồng ý với <b>Điều khoản & Chính sách Hợp đồng</b> (phiên bản {TERMS_VERSION}), gồm quy định đặt cọc, hủy đơn, trả kho và phí quá hạn.</span>
                </label>
                <small className="muted">Hợp đồng chính thức được lập khi nhân viên bàn giao kho, theo đúng các điều khoản bạn đã đồng ý.</small>
                {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
                <button className="btn primary block lg" disabled={busy} onClick={reserve}>
                  {busy ? 'Đang giữ chỗ…' : 'Đồng Ý & Giữ Chỗ'}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="stack" id="my-reservations">
          <div className="row between">
            <h2 className="section-title">Đơn Đặt Kho Của Tôi</h2>
            <Link to="/my-units" className="link">Xem kho của tôi <Icon name="arrowRight" size={14} /></Link>
          </div>
          <div className="table-card">
            <table>
              <thead><tr><th>Mã đơn</th><th>Cơ sở · loại kho</th><th>Bắt đầu</th><th>Tiền cọc</th><th>Hạn cọc</th><th>Lịch nhận kho</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>
                {reservations.map((r) => {
                  const cr = cancellations[r.reservationId]
                  // Past the deposit time or 20:00 on the start date the API refuses a cancellation; the system expires it.
                  const late = depositMissed(r) || pickupMissed(r)
                  const canCancel = (r.status === 'PendingDeposit' || r.status === 'Confirmed') && cr?.status !== 'Pending' && !late
                  return (
                  <Fragment key={r.reservationId}>
                  <tr>
                    <td className="code">{r.reservationCode}{signedList[r.reservationCode] && <><br /><small className="ok-text">Đã đồng ý ĐK {fmtDate(signedList[r.reservationCode].at)}</small></>}</td>
                    <td>{r.facilityName}<br /><small className="muted">{splitTypeName(r.unitTypeName).name}{r.assignedUnitCode && ` · kho ${r.assignedUnitCode}`}</small></td>
                    <td>{fmtDate(r.expectedStartDate)}<br /><small className="muted">{r.durationMonths} tháng</small></td>
                    <td className="money">{fmtMoney(r.depositAmount)}{r.promoCode && <><br /><small className="ok-text">Mã {r.promoCode} · −{fmtMoney(r.promotionDiscountAmount ?? 0)}</small></>}</td>
                    <td>{r.status === 'PendingDeposit' ? fmtTime(depositDueAt(r)) : '—'}</td>
                    <td><AppointmentPicker reservation={r} operatingHours={facilities.find((f) => f.facilityName === r.facilityName)?.operatingHours}
                      onSaved={(u) => setReservations((rs) => rs.map((x) => (x.reservationId === u.reservationId ? u : x)))} /></td>
                    <td>
                      {late ? <span className="badge bad">{depositMissed(r) ? 'Quá hạn đặt cọc' : 'Quá hạn nhận kho'}</span> : <StatusBadge status={r.status} />}
                      {cr && <><br /><span className={`badge ${CancellationStatuses[cr.status]?.tone ?? 'muted'}`}>{CancellationStatuses[cr.status]?.label ?? cr.status}</span></>}
                    </td>
                    <td>
                      {canCancel && cancelling !== r.reservationId && (
                        <button type="button" className="link-btn danger-text" onClick={() => setCancelling(r.reservationId)}>Yêu cầu hủy</button>
                      )}
                    </td>
                  </tr>
                  {(cancelling === r.reservationId || (cr && cr.status !== 'Pending')) && (
                    <tr className="sub-row">
                      <td colSpan={8}>
                        {cancelling === r.reservationId
                          ? <CancelForm reservation={r} onDone={(c) => { setCancelling(null); if (c) setCancellations((m) => ({ ...m, [r.reservationId]: c })) }} />
                          : cr && <CancellationResult request={cr} />}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
            {reservations.length === 0 && <Empty icon="clipboard">Chưa có đơn đặt kho nào.</Empty>}
          </div>
        </section>
      </div>
    </>
  )
}

/** Reason form for POST /api/reservations/{id}/cancellation-requests. */
/** Start date: today or later (and before 19:00 when it is today, so there is still time to pay and pick up), within a year. */
function checkStartDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Vui lòng chọn ngày bắt đầu thuê'
  const today = todayIso()
  if (iso < today) return 'Ngày bắt đầu không được ở quá khứ'
  if (iso === today && new Date().getHours() >= 19) return 'Đã quá giờ nhận kho hôm nay, vui lòng chọn từ ngày mai'
  if (iso > localToday(365)) return 'Chỉ đặt trước tối đa 1 năm'
  return ''
}

function CancelForm({ reservation: r, onDone }: { reservation: Reservation; onDone: (c: CancellationRequest | null) => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const invalid = textError(reason, 'Lý do hủy', 5, 1000)
    if (invalid) { setError(invalid); return }
    setError('')
    setBusy(true)
    try {
      onDone(await api<CancellationRequest>(`/api/reservations/${r.reservationId}/cancellation-requests`, { body: { reason: reason.trim() } }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cancel-form">
      <div className="stack-sm grow">
        <b>Yêu cầu hủy đơn {r.reservationCode}</b>
        <small className="muted">
          {r.status === 'Confirmed'
            ? 'Bạn đã đặt cọc: khi nhân viên duyệt, cọc được hoàn lại sau khi trừ phí hủy theo chính sách thuê của cơ sở.'
            : 'Đơn chưa đặt cọc: khi nhân viên duyệt, đơn được hủy và không phát sinh phí.'}
        </small>
        <textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do hủy, vd: đổi kế hoạch chuyển nhà" autoFocus />
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      </div>
      <div className="row">
        <button type="button" className="btn ghost sm" onClick={() => onDone(null)}>Đóng</button>
        <button type="button" className="btn danger sm" disabled={busy} onClick={send}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu hủy'}</button>
      </div>
    </div>
  )
}

function CancellationResult({ request: c }: { request: CancellationRequest }) {
  return (
    <p className="muted cancel-result">
      <Icon name={c.status === 'Approved' ? 'check' : 'alert'} size={14} /> Yêu cầu hủy {c.status === 'Approved' ? 'đã được duyệt' : 'bị từ chối'}
      {c.resolvedAt && ` lúc ${fmtTime(c.resolvedAt)}`}
      {c.status === 'Approved' && c.approvedRefundAmount != null && <> · hoàn cọc <b>{fmtMoney(c.approvedRefundAmount)}</b></>}
      {c.resolutionNotes && <> · ghi chú: {c.resolutionNotes}</>}
    </p>
  )
}
