import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { checkCitizenId, checkPhone, CITIZEN_ID_FILTER, digitsOnly, PHONE_FILTER } from '../validation'
import { FieldNote, useInputFilter } from '../components/form'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Empty, Icon } from '../components/ui'
import { ContractUnitArt } from '../components/unitPhoto'
import type { Contract, ContractDetail, Facility, Person, StorageUnit, UnitType, VisitRegistration } from '../types'
import { termsHref } from './Terms'

/**
 * Figma "Đăng ký đưa đồ vào kho" (120:2343): the customer declares the items to bring in, books the move-in slot
 * (vehicle, helpers, who escorts the goods) and sends it for staff approval.
 * It uses the existing visit-registration API (POST /api/contracts/{id}/visit-registrations): the declared items,
 * vehicle and contact are packed into the registration's purpose (max 255 characters), which gate staff read when
 * approving and at the gate. A dedicated item table would need a new backend endpoint.
 */

export { MOVE_IN_PREFIX } from '../types'
import { MOVE_IN_PREFIX } from '../types'
const PURPOSE_MAX = 255

const CATEGORIES = ['Đồ nội thất', 'Điện tử - điện máy', 'Thùng hàng / carton', 'Quần áo - chăn màn', 'Sách - hồ sơ giấy tờ', 'Dụng cụ - thể thao', 'Khác']
const VEHICLES = ['Tự mang (xe máy)', 'Ô tô con', 'Xe ba gác', 'Xe tải ≤ 1,25 tấn', 'Xe tải > 1,25 tấn']
const DURATIONS = [30, 60, 90, 120, 180]
const FORBIDDEN = 'Chất cháy nổ, xăng dầu, bình gas; hóa chất, chất độc; thực phẩm tươi sống, đồ dễ hư thối; động vật, cây sống; vũ khí, hàng cấm, hàng không rõ nguồn gốc.'

type Item = { key: number; name: string; category: string; quantity: number; l: string; w: string; h: string; value: string }
let nextKey = 1
const newItem = (): Item => ({ key: nextKey++, name: '', category: CATEGORIES[0], quantity: 1, l: '', w: '', h: '', value: '' })

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoDate(d) }
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHHMM = (t: number) => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
const hhmm = (iso: string) => iso.slice(11, 16)
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
function openHours(text?: string): [number, number] {
  const m = text?.match(/(\d{1,2})[:h](\d{2})?\s*[-–]\s*(\d{1,2})[:h](\d{2})?/)
  return m ? [Number(m[1]) * 60 + Number(m[2] ?? 0), Number(m[3]) * 60 + Number(m[4] ?? 0)] : [8 * 60, 20 * 60]
}
const num = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }
/** Item volume in m³ from centimetres. */
const volumeOf = (i: Item) => (num(i.l) * num(i.w) * num(i.h) / 1e6) * Math.max(1, i.quantity)

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
      api<StorageUnit[]>(`/api/facilities/${d.facilityId}/units`).then((us) => {
        const u = us.find((x) => x.unitId === d.unitId)
        if (u) api<UnitType[]>('/api/unit-types').then((ts) => setType(ts.find((t) => t.unitTypeId === u.unitTypeId) ?? null)).catch(() => {})
      }).catch(() => {})
    }).catch((e) => setError((e as Error).message))
    api<Contract[]>('/api/contracts/my').then(setContracts).catch(() => {})
    api<Person[]>(`/api/contracts/${id}/authorized-persons`).then((ps) => setPeople(ps.filter((p) => p.authorizedPersonId != null))).catch(() => {})
    void loadRows()
  }, [id, loadRows, today])

  const [open, close] = openHours(facility?.operatingHours)
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
  const named = items.filter((i) => i.name.trim())
  const pieces = named.reduce((n, i) => n + Math.max(1, i.quantity), 0)
  const volume = named.reduce((n, i) => n + volumeOf(i), 0)
  const capacity = type ? type.volumeCubicMeters || type.lengthMeters * type.widthMeters * type.heightMeters : 0
  const fill = capacity ? Math.round(volume / capacity * 100) : 0
  const declaredValue = named.reduce((n, i) => n + num(i.value) * Math.max(1, i.quantity), 0)
  const visitor = who == null ? null : people.find((p) => p.authorizedPersonId === who) ?? null
  const purpose = buildPurpose(items, vehicle, helpers, phone, note)

  const setItem = (key: number, patch: Partial<Item>) => { setItems((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i))); clearErr('items') }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const badItem = items.find((i) => i.name.trim() && [i.l, i.w, i.h].some((d) => d.trim() && (!num(d) || num(d) > 2000)))
    const errs: typeof fieldErr = {
      items: named.length === 0 ? 'Vui lòng khai báo ít nhất một món đồ'
        : badItem ? `Kích thước "${badItem.name.trim()}" không hợp lệ (số cm từ 1 đến 2000)` : undefined,
      entry: !entrySlots.includes(entry) ? 'Giờ đến không còn hợp lệ, vui lòng chọn lại giờ'
        : exitMin <= toMin(entry) ? 'Giờ chuyển đồ vượt quá giờ đóng cửa của kho, vui lòng chọn giờ sớm hơn' : undefined,
      citizenId: checkCitizenId(citizenId, 'Số CCCD người áp tải') || undefined,
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
    try {
      const r = await api<VisitRegistration>(`/api/contracts/${id}/visit-registrations`, {
        body: {
          citizenId: digitsOnly(citizenId),
          authorizedPersonId: who,
          scheduledEntryAt: `${date}T${entry}:00+07:00`,
          scheduledExitAt: `${date}T${exit}:00+07:00`,
          purpose: purpose.text,
        },
      })
      setNotice(`Đã gửi đăng ký đưa ${pieces} món đồ vào kho ${r.unitCode} lúc ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}. Nhân viên cơ sở sẽ duyệt trước giờ hẹn.`)
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
    }
  }

  const cancel = async (r: VisitRegistration) => {
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
              <form className="stack-lg" onSubmit={submit}>
                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">01</span><div><h3>Kho nhận đồ</h3><p className="muted">Chọn hợp đồng / kho bạn muốn đưa đồ vào.</p></div></div>
                  <label className="field"><span>Hợp đồng & kho *</span>
                    <select value={c.contractId} onChange={(e) => navigate(`/my-units/${e.target.value}/move-in`)} aria-label="Chọn hợp đồng">
                      {(active.length ? active : [{ contractId: c.contractId, contractNumber: c.contractNumber, unitCode: c.unitCode, facilityName: c.facilityName } as Contract]).map((x) => (
                        <option key={x.contractId} value={x.contractId}>{x.unitCode} · {x.facilityName} · {x.contractNumber}</option>
                      ))}
                    </select>
                  </label>
                  <div className="notice warn-notice">
                    <span className="notice-icon warn"><Icon name="alert" size={16} /></span>
                    <div><b>Đồ không được gửi</b><p>{FORBIDDEN}</p></div>
                  </div>
                  <Link to={`/my-units/${c.contractId}/visit`} className="link with-icon">Chỉ vào lấy đồ, kiểm tra hay sắp xếp đồ? Đăng ký vào kho <Icon name="arrowRight" size={14} /></Link>
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">02</span><div><h3>Danh sách đồ mang vào</h3><p className="muted">Khai báo từng món hoặc từng nhóm đồ; kích thước giúp ước tính chỗ trống trong kho.</p></div></div>
                  {items.map((it, idx) => (
                    <div key={it.key} className="item-card">
                      <div className="row between">
                        <b className="item-title"><Icon name="package" size={16} /> Món {idx + 1}{it.name.trim() && <span className="muted"> · {it.name.trim()}</span>}</b>
                        {items.length > 1 && <button type="button" className="icon-btn" aria-label={`Xóa món ${idx + 1}`} onClick={() => setItems((is) => is.filter((x) => x.key !== it.key))}><Icon name="trash" size={16} /></button>}
                      </div>
                      <div className="form-grid two">
                        <label className="field"><span>Tên đồ *</span><input value={it.name} maxLength={60} onChange={(e) => setItem(it.key, { name: e.target.value })} placeholder="vd: Tủ lạnh, thùng sách" /></label>
                        <label className="field"><span>Loại đồ</span>
                          <select value={it.category} onChange={(e) => setItem(it.key, { category: e.target.value })}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select>
                        </label>
                      </div>
                      <div className="item-measure">
                        <label className="field"><span>Số lượng</span><input type="number" min={1} max={999} value={it.quantity} onChange={(e) => setItem(it.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} /></label>
                        <div className="field"><span>Kích thước mỗi món (cm) · Dài × Rộng × Cao</span>
                          <div className="dims">
                            <input inputMode="decimal" value={it.l} onChange={(e) => setItem(it.key, { l: e.target.value })} placeholder="Dài" aria-label="Dài (cm)" />
                            <span>×</span>
                            <input inputMode="decimal" value={it.w} onChange={(e) => setItem(it.key, { w: e.target.value })} placeholder="Rộng" aria-label="Rộng (cm)" />
                            <span>×</span>
                            <input inputMode="decimal" value={it.h} onChange={(e) => setItem(it.key, { h: e.target.value })} placeholder="Cao" aria-label="Cao (cm)" />
                          </div>
                        </div>
                        <label className="field"><span>Giá trị ước tính (đ)</span><input inputMode="numeric" value={it.value} onChange={(e) => setItem(it.key, { value: e.target.value.replace(/\D/g, '') })} placeholder="Không bắt buộc" /></label>
                      </div>
                    </div>
                  ))}
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
                  <div className="section-head"><span className="step-no">03</span><div><h3>Lịch chuyển đồ</h3><p className="muted">Chọn ngày giờ trong giờ hoạt động {facility?.operatingHours ?? ''} và phương tiện chở đồ.</p></div></div>
                  <div className="form-grid two">
                    <label className="field"><span>Ngày chuyển đồ *</span>
                      <input type="date" value={date} min={c.startDate > today ? c.startDate : today} max={c.endDate} onChange={(e) => setDate(e.target.value)} required />
                    </label>
                    <label className={`field ${fieldErr.entry ? 'has-error' : ''}`}><span>Giờ đến *</span>
                      <select id="movein-entry" value={entry} onChange={(e) => { setEntry(e.target.value); clearErr('entry') }} aria-invalid={fieldErr.entry ? true : undefined}>{entrySlots.map((s) => <option key={s}>{s}</option>)}</select>
                      <FieldNote text={fieldErr.entry} />
                    </label>
                    <label className="field"><span>Thời gian bốc xếp dự kiến</span>
                      <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} phút` : `${d / 60} giờ`}</option>)}</select>
                    </label>
                    <label className="field"><span>Giờ rời kho</span><input value={exit} readOnly /></label>
                    <label className="field"><span>Phương tiện</span>
                      <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>{VEHICLES.map((v) => <option key={v}>{v}</option>)}</select>
                    </label>
                    <label className="field"><span>Số người phụ bốc xếp</span>
                      <select value={helpers} onChange={(e) => setHelpers(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'Không có' : `${n} người`}</option>)}</select>
                    </label>
                  </div>
                  <span className="label">Người áp tải đồ đến kho</span>
                  <div className="person-picker">
                    <button type="button" className={`person-option ${who == null ? 'active' : ''}`} onClick={() => setWho(null)}>
                      <span className="radio" /><span className="grow"><b>{user?.fullName}</b><small>Chủ hợp đồng</small></span>
                    </button>
                    {people.map((p) => (
                      <button key={p.authorizedPersonId} type="button" className={`person-option ${who === p.authorizedPersonId ? 'active' : ''}`} onClick={() => setWho(p.authorizedPersonId)}>
                        <span className="radio" /><span className="grow"><b>{p.fullName}</b><small>{p.relationship ?? 'Người được ủy quyền'}{p.phoneNumber && ` · ${p.phoneNumber}`}</small></span>
                      </button>
                    ))}
                  </div>
                  <div className="form-grid two">
                    <label className={`field ${fieldErr.citizenId ? 'has-error' : ''}`}><span>Số CCCD người áp tải *</span>
                      <input id="movein-citizenId" value={citizenId} inputMode="numeric" maxLength={12} onChange={(e) => { setCitizenId(cid.keep(e.target.value)); clearErr('citizenId') }} placeholder="12 chữ số trên thẻ CCCD" required aria-invalid={fieldErr.citizenId ? true : undefined} />
                      <FieldNote text={cid.hint ?? fieldErr.citizenId} />
                    </label>
                    <label className={`field ${fieldErr.phone ? 'has-error' : ''}`}><span>SĐT liên hệ khi đến</span>
                      <input id="movein-phone" value={phone} inputMode="tel" maxLength={15} onChange={(e) => { setPhone(tel.keep(e.target.value)); clearErr('phone') }} placeholder={visitor?.phoneNumber ?? '09xx xxx xxx'} aria-invalid={fieldErr.phone ? true : undefined} />
                      <FieldNote text={tel.hint ?? fieldErr.phone} />
                    </label>
                  </div>
                  <p className="hint"><Icon name="clock" size={15} /> Đến đúng giờ và xuất trình CCCD trùng với người áp tải đã đăng ký; xe tải lớn vui lòng gọi trước cho cơ sở.</p>
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">04</span><div><h3>Xác nhận & gửi</h3></div></div>
                  <div className="movein-summary">
                    <div className="row between"><b>Tóm tắt đăng ký</b><span className="badge info">{pieces} món</span></div>
                    <dl className="movein-grid">
                      <div><dt>Kho</dt><dd>{c.unitCode} · {c.facilityName}</dd></div>
                      <div><dt>Thời gian</dt><dd>{entry} – {exit}, ngày {dmy(date)}</dd></div>
                      <div><dt>Người áp tải</dt><dd>{visitor ? visitor.fullName : user?.fullName}</dd></div>
                      <div><dt>Phương tiện</dt><dd>{vehicle}{helpers > 0 && ` · ${helpers} người phụ`}</dd></div>
                      <div><dt>Thể tích ước tính</dt><dd>{volume ? `${volume.toFixed(2)} m³` : '—'}{capacity > 0 && volume > 0 && <small className={fill > 100 ? 'danger-text' : 'muted'}> · {fill}% kho ({capacity.toFixed(1)} m³)</small>}</dd></div>
                      <div><dt>Giá trị khai báo</dt><dd>{declaredValue ? fmtMoney(declaredValue) : '—'}</dd></div>
                    </dl>
                    {fill > 100 && <p className="alert bad"><Icon name="alert" size={15} />Đồ khai báo lớn hơn thể tích kho. Kiểm tra lại kích thước hoặc thuê thêm kho.</p>}
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
                    <button className="btn primary" type="submit" disabled={busy}><Icon name="package" size={15} /> {busy ? 'Đang gửi…' : 'Gửi đăng ký đưa đồ vào kho'}</button>
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
                      </div>
                      <span className={`badge ${st.tone}`}>{st.label}</span>
                      {r.status === 'Pending' && <button type="button" className="btn ghost sm danger-text" onClick={() => cancel(r)}>Hủy</button>}
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
              <div className="unit-photo sm"><ContractUnitArt facilityId={c.facilityId} unitId={c.unitId} /></div>
              <div>
                <h4 className="unit-title">Kho {c.unitCode}</h4>
                <p className="muted">{type ? `${type.typeName} · ${capacity.toFixed(1)} m³` : c.facilityName}</p>
                <span className={`badge ${ended || locked ? 'bad' : 'ok'}`}>{ended ? 'Đã kết thúc' : locked ? 'Đang khóa' : 'Đang hoạt động'}</span>
              </div>
              <div className="info-row"><span className="muted">Cơ sở</span><b>{c.facilityName}</b></div>
              <div className="info-row"><span className="muted">Thời hạn</span><b>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</b></div>
              <div className="info-row"><span className="muted">Giờ mở cửa</span><b>{facility?.operatingHours ?? '—'}</b></div>
              {capacity > 0 && (
                <div className="stack-sm">
                  <div className="info-row"><span className="muted">Đồ khai báo lần này</span><b>{volume.toFixed(2)} / {capacity.toFixed(1)} m³</b></div>
                  <div className="pay-progress" role="progressbar" aria-valuenow={Math.min(fill, 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Tỷ lệ chiếm kho"><i style={{ width: `${Math.min(fill, 100)}%`, background: fill > 100 ? 'var(--bad)' : fill > 80 ? 'var(--warn)' : undefined }} /></div>
                </div>
              )}
              <div className="notice info-notice">
                <span className="notice-icon info"><Icon name="idCard" size={15} /></span>
                <div><b>Tại cổng</b><p>Nhân viên đối chiếu CCCD người áp tải và danh sách đồ đã khai báo trước khi mở kho.</p></div>
              </div>
              <Link to={`/my-units/${c.contractId}`} className="btn outline block"><Icon name="clipboard" size={15} /> Xem hợp đồng</Link>
            </section>

            <section className="panel">
              <h3 className="panel-title">Các bước tiếp theo</h3>
              <ol className="next-steps">
                <li><span>1</span><div><b>Nhân viên duyệt</b><p>Cơ sở xem danh sách đồ và lịch chuyển, duyệt hoặc từ chối kèm ghi chú.</p></div></li>
                <li><span>2</span><div><b>Chuyển đồ đến kho</b><p>Đến đúng khung giờ; người áp tải xuất trình CCCD tại cổng.</p></div></li>
                <li><span>3</span><div><b>Đối chiếu & cất đồ</b><p>Nhân viên đối chiếu đồ với khai báo, mở kho để bạn sắp xếp.</p></div></li>
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}
