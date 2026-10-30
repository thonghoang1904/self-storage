import { useEffect, useState } from 'react'
import { api } from '../api'
import type { StorageUnit } from '../types'
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

/** The photo of the unit's own type (locker / small / medium / large) for a contract's unit. */
export function ContractUnitArt({ facilityId, unitId, unitCode }: { facilityId: number; unitId?: number; unitCode?: string }) {
  const [variant, setVariant] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    void facilityUnits(facilityId).then((us) => {
      const u = us.find((x) => (unitId != null && x.unitId === unitId) || (unitCode != null && x.unitCode === unitCode))
      if (live) setVariant(u ? photoVariant(u.unitTypeName, u.unitTypeId) : 2)
    })
    return () => { live = false }
  }, [facilityId, unitId, unitCode])
  return variant == null ? <div className="photo-fill photo-loading" /> : <UnitArt variant={variant} />
}
