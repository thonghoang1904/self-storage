import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, billingLink, fmtDate, fmtMoney, fmtTime } from '../api'
import { useStaffFacility } from '../components/layout'
import { appointmentReached, depositDueAt, depositMissed, pickupMissed } from '../components/appointment'
import { Badge, Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import type { Reservation, StorageUnit } from '../types'
import { Select } from '../components/Select'
import { StatChip } from '../components/StatCard'

const FILTERS = [
  { key: 'open', label: 'Cần xử lý' },
  { key: 'PendingDeposit', label: 'Chờ đặt cọc' },
  { key: 'Confirmed', label: 'Chờ bàn giao' },
  { key: 'CheckedIn', label: 'Đã bàn giao' },
  { key: 'all', label: 'Tất cả' },
] as const

/**
 * Staff: confirm deposits and check customers in (assign a unit, which creates the contract).
 * Two time limits matter: the deposit is due 24 hours after booking but never after 20:00 on the start date,
 * and a paid reservation not picked up by 20:00 on the start date expires (the system refunds minus the fee).
 * Rows past either limit are marked and offer no action, since the API refuses them.
 */
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

  // One action at a time: a double click must not confirm or hand over twice.
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(done)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const now = new Date()
  const showOnly = (key: (typeof FILTERS)[number]['key']) => {
    setFilter(key)
    document.getElementById('reservation-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const pending = rows.filter((r) => r.status === 'PendingDeposit' && !depositMissed(r, now)).length
  const confirmed = rows.filter((r) => r.status === 'Confirmed' && !pickupMissed(r, now)).length
  const late = rows.filter((r) => depositMissed(r, now) || pickupMissed(r, now)).length
  const checkedIn = rows.filter((r) => r.status === 'CheckedIn').length
  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'open' ? r.status === 'PendingDeposit' || r.status === 'Confirmed' : r.status === filter)

  return (
    <div className="stack-xl">
      <div className="page-top">
        <div>
          <h1>Xác Nhận Cọc & Bàn Giao Kho</h1>
          <p className="muted">Khách đặt kho trực tuyến và chuyển khoản cọc; nhân viên chọn kho cụ thể để bàn giao. Bàn giao sẽ tạo hợp đồng.</p>
        </div>
        {/* Each counter filters the list below to its orders. */}
        <div className="stat-chips">
          <StatChip icon="wallet" tone="warn" label="chờ đặt cọc" value={pending} hint="Quá hạn cọc đơn tự hủy, chậm nhất 20:00 ngày bắt đầu" active={filter === 'PendingDeposit'} onClick={() => showOnly('PendingDeposit')} />
          <StatChip icon="key" tone={late ? 'bad' : 'info'} label="chờ bàn giao" value={confirmed} extra={late ? `${late} quá hạn` : `${units.length} kho trống`} active={filter === 'Confirmed'} onClick={() => showOnly('Confirmed')} />
          <StatChip icon="check" tone="ok" label="đã bàn giao" value={checkedIn} hint="Đã tạo hợp đồng" active={filter === 'CheckedIn'} onClick={() => showOnly('CheckedIn')} />
        </div>
      </div>

      <section className="panel" id="reservation-list">
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
                  <td><Link to={billingLink(r.reservationCode)} className="code link" title="Xem hóa đơn của đơn này">{r.reservationCode}</Link></td>
                  <td><b>{r.customerName}</b></td>
                  <td>{splitTypeName(r.unitTypeName).name}{r.assignedUnitCode && <><br /><small className="muted">Kho {r.assignedUnitCode}</small></>}</td>
                  <td>{fmtDate(r.expectedStartDate)}<br /><small className="muted">{r.durationMonths} tháng</small></td>
                  <td>{pickupMissed(r, now) ? <span className="pill bad">Quá 20:00 ngày bắt đầu</span>
                    : r.checkInAppointmentAt ? <b>{fmtTime(r.checkInAppointmentAt)}</b>
                    : r.status === 'Confirmed' ? <span className="pill warn">Khách chưa đặt lịch</span> : <span className="muted">—</span>}</td>
                  <td className="money">{fmtMoney(r.depositAmount)}{r.status === 'PendingDeposit' && (
                    <><br /><small className={depositMissed(r, now) ? 'danger-text' : 'muted'}>hạn {fmtTime(depositDueAt(r))}</small></>)}</td>
                  <td>{depositMissed(r, now) ? <Badge tone="bad">Quá hạn cọc</Badge> : pickupMissed(r, now) ? <Badge tone="bad">Quá hạn nhận kho</Badge> : <StatusBadge status={r.status} />}</td>
                  <td className="right">
                    {depositMissed(r, now) && <span className="muted">Khách không cọc kịp, cần đặt lại</span>}
                    {pickupMissed(r, now) && (
                      <span className="muted">Khách không đến nhận kho. Hệ thống tự hủy, hoàn cọc trừ phí hủy · <Link to="/staff-cancellations" className="link">Hủy đơn & hoàn tiền</Link></span>
                    )}
                    {r.status === 'PendingDeposit' && !depositMissed(r, now) && <small className="muted">Chờ khách chuyển khoản cọc</small>}
                    {r.status === 'Confirmed' && !pickupMissed(r, now) && (
                      <>
                      <small className={`handover-hint ${appointmentReached(r) ? 'ok-text' : 'muted'}`}>
                        {!r.checkInAppointmentAt ? 'Khách chưa hẹn giờ · có thể bàn giao ngay'
                          : appointmentReached(r) ? `Đã tới giờ hẹn ${fmtTime(r.checkInAppointmentAt)}`
                          : `Hẹn ${fmtTime(r.checkInAppointmentAt)} · có thể bàn giao sớm`}
                      </small>
                      <CheckIn
                        busy={busy}
                        units={units.filter((u) => u.unitTypeName === r.unitTypeName)}
                        onCheckIn={(unit) => act(() => api(`/api/reservations/${r.reservationId}/check-in`, { body: { unitId: unit.unitId } }), `Đã bàn giao kho ${unit.unitCode} cho ${r.customerName} và tạo hợp đồng.`)}
                      />
                      </>
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

function CheckIn({ units, onCheckIn, busy }: { units: StorageUnit[]; onCheckIn: (unit: StorageUnit) => void; busy: boolean }) {
  const [unitId, setUnitId] = useState<number | ''>(units[0]?.unitId ?? '')
  useEffect(() => {
    if (!units.some((u) => u.unitId === unitId)) setUnitId(units[0]?.unitId ?? '')
  }, [units, unitId])
  if (!units.length) return <span className="muted">Hết kho trống cùng loại</span>
  return (
    <span className="row end">
      <Select value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
        {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitCode} · {u.zoneArea}</option>)}
      </Select>
      <button className="btn primary sm" disabled={busy} onClick={() => { const u = units.find((x) => x.unitId === unitId); if (u) onCheckIn(u) }}>Bàn giao</button>
    </span>
  )
}
