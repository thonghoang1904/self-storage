import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ContractDetail, StorageUnit, UnitType } from '../types'
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
const typeByContract = new Map<number, Promise<{ name: string; id: number; image: string | null } | null>>()
function contractType(contractId: number) {
  let p = typeByContract.get(contractId)
  if (!p) {
    p = api<ContractDetail>(`/api/contracts/${contractId}`)
      .then((d) => (d.unitTypeName || d.unitTypeId ? { name: d.unitTypeName, id: d.unitTypeId, image: d.unitImageUrl ?? d.unitTypeImageUrl ?? null } : null))
      .catch(() => null)
    typeByContract.set(contractId, p)
  }
  return p
}

// Uploaded unit-type photos (GET /api/unit-types), read once per page load; a failed read is tried again next time.
let typeImages: Promise<Map<number, string>> | null = null
function unitTypeImages() {
  typeImages ??= api<UnitType[]>('/api/unit-types')
    .then((ts) => new Map(ts.filter((t) => t.imageUrl).map((t) => [t.unitTypeId, t.imageUrl as string])))
    .catch(() => { typeImages = null; return new Map<number, string>() })
  return typeImages
}
/** Forget the cached photos after an admin changes them. */
export function resetUnitTypeImages() { typeImages = null }

/**
 * A unit type's uploaded photo (Cloudinary), or the drawn picture for its size when it has none or the link fails.
 */
export function UnitTypePhoto({ src, typeName, typeId, alt }: { src?: string | null; typeName?: string | null; typeId?: number; alt?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (src && !failed) return <img className="photo-fill" src={src} alt={alt ?? typeName ?? 'Ảnh loại kho'} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  return <UnitArt variant={photoVariant(typeName, typeId)} />
}

/**
 * The photo of a contract's unit: the unit's own photo, else its type's uploaded photo, else the drawn picture for its size.
 * Known type (from the contract detail) is used straight away; otherwise the contract detail is read
 * (it carries the unit type, rented units included); the facility's public unit list is the last resort.
 */
export function ContractUnitArt({ facilityId, unitId, unitCode, contractId, unitTypeName, unitTypeId, imageUrl }:
  { facilityId: number; unitId?: number; unitCode?: string; contractId?: number; unitTypeName?: string; unitTypeId?: number; imageUrl?: string | null }) {
  const [photo, setPhoto] = useState<{ name?: string; id?: number; image: string | null } | null>(
    unitTypeName || unitTypeId ? { name: unitTypeName, id: unitTypeId, image: imageUrl ?? null } : null)
  useEffect(() => {
    let live = true
    const fromList = () => facilityUnits(facilityId).then((us) => {
      const u = us.find((x) => (unitId != null && x.unitId === unitId) || (unitCode != null && x.unitCode === unitCode))
      return u ? { name: u.unitTypeName, id: u.unitTypeId, image: u.imageUrl ?? null } : null
    })
    const known = unitTypeName || unitTypeId ? Promise.resolve({ name: unitTypeName, id: unitTypeId, image: imageUrl ?? null }) : null
    void (known ?? (contractId != null ? contractType(contractId).then((t) => t ?? fromList()) : fromList()))
      .then(async (t) => {
        // No photo on hand: look the type up in the public unit-type list (uploaded photos only).
        const image = t?.image ?? (t?.id ? (await unitTypeImages()).get(t.id) ?? null : null)
        if (live) setPhoto(t ? { ...t, image } : { image: null })
      })
    return () => { live = false }
  }, [facilityId, unitId, unitCode, contractId, unitTypeName, unitTypeId, imageUrl])
  return photo == null ? <div className="photo-fill photo-loading" /> : <UnitTypePhoto src={photo.image} typeName={photo.name} typeId={photo.id} />
}
