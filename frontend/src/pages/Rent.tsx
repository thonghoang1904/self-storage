import { useEffect, useState } from 'react'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import type { Availability, Facility, Reservation } from '../types'

/** Customer: choose a facility and unit type, reserve, and see reservations. */
export default function Rent() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  const [availability, setAvailability] = useState<Availability[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [months, setMonths] = useState(1)
  const [error, setError] = useState('')

  const loadReservations = () => api<Reservation[]>('/api/reservations/my').then(setReservations)

  useEffect(() => {
    api<Facility[]>('/api/facilities').then((fs) => {
      setFacilities(fs)
      if (fs.length) setFacilityId(fs[0].facilityId)
    })
    void loadReservations()
  }, [])

  useEffect(() => {
    if (facilityId) api<Availability[]>(`/api/facilities/${facilityId}/availability`).then(setAvailability)
  }, [facilityId])

  const reserve = async (unitTypeId: number) => {
    setError('')
    try {
      await api('/api/reservations', { body: { facilityId, unitTypeId, expectedStartDate: startDate, durationMonths: months } })
      void loadReservations()
      if (facilityId) setAvailability(await api<Availability[]>(`/api/facilities/${facilityId}/availability`))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const facility = facilities.find((f) => f.facilityId === facilityId)

  return (
    <div className="page">
      <h2>Thuê kho</h2>
      <div className="row wrap">
        <select value={facilityId ?? ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
          {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
        </select>
        <label>Từ ngày <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label>Số tháng <input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} /></label>
      </div>
      {facility && <p className="muted">{facility.address}, {facility.district}, {facility.city} · Giờ mở cửa: {facility.operatingHours}</p>}
      {error && <p className="error">{error}</p>}

      <div className="grid">
        {availability.map((a) => (
          <div key={a.unitTypeId} className="card">
            <h3>{a.typeName}</h3>
            <p>{fmtMoney(a.baseMonthlyRate)}/tháng</p>
            <p className="muted">Còn trống: {a.availableUnits}</p>
            <p className="muted">Tạm tính {months} tháng: {fmtMoney(a.baseMonthlyRate * months)}</p>
            <button className="btn primary" disabled={a.availableUnits === 0} onClick={() => reserve(a.unitTypeId)}>Đặt kho</button>
          </div>
        ))}
      </div>

      <h3>Đơn đặt kho của tôi</h3>
      <table>
        <thead><tr><th>Mã đơn</th><th>Loại kho</th><th>Bắt đầu</th><th>Tiền cọc</th><th>Hạn cọc</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.reservationId}>
              <td>{r.reservationCode}</td>
              <td>{r.unitTypeName}{r.assignedUnitCode && ` · ${r.assignedUnitCode}`}</td>
              <td>{fmtDate(r.expectedStartDate)} ({r.durationMonths} th)</td>
              <td>{fmtMoney(r.depositAmount)}</td>
              <td>{fmtTime(r.depositDeadline)}</td>
              <td><span className="badge">{r.status}</span></td>
            </tr>
          ))}
          {reservations.length === 0 && <tr><td colSpan={6} className="muted">Chưa có đơn nào.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
