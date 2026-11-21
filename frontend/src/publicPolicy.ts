import { useEffect, useState } from 'react'
import { api, fmtMoney } from './api'
import type { FeeConfiguration, Promotion } from './types'

/**
 * Public catalog data (CatalogController, no login needed): the policy that applies to one facility, the fee table
 * and the live promotions. The fee table is never copied into the frontend: when it cannot be read the pages say
 * "theo bảng phí hiện hành" instead of showing a price that may be out of date.
 */
export interface EffectiveRentalPolicy {
  depositPercent: number
  cancellationGraceHours: number
  cancellationFeePercent: number
  renewalNoticeDays: number
  maxOverdueDaysBeforeLock: number
  depositPaymentHours: number
}
export const DEFAULT_POLICY: EffectiveRentalPolicy = {
  depositPercent: 100, cancellationGraceHours: 24, cancellationFeePercent: 10, renewalNoticeDays: 7, maxOverdueDaysBeforeLock: 1, depositPaymentHours: 24,
}

export function useRentalPolicy(facilityId: number | null | undefined) {
  const [policy, setPolicy] = useState<EffectiveRentalPolicy>(DEFAULT_POLICY)
  useEffect(() => {
    if (!facilityId) return
    let live = true
    api<EffectiveRentalPolicy>(`/api/facilities/${facilityId}/rental-policy`)
      .then((p) => { if (live) setPolicy({ ...DEFAULT_POLICY, ...p }) })
      .catch(() => { if (live) setPolicy(DEFAULT_POLICY) })
    return () => { live = false }
  }, [facilityId])
  return policy
}

let feesRequest: Promise<FeeConfiguration[]> | null = null
export function useFees() {
  const [fees, setFees] = useState<FeeConfiguration[]>([])
  useEffect(() => {
    let live = true
    // A failed read is not cached, so the next page tries again.
    feesRequest ??= api<FeeConfiguration[]>('/api/fees').catch(() => { feesRequest = null; return [] as FeeConfiguration[] })
    void feesRequest.then((f) => { if (live) setFees(f) })
    return () => { live = false }
  }, [])
  return fees
}

export function usePromotions() {
  const [promos, setPromos] = useState<Promotion[]>([])
  useEffect(() => { api<Promotion[]>('/api/promotions').then(setPromos).catch(() => setPromos([])) }, [])
  return promos
}

/**
 * Daily overdue storage fee as OverdueService charges it: a flat amount (DailyRate) or a percentage of the daily rent
 * (Percentage: monthly rent × % / 3000). Without a monthly rent, a percentage is described instead of priced.
 */
export function lateFeeText(fees: FeeConfiguration[], monthlyRent?: number) {
  const f = fees.find((x) => x.feeCode === 'LATE_FEE_DAILY')
  if (!f) return 'theo bảng phí hiện hành'
  if (f.calculationMethod === 'Percentage') {
    return monthlyRent ? `${fmtMoney(Math.round(monthlyRent * f.defaultAmount / 3000))}/ngày (${f.defaultAmount}% tiền thuê một ngày)` : `${f.defaultAmount}% tiền thuê một ngày`
  }
  return `${fmtMoney(f.defaultAmount)}/ngày`
}
export function lateFeePerDay(fees: FeeConfiguration[], monthlyRent: number) {
  const f = fees.find((x) => x.feeCode === 'LATE_FEE_DAILY')
  if (!f) return null
  return f.calculationMethod === 'Percentage' ? Math.round(monthlyRent * f.defaultAmount / 3000) : f.defaultAmount
}

/** Fees the system charges by itself (OverdueService, early return): staff never bill them by hand. */
export const SYSTEM_FEE_CODES = ['LATE_FEE_DAILY', 'EARLY_RETURN_FEE']
export const chargeableFees = (fees: FeeConfiguration[]) => fees.filter((f) => !SYSTEM_FEE_CODES.includes(f.feeCode))

/** Unit price of an extra charge as FacilityManagementController bills it: Fixed / DailyRate as is, Percentage of the monthly rent. */
export const extraChargePrice = (f: FeeConfiguration, monthlyRent: number) =>
  f.calculationMethod === 'Percentage' ? Math.round(monthlyRent * f.defaultAmount / 100) : f.defaultAmount

/** When OverdueService locks a unit that was not returned: MaxOverdueDaysBeforeLock days after 20:00 on the end date. */
export const lockDelayText = (p: EffectiveRentalPolicy) =>
  p.maxOverdueDaysBeforeLock <= 0 ? 'ngay khi quá 20:00 ngày hết hạn' : `sau ${p.maxOverdueDaysBeforeLock * 24} giờ kể từ 20:00 ngày hết hạn`

/** Static texts write {HOLD_HOURS}, {DEPOSIT} and {LOCK_DELAY} where the facility's own policy numbers go. */
export const fillPolicy = (text: string, p: EffectiveRentalPolicy) => text
  .replace('{HOLD_HOURS}', `${p.depositPaymentHours} giờ`)
  .replace('{DEPOSIT}', `${p.depositPercent.toLocaleString('vi-VN')}% tiền thuê tháng`)
  .replace('{LOCK_DELAY}', lockDelayText(p))

/** Deposit the backend will invoice for a monthly rent (ReservationsController: monthly × depositPercent / 100). */
export const depositFor = (monthly: number, policy: EffectiveRentalPolicy) => Math.round(monthly * policy.depositPercent / 100)

/** Static texts (FAQ, terms, invoice notes) write {LATE_FEE} where the current daily overdue fee goes. */
export const LATE_FEE = '{LATE_FEE}'
export const fillFees = (text: string, fees: FeeConfiguration[], monthlyRent?: number) =>
  text.includes(LATE_FEE) ? text.replace(LATE_FEE, lateFeeText(fees, monthlyRent)) : text
