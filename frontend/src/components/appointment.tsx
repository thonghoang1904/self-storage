import { useState } from 'react'
import { api, fmtTime } from '../api'
import type { Reservation } from '../types'
import { Icon } from './ui'

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Facility hours such as "06:00 - 22:00"; falls back to office hours when the text cannot be read. */
function openHours(operatingHours?: string): [number, number] {
  const m = operatingHours?.match(/(\d{1,2})[:h](\d{2})?\s*[-–]\s*(\d{1,2})[:h](\d{2})?/)
  if (!m) return [8 * 60, 20 * 60]
  return [Number(m[1]) * 60 + Number(m[2] ?? 0), Number(m[3]) * 60 + Number(m[4] ?? 0)]
}

/**
 * Half-hour pick-up slots on the reservation start date, inside the facility's opening hours,
 * ending an hour before closing so there is time to hand the unit over. Past slots are left out.
 */
export function appointmentSlots(startDate: string, operatingHours?: string, now = new Date()): string[] {
  const [open, close] = openHours(operatingHours)
  const slots: string[] = []
  // The backend accepts pick-up times before 20:00 only.
  for (let t = Math.ceil(open / 30) * 30; t <= Math.min(close - 60, 19 * 60 + 30); t += 30) {
    const hhmm = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
    if (new Date(`${startDate}T${hhmm}:00+07:00`) > now) slots.push(hhmm)
  }
  return slots
}

/** 20:00 on the start date: after that a paid reservation that was not picked up expires (no-show). */
export const pickupClosesAt = (r: Reservation) => new Date(`${r.expectedStartDate}T20:00:00+07:00`)

/**
 * When the deposit really has to be paid: 24 hours after booking, but never later than 20:00 on the start date.
 * A deposit paid after that would confirm a reservation that expires as a no-show straight away.
 */
export const depositDueAt = (r: Reservation) => {
  const due = Math.min(new Date(r.depositDeadline).getTime(), pickupClosesAt(r).getTime())
  return new Date(due).toISOString()
}

/** Unpaid and past its deposit time: it can no longer be confirmed, the customer has to book again. */
export const depositMissed = (r: Reservation, now = new Date()) => r.status === 'PendingDeposit' && new Date(depositDueAt(r)) <= now

/** Paid but not picked up by 20:00 on the start date: the system cancels it and refunds the deposit minus the fee. */
export const pickupMissed = (r: Reservation, now = new Date()) => r.status === 'Confirmed' && pickupClosesAt(r) <= now

/** True once the appointment time has come, which is when staff may hand the unit over. */
export const appointmentReached = (r: Reservation, now = new Date()) =>
  !!r.checkInAppointmentAt && new Date(r.checkInAppointmentAt) <= now

/**
 * Customer: choose (or move) the time to come and collect a reserved unit.
 * Only a confirmed reservation can be booked, on its start date and in the future (PUT /api/reservations/{id}/appointment).
 * Times are sent with the Vietnam offset because every facility is in Vietnam.
 */
export function AppointmentPicker({ reservation: r, operatingHours, onSaved, defaultOpen = false }: {
  reservation: Reservation
  operatingHours?: string
  onSaved: (updated: Reservation) => void
  /** Open the time picker straight away (right after the deposit is paid). */
  defaultOpen?: boolean
}) {
  const slots = appointmentSlots(r.expectedStartDate, operatingHours)
  const current = r.checkInAppointmentAt ? r.checkInAppointmentAt.slice(11, 16) : ''
  const [open, setOpen] = useState(defaultOpen && !r.checkInAppointmentAt && slots.length > 0)
  const [time, setTime] = useState(open ? slots[0] : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (r.status !== 'Confirmed')
    return r.checkInAppointmentAt ? <span>{fmtTime(r.checkInAppointmentAt)}</span> : <span className="muted">—</span>

  const save = async () => {
    const chosen = time || slots[0]
    if (!chosen) return
    setError('')
    setBusy(true)
    try {
      const updated = await api<Reservation>(`/api/reservations/${r.reservationId}/appointment`, {
        method: 'PUT',
        body: { appointmentAt: `${r.expectedStartDate}T${chosen}:00+07:00` },
      })
      setOpen(false)
      onSaved(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <span className="appt">
        {r.checkInAppointmentAt
          ? <b className="appt-time"><Icon name="clock" size={14} /> {fmtTime(r.checkInAppointmentAt)}</b>
          : <span className="pill warn">Chưa đặt lịch</span>}
        {slots.length > 0 && (
          <button type="button" className="link-btn" onClick={() => { setTime(slots.includes(current) ? current : slots[0]); setOpen(true) }}>
            {r.checkInAppointmentAt ? 'Đổi giờ' : 'Đặt lịch nhận kho'}
          </button>
        )}
        {slots.length === 0 && !r.checkInAppointmentAt && (
          <small className="muted">{r.expectedStartDate < localDate(new Date()) ? 'Đã qua ngày nhận kho, vui lòng gọi cơ sở' : 'Hết giờ nhận kho hôm nay, vui lòng gọi cơ sở'}</small>
        )}
      </span>
    )
  }

  return (
    <span className="appt editing">
      <small className="muted">Giờ đến nhận kho ngày {r.expectedStartDate.split('-').reverse().join('/')}</small>
      <span className="row">
        <select value={time} onChange={(e) => setTime(e.target.value)} aria-label="Giờ nhận kho">
          {slots.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Chốt giờ nhận kho'}</button>
        <button type="button" className="btn ghost sm" onClick={() => { setOpen(false); setError('') }}>Hủy</button>
      </span>
      {error && <small className="bad-text"><Icon name="alert" size={13} /> {error}</small>}
    </span>
  )
}
