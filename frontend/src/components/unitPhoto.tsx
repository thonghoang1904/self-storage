import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ContractDetail, StorageUnit } from '../types'
import { UnitArt } from './ui'

/** Photo index (0 locker, 1 small, 2 medium, 3 large) for a unit type, by name with the type id as fallback. */
export function photoVariant(typeName?: string | null, typeId?: number): number {
  const n = (typeName ?? '').toLowerCase()
  if (/locker|tủ/.test(n)) return 0
  if (/nhỏ|small|\bs\b/.test(n)) return 1
  if (/tiêu chuẩn|vừa|medium|\bm\b/.test(n)) return 2
  if (/lớn|large|\bl\b/.test(n)) return 3
  return typeId ? Math.max(0, Math.min(3, typeId - 1)) : 2
}

// One request per facility, shared by every photo on the page.
const unitsByFacility = new Map<number, Promise<StorageUnit[]>>()
function facilityUnits(facilityId: number) {
  let p = unitsByFacility.get(facilityId)
  if (!p) {
    p = api<StorageUnit[]>(`/api/facilities/${facilityId}/units`).catch(() => [] as StorageUnit[])
    unitsByFacility.set(facilityId, p)
  }
  return p
}

// One request per contract, shared by every photo on the page.
const typeByContract = new Map<number, Promise<{ name: string; id: number } | null>>()
function contractType(contractId: number) {
  let p = typeByContract.get(contractId)
  if (!p) {
    p = api<ContractDetail>(`/api/contracts/${contractId}`).then((d) => (d.unitTypeName || d.unitTypeId ? { name: d.unitTypeName, id: d.unitTypeId } : null)).catch(() => null)
    typeByContract.set(contractId, p)
  }
  return p
}

/**
 * The photo of the unit's own type (locker / small / medium / large) for a contract's unit.
 * Known type (from the contract detail) is used straight away; otherwise the contract detail is read
 * (it carries the unit type, rented units included); the facility's public unit list is the last resort.
 */
export function ContractUnitArt({ facilityId, unitId, unitCode, contractId, unitTypeName, unitTypeId }:
  { facilityId: number; unitId?: number; unitCode?: string; contractId?: number; unitTypeName?: string; unitTypeId?: number }) {
  const known = unitTypeName || unitTypeId ? photoVariant(unitTypeName, unitTypeId) : null
  const [variant, setVariant] = useState<number | null>(known)
  useEffect(() => {
    if (known != null) { setVariant(known); return }
    let live = true
    const fromList = () => facilityUnits(facilityId).then((us) => {
      const u = us.find((x) => (unitId != null && x.unitId === unitId) || (unitCode != null && x.unitCode === unitCode))
      return u ? photoVariant(u.unitTypeName, u.unitTypeId) : 2
    })
    void (contractId != null ? contractType(contractId).then((t) => (t ? photoVariant(t.name, t.id) : fromList())) : fromList())
      .then((v) => { if (live) setVariant(v) })
    return () => { live = false }
  }, [facilityId, unitId, unitCode, contractId, known])
  return variant == null ? <div className="photo-fill photo-loading" /> : <UnitArt variant={variant} />
}
