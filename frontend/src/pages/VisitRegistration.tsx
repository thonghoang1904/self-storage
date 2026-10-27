import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CITIZEN_ID_FILTER, citizenIdError, digitsOnly, textError } from '../validation'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Empty, Icon } from '../components/ui'
import { ContractUnitArt } from '../components/unitPhoto'
import { MOVE_IN_PREFIX, VisitPurposes, type Contract, type ContractDetail, type Facility, type Person, type VisitRegistration } from '../types'
import { FieldNote, useInputFilter } from '../components/form'
import { Select } from '../components/Select'

/**
 * Figma "Đăng ký vào kho" (120:2111): the customer books a time to come to the unit, for themselves or an
 * authorized person, and follows staff approval. The gate only admits a visitor with an approved registration
 * whose window covers the arrival time (POST/GET/DELETE /api/contracts/{id}/visit-registrations).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoDate(d) }
const hhmm = (iso: string) => iso.slice(11, 16)
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/** "06:00 - 22:00" → minutes; falls back to office hours. */
function hours(text?: string): [number, number] {
  const m = text?.match(/(\d{1,2})[:h](\d{2})?\s*[-–]\s*(\d{1,2})[:h](\d{2})?/)
  return m ? [Number(m[1]) * 60 + Number(m[2] ?? 0), Number(m[3]) * 60 + Number(m[4] ?? 0)] : [8 * 60, 20 * 60]
}
const toHHMM = (t: number) => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`

const VISIT_STATE: Record<string, { label: string; tone: string; icon: string }> = {
  Pending: { label: 'Chờ nhân viên duyệt', tone: 'warn', icon: 'clock' },
  Approved: { label: 'Đã duyệt', tone: 'ok', icon: 'check' },
  Rejected: { label: 'Bị từ chối', tone: 'bad', icon: 'x' },
  Cancelled: { label: 'Đã hủy', tone: 'muted', icon: 'x' },
}

/**
 * "Đăng Ký Vào Kho" (/visit, optionally ?contract=): first the customer picks the unit and what the request is for —
 * (1) entering the unit (take out, check, rearrange) or (2) bringing items in — then continues to that form
 * (/my-units/:id/visit or /my-units/:id/move-in).
 */
const REQUEST_KINDS = [
  { key: 'visit', icon: 'calendar', title: 'Đăng ký vào kho', text: 'Vào kho để lấy đồ ra, kiểm tra hoặc sắp xếp lại đồ.',
    points: ['Chọn ngày, giờ vào và giờ rời kho', 'Chọn người đến: bạn hoặc người được ủy quyền', 'Xuất trình CCCD tại cổng khi đến'] },
  { key: 'move-in', icon: 'package', title: 'Đăng ký đưa đồ vào kho', text: 'Mang đồ mới vào kho, khai báo trước để nhân viên chuẩn bị.',
    points: ['Khai báo danh sách đồ, kích thước, số lượng', 'Lịch chuyển đồ, phương tiện, người phụ', 'Người áp tải xuất trình CCCD tại cổng'] },
] as const

export function VisitHub() {
  const navigate = useNavigate()
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [error, setError] = useState('')
  const [params] = useSearchParams()
  const [chosen, setChosen] = useState<number | null>(() => Number(params.get('contract')) || null)
  const [kind, setKind] = useState<'visit' | 'move-in' | null>(null)
  const [tried, setTried] = useState(false)
  useEffect(() => {
    api<Contract[]>('/api/contracts/my').then(setContracts).catch((e) => setError((e as Error).message))
  }, [])
  if (!contracts) {
    return <div className="container page-body">{error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}</div>
  }
  const usable = contracts.filter((c) => c.status === 'Active' || c.status === 'Renewed')
  if (usable.length === 0) {
    return (
      <div className="container page-body stack">
        <h1>Đăng ký vào kho</h1>
        <Empty icon="package">Bạn chưa có hợp đồng đang hoạt động để đăng ký vào kho.</Empty>
        <Link to="/rent" className="btn primary self-start"><Icon name="plus" size={15} /> Thuê kho</Link>
      </div>
    )
  }
  const current = usable.find((c) => c.contractId === chosen) ?? usable[0]
  const next = () => {
    setTried(true)
    if (!kind) return
    navigate(`/my-units/${current.contractId}/${kind}`)
  }

  return (
    <>
      <section className="page-hero detail-hero">
        <div className="container">
          <div className="grow">
            <nav className="crumbs"><Link to="/my-units">Kho Của Tôi</Link><span>/</span><b>Đăng ký vào kho</b></nav>
            <h1>Đăng ký vào kho</h1>
            <p>Chọn kho và loại yêu cầu, sau đó điền thông tin ở bước tiếp theo. Nhân viên cổng chỉ cho vào khi lịch đã được duyệt.</p>
          </div>
        </div>
      </section>
      <div className="container page-body stack-lg">
        <ol className="journey">
          <li className="active"><span>1</span>Chọn loại yêu cầu</li>
          <li className="later"><span>2</span>Điền thông tin</li>
          <li className="later"><span>3</span>Nhân viên duyệt</li>
        </ol>

        <section className="panel stack">
          <div><h2 className="panel-title">Kho của bạn</h2><p className="muted">{usable.length > 1 ? 'Chọn kho muốn đăng ký.' : 'Yêu cầu áp dụng cho kho này.'}</p></div>
          <div className="contract-picker" role="radiogroup" aria-label="Chọn kho">
            {usable.map((c) => (
              <button key={c.contractId} type="button" role="radio" aria-checked={c.contractId === current.contractId}
                className={c.contractId === current.contractId ? 'active' : ''} onClick={() => setChosen(c.contractId)}>
                <b>Kho {c.unitCode}</b><small>{c.facilityName} · {c.contractNumber}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel stack">
          <div><h2 className="panel-title">Bạn muốn làm gì?</h2><p className="muted">Chọn một trong hai loại yêu cầu.</p></div>
          <div className="request-kinds" role="radiogroup" aria-label="Loại yêu cầu">
            {REQUEST_KINDS.map((k, i) => (
              <button key={k.key} type="button" role="radio" aria-checked={kind === k.key}
                className={`request-kind ${kind === k.key ? 'active' : ''}`} onClick={() => { setKind(k.key); setTried(false) }}>
                <span className="request-kind-top">
                  <span className="tile-icon"><Icon name={k.icon} size={20} /></span>
                  <span className="request-kind-no">{i + 1}</span>
                  <span className="radio" />
                </span>
                <b>{k.title}</b>
                <span className="muted">{k.text}</span>
                <ul>{k.points.map((t) => <li key={t}><Icon name="check" size={13} /> {t}</li>)}</ul>
              </button>
            ))}
          </div>
          {tried && !kind && <small className="field-error" role="alert"><Icon name="alert" size={12} /> Vui lòng chọn một loại yêu cầu</small>}
          <div className="row between wrap">
            <Link to="/my-units" className="btn outline">Quay lại</Link>
            <button type="button" className="btn primary" onClick={next}>Tiếp tục <Icon name="arrowRight" size={16} /></button>
          </div>
        </section>
      </div>
    </>
  )
}

export default function VisitRegistrationPage({ contractId, picker }: { contractId?: number; picker?: ReactNode } = {}) {
  const routeId = Number(useParams().id)
  const id = contractId ?? routeId
  const { user } = useAuth()
  const [c, setC] = useState<ContractDetail | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [rows, setRows] = useState<VisitRegistration[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const today = isoDate(new Date())
  const [date, setDate] = useState(addDays(today, 1))
  const [entry, setEntry] = useState('09:00')
  const [exit, setExit] = useState('10:00')
  const [purpose, setPurpose] = useState(VisitPurposes[0])
  const [otherPurpose, setOtherPurpose] = useState('')
  /** Errors shown under the field they belong to (the top alert is only for loading the contract). */
  const [fieldErr, setFieldErr] = useState<{ time?: string; purpose?: string; citizenId?: string; agree?: string; submit?: string }>({})
  const clearErr = (k: keyof typeof fieldErr) => setFieldErr((f) => (f[k] || f.submit ? { ...f, [k]: undefined, submit: undefined } : f))
  const [who, setWho] = useState<number | null>(null) // null = contract holder
  const [citizenId, setCitizenId] = useState('')
  const cid = useInputFilter(CITIZEN_ID_FILTER)
  const [agree, setAgree] = useState(false)

  // Registrations to bring items in are listed on the move-in page, not here.
  const loadRows = useCallback(() => api<VisitRegistration[]>(`/api/contracts/${id}/visit-registrations`)
    .then((rs) => setRows(rs.filter((r) => !r.purpose.startsWith(MOVE_IN_PREFIX)))).catch(() => {}), [id])

  useEffect(() => {
    api<ContractDetail>(`/api/contracts/${id}`).then((d) => {
      setC(d)
      api<Facility[]>('/api/facilities').then((fs) => setFacility(fs.find((f) => f.facilityId === d.facilityId) ?? null)).catch(() => {})
      // Earliest date: tomorrow, or the contract start if later.
      if (d.startDate > addDays(today, 1)) setDate(d.startDate)
    }).catch((e) => setError((e as Error).message))
    api<Person[]>(`/api/contracts/${id}/authorized-persons`).then(setPeople).catch(() => {})
    void loadRows()
  }, [id, loadRows, today])

  const [open, close] = hours(facility?.operatingHours)
  const slots: string[] = []
  for (let t = Math.ceil(open / 30) * 30; t <= close; t += 30) slots.push(toHHMM(t))
  // Today only future times; on the last day of the contract the visit must end before 20:00.
  const nowHHMM = toHHMM(new Date().getHours() * 60 + new Date().getMinutes())
  const entrySlots = slots.slice(0, -1).filter((s) => (date !== today || s > nowHHMM) && (date !== c?.endDate || s < '19:30'))
  const exitSlots = slots.filter((s) => s > entry && (date !== c?.endDate || s < '20:00'))
  useEffect(() => { if (entrySlots.length && !entrySlots.includes(entry)) setEntry(entrySlots[0]) }, [date, entrySlots.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!exitSlots.includes(exit)) setExit(exitSlots[1] ?? exitSlots[0] ?? '') }, [entry, date, exitSlots.join()]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const visitor = who == null ? null : people.find((p) => p.authorizedPersonId === who) ?? null
  const visitorName = visitor ? visitor.fullName : user?.fullName ?? 'Chủ hợp đồng'
  const finalPurpose = purpose === 'Khác' ? otherPurpose.trim() : purpose
  const pending = rows.filter((r) => r.status === 'Pending').length
  const latest = rows[0]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const errs: typeof fieldErr = {
      time: !entrySlots.includes(entry) || !exit ? 'Ngày này không còn khung giờ trống, vui lòng chọn ngày khác' : undefined,
      purpose: textError(finalPurpose ?? '', 'Mục đích vào kho', 3, 255) ?? undefined,
      citizenId: citizenIdError(citizenId) ?? undefined,
      agree: agree ? undefined : 'Vui lòng tích xác nhận cam kết trước khi gửi đăng ký',
    }
    setFieldErr(errs)
    const first = (['time', 'purpose', 'citizenId', 'agree'] as const).find((k) => errs[k])
    if (first) {
      const el = document.getElementById(`visit-${first}`)
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
          purpose: finalPurpose,
        },
      })
      setNotice(`Đã gửi đăng ký vào kho ${r.unitCode} lúc ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}. Nhân viên cơ sở sẽ duyệt trước giờ hẹn.`)
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
      setNotice(`Đã hủy lịch ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}.`)
      await loadRows()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <section className="page-hero detail-hero">
        <div className="container">
          <div className="grow">
            <nav className="crumbs">
              <Link to="/my-units">Kho Của Tôi</Link><span>/</span>
              <Link to={`/my-units/${c.contractId}`}>{c.unitCode}</Link><span>/</span>
              <Link to={`/my-units/${c.contractId}`}>{c.contractNumber}</Link><span>/</span>
              <b>Đăng ký vào kho</b>
            </nav>
            <h1>Đăng ký vào kho</h1>
            <p>Đăng ký lượt vào kho {c.unitCode} để lấy đồ ra, kiểm tra hoặc sắp xếp đồ. Muốn mang đồ vào kho, dùng <Link to={`/my-units/${c.contractId}/move-in`} className="link cyan">Đăng ký đưa đồ vào kho</Link>.</p>
          </div>
          <div className="hero-side">
            <span className={`badge ${ended || locked ? 'bad' : 'ok'}`}>{ended ? 'Hợp đồng đã kết thúc' : locked ? 'Kho đang bị khóa' : 'Hợp đồng đang hoạt động'}</span>
            <small>Hợp đồng {c.contractNumber}</small>
          </div>
        </div>
      </section>
      {picker && <div className="container picker-row"><span className="muted">Chọn kho muốn vào:</span>{picker}</div>}

      <div className="container page-body">
        <div className="row between wrap">
          <Link to={`/my-units/${c.contractId}`} className="link with-icon"><Icon name="arrowRight" size={14} className="flip" /> Quay lại hợp đồng {c.contractNumber}</Link>
          <span className={`badge ${latest ? VISIT_STATE[latest.status]?.tone ?? 'muted' : 'muted'}`}>{latest ? VISIT_STATE[latest.status]?.label : 'Chưa gửi đăng ký'}</span>
        </div>

        <ol className="journey">
          <li className="done"><span><Icon name="check" size={14} /></span>Hợp đồng đã ký</li>
          <li className="active"><span>1</span>Đăng ký lịch vào kho</li>
          <li className="later"><span>2</span>Nhân viên duyệt</li>
          <li className="later"><span>3</span>Xuất trình CCCD tại cổng</li>
        </ol>

        {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <div className="visit-layout">
          <div className="stack-lg">
            <div className="notice info-notice">
              <span className="notice-icon info"><Icon name="idCard" size={16} /></span>
              <div>
                <b>Đăng ký lượt vào kho</b>
                <p>Mỗi lần đến kho cần một lịch đã được duyệt. Đến đúng khung giờ, xuất trình CCCD trùng với người đã đăng ký để nhân viên cổng đối chiếu.</p>
              </div>
            </div>

            {ended || locked ? (
              <section className="panel"><Empty icon="lock">{ended ? 'Hợp đồng đã kết thúc nên không thể đăng ký vào kho.' : 'Kho đang bị khóa do quá hạn. Vui lòng thanh toán hoặc liên hệ cơ sở trước khi đăng ký.'}</Empty></section>
            ) : (
              <form className="stack-lg" onSubmit={submit}>
                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">01</span><div><h3>Lịch vào kho dự kiến</h3><p className="muted">Chọn ngày và giờ trong khung giờ hoạt động của kho.</p></div></div>
                  <dl className="context-box">
                    <div><dt>Kho đăng ký</dt><dd>{c.unitCode} • {c.facilityName}</dd></div>
                    <div><dt>Hợp đồng áp dụng</dt><dd>{c.contractNumber} • đến {fmtDate(c.endDate)}</dd></div>
                  </dl>
                  <div className="form-grid three">
                    <label className={`field ${fieldErr.time ? 'has-error' : ''}`}><span>Ngày vào kho dự kiến *</span>
                      <input id="visit-time" type="date" value={date} min={c.startDate > today ? c.startDate : today} max={c.endDate} onChange={(e) => { setDate(e.target.value); clearErr('time') }} required aria-invalid={fieldErr.time ? true : undefined} />
                      <FieldNote text={fieldErr.time} />
                    </label>
                    <label className="field"><span>Giờ đến dự kiến *</span>
                      <Select value={entry} onChange={(e) => setEntry(e.target.value)}>
                        {entrySlots.map((s) => <option key={s} value={s}>{s}</option>)}
                        {entrySlots.length === 0 && <option value="">Hết giờ trong ngày, chọn ngày khác</option>}
                      </Select>
                    </label>
                    <label className="field"><span>Giờ rời kho dự kiến *</span>
                      <Select value={exit} onChange={(e) => setExit(e.target.value)}>
                        {exitSlots.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </label>
                  </div>
                  <p className="hint"><Icon name="clock" size={15} /> Giờ hoạt động: {facility?.operatingHours ?? '—'} hằng ngày. Lịch trên là đề xuất, chưa được xác nhận.</p>
                  <label className={`field ${fieldErr.purpose && purpose !== 'Khác' ? 'has-error' : ''}`}><span>Mục đích vào kho *</span>
                    <Select id={purpose === 'Khác' ? undefined : 'visit-purpose'} value={purpose} onChange={(e) => { setPurpose(e.target.value); clearErr('purpose') }}>
                      {VisitPurposes.map((p) => <option key={p}>{p}</option>)}
                    </Select>
                    {purpose !== 'Khác' && <FieldNote text={fieldErr.purpose} />}
                  </label>
                  <p className="hint"><Icon name="package" size={15} /> Mang đồ vào kho? <Link to={`/my-units/${c.contractId}/move-in`} className="link">Dùng Đăng ký đưa đồ vào kho</Link> để khai báo danh sách đồ, phương tiện và người phụ.</p>
                  {purpose === 'Khác' && (
                    <label className={`field ${fieldErr.purpose ? 'has-error' : ''}`}><span>Ghi rõ mục đích *</span>
                      <input id="visit-purpose" value={otherPurpose} maxLength={255} onChange={(e) => { setOtherPurpose(e.target.value); clearErr('purpose') }} placeholder="vd: Bàn giao chìa khóa cho người được ủy quyền" required aria-invalid={fieldErr.purpose ? true : undefined} />
                      <FieldNote text={fieldErr.purpose} />
                    </label>
                  )}
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">02</span><div><h3>Người đến kho</h3><p className="muted">Bạn hoặc người được ủy quyền trên hợp đồng. CCCD phải trùng với hồ sơ.</p></div></div>
                  <div className="person-picker">
                    <button type="button" className={`person-option ${who == null ? 'active' : ''}`} onClick={() => setWho(null)}>
                      <span className="radio" /><span className="grow"><b>{user?.fullName}</b><small>Chủ hợp đồng</small></span>
                    </button>
                    {people.map((p) => (
                      <button key={p.authorizedPersonId} type="button" className={`person-option ${who === p.authorizedPersonId ? 'active' : ''}`} onClick={() => setWho(p.authorizedPersonId)}>
                        <span className="radio" /><span className="grow"><b>{p.fullName}</b><small>{p.relationship ?? 'Người được ủy quyền'} · SĐT {p.phoneNumber}</small></span>
                      </button>
                    ))}
                  </div>
                  {people.length === 0 && <p className="hint"><Icon name="users" size={15} /> Muốn người khác vào thay bạn? <Link to={`/my-units?contract=${c.contractId}&tab=people`} className="link">Thêm người được ủy quyền</Link></p>}
                  <label className={`field ${fieldErr.citizenId ? 'has-error' : ''}`}><span>Số CCCD của người đến kho *</span>
                    <input id="visit-citizenId" value={citizenId} inputMode="numeric" maxLength={12} onChange={(e) => { setCitizenId(cid.keep(e.target.value)); clearErr('citizenId') }} placeholder="Nhập đủ 12 số trên thẻ CCCD" required aria-invalid={fieldErr.citizenId ? true : undefined} />
                    <FieldNote text={cid.hint ?? fieldErr.citizenId} />
                  </label>
                </section>

                <section className="panel form-section">
                  <div className="section-head"><span className="step-no">03</span><div><h3>Xác nhận đăng ký</h3><p className="muted">Kiểm tra lại thông tin trước khi gửi.</p></div></div>
                  <dl className="summary-lines">
                    <div><dt>Kho</dt><dd>{c.unitCode} · {c.facilityName}</dd></div>
                    <div><dt>Thời gian</dt><dd>{entry} – {exit}, ngày {dmy(date)}</dd></div>
                    <div><dt>Người đến</dt><dd>{visitorName}</dd></div>
                    <div><dt>Mục đích</dt><dd>{finalPurpose || '—'}</dd></div>
                  </dl>
                  <label className="check-line">
                    <input id="visit-agree" type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); clearErr('agree') }} />
                    <span>Tôi cam kết đến đúng khung giờ, xuất trình CCCD của người đã đăng ký và tuân thủ nội quy kho.</span>
                  </label>
                  <FieldNote text={fieldErr.agree} />
                  {fieldErr.submit && <p className="alert bad"><Icon name="alert" size={16} />{fieldErr.submit}</p>}
                  <div className="row wrap">
                    <button className="btn primary" type="submit" disabled={busy || !entrySlots.length || !exit}><Icon name="calendar" size={15} /> {busy ? 'Đang gửi…' : 'Gửi đăng ký vào kho'}</button>
                    <Link to={`/my-units/${c.contractId}`} className="btn outline">Để sau</Link>
                  </div>
                </section>
              </form>
            )}

            <section className="panel">
              <div className="row between wrap">
                <h3 className="panel-title"><Icon name="history" size={18} className="cyan" /> Lịch đã đăng ký {pending > 0 && <span className="pill">{pending} chờ duyệt</span>}</h3>
              </div>
              <div className="visit-list">
                {rows.map((r) => {
                  const st = VISIT_STATE[r.status] ?? { label: r.status, tone: 'muted', icon: 'clock' }
                  return (
                    <div key={r.visitRegistrationId} className="visit-row">
                      <span className={`notice-icon ${st.tone}`}><Icon name={st.icon} size={15} /></span>
                      <div className="grow">
                        <b>{hhmm(r.scheduledEntryAt)} – {hhmm(r.scheduledExitAt)} · {dmy(r.scheduledEntryAt)}</b>
                        <small className="muted block">{r.visitorName} · {r.purpose} · gửi {fmtTime(r.requestedAt)}</small>
                        {r.reviewNotes && <small className="muted block">Ghi chú nhân viên: {r.reviewNotes}</small>}
                      </div>
                      <span className={`badge ${st.tone}`}>{st.label}</span>
                      {r.status === 'Pending' && <button type="button" className="btn ghost sm danger-text" onClick={() => cancel(r)}>Hủy</button>}
                    </div>
                  )
                })}
                {rows.length === 0 && <Empty icon="calendar">Chưa có lịch vào kho nào.</Empty>}
              </div>
            </section>
          </div>

          <aside className="stack-lg">
            <section className="panel">
              <h3 className="panel-title">Hợp đồng của bạn</h3>
              <div className="unit-photo sm"><ContractUnitArt facilityId={c.facilityId} unitId={c.unitId} /></div>
              <div>
                <h4 className="unit-title">Kho {c.unitCode}</h4>
                <p className="muted">{c.facilityName} • {c.contractNumber}</p>
                <span className={`badge ${ended || locked ? 'bad' : 'ok'}`}>{ended ? 'Đã kết thúc' : locked ? 'Đang khóa' : 'Đã ký • Đang hoạt động'}</span>
              </div>
              <div className="info-row"><span className="muted">Chủ hợp đồng</span><b>{user?.fullName}</b></div>
              <div className="info-row"><span className="muted">Thời hạn</span><b>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</b></div>
              <div className="info-row"><span className="muted">Tiền thuê / tháng</span><b>{fmtMoney(c.monthlyRentFee)}</b></div>
              <div className="info-row"><span className="muted">Tiền cọc</span><b>{fmtMoney(c.depositPaid)}</b></div>
              <div className="notice info-notice">
                <span className="notice-icon info"><Icon name="clock" size={15} /></span>
                <div><b>Giờ vào kho: {facility?.operatingHours ?? '—'}</b><p>Quyền truy cập theo hợp đồng đã ký. Mỗi lượt vào cần lịch đã được duyệt.</p></div>
              </div>
              <Link to={`/my-units/${c.contractId}`} className="btn outline block"><Icon name="clipboard" size={15} /> Xem hợp đồng đã ký</Link>
            </section>

            <section className="panel">
              <h3 className="panel-title">Sau khi gửi đăng ký</h3>
              <ol className="next-steps">
                <li><span>1</span><div><b>Chờ xác nhận</b><p>Đăng ký ở trạng thái chờ cho đến khi nhân viên cơ sở duyệt.</p></div></li>
                <li><span>2</span><div><b>Nhận kết quả</b><p>Trạng thái cập nhật tại trang này: đã duyệt hoặc bị từ chối kèm ghi chú.</p></div></li>
                <li><span>3</span><div><b>Đến kho đúng giờ</b><p>Xuất trình CCCD tại cổng trong khung giờ đã đăng ký.</p></div></li>
              </ol>
            </section>

            <section className="panel">
              <h3 className="panel-title">Hỗ trợ khách hàng</h3>
              <p className="muted">Cần đổi lịch gấp hoặc có sự cố tại kho?</p>
              <Link to={`/support?contract=${c.contractId}`} className="link with-icon"><Icon name="phone" size={14} /> Gửi yêu cầu hỗ trợ · (028) 1234 5678</Link>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}
