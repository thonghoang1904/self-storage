import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, fmtDate, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Roles, type Reservation } from '../types'
import { depositDueAt, depositMissed, pickupMissed } from './appointment'
import { Icon, splitTypeName } from './ui'

/**
 * "Việc cần làm" bar under the customer header, on every portal page, so a step that blocks the customer is not lost
 * among notifications (the pattern shops and booking sites use for "chờ xác nhận / cần thanh toán"):
 * a paid reservation still without a pickup time comes first, then a deposit still to pay.
 * Reloaded on each page change (GET /api/reservations/my).
 */
export function ActionBanner() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [rows, setRows] = useState<Reservation[]>([])

  useEffect(() => {
    if (user?.role !== Roles.Customer) { setRows([]); return }
    api<Reservation[]>('/api/reservations/my').then(setRows).catch(() => setRows([]))
  }, [user?.role, pathname])

  if (user?.role !== Roles.Customer) return null
  const needTime = rows.filter((r) => r.status === 'Confirmed' && !r.checkInAppointmentAt && !pickupMissed(r))
  const needDeposit = rows.filter((r) => r.status === 'PendingDeposit' && !depositMissed(r))
  const r = needTime[0]
  // Already on the page that does it: nothing to point at.
  if (r && pathname === `/reservations/${r.reservationId}/pickup`) return null

  if (r) {
    const more = needTime.length - 1
    return (
      <div className="action-banner">
        <div className="container action-banner-inner">
          <span className="action-banner-icon"><Icon name="calendar" size={20} /></span>
          <div className="grow">
            <b>Việc cần làm: đặt lịch nhận kho</b>
            <p>Đơn {r.reservationCode} ({splitTypeName(r.unitTypeName).name}, {r.facilityName}) đã nhận cọc. Chọn giờ đến nhận kho trong ngày {fmtDate(r.expectedStartDate)}, trước 20:00{more > 0 ? ` · còn ${more} đơn khác cần đặt lịch` : ''}.</p>
          </div>
          <Link to={`/reservations/${r.reservationId}/pickup`} className="btn primary"><Icon name="calendar" size={16} /> Đặt lịch ngay</Link>
        </div>
      </div>
    )
  }
  const d = needDeposit[0]
  if (d && pathname !== '/invoices') {
    return (
      <div className="action-banner deposit">
        <div className="container action-banner-inner">
          <span className="action-banner-icon"><Icon name="wallet" size={20} /></span>
          <div className="grow">
            <b>Việc cần làm: thanh toán tiền cọc</b>
            <p>Đơn {d.reservationCode} ({d.facilityName}) đang giữ chỗ đến {fmtTime(depositDueAt(d))}; quá hạn đơn tự hủy.</p>
          </div>
          <Link to="/invoices" className="btn primary"><Icon name="wallet" size={16} /> Thanh toán cọc</Link>
        </div>
      </div>
    )
  }
  return null
}
