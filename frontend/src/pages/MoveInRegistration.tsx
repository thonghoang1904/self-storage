import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { checkCitizenId, checkPhone, CITIZEN_ID_FILTER, digitsOnly, PHONE_FILTER } from '../validation'
import { FieldNote, useInputFilter } from '../components/form'
import { api, fmtDate, fmtTime } from '../api'
import { parseOperatingHours } from '../components/appointment'
import { useAuth } from '../auth'
import { Empty, Icon } from '../components/ui'
import { ContractUnitArt } from '../components/unitPhoto'
import type { Contract, ContractDetail, Facility, Person, StorageUnit, StoredItem, UnitType, VisitRegistration } from '../types'
import { termsHref } from './Terms'

/**
 * Figma "Đăng ký đưa đồ vào kho" (120:2343): the customer declares the items to bring in (with optional item photos),
 * books the move-in slot (vehicle, helpers, who escorts the goods) and sends it for staff approval.
 * Declared items are persisted in StoredItems via POST /api/contracts/{id}/visit-registrations, and optional item
 * photos are uploaded to Cloudinary via POST /api/contracts/{id}/items/{itemId}/image.
 */

export { MOVE_IN_PREFIX } from '../types'
import { MOVE_IN_PREFIX } from '../types'
import { Select } from '../components/Select'
const PURPOSE_MAX = 255
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return 'Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP'
  if (file.size === 0)
    return 'Tệp hình ảnh bị rỗng'
  if (file.size > MAX_IMAGE_BYTES)
    return 'Ảnh tải lên không được vượt quá 5 MB'
  return null
}

const CATEGORIES = ['Đồ nội thất', 'Điện tử - điện máy', 'Thùng hàng / carton', 'Quần áo - chăn màn', 'Sách - hồ sơ giấy tờ', 'Dụng cụ - thể thao', 'Khác']
const VEHICLES = ['Tự mang (xe máy)', 'Ô tô con', 'Xe ba gác', 'Xe tải ≤ 1,25 tấn', 'Xe tải > 1,25 tấn']
const DURATIONS = [30, 60, 90, 120, 180]
const FORBIDDEN = 'Chất cháy nổ, xăng dầu, bình gas; hóa chất, chất độc; thực phẩm tươi sống, đồ dễ hư thối; động vật, cây sống; vũ khí, hàng cấm, hàng không rõ nguồn gốc.'

type Item = {
  key: number
  name: string
  category: string
  quantity: number
  l: string
  w: string
  h: string
  imageFile: File | null
  imagePreview: string
  imageError: string
}
let nextKey = 1
const newItem = (): Item => ({
  key: nextKey++,
  name: '',
  category: CATEGORIES[0],
  quantity: 1,
  l: '',
  w: '',
  h: '',
  imageFile: null,
  imagePreview: '',
  imageError: '',
})

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoDate(d) }
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHHMM = (t: number) => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
const hhmm = (iso: string) => iso.slice(11, 16)
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const DIM_MIN = 0.1
const DIM_MAX = 2000
const num = (s: string) => { const n = Number(s.trim().replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }
const fmtCm = (v: number) => Number(v.toFixed(2)).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const fmtVol = (v: number) => Number(v.toFixed(3)).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const floorDiv = (a: number, b: number) => Math.floor(a / b + 1e-9)
function maxItemQty(unitL: number, unitW: number, unitH: number, l: number, w: number, h: number): number {
  const maxLayers = floorDiv(unitH, h)
  const shortFloor = Math.min(unitL, unitW), longFloor = Math.max(unitL, unitW)
  const minItem = Math.min(l, w), maxItem = Math.max(l, w)
  let maxPerLayer: number
  if (maxItem > shortFloor + 1e-6) {
    maxPerLayer = floorDiv(longFloor, maxItem) * floorDiv(shortFloor, minItem)
  } else if (Math.abs(l - w) < 1e-6) {
    maxPerLayer = floorDiv(unitL, l) * floorDiv(unitW, l)
  } else if (l + w > longFloor + 1e-6) {
    maxPerLayer = Math.max(floorDiv(unitL, l) * floorDiv(unitW, w), floorDiv(unitL, w) * floorDiv(unitW, l))
  } else {
    maxPerLayer = Math.min(floorDiv(unitL * unitW, l * w), floorDiv(unitL, minItem) * floorDiv(unitW, minItem))
  }
  return maxLayers * maxPerLayer
}
function checkItemPlacement(it: Item, title: string, unitL: number, unitW: number, unitH: number, unitSizeLabel: string): string | null {
  if (!(unitL > 0 && unitW > 0 && unitH > 0)) return null
  const l = num(it.l), w = num(it.w), h = num(it.h)
  if (l < DIM_MIN || l > DIM_MAX || w < DIM_MIN || w > DIM_MAX || h < DIM_MIN || h > DIM_MAX) return null
  if (h > unitH + 1e-6)
    return `Món "${title}" cao ${fmtCm(h)} cm vượt quá chiều cao kho (${fmtCm(unitH)} cm)`
  const shortFloor = Math.min(unitL, unitW), longFloor = Math.max(unitL, unitW)
  const minItem = Math.min(l, w), maxItem = Math.max(l, w)
  if (minItem > shortFloor + 1e-6 || maxItem > longFloor + 1e-6)
    return `Món "${title}" (đáy ${fmtCm(l)}×${fmtCm(w)} cm) tràn quá chiều dài/rộng mặt sàn kho (${fmtCm(unitL)}×${fmtCm(unitW)} cm)`
  const qty = Math.max(1, Math.min(999, Math.trunc(it.quantity) || 1))
  const maxQty = maxItemQty(unitL, unitW, unitH, l, w, h)
  if (qty > maxQty)
    return `Kho (${unitSizeLabel}) chỉ xếp được tối đa ${maxQty} món "${title}" (${fmtCm(l)}×${fmtCm(w)}×${fmtCm(h)} cm)`
  return null
}
/** Item volume in m³ from centimetres (0 if any dimension is missing). */
const volumeOf = (i: Item) => {
  const l = num(i.l), w = num(i.w), h = num(i.h)
  return l > 0 && w > 0 && h > 0 ? (l * w * h / 1e6) * Math.max(1, i.quantity) : 0
}

/** "Tủ lạnh ×1 (60×60×170cm)" */
function itemText(i: Item) {
  const dims = num(i.l) && num(i.w) && num(i.h) ? ` (${num(i.l)}×${num(i.w)}×${num(i.h)}cm)` : ''
  return `${i.name.trim()} ×${i.quantity}${dims}`
}

/** Packs the declaration into the purpose text: items first, then logistics; shortened with "…" when over 255 characters. */
export function buildPurpose(items: Item[], vehicle: string, helpers: number, phone: string, note: string) {
  const list = items.filter((i) => i.name.trim()).map(itemText)
  const logistics = [vehicle, helpers > 0 ? `${helpers} người phụ` : '', phone.trim() ? `SĐT ${phone.trim()}` : '', note.trim()].filter(Boolean).join('; ')
  const full = `${MOVE_IN_PREFIX}: ${list.join(', ')}${logistics ? ` | ${logistics}` : ''}`
  if (full.length <= PURPOSE_MAX) return { text: full, cut: false }
  // Keep the logistics and as many items as fit.
  const tail = logistics ? ` | ${logistics}` : ''
  let head = `${MOVE_IN_PREFIX}: `
  let shown = 0
  for (const t of list) {
    const extra = `${shown ? ', ' : ''}${t}`
    if ((head + extra + `, +${list.length - shown - 1} món khác` + tail).length > PURPOSE_MAX) break
    head += extra
    shown++
  }
  if (shown < list.length) head += `${shown ? ', ' : ''}+${list.length - shown} món khác`
  const text = (head + tail).length > PURPOSE_MAX ? `${(head + tail).slice(0, PURPOSE_MAX - 1)}…` : head + tail
  return { text, cut: true }
}

export default function MoveInRegistration() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [c, setC] = useState<ContractDetail | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [type, setType] = useState<UnitType | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [rows, setRows] = useState<VisitRegistration[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState('')
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null)
  const [historyPhotoError, setHistoryPhotoError] = useState<{ itemId: number; message: string } | null>(null)
  const objectUrlsRef = useRef(new Set<string>())
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const historyFileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
  }, [])

  const today = isoDate(new Date())
  const [items, setItems] = useState<Item[]>(() => [newItem()])
  const [note, setNote] = useState('')
  const [date, setDate] = useState(addDays(today, 1))
  const [entry, setEntry] = useState('09:00')
  const [duration, setDuration] = useState(60)
  const [vehicle, setVehicle] = useState(VEHICLES[1])
  const [helpers, setHelpers] = useState(0)
  const [who, setWho] = useState<number | null>(null)
  const [citizenId, setCitizenId] = useState('')
  const [phone, setPhone] = useState('')
  /** Errors shown under the field they belong to. */
  const [fieldErr, setFieldErr] = useState<{ items?: string; entry?: string; citizenId?: string; phone?: string; agree?: string; submit?: string }>({})
  const clearErr = (k: keyof typeof fieldErr) => setFieldErr((f) => (f[k] || f.submit ? { ...f, [k]: undefined, submit: undefined } : f))
  const cid = useInputFilter(CITIZEN_ID_FILTER)
  const tel = useInputFilter(PHONE_FILTER)
  const [agree, setAgree] = useState(false)

  const loadRows = useCallback(() => api<VisitRegistration[]>(`/api/contracts/${id}/visit-registrations`)
    .then((rs) => setRows(rs.filter((r) => r.purpose.startsWith(MOVE_IN_PREFIX)))).catch(() => {}), [id])

  useEffect(() => {
    setC(null)
    setError('')
    api<ContractDetail>(`/api/contracts/${id}`).then((d) => {
      setC(d)
      if (d.startDate > addDays(today, 1)) setDate(d.startDate)
      api<Facility[]>('/api/facilities').then((fs) => setFacility(fs.find((f) => f.facilityId === d.facilityId) ?? null)).catch(() => {})
      // Unit size comes with the contract; the public unit list (older backends) leaves rented units out.
      if (!d.lengthMeters) api<StorageUnit[]>(`/api/facilities/${d.facilityId}/units`).then((us) => {
        const u = us.find((x) => x.unitId === d.unitId)
        if (u) api<UnitType[]>('/api/unit-types').then((ts) => setType(ts.find((t) => t.unitTypeId === u.unitTypeId) ?? null)).catch(() => {})
      }).catch(() => {})
    }).catch((e) => setError((e as Error).message))
    api<Contract[]>('/api/contracts/my').then(setContracts).catch(() => {})
    api<Person[]>(`/api/contracts/${id}/authorized-persons`).then((ps) => setPeople(ps.filter((p) => p.authorizedPersonId != null))).catch(() => {})
    void loadRows()
  }, [id, loadRows, today])

  const hoursText = c?.operatingHours || facility?.operatingHours
  // A 24-hour facility closes at 24:00; cap at 23:30 so no "24:00" time is sent.
  const [open, close] = parseOperatingHours(hoursText).map((t) => Math.min(t, 23 * 60 + 30))
  const entrySlots: string[] = []
  const nowMin = date === today ? new Date().getHours() * 60 + new Date().getMinutes() + 15 : 0
  for (let t = Math.ceil(Math.max(open, nowMin) / 30) * 30; t + 30 <= close; t += 30) entrySlots.push(toHHMM(t))
  useEffect(() => { if (entrySlots.length && !entrySlots.includes(entry)) setEntry(entrySlots[0]) }, [date, entrySlots.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const exitMin = Math.min(toMin(entry) + duration, close, date === c?.endDate ? 20 * 60 : close)
  const exit = toHHMM(exitMin)

  if (!c) {
    return (
      <div className="container page-body">
        {error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}
        <Link to="/my-units" className="link">← Về Kho Của Tôi</Link>
      </div>
    )
  }

  const ended = c.status !== 'Active' && c.status !== 'Renewed'
  const locked = c.unitStatus === 'OverdueLocked' || c.status === 'Overdue'
  const active = contracts.filter((x) => x.status === 'Active' || x.status === 'Renewed')
  const activeItems = items.filter((i) => i.name.trim() || i.l.trim() || i.w.trim() || i.h.trim() || i.imageFile != null)
  const named = items.filter((i) => i.name.trim())
  const photoCount = activeItems.filter((i) => i.imageFile != null).length
  const pieces = named.reduce((n, i) => n + Math.max(1, i.quantity), 0)
  const volume = named.reduce((n, i) => n + volumeOf(i), 0)
  // Unit dimensions and volume from the contract (newer backends), else from the unit type found in the public list.
  const unitL = (c.lengthMeters || type?.lengthMeters || 0) * 100
  const unitW = (c.widthMeters || type?.widthMeters || 0) * 100
  const unitH = (c.heightMeters || type?.heightMeters || 0) * 100
  const hasUnitDims = unitL > 0 && unitW > 0 && unitH > 0
  const unitSizeLabel = hasUnitDims ? `${fmtCm(unitL)}×${fmtCm(unitW)}×${fmtCm(unitH)} cm` : ''
  const capacity = c?.volumeCubicMeters || (c?.lengthMeters ? c.lengthMeters * c.widthMeters * c.heightMeters : 0)
    || (type ? type.volumeCubicMeters || type.lengthMeters * type.widthMeters * type.heightMeters : 0)
  const fill = capacity ? Math.round(volume / capacity * 100) : 0
  const exceedsCapacity = capacity > 0 && volume > capacity + 1e-9
  const placementErrorOf = (it: Item, idx: number) =>
    checkItemPlacement(it, it.name.trim() || `Món ${idx + 1}`, unitL, unitW, unitH, unitSizeLabel)
  const firstPlacementError = activeItems.map((it, idx) => placementErrorOf(it, idx)).find((msg): msg is string => Boolean(msg)) ?? null
  const crossStats = activeItems.reduce(
    (acc, it) => {
      const l = num(it.l), w = num(it.w), h = num(it.h)
      if (l >= DIM_MIN && w >= DIM_MIN && h >= DIM_MIN) {
        const qty = Math.max(1, Math.min(999, Math.trunc(it.quantity) || 1))
        const minItem = Math.min(l, w)
        if (hasUnitDims && minItem > unitL / 2 + 1e-6 && minItem > unitW / 2 + 1e-6 && h > unitH / 2 + 1e-6)
          acc.centerBlockers += qty
        if (hasUnitDims && h > unitH / 2 + 1e-6)
          acc.tallFootprintCm2 += l * w * qty
      }
      return acc
    },
    { centerBlockers: 0, tallFootprintCm2: 0 },
  )
  const unitFloorAreaCm2 = unitL * unitW
  const exceedsCenterBlockers = hasUnitDims && crossStats.centerBlockers > 1
  const exceedsTallFootprint = hasUnitDims && crossStats.tallFootprintCm2 > unitFloorAreaCm2 + 1e-4
  const crossError = exceedsCenterBlockers
    ? `Các món đồ có kích thước lớn hơn một nửa chiều kho (${unitSizeLabel}) không thể xếp cùng lúc quá 1 món`
    : exceedsTallFootprint
      ? `Tổng diện tích đáy các món cao quá nửa kho (${fmtVol(crossStats.tallFootprintCm2 / 10_000)} m²) vượt quá diện tích sàn kho (${fmtVol(unitFloorAreaCm2 / 10_000)} m²)`
      : null
  const hasFitError = Boolean(firstPlacementError || crossError || exceedsCapacity)
  const visitor = who == null ? null : people.find((p) => p.authorizedPersonId === who) ?? null
  const purpose = buildPurpose(items, vehicle, helpers, phone, note)

  const setItem = (key: number, patch: Partial<Item>) => { setItems((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i))); clearErr('items') }

  const revokePreview = (url: string) => {
    if (!url) return
    URL.revokeObjectURL(url)
    objectUrlsRef.current.delete(url)
  }

  const clearItemImage = (key: number) => {
    const prev = items.find((i) => i.key === key)?.imagePreview
    if (prev) revokePreview(prev)
    const input = fileInputRefs.current[key]
    if (input) input.value = ''
    setItem(key, { imageFile: null, imagePreview: '', imageError: '' })
  }

  const pickItemImage = (key: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) { clearItemImage(key); return }
    const prev = items.find((i) => i.key === key)?.imagePreview
    if (prev) revokePreview(prev)
    const err = validateImageFile(file)
    if (err) {
      const input = fileInputRefs.current[key]
      if (input) input.value = ''
      setItem(key, { imageFile: null, imagePreview: '', imageError: err })
      return
    }
    const previewUrl = URL.createObjectURL(file)
    objectUrlsRef.current.add(previewUrl)
    setItem(key, { imageFile: file, imagePreview: previewUrl, imageError: '' })
  }

  const removeItem = (key: number) => {
    const prev = items.find((i) => i.key === key)?.imagePreview
    if (prev) revokePreview(prev)
    delete fileInputRefs.current[key]
    setItems((is) => is.filter((x) => x.key !== key))
    clearErr('items')
  }

  const validateItems = () => {
    if (activeItems.length === 0) return 'Vui lòng khai báo ít nhất một món đồ'
    for (let idx = 0; idx < activeItems.length; idx++) {
      const it = activeItems[idx]
      const title = it.name.trim() || `Món ${idx + 1}`
      if (!it.name.trim()) return `Vui lòng nhập tên cho Món ${idx + 1}`
      if (!it.l.trim() || !it.w.trim() || !it.h.trim())
        return `Vui lòng nhập đủ 3 chiều Dài × Rộng × Cao (cm) cho "${title}"`
      const l = num(it.l), w = num(it.w), h = num(it.h)
      if (l < DIM_MIN || l > DIM_MAX || w < DIM_MIN || w > DIM_MAX || h < DIM_MIN || h > DIM_MAX)
        return `Kích thước "${title}" không hợp lệ (mỗi chiều từ 0,1 đến 2000 cm)`
      if (it.imageError) return `Ảnh của "${title}" không hợp lệ: ${it.imageError}`
      const placeErr = checkItemPlacement(it, title, unitL, unitW, unitH, unitSizeLabel)
      if (placeErr) return placeErr
    }
    if (crossError) return crossError
    if (exceedsCapacity)
      return `Tổng thể tích đồ khai báo (${fmtVol(volume)} m³) vượt quá sức chứa của kho (${fmtVol(capacity)} m³). Vui lòng giảm số lượng/kích thước hoặc thuê thêm kho.`
    return undefined
  }

  const uploadRegisteredItemImage = async (itemId: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const input = historyFileInputRefs.current[itemId]
    if (input) input.value = ''
    if (!file) return
    const err = validateImageFile(file)
    if (err) {
      setHistoryPhotoError({ itemId, message: err })
      return
    }
    setUploadingItemId(itemId)
    setHistoryPhotoError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api<StoredItem>(`/api/contracts/${id}/items/${itemId}/image`, { body: fd })
      await loadRows()
    } catch (uploadErr) {
      setHistoryPhotoError({ itemId, message: (uploadErr as Error).message })
    } finally {
      setUploadingItemId(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const errs: typeof fieldErr = {
      items: validateItems(),
      entry: !entrySlots.includes(entry) ? 'Giờ đến không còn hợp lệ, vui lòng chọn lại giờ'
        : exitMin <= toMin(entry) ? 'Giờ chuyển đồ vượt quá giờ đóng cửa của kho, vui lòng chọn giờ sớm hơn' : undefined,
      citizenId: checkCitizenId(citizenId, 'Số CCCD người vào kho') || undefined,
      phone: checkPhone(phone, 'SĐT liên hệ', true) || undefined,
      agree: agree ? undefined : 'Vui lòng tích xác nhận cam kết về đồ gửi trước khi gửi đăng ký',
    }
    setFieldErr(errs)
    const first = (['items', 'entry', 'citizenId', 'phone', 'agree'] as const).find((k) => errs[k])
    if (first) {
      const el = document.getElementById(`movein-${first}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true })
      return
    }
    setBusy(true)
    setBusyText('Đang gửi đăng ký…')
    try {
      const submittedItems = [...activeItems]
      const r = await api<VisitRegistration>(`/api/contracts/${id}/visit-registrations`, {
        body: {
          citizenId: digitsOnly(citizenId),
          authorizedPersonId: who,
          scheduledEntryAt: `${date}T${entry}:00+07:00`,
          scheduledExitAt: `${date}T${exit}:00+07:00`,
          purpose: purpose.text,
          items: submittedItems.map((i) => ({
            name: i.name.trim(),
            category: i.category,
            quantity: Math.max(1, Math.min(999, i.quantity)),
            lengthCm: num(i.l),
            widthCm: num(i.w),
            heightCm: num(i.h),
          })),
        },
      })
      const itemsToUpload = submittedItems
        .map((localItem, index) => ({ localItem, created: r.items?.[index] }))
        .filter((pair): pair is { localItem: Item & { imageFile: File }; created: StoredItem } =>
          pair.localItem.imageFile != null && pair.created != null)

      const failedUploads: string[] = []
      for (let i = 0; i < itemsToUpload.length; i++) {
        const { localItem, created } = itemsToUpload[i]
        setBusyText(`Đang tải ảnh đồ vật (${i + 1}/${itemsToUpload.length})…`)
        try {
          const fd = new FormData()
          fd.append('file', localItem.imageFile)
          await api<StoredItem>(`/api/contracts/${id}/items/${created.storedItemId}/image`, { body: fd })
        } catch (imgErr) {
          failedUploads.push(`${localItem.name.trim()}: ${(imgErr as Error).message}`)
        }
      }

      const uploadedCount = itemsToUpload.length - failedUploads.length
      if (failedUploads.length > 0) {
        setNotice(`Đã gửi đăng ký đưa ${pieces} món đồ vào kho ${r.unitCode} lúc ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}.`)
        setError(`Đăng ký đã được tạo nhưng có ${failedUploads.length}/${itemsToUpload.length} ảnh đồ vật tải lên thất bại (${failedUploads.join('; ')}). Bạn có thể thử đính kèm lại ngay trong danh sách "Lịch chuyển đồ đã đăng ký" bên dưới.`)
      } else {
        const photoSuffix = uploadedCount > 0 ? ` (kèm ${uploadedCount} ảnh đồ vật)` : ''
        setNotice(`Đã gửi đăng ký đưa ${pieces} món đồ${photoSuffix} vào kho ${r.unitCode} lúc ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}. Nhân viên cơ sở sẽ duyệt trước giờ hẹn.`)
      }

      for (const item of items) {
        if (item.imagePreview) revokePreview(item.imagePreview)
        const input = fileInputRefs.current[item.key]
        if (input) input.value = ''
      }
      setItems([newItem()])
      setNote('')
      setCitizenId('')
      setAgree(false)
      await loadRows()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setFieldErr({ submit: (err as Error).message })
    } finally {
      setBusy(false)
      setBusyText('')
    }
  }

  const canCancel = (r: VisitRegistration) => r.status === 'Pending' || (r.status === 'Approved' && new Date(r.scheduledExitAt).getTime() > Date.now())
  const cancel = async (r: VisitRegistration) => {
    if (r.status === 'Approved' && !window.confirm('Hủy lịch chuyển đồ đã được duyệt này? Bạn sẽ cần đăng ký lại nếu muốn vào kho khung giờ khác.')) return
    setError('')
    try {
      await api(`/api/contracts/${id}/visit-registrations/${r.visitRegistrationId}`, { method: 'DELETE' })
      setNotice(`Đã hủy lịch chuyển đồ ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}.`)
      await loadRows()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const latest = rows[0]
  const STATE: Record<string, { label: string; tone: string; icon: string }> = {
    Pending: { label: 'Chờ nhân viên duyệt', tone: 'warn', icon: 'clock' },
    Approved: { label: 'Đã duyệt', tone: 'ok', icon: 'check' },
    Rejected: { label: 'Bị từ chối', tone: 'bad', icon: 'x' },
    Cancelled: { label: 'Đã hủy', tone: 'muted', icon: 'x' },
  }

  return (
    <>
      <section className="page-hero detail-hero">
        <div className="container">
          <div className="grow">
            <nav className="crumbs">
              <Link to="/my-units">Kho Của Tôi</Link><span>/</span>
              <Link to={`/my-units/${c.contractId}`}>{c.unitCode}</Link><span>/</span>
              <b>Đưa đồ vào kho</b>
            </nav>
            <h1>Đăng ký đưa đồ vào kho</h1>
            <p>Khai báo đồ mang vào kho {c.unitCode} và đặt lịch chuyển đồ. Nhân viên cổng đối chiếu danh sách khi bạn đến.</p>
          </div>
          <div className="hero-side">
            <span className={`badge ${ended || locked ? 'bad' : 'ok'}`}>{ended ? 'Hợp đồng đã kết thúc' : locked ? 'Kho đang bị khóa' : 'Hợp đồng đang hoạt động'}</span>
            <small>Hợp đồng {c.contractNumber}</small>
          </div>
        </div>
      </section>

      <div className="container page-body">
        <div className="row between wrap">
          <Link to={`/my-units/${c.contractId}`} className="link with-icon"><Icon name="arrowRight" size={14} className="flip" /> Quay lại hợp đồng {c.contractNumber}</Link>
          <span className={`badge ${latest ? STATE[latest.status]?.tone ?? 'muted' : 'muted'}`}>{latest ? STATE[latest.status]?.label : 'Chưa gửi đăng ký'}</span>
        </div>

        <ol className="journey">
          <li className={named.length ? 'done' : 'active'}><span>{named.length ? <Icon name="check" size={14} /> : 1}</span>Khai báo đồ</li>
          <li className={named.length ? 'active' : 'later'}><span>2</span>Lịch chuyển đồ</li>
          <li className="later"><span>3</span>Nhân viên duyệt & nhận đồ</li>
        </ol>

        {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <div className="visit-layout">
          <div className="stack-lg">
            <div className="notice info-notice">
              <span className="notice-icon info"><Icon name="package" size={16} /></span>
              <div>
                <b>Khai báo đồ trước khi mang vào kho</b>
                <p>Mỗi lần chuyển đồ cần một lịch đã được duyệt. Danh sách đồ giúp nhân viên chuẩn bị lối đi, xe đẩy và đối chiếu tại cổng.</p>
              </div>
            </div>

            {ended || locked ? (
              <section className="panel"><Empty icon="lock">{ended ? 'Hợp đồng đã kết thúc nên không thể đưa đồ vào kho.' : 'Kho đang bị khóa do quá hạn. Vui lòng thanh toán hoặc liên hệ cơ sở trước khi chuyển đồ.'}</Empty></section>
            ) : (
              <form className="stack-lg" onSubmit={submit} noValidate>
                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">01</span><div><h3>Kho nhận đồ</h3><p className="muted">Chọn hợp đồng / kho bạn muốn đưa đồ vào.</p></div></div>
                  <label className="field"><span>Hợp đồng & kho *</span>
                    <Select value={c.contractId} onChange={(e) => navigate(`/my-units/${e.target.value}/move-in`)} aria-label="Chọn hợp đồng">
                      {(active.length ? active : [{ contractId: c.contractId, contractNumber: c.contractNumber, unitCode: c.unitCode, facilityName: c.facilityName } as Contract]).map((x) => (
                        <option key={x.contractId} value={x.contractId}>{x.unitCode} · {x.facilityName} · {x.contractNumber}</option>
                      ))}
                    </Select>
                  </label>
                  <div className="notice warn-notice">
                    <span className="notice-icon warn"><Icon name="alert" size={16} /></span>
                    <div><b>Đồ không được gửi</b><p>{FORBIDDEN}</p></div>
                  </div>
                  <Link to={`/my-units/${c.contractId}/visit`} className="link with-icon">Chỉ vào lấy đồ, kiểm tra hay sắp xếp đồ? Đăng ký vào kho <Icon name="arrowRight" size={14} /></Link>
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">02</span><div><h3>Danh sách đồ mang vào</h3><p className="muted">Nhập đủ 3 chiều kích thước (Dài × Rộng × Cao tính bằng cm) cho từng món. Chiều cao giữ cố định, chỉ xoay ngang trên mặt sàn kho.{hasUnitDims && ` Giới hạn kho ${c.unitCode}: ${unitSizeLabel} (${fmtVol(capacity)} m³).`}</p></div></div>
                  {items.map((it, idx) => {
                    const placeErr = placementErrorOf(it, idx)
                    return (
                    <div key={it.key} className="item-card">
                      <div className="row between">
                        <b className="item-title"><Icon name="package" size={16} /> Món {idx + 1}{it.name.trim() && <span className="muted"> · {it.name.trim()}</span>}</b>
                        {items.length > 1 && <button type="button" className="icon-btn" aria-label={`Xóa món ${idx + 1}`} onClick={() => removeItem(it.key)}><Icon name="trash" size={16} /></button>}
                      </div>
                      <div className="form-grid two">
                        <label className="field"><span>Tên đồ *</span><input value={it.name} maxLength={60} onChange={(e) => setItem(it.key, { name: e.target.value })} placeholder="vd: Tủ lạnh, thùng sách" /></label>
                        <label className="field"><span>Loại đồ</span>
                          <Select value={it.category} onChange={(e) => setItem(it.key, { category: e.target.value })}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select>
                        </label>
                      </div>
                      <div className="item-measure">
                        <label className="field"><span>Số lượng *</span><input type="number" min={1} max={999} value={it.quantity} onChange={(e) => setItem(it.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} /></label>
                        <div className="field"><span>Kích thước mỗi món (cm) * · Dài × Rộng × Cao</span>
                          <div className="dims">
                            <input inputMode="decimal" value={it.l} onChange={(e) => setItem(it.key, { l: e.target.value })} placeholder="Dài" aria-label="Dài (cm)" aria-required="true" />
                            <span>×</span>
                            <input inputMode="decimal" value={it.w} onChange={(e) => setItem(it.key, { w: e.target.value })} placeholder="Rộng" aria-label="Rộng (cm)" aria-required="true" />
                            <span>×</span>
                            <input inputMode="decimal" value={it.h} onChange={(e) => setItem(it.key, { h: e.target.value })} placeholder="Cao" aria-label="Cao (cm)" aria-required="true" />
                          </div>
                        </div>
                      </div>
                      <div className="field">
                        <span>Ảnh món đồ (không bắt buộc)</span>
                        <div className="item-upload">
                          <input
                            ref={(el) => { fileInputRefs.current[it.key] = el }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => pickItemImage(it.key, e)}
                            aria-label={`Chọn ảnh cho món ${idx + 1}`}
                          />
                          {it.imagePreview && (
                            <div className="item-preview">
                              <img src={it.imagePreview} alt={`Xem trước ảnh món ${idx + 1}`} className="item-photo" />
                              <button type="button" className="btn ghost sm danger-text" onClick={() => clearItemImage(it.key)}>
                                <Icon name="trash" size={14} /> Xóa ảnh
                              </button>
                            </div>
                          )}
                        </div>
                        {it.imageError
                          ? <FieldNote text={it.imageError} />
                          : <small className="field-hint">JPG, PNG hoặc WebP · tối đa 5 MB (tùy chọn)</small>}
                      </div>
                      {placeErr && (
                        <p className="alert bad"><Icon name="alert" size={15} />{placeErr}</p>
                      )}
                    </div>
                  )})}
                  <button id="movein-items" type="button" className="btn dashed block" onClick={() => { setItems((is) => [...is, newItem()]); clearErr('items') }}><Icon name="plus" size={16} /> Thêm món đồ</button>
                  <FieldNote text={fieldErr.items} />
                  <label className="field"><span>Ghi chú cho nhân viên</span>
                    <textarea rows={3} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: Có đồ dễ vỡ, cần xe đẩy hàng" />
                  </label>
                  <div className="notice warn-notice">
                    <span className="notice-icon warn"><Icon name="shield" size={16} /></span>
                    <div><p>Đồ có giá trị cao (trang sức, tiền mặt, giấy tờ quan trọng) nên khai báo rõ hoặc không gửi. SafeKeep chỉ chịu trách nhiệm theo điều khoản hợp đồng đã đồng ý.</p></div>
                  </div>
                  <Link to={termsHref({ newTab: true, label: 'Đóng & quay lại đăng ký đưa đồ' })} target="_blank" className="link with-icon"><Icon name="file" size={14} /> Xem điều khoản hợp đồng đã đồng ý</Link>
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">03</span><div><h3>Lịch chuyển đồ</h3><p className="muted">Chọn ngày giờ trong giờ hoạt động {hoursText ?? ''} và phương tiện chở đồ.</p></div></div>
                  <div className="form-grid two">
                    <label className="field"><span>Ngày chuyển đồ *</span>
                      <input type="date" value={date} min={c.startDate > today ? c.startDate : today} max={c.endDate} onChange={(e) => setDate(e.target.value)} required />
                    </label>
                    <label className={`field ${fieldErr.entry ? 'has-error' : ''}`}><span>Giờ đến *</span>
                      <Select id="movein-entry" value={entry} onChange={(e) => { setEntry(e.target.value); clearErr('entry') }} aria-invalid={fieldErr.entry ? true : undefined}>{entrySlots.map((s) => <option key={s}>{s}</option>)}</Select>
                      <FieldNote text={fieldErr.entry} />
                    </label>
                    <label className="field"><span>Thời gian bốc xếp dự kiến</span>
                      <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} phút` : `${d / 60} giờ`}</option>)}</Select>
                    </label>
                    <label className="field"><span>Giờ rời kho</span><input value={exit} readOnly /></label>
                    <label className="field"><span>Phương tiện</span>
                      <Select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>{VEHICLES.map((v) => <option key={v}>{v}</option>)}</Select>
                    </label>
                    <label className="field"><span>Số người phụ bốc xếp</span>
                      <Select value={helpers} onChange={(e) => setHelpers(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'Không có' : `${n} người`}</option>)}</Select>
                    </label>
                  </div>
                  <span className="label">Người vào kho</span>
                  <div className="person-picker">
                    <button type="button" className={`person-option ${who == null ? 'active' : ''}`} onClick={() => setWho(null)}>
                      <span className="radio" /><span className="grow"><b>{user?.fullName}</b><small>Chủ hợp đồng</small></span>
                    </button>
                    {people.map((p) => (
                      <button key={p.authorizedPersonId} type="button" className={`person-option ${who === p.authorizedPersonId ? 'active' : ''}`} onClick={() => setWho(p.authorizedPersonId)}>
                        <span className="radio" /><span className="grow"><b>{p.fullName}</b><small>{p.relationship ?? 'Người vào kho'}{p.phoneNumber && ` · ${p.phoneNumber}`}</small></span>
                      </button>
                    ))}
                  </div>
                  <div className="form-grid two">
                    <label className={`field ${fieldErr.citizenId ? 'has-error' : ''}`}><span>Số CCCD người vào kho *</span>
                      <input id="movein-citizenId" value={citizenId} inputMode="numeric" maxLength={12} onChange={(e) => { setCitizenId(cid.keep(e.target.value)); clearErr('citizenId') }} placeholder="12 chữ số trên thẻ CCCD" required aria-invalid={fieldErr.citizenId ? true : undefined} />
                      <FieldNote text={cid.hint ?? fieldErr.citizenId} />
                    </label>
                    <label className={`field ${fieldErr.phone ? 'has-error' : ''}`}><span>SĐT liên hệ khi đến</span>
                      <input id="movein-phone" value={phone} inputMode="tel" maxLength={15} onChange={(e) => { setPhone(tel.keep(e.target.value)); clearErr('phone') }} placeholder={visitor?.phoneNumber ?? '09xx xxx xxx'} aria-invalid={fieldErr.phone ? true : undefined} />
                      <FieldNote text={tel.hint ?? fieldErr.phone} />
                    </label>
                  </div>
                  <p className="hint"><Icon name="clock" size={15} /> Đến đúng giờ và xuất trình CCCD trùng với người vào kho đã đăng ký; xe tải lớn vui lòng gọi trước cho cơ sở.</p>
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">04</span><div><h3>Xác nhận & gửi</h3></div></div>
                  <div className="movein-summary">
                    <div className="row between"><b>Tóm tắt đăng ký</b><span className="badge info">{pieces} món</span></div>
                    <dl className="movein-grid">
                      <div><dt>Kho</dt><dd>{c.unitCode} · {c.facilityName}</dd></div>
                      <div><dt>Thời gian</dt><dd>{entry} – {exit}, ngày {dmy(date)}</dd></div>
                      <div><dt>Người vào kho</dt><dd>{visitor ? visitor.fullName : user?.fullName}</dd></div>
                      <div><dt>Phương tiện</dt><dd>{vehicle}{helpers > 0 && ` · ${helpers} người phụ`}</dd></div>
                      <div><dt>Thể tích ước tính</dt><dd>{volume > 0 ? `${fmtVol(volume)} m³` : '—'}{capacity > 0 && volume > 0 && <small className={exceedsCapacity ? 'danger-text' : 'muted'}> · {fill}% kho ({fmtVol(capacity)} m³)</small>}</dd></div>
                      <div><dt>Ảnh đồ vật</dt><dd>{photoCount > 0 ? `${photoCount} ảnh đính kèm` : 'Không có'}</dd></div>
                    </dl>
                    {hasFitError && (
                      <p className="alert bad"><Icon name="alert" size={15} />
                        {firstPlacementError
                          ?? crossError
                          ?? `Tổng thể tích đồ khai báo (${fmtVol(volume)} m³) lớn hơn thể tích kho (${fmtVol(capacity)} m³). Vui lòng giảm số lượng/kích thước hoặc thuê thêm kho.`}
                      </p>
                    )}
                    <div className="purpose-preview">
                      <small className="muted">Nội dung gửi nhân viên cổng ({purpose.text.length}/{PURPOSE_MAX} ký tự{purpose.cut ? ', đã rút gọn' : ''}):</small>
                      <p>{named.length ? purpose.text : '—'}</p>
                    </div>
                  </div>
                  <label className="check-line">
                    <input id="movein-agree" type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); clearErr('agree') }} />
                    <span>Tôi cam kết đồ mang vào đúng như khai báo, không thuộc danh mục cấm và tôi chịu trách nhiệm về nguồn gốc đồ gửi.</span>
                  </label>
                  <FieldNote text={fieldErr.agree} />
                  {fieldErr.submit && <p className="alert bad"><Icon name="alert" size={16} />{fieldErr.submit}</p>}
                  <p className="muted fine">Sau khi gửi, đăng ký ở trạng thái chờ duyệt. Bạn có thể hủy khi nhân viên chưa duyệt.</p>
                  <div className="row between wrap">
                    <Link to={`/my-units/${c.contractId}`} className="btn outline">Quay lại</Link>
                    <button className="btn primary" type="submit" disabled={busy}><Icon name="package" size={15} /> {busy ? (busyText || 'Đang gửi…') : 'Gửi đăng ký đưa đồ vào kho'}</button>
                  </div>
                </section>
              </form>
            )}

            <section className="panel">
              <h3 className="panel-title"><Icon name="history" size={18} className="cyan" /> Lịch chuyển đồ đã đăng ký</h3>
              <div className="visit-list">
                {rows.map((r) => {
                  const st = STATE[r.status] ?? { label: r.status, tone: 'muted', icon: 'clock' }
                  return (
                    <div key={r.visitRegistrationId} className="visit-row">
                      <span className={`notice-icon ${st.tone}`}><Icon name={st.icon} size={15} /></span>
                      <div className="grow">
                        <b>{hhmm(r.scheduledEntryAt)} – {hhmm(r.scheduledExitAt)} · {dmy(r.scheduledEntryAt)} · {r.visitorName}</b>
                        <small className="muted block">{r.purpose.slice(MOVE_IN_PREFIX.length + 2)}</small>
                        <small className="muted block">Gửi {fmtTime(r.requestedAt)}{r.reviewNotes && ` · Ghi chú nhân viên: ${r.reviewNotes}`}</small>
                        {r.items && r.items.length > 0 && (
                          <div className="movein-items-list">
                            {r.items.map((it) => {
                              const canEditPhoto = (r.status === 'Pending' || r.status === 'Approved')
                                && (it.status === 'PendingMoveIn' || it.status === 'Stored')
                              const itemUploading = uploadingItemId === it.storedItemId
                              return (
                                <div key={it.storedItemId} className="movein-item-row">
                                  <div className="grow">
                                    <b>{it.itemName}</b> <small className="muted">×{it.quantity}</small>
                                    <small className="muted block">
                                      {it.lengthCm}×{it.widthCm}×{it.heightCm} cm{it.category ? ` · ${it.category}` : ''}
                                    </small>
                                    {historyPhotoError?.itemId === it.storedItemId && (
                                      <small className="field-error">{historyPhotoError.message}</small>
                                    )}
                                  </div>
                                  <div className="movein-item-actions">
                                    {it.imageUrl && (
                                      <a href={it.imageUrl} target="_blank" rel="noreferrer" className="item-thumb-link" title="Bấm để xem ảnh kích thước đầy đủ">
                                        <img src={it.imageUrl} alt={it.itemName} className="item-thumb" loading="lazy" />
                                      </a>
                                    )}
                                    {canEditPhoto && (
                                      <>
                                        <input
                                          ref={(el) => { historyFileInputRefs.current[it.storedItemId] = el }}
                                          type="file"
                                          accept="image/jpeg,image/png,image/webp"
                                          hidden
                                          onChange={(e) => uploadRegisteredItemImage(it.storedItemId, e)}
                                        />
                                        <button
                                          type="button"
                                          className="btn outline sm"
                                          disabled={uploadingItemId !== null}
                                          onClick={() => historyFileInputRefs.current[it.storedItemId]?.click()}
                                        >
                                          <Icon name="plus" size={13} /> {itemUploading ? 'Đang tải…' : it.imageUrl ? 'Đổi ảnh' : 'Đính kèm ảnh'}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <span className={`badge ${st.tone}`}>{st.label}</span>
                      {canCancel(r) && <button type="button" className="btn ghost sm danger-text" onClick={() => cancel(r)}>Hủy</button>}
                    </div>
                  )
                })}
                {rows.length === 0 && <Empty icon="package">Chưa có lịch chuyển đồ nào.</Empty>}
              </div>
            </section>
          </div>

          <aside className="stack-lg">
            <section className="panel">
              <h3 className="panel-title">Kho nhận đồ</h3>
              <div className="unit-photo sm"><ContractUnitArt facilityId={c.facilityId} unitId={c.unitId} unitTypeName={c.unitTypeName} unitTypeId={c.unitTypeId} /></div>
              <div>
                <h4 className="unit-title">Kho {c.unitCode}</h4>
                <p className="muted">{c.unitTypeName || type?.typeName ? `${c.unitTypeName || type?.typeName} · ${fmtVol(capacity)} m³` : c.facilityName}</p>
                <span className={`badge ${ended || locked ? 'bad' : 'ok'}`}>{ended ? 'Đã kết thúc' : locked ? 'Đang khóa' : 'Đang hoạt động'}</span>
              </div>
              <div className="info-row"><span className="muted">Cơ sở</span><b>{c.facilityName}</b></div>
              {hasUnitDims && <div className="info-row"><span className="muted">Kích thước kho</span><b>{unitSizeLabel}</b></div>}
              <div className="info-row"><span className="muted">Thời hạn</span><b>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</b></div>
              <div className="info-row"><span className="muted">Giờ mở cửa</span><b>{hoursText ?? '—'}</b></div>
              {capacity > 0 && (
                <div className="stack-sm">
                  <div className="info-row"><span className="muted">Đồ khai báo lần này</span><b>{fmtVol(volume)} / {fmtVol(capacity)} m³</b></div>
                  <div className="pay-progress" role="progressbar" aria-valuenow={Math.min(fill, 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Tỷ lệ chiếm kho"><i style={{ width: `${Math.min(fill, 100)}%`, background: hasFitError ? 'var(--bad)' : fill > 80 ? 'var(--warn)' : undefined }} /></div>
                </div>
              )}
              <div className="notice info-notice">
                <span className="notice-icon info"><Icon name="idCard" size={15} /></span>
                <div><b>Tại cổng</b><p>Nhân viên đối chiếu CCCD người vào kho và danh sách đồ đã khai báo trước khi mở kho.</p></div>
              </div>
              <Link to={`/my-units/${c.contractId}`} className="btn outline block"><Icon name="clipboard" size={15} /> Xem hợp đồng</Link>
            </section>

            <section className="panel">
              <h3 className="panel-title">Các bước tiếp theo</h3>
              <ol className="next-steps">
                <li><span>1</span><div><b>Nhân viên duyệt</b><p>Cơ sở xem danh sách đồ và lịch chuyển, duyệt hoặc từ chối kèm ghi chú.</p></div></li>
                <li><span>2</span><div><b>Chuyển đồ đến kho</b><p>Đến đúng khung giờ; người vào kho xuất trình CCCD tại cổng.</p></div></li>
                <li><span>3</span><div><b>Đối chiếu & cất đồ</b><p>Nhân viên đối chiếu đồ với khai báo, mở kho để bạn sắp xếp.</p></div></li>
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}
