import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useStaffFacility } from '../components/layout'
import { appointmentReached } from '../components/appointment'
import { Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import type { Reservation, StorageUnit } from '../types'

const FILTERS = [
  { key: 'open', label: 'Cần xử lý' },
  { key: 'PendingDeposit', label: 'Chờ đặt cọc' },
  { key: 'Confirmed', label: 'Chờ bàn giao' },
  { key: 'all', label: 'Tất cả' },
] as const

/** Staff: confirm deposits and check customers in (assign a unit, which creates the contract). */
export default function StaffReservations() {
  const { facilityId } = useStaffFacility()
  const [rows, setRows] = useState<Reservation[]>([])
  const [units, setUnits] = useState<StorageUnit[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      const [r, u] = await Promise.all([
        api<Reservation[]>(`/api/facilities/${facilityId}/reservations`),
        api<StorageUnit[]>(`/api/facilities/${facilityId}/units?status=Available`),
      ])
      setRows(r)
      setUnits(u)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])

  useEffect(() => {
    void load()
    // Online payments confirm deposits on their own (gateway IPN): refresh so new "chờ bàn giao" orders appear without reloading.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15000)
    return () => window.clearInterval(t)
  }, [load])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(done)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const pending = rows.filter((r) => r.status === 'PendingDeposit').length
  const confirmed = rows.filter((r) => r.status === 'Confirmed').length
  const checkedIn = rows.filter((r) => r.status === 'CheckedIn').length
  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'open' ? r.status === 'PendingDeposit' || r.status === 'Confirmed' : r.status === filter)

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <div>
          <h1>Xác Nhận Cọc & Bàn Giao Kho</h1>
          <p className="muted">Khách đặt kho trực tuyến, nhân viên xác nhận đã nhận cọc rồi chọn kho cụ thể để bàn giao. Bàn giao sẽ tạo hợp đồng.</p>
        </div>
      </div>

      <div className="stat-grid three">
        <div className="stat-card"><div className="row between"><span className="muted">Chờ đặt cọc</span><span className="stat-icon warn"><Icon name="wallet" size={17} /></span></div><b className="stat-value">{pending}</b><small className="stat-note warn">Giữ chỗ 24 giờ</small></div>
        <div className="stat-card"><div className="row between"><span className="muted">Chờ bàn giao</span><span className="stat-icon info"><Icon name="key" size={17} /></span></div><b className="stat-value">{confirmed}</b><small className="stat-note info">{units.length} kho đang trống</small></div>
        <div className="stat-card"><div className="row between"><span className="muted">Đã bàn giao</span><span className="stat-icon ok"><Icon name="check" size={17} /></span></div><b className="stat-value">{checkedIn}</b><small className="stat-note ok">Đã tạo hợp đồng</small></div>
      </div>

      <section className="panel">
        <div className="panel-head wrap">
          <h3 className="panel-title">Đơn đặt kho</h3>
          <div className="segmented">
            {FILTERS.map((f) => <button key={f.key} className={f.key === filter ? 'active' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>)}
          </div>
        </div>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mã đơn</th><th>Khách</th><th>Loại kho</th><th>Bắt đầu</th><th>Lịch hẹn nhận kho</th><th>Cọc</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.reservationId}>
                  <td className="code">{r.reservationCode}</td>
                  <td><b>{r.customerName}</b></td>
                  <td>{splitTypeName(r.unitTypeName).name}{r.assignedUnitCode && <><br /><small className="muted">Kho {r.assignedUnitCode}</small></>}</td>
                  <td>{fmtDate(r.expectedStartDate)}<br /><small className="muted">{r.durationMonths} tháng</small></td>
                  <td>{r.checkInAppointmentAt ? <b>{fmtTime(r.checkInAppointmentAt)}</b>
                    : r.status === 'Confirmed' ? <span className="pill warn">Khách chưa đặt lịch</span> : <span className="muted">—</span>}</td>
                  <td className="money">{fmtMoney(r.depositAmount)}{r.status === 'PendingDeposit' && <><br /><small className="muted">hạn {fmtTime(r.depositDeadline)}</small></>}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="right">
                    {r.status === 'PendingDeposit' && (
                      <button className="btn outline sm" onClick={() => act(() => api(`/api/reservations/${r.reservationId}/confirm-deposit`, { method: 'POST' }), `Đã xác nhận cọc cho đơn ${r.reservationCode}.`)}>
                        <Icon name="wallet" size={15} /> Đã nhận cọc
                      </button>
                    )}
                    {r.status === 'Confirmed' && !r.checkInAppointmentAt && <span className="muted">Chờ khách đặt lịch nhận kho</span>}
                    {r.status === 'Confirmed' && r.checkInAppointmentAt && !appointmentReached(r) && <span className="muted">Bàn giao từ {fmtTime(r.checkInAppointmentAt)}</span>}
                    {r.status === 'Confirmed' && appointmentReached(r) && (
                      <CheckIn
                        units={units.filter((u) => u.unitTypeName === r.unitTypeName)}
                        onCheckIn={(unit) => act(() => api(`/api/reservations/${r.reservationId}/check-in`, { body: { unitId: unit.unitId } }), `Đã bàn giao kho ${unit.unitCode} cho ${r.customerName} và tạo hợp đồng.`)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <Empty icon="clipboard">Không có đơn nào trong mục này.</Empty>}
        </div>
      </section>
    </div>
  )
}

function CheckIn({ units, onCheckIn }: { units: StorageUnit[]; onCheckIn: (unit: StorageUnit) => void }) {
  const [unitId, setUnitId] = useState<number | ''>(units[0]?.unitId ?? '')
  useEffect(() => {
    if (!units.some((u) => u.unitId === unitId)) setUnitId(units[0]?.unitId ?? '')
  }, [units, unitId])
  if (!units.length) return <span className="muted">Hết kho trống cùng loại</span>
  return (
    <span className="row end">
      <select value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
        {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitCode} · {u.zoneArea}</option>)}
      </select>
      <button className="btn primary sm" onClick={() => { const u = units.find((x) => x.unitId === unitId); if (u) onCheckIn(u) }}>Bàn giao</button>
    </span>
  )
}
