import { useEffect, useState } from 'react'
import { api, fmtMoney } from './api'
import { ExtraChargeFees, type FeeConfiguration, type Promotion } from './types'

/**
 * Public catalog data (CatalogController, no login needed): the policy that applies to one facility, the fee table
 * and the live promotions. Each hook falls back to the seeded defaults when the backend does not answer, so the
 * pages still render with an older backend.
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

const FALLBACK_FEES: FeeConfiguration[] = ExtraChargeFees.map((f) => ({
  feeTypeId: f.feeTypeId, feeCode: f.feeCode, feeName: f.feeName, defaultAmount: f.defaultAmount,
  calculationMethod: f.perDay ? 'DailyRate' : 'Fixed', description: null,
}))
let feesRequest: Promise<FeeConfiguration[]> | null = null
export function useFees() {
  const [fees, setFees] = useState<FeeConfiguration[]>(FALLBACK_FEES)
  useEffect(() => {
    let live = true
    feesRequest ??= api<FeeConfiguration[]>('/api/fees').then((f) => (f.length ? f : FALLBACK_FEES)).catch(() => FALLBACK_FEES)
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

/** Deposit the backend will invoice for a monthly rent (ReservationsController: monthly × depositPercent / 100). */
export const depositFor = (monthly: number, policy: EffectiveRentalPolicy) => Math.round(monthly * policy.depositPercent / 100)

/** Static texts (FAQ, terms, invoice notes) write {LATE_FEE} where the current daily overdue fee goes. */
export const LATE_FEE = '{LATE_FEE}'
export const fillFees = (text: string, fees: FeeConfiguration[], monthlyRent?: number) =>
  text.includes(LATE_FEE) ? text.replace(LATE_FEE, lateFeeText(fees, monthlyRent)) : text
