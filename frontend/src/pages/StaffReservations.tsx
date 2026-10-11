import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import type { Facility, Reservation, StorageUnit } from '../types'

/** Staff: confirm deposits and check customers in (assign a unit, which creates the contract). */
export default function StaffReservations() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  const [rows, setRows] = useState<Reservation[]>([])
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<Facility[]>('/api/gate/my-facilities').then((fs) => {
      setFacilities(fs)
      if (fs.length) setFacilityId(fs[0].facilityId)
    })
  }, [])

  const load = useCallback(async () => {
    if (!facilityId) return
    const [r, u] = await Promise.all([
      api<Reservation[]>(`/api/facilities/${facilityId}/reservations`),
      api<StorageUnit[]>(`/api/facilities/${facilityId}/units?status=Available`),
    ])
    setRows(r)
    setUnits(u)
  }, [facilityId])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="page">
      <div className="row between">
        <h2>Đặt kho & nhận kho</h2>
        <select value={facilityId ?? ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
          {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Mã đơn</th><th>Khách</th><th>Loại kho</th><th>Bắt đầu</th><th>Cọc</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reservationId}>
              <td>{r.reservationCode}</td>
              <td>{r.customerName}</td>
              <td>{r.unitTypeName}{r.assignedUnitCode && ` · ${r.assignedUnitCode}`}</td>
              <td>{fmtDate(r.expectedStartDate)}</td>
              <td>{fmtMoney(r.depositAmount)}</td>
              <td><span className="badge">{r.status}</span></td>
              <td>
                {r.status === 'PendingDeposit' && (
                  <button className="btn" onClick={() => act(() => api(`/api/reservations/${r.reservationId}/confirm-deposit`, { method: 'POST' }))}>
                    Đã nhận cọc
                  </button>
                )}
                {r.status === 'Confirmed' && (
                  <CheckIn
                    units={units.filter((u) => u.unitTypeName === r.unitTypeName)}
                    onCheckIn={(unitId) => act(() => api(`/api/reservations/${r.reservationId}/check-in`, { body: { unitId } }))}
                  />
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">Chưa có đơn nào.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function CheckIn({ units, onCheckIn }: { units: StorageUnit[]; onCheckIn: (unitId: number) => void }) {
  const [unitId, setUnitId] = useState<number | ''>(units[0]?.unitId ?? '')
  if (!units.length) return <span className="muted">Hết kho trống</span>
  return (
    <span className="row">
      <select value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
        {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitCode}</option>)}
      </select>
      <button className="btn primary" onClick={() => unitId && onCheckIn(unitId)}>Bàn giao</button>
    </span>
  )
}
