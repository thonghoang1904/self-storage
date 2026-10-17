import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { PageHero } from '../components/layout'
import { Empty, Icon, splitTypeName, StatusBadge, UnitArt } from '../components/ui'
import type { Availability, Facility, Reservation, UnitType } from '../types'

const DURATIONS = [1, 3, 6, 12]
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
  const [startDate, setStartDate] = useState(todayIso)
  const [months, setMonths] = useState(6)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Reservation | null>(null)

  const loadReservations = () => api<Reservation[]>('/api/reservations/my').then(setReservations).catch(() => {})

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

  const reserve = async () => {
    if (!facilityId || !selected) return
    setError('')
    setBusy(true)
    try {
      const r = await api<Reservation>('/api/reservations', {
        body: { facilityId, unitTypeId: selected.unitTypeId, expectedStartDate: startDate, durationMonths: months },
      })
      setCreated(r)
      void loadReservations()
      setAvailability(await api<Availability[]>(`/api/facilities/${facilityId}/availability`))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHero center eyebrow="Đặt kho nhanh chóng · chỉ trong 3 bước" title="Đặt Kho Lưu Trữ SafeKeep">
        Chọn cơ sở và kích thước kho, giữ chỗ ngay hôm nay. Đơn được giữ 24 giờ để bạn đến cơ sở đặt cọc.
      </PageHero>

      <div className="container page-body">
        {created && (
          <div className="success-panel">
            <span className="success-icon"><Icon name="check" size={22} /></span>
            <div className="grow">
              <h3>Đã giữ chỗ thành công · {created.reservationCode}</h3>
              <p>
                {splitTypeName(created.unitTypeName).name} tại {created.facilityName}, bắt đầu {fmtDate(created.expectedStartDate)} trong {created.durationMonths} tháng.
                Vui lòng đặt cọc <b>{fmtMoney(created.depositAmount)}</b> trước <b>{fmtTime(created.depositDeadline)}</b>. Nhân viên sẽ xác nhận cọc và bàn giao kho cho bạn.
              </p>
            </div>
            <button className="icon-btn" aria-label="Đóng" onClick={() => setCreated(null)}><Icon name="x" /></button>
          </div>
        )}

        <div className="checkout-grid">
          <div className="stack-xl">
            <ol className="stepper">
              <li className="active"><span>1</span><div><small>Bước 1</small><b>Chọn kho</b></div></li>
              <li className={selected ? 'active' : ''}><span>2</span><div><small>Bước 2</small><b>Thời gian thuê</b></div></li>
              <li className={created ? 'active' : ''}><span>3</span><div><small>Bước 3</small><b>Giữ chỗ & đặt cọc</b></div></li>
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
            <div className="summary-total"><span>Tạm Tính</span><b>{fmtMoney(total)}</b></div>
            {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
            <button className="btn primary block lg" disabled={!selected || busy} onClick={reserve}>{busy ? 'Đang giữ chỗ…' : 'Giữ Chỗ Ngay'}</button>
            <p className="fine-print">Đơn được giữ 24 giờ. Thanh toán trực tuyến và khuyến mãi theo kỳ hạn chưa áp dụng ở phiên bản này.</p>
          </aside>
        </div>

        <section className="stack">
          <div className="row between">
            <h2 className="section-title">Đơn Đặt Kho Của Tôi</h2>
            <Link to="/my-units" className="link">Xem kho của tôi <Icon name="arrowRight" size={14} /></Link>
          </div>
          <div className="table-card">
            <table>
              <thead><tr><th>Mã đơn</th><th>Cơ sở · loại kho</th><th>Bắt đầu</th><th>Tiền cọc</th><th>Hạn cọc</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.reservationId}>
                    <td className="code">{r.reservationCode}</td>
                    <td>{r.facilityName}<br /><small className="muted">{splitTypeName(r.unitTypeName).name}{r.assignedUnitCode && ` · kho ${r.assignedUnitCode}`}</small></td>
                    <td>{fmtDate(r.expectedStartDate)}<br /><small className="muted">{r.durationMonths} tháng</small></td>
                    <td className="money">{fmtMoney(r.depositAmount)}</td>
                    <td>{r.status === 'PendingDeposit' ? fmtTime(r.depositDeadline) : '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reservations.length === 0 && <Empty icon="clipboard">Chưa có đơn đặt kho nào.</Empty>}
          </div>
        </section>
      </div>
    </>
  )
}
