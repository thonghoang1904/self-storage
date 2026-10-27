import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { AppointmentPicker, pickupMissed } from '../components/appointment'
import { PageHero } from '../components/layout'
import { Icon, splitTypeName, StatusBadge } from '../components/ui'
import type { Facility, Reservation } from '../types'

/**
 * /reservations/:id/pickup: its own page to book the time to come and take over the unit once the deposit is paid
 * (PUT /api/reservations/{id}/appointment through AppointmentPicker). Staff hand the unit over from that time on.
 */
export default function PickupAppointment() {
  const id = Number(useParams().id)
  const [r, setR] = useState<Reservation | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api<Reservation[]>('/api/reservations/my')
      .then((rs) => {
        const found = rs.find((x) => x.reservationId === id)
        if (!found) { setError('Không tìm thấy đơn đặt kho này'); return }
        setR(found)
        api<Facility[]>('/api/facilities').then((fs) => setFacility(fs.find((f) => f.facilityName === found.facilityName) ?? null)).catch(() => {})
      })
      .catch((e) => setError((e as Error).message))
  }, [id])

  const missed = r ? pickupMissed(r) : false
  return (
    <>
      <PageHero eyebrow="Nhận kho" title="Đặt Lịch Nhận Kho">
        Chọn giờ bạn đến cơ sở nhận kho. Nhân viên chỉ bàn giao kho từ giờ hẹn, trong ngày bắt đầu thuê.
      </PageHero>
      <div className="container page-body">
        <Link to="/my-units" className="link with-icon"><Icon name="arrowLeft" size={15} /> Quay lại kho của tôi</Link>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        {!r ? (!error && <p className="muted">Đang tải…</p>) : (
          <div className="policy-layout">
            <section className="panel stack">
              <div className="row between wrap">
                <h2 className="panel-title">Đơn {r.reservationCode}</h2>
                <StatusBadge status={r.status} />
              </div>
              <div className="info-row"><span className="muted">Cơ sở</span><b>{r.facilityName}</b></div>
              <div className="info-row"><span className="muted">Loại kho</span><b>{splitTypeName(r.unitTypeName).name}</b></div>
              <div className="info-row"><span className="muted">Ngày bắt đầu</span><b>{fmtDate(r.expectedStartDate)} · {r.durationMonths} tháng</b></div>
              <div className="info-row"><span className="muted">Tiền cọc</span><b>{fmtMoney(r.depositAmount)}</b></div>
              {facility && <div className="info-row"><span className="muted">Giờ mở cửa</span><b>{facility.operatingHours}</b></div>}
              {r.checkInAppointmentAt && <div className="info-row"><span className="muted">Giờ hẹn hiện tại</span><b>{fmtTime(r.checkInAppointmentAt)}</b></div>}
            </section>
            <aside className="panel stack">
              <h2 className="panel-title">Chọn giờ nhận kho</h2>
              {r.status !== 'Confirmed' ? (
                <p className="alert info"><Icon name="alert" size={16} />
                  {r.status === 'PendingDeposit' ? 'Đơn chưa đặt cọc: thanh toán cọc trước rồi mới chọn giờ nhận kho.' : 'Đơn này không còn chờ nhận kho.'}
                </p>
              ) : missed ? (
                <p className="alert bad"><Icon name="alert" size={16} />Đã quá 20:00 ngày {fmtDate(r.expectedStartDate)} mà chưa nhận kho; đơn sẽ tự hủy và hoàn cọc sau khi trừ phí hủy.</p>
              ) : (
                <>
                  <p className="muted">Giờ đến phải trong ngày {fmtDate(r.expectedStartDate)}, trong giờ mở cửa và trước 20:00.</p>
                  <AppointmentPicker reservation={r} operatingHours={facility?.operatingHours} defaultOpen
                    onSaved={(u) => { setR(u); setSaved(true) }} />
                  {saved && r.checkInAppointmentAt && (
                    <p className="alert ok"><Icon name="check" size={16} />Đã chốt giờ nhận kho {fmtTime(r.checkInAppointmentAt)}. Mang CCCD đến đúng giờ để nhân viên bàn giao kho.</p>
                  )}
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  )
}
