import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, fmtDate, fmtTime, IS_DEMO } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import { DenyReasons, type AccessRecord, type Person, type VisitCandidate, type VisitRegistration } from '../types'
import { CITIZEN_ID_FILTER } from '../validation'
import { FieldNote, useInputFilter } from '../components/form'

const REFRESH_MS = 5000
const hhmm = (iso: string) => iso.slice(11, 16)
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
/** Approved registration whose window covers now, for this contract and visitor (null = contract holder). */
const activeRegistration = (regs: VisitRegistration[], contractId: number, authorizedPersonId: number | null) => {
  const now = Date.now()
  return regs.find((r) => r.contractId === contractId && r.status === 'Approved' && r.authorizedPersonId === authorizedPersonId
    && new Date(r.scheduledEntryAt).getTime() <= now && new Date(r.scheduledExitAt).getTime() >= now)
}

/** "0792••••0123": staff must read the number off the card, the screen only confirms it. */
const maskId = (id: string | null) => (id ? (id.length > 6 ? `${id.slice(0, 4)}${'•'.repeat(id.length - 7)}${id.slice(-3)}` : id) : '—')

/**
 * Staff on duty at the gate. A visitor arrives, staff finds their contract, checks the ID card
 * and records entry or denial; when the visitor leaves, staff confirms the exit.
 */
export default function Gate() {
  const { facilities, facilityId, error: facilityError } = useStaffFacility()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [candidates, setCandidates] = useState<VisitCandidate[] | null>(null)
  const [inside, setInside] = useState<AccessRecord[]>([])
  const [today, setToday] = useState<AccessRecord[]>([])
  const [regs, setRegs] = useState<VisitRegistration[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [searching, setSearching] = useState(false)

  const refresh = useCallback(async () => {
    if (!facilityId) return
    try {
      const [i, t, v] = await Promise.all([
        api<AccessRecord[]>(`/api/gate/facilities/${facilityId}/inside`),
        api<AccessRecord[]>(`/api/gate/facilities/${facilityId}/today`),
        api<VisitRegistration[]>(`/api/gate/facilities/${facilityId}/visit-registrations`),
      ])
      setInside(i)
      setToday(t)
      setRegs(v)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])

  useEffect(() => {
    setCandidates(null)
    void refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const runSearch = async (q: string) => {
    setError('')
    setNotice(null)
    setSearching(true)
    try {
      setCandidates(await api<VisitCandidate[]>(`/api/gate/facilities/${facilityId}/lookup?q=${encodeURIComponent(q)}`))
      setSearched(q.trim())
    } catch (err) {
      setError((err as Error).message)
      setCandidates(null)
    } finally {
      setSearching(false)
    }
  }

  const search = (e: FormEvent) => {
    e.preventDefault()
    void runSearch(query)
  }

  const onRecorded = (rec: AccessRecord) => {
    setNotice(rec.result === 'Granted'
      ? { tone: 'ok', text: `Đã cho ${rec.visitorName}${(rec.companionCount ?? 0) > 0 ? ` và ${rec.companionCount} người đi cùng` : ''} vào kho ${rec.unitCode} lúc ${fmtTime(rec.entryTime)}.` }
      : { tone: 'bad', text: `Đã ghi nhận từ chối ${rec.visitorName} (kho ${rec.unitCode}): ${DenyReasons[rec.denyReason ?? 'Other']}.` })
    setCandidates(null)
    setQuery('')
    void refresh()
  }

  // Ignore repeated clicks while a review or exit is being saved.
  const inFlight = useRef(new Set<string>())
  const review = async (r: VisitRegistration, approve: boolean, notes?: string) => {
    const key = `r${r.visitRegistrationId}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    setError('')
    try {
      await api(`/api/gate/facilities/${facilityId}/visit-registrations/${r.visitRegistrationId}/review`, { body: { approve, notes: notes || null } })
      setNotice({ tone: approve ? 'ok' : 'bad', text: `${approve ? 'Đã duyệt' : 'Đã từ chối'} lịch của ${r.visitorName} (kho ${r.unitCode}) ${hhmm(r.scheduledEntryAt)} ngày ${dmy(r.scheduledEntryAt)}.` })
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current.delete(key)
    }
  }

  const confirmExit = async (r: AccessRecord) => {
    const key = `x${r.accessRecordId}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    try {
      await api(`/api/gate/access-records/${r.accessRecordId}/exit`, { method: 'POST' })
      setNotice({ tone: 'ok', text: `${r.visitorName} đã ra khỏi kho ${r.unitCode}.` })
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current.delete(key)
    }
  }

  if (!facilities.length) {
    return <div className="panel"><Empty icon="building">{facilityError || 'Bạn chưa được phân công tại cơ sở nào.'}</Empty></div>
  }

  const granted = today.filter((r) => r.result === 'Granted').length
  const denied = today.filter((r) => r.result === 'Denied').length
  const exited = today.filter((r) => r.exitTime).length

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <div>
          <h1>Kiểm Tra & Cho Vào Kho</h1>
          <p className="muted">Tìm hợp đồng của khách, đối chiếu CCCD trên thẻ rồi cho vào hoặc ghi nhận từ chối.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard icon="users" tone="info" label="Đang ở trong kho" value={inside.length} note="Cập nhật mỗi 5 giây" />
        <StatCard icon="door" tone="ok" label="Lượt vào hôm nay" value={granted} note={`${exited} lượt đã ra`} />
        <StatCard icon="alert" tone="bad" label="Từ chối hôm nay" value={denied} note="Đã ghi lý do vào nhật ký" />
        <StatCard icon="history" tone="warn" label="Tổng lượt hôm nay" value={today.length} note={fmtDate(new Date().toISOString())} />
      </div>

      <section className="panel">
        <h3 className="panel-title">Tìm & kiểm tra khách đến</h3>
        <p className="muted">Nhập mã kho, số hợp đồng, số CCCD, số điện thoại hoặc tên của khách hay người được ủy quyền. Chỉ cần gõ một phần, chữ hoa hay thường đều được (vd: <b>a</b>, <b>b-0</b>, <b>0912</b>).</p>
        <form className="search-row" onSubmit={search}>
          <span className="input-wrap grow">
            <Icon name="search" className="input-lead" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="vd: B-01, HD-DEMO-0001, 079300000456" />
          </span>
          <button className="btn primary" type="submit" disabled={searching || !query.trim()}><Icon name="search" size={16} /> {searching ? 'Đang tìm…' : 'Kiểm tra'}</button>
        </form>
        {IS_DEMO && (
          <div className="quick-tries">
            <span className="muted">Thử nhanh:</span>
            {['B-01', '079300000456', 'C-02', 'D-01'].map((q) => (
              <button key={q} type="button" className="chip" onClick={() => { setQuery(q); void runSearch(q) }}>{q}</button>
            ))}
          </div>
        )}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        {notice && <p className={`alert ${notice.tone}`}><Icon name={notice.tone === 'ok' ? 'check' : 'alert'} size={16} />{notice.text}</p>}
      </section>

      {candidates && candidates.length === 0 && <div className="panel"><Empty icon="search">Không tìm thấy hợp đồng nào khớp "{searched}" tại cơ sở này.</Empty></div>}
      {candidates?.map((c) => (
        <VisitCard key={`${c.contractId}-${searched}`} facilityId={facilityId!} visit={c} query={searched} regs={regs} onRecorded={onRecorded} />
      ))}

      <RegistrationsPanel facilityId={facilityId} regs={regs} onReview={review} />

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Đang ở trong kho <span className="pill">{inside.length}</span></h3>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Kho</th><th>Người vào</th><th>Mục đích</th><th>Vào lúc</th><th>Nhân viên duyệt</th><th></th></tr></thead>
            <tbody>
              {inside.map((r) => (
                <tr key={r.accessRecordId}>
                  <td><span className="unit-code">{r.unitCode}</span></td>
                  <td><b>{r.visitorName}</b>{(r.companionCount ?? 0) > 0 && <span className="pill muted">+{r.companionCount} người</span>}<br /><small className="muted">HĐ {r.contractNumber}</small></td>
                  <td>{r.purpose ?? '—'}</td>
                  <td>{fmtTime(r.entryTime)}</td>
                  <td>{r.verifiedBy}</td>
                  <td className="right"><button className="btn outline sm" onClick={() => confirmExit(r)}><Icon name="logout" size={15} /> Xác nhận ra</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {inside.length === 0 && <Empty icon="door">Không có ai trong kho.</Empty>}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">Nhật ký hôm nay <span className="pill">{today.length}</span></h3>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Giờ</th><th>Kho</th><th>Người</th><th>Kết quả</th><th>Ra lúc</th><th>Nhân viên</th></tr></thead>
            <tbody>
              {today.map((r) => (
                <tr key={r.accessRecordId}>
                  <td>{fmtTime(r.entryTime)}</td>
                  <td><span className="unit-code">{r.unitCode}</span></td>
                  <td>{r.visitorName}{(r.companionCount ?? 0) > 0 && <small className="muted"> +{r.companionCount} người</small>}</td>
                  <td>{r.result === 'Granted'
                    ? <span className="badge ok">Cho vào</span>
                    : <span className="badge bad">Từ chối · {DenyReasons[r.denyReason ?? 'Other'] ?? r.denyReason}</span>}</td>
                  <td>{r.exitTime ? fmtTime(r.exitTime) : '—'}</td>
                  <td>{r.verifiedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {today.length === 0 && <Empty icon="history">Chưa có lượt nào hôm nay.</Empty>}
        </div>
      </section>
    </div>
  )
}

function StatCard({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: number; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

/** Customers' visit registrations at this facility: pending ones to approve or reject, then today's approved ones. */
function RegistrationsPanel({ facilityId, regs, onReview }: { facilityId: number | null; regs: VisitRegistration[]; onReview: (r: VisitRegistration, approve: boolean, notes?: string) => void }) {
  const [tab, setTab] = useState<'Pending' | 'Approved'>('Pending')
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const now = Date.now()
  const pending = regs.filter((r) => r.status === 'Pending')
  const approved = regs.filter((r) => r.status === 'Approved' && new Date(r.scheduledExitAt).getTime() >= now)
  const shown = tab === 'Pending' ? pending : approved
  return (
    <section className="panel">
      <div className="panel-head wrap">
        <div>
          <h3 className="panel-title">Lịch đăng ký vào kho</h3>
          <p className="muted">Khách đăng ký trước giờ đến. Chỉ lịch đã duyệt và đang trong khung giờ mới được cho vào cổng.</p>
        </div>
        <div className="segmented">
          <button className={tab === 'Pending' ? 'active' : ''} onClick={() => setTab('Pending')}>Chờ duyệt {pending.length > 0 && <span className="pill">{pending.length}</span>}</button>
          <button className={tab === 'Approved' ? 'active' : ''} onClick={() => setTab('Approved')}>Đã duyệt ({approved.length})</button>
        </div>
      </div>
      <div>
        {shown.map((r) => {
          const live = new Date(r.scheduledEntryAt).getTime() <= now && new Date(r.scheduledExitAt).getTime() >= now
          const open = openId === r.visitRegistrationId
          return (
            <Fragment key={r.visitRegistrationId}>
            <div className={`reg-row ${open ? 'open' : ''}`}>
              <div className="reg-time"><b>{hhmm(r.scheduledEntryAt)} – {hhmm(r.scheduledExitAt)}</b><small className="muted">{dmy(r.scheduledEntryAt)}</small></div>
              <span className="unit-code">{r.unitCode}</span>
              <div className="grow">
                <b>{r.visitorName}</b> {r.authorizedPersonId != null && <span className="pill muted">Ủy quyền</span>}
                <small className="muted block">HĐ {r.contractNumber} · {r.purpose}</small>
                <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpenId(open ? null : r.visitRegistrationId)}>
                  <Icon name={open ? 'x' : 'eye'} size={13} /> {open ? 'Ẩn thông tin' : 'Xem thông tin người đăng ký'}
                </button>
              </div>
              {tab === 'Approved' ? (
                <span className={`badge ${live ? 'ok' : 'info'}`}>{live ? 'Đang trong giờ' : 'Sắp tới'}</span>
              ) : rejecting === r.visitRegistrationId ? (
                <span className="row wrap">
                  <input value={notes} maxLength={500} placeholder="Lý do từ chối (bắt buộc)" onChange={(e) => setNotes(e.target.value)} aria-label="Lý do từ chối" />
                  <button className="btn danger sm" disabled={notes.trim().length < 5} title={notes.trim().length < 5 ? 'Nhập lý do ít nhất 5 ký tự để khách biết vì sao bị từ chối' : undefined}
                    onClick={() => { onReview(r, false, notes.trim()); setRejecting(null); setNotes('') }}>Từ chối</button>
                  <button className="btn ghost sm" onClick={() => setRejecting(null)}>Hủy</button>
                </span>
              ) : (
                <span className="row">
                  {/* The API refuses to approve once the booked entry time has passed: only rejecting is left. */}
                  {new Date(r.scheduledEntryAt).getTime() <= now
                    ? <span className="badge bad" title="Không duyệt được lịch đã qua giờ vào dự kiến">Quá giờ hẹn</span>
                    : <button className="btn primary sm" onClick={() => onReview(r, true)}><Icon name="check" size={14} /> Duyệt</button>}
                  <button className="btn outline sm" onClick={() => { setRejecting(r.visitRegistrationId); setNotes('') }}>Từ chối</button>
                </span>
              )}
            </div>
            {open && facilityId && <RegistrationDetail facilityId={facilityId} reg={r} />}
            </Fragment>
          )
        })}
        {shown.length === 0 && <Empty icon="calendar">{tab === 'Pending' ? 'Không có lịch nào chờ duyệt.' : 'Chưa có lịch đã duyệt sắp tới.'}</Empty>}
      </div>
    </section>
  )
}

/**
 * Who asked to come in: the registration only carries the visitor's name, so the contract is looked up at the gate
 * (GET /api/gate/facilities/{id}/lookup?q=<contract number>) for the visitor's CCCD and phone, the contract holder,
 * the contract and unit state, and anything that would block entry.
 */
function RegistrationDetail({ facilityId, reg }: { facilityId: number; reg: VisitRegistration }) {
  const [visit, setVisit] = useState<VisitCandidate | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<VisitCandidate[]>(`/api/gate/facilities/${facilityId}/lookup?q=${encodeURIComponent(reg.contractNumber)}`)
      .then((list) => {
        const v = list.find((x) => x.contractId === reg.contractId)
        if (v) setVisit(v)
        else setError('Không tìm thấy hợp đồng tại cơ sở này')
      })
      .catch((e) => setError((e as Error).message))
  }, [facilityId, reg.contractId, reg.contractNumber])

  if (error) return <p className="alert bad reg-detail"><Icon name="alert" size={16} />{error}</p>
  if (!visit) return <p className="muted reg-detail">Đang tải thông tin…</p>
  const visitor = reg.authorizedPersonId == null
    ? visit.customer
    : visit.authorizedPersons.find((p) => p.authorizedPersonId === reg.authorizedPersonId)
  const holder = visit.customer
  return (
    <div className="reg-detail">
      <div className="reg-detail-grid">
        <div>
          <span className="label">Người đăng ký vào kho</span>
          {visitor ? (
            <dl className="kv">
              <div><dt>Họ tên</dt><dd>{visitor.fullName}</dd></div>
              <div><dt>Vai trò</dt><dd>{reg.authorizedPersonId == null ? 'Chủ hợp đồng' : `Người được ủy quyền${visitor.relationship ? ` · ${visitor.relationship}` : ''}`}</dd></div>
              <div><dt>Số CCCD</dt><dd className="code">{visitor.citizenId ?? '—'}</dd></div>
              <div><dt>Số điện thoại</dt><dd>{visitor.phoneNumber ? <a href={`tel:${visitor.phoneNumber}`} className="link">{visitor.phoneNumber}</a> : '—'}</dd></div>
            </dl>
          ) : <p className="alert warn"><Icon name="alert" size={15} />{reg.visitorName} không còn trong danh sách ủy quyền của hợp đồng.</p>}
        </div>
        {reg.authorizedPersonId != null && (
          <div>
            <span className="label">Chủ hợp đồng</span>
            <dl className="kv">
              <div><dt>Họ tên</dt><dd>{holder.fullName}</dd></div>
              <div><dt>Số CCCD</dt><dd className="code">{holder.citizenId ?? '—'}</dd></div>
              <div><dt>Số điện thoại</dt><dd>{holder.phoneNumber ? <a href={`tel:${holder.phoneNumber}`} className="link">{holder.phoneNumber}</a> : '—'}</dd></div>
            </dl>
          </div>
        )}
        <div>
          <span className="label">Hợp đồng & kho</span>
          <dl className="kv">
            <div><dt>Hợp đồng</dt><dd>{visit.contractNumber} <StatusBadge status={visit.contractStatus} /></dd></div>
            <div><dt>Thời hạn</dt><dd>{fmtDate(visit.startDate)} – {fmtDate(visit.endDate)}</dd></div>
            <div><dt>Kho</dt><dd>{visit.unitCode} <StatusBadge status={visit.unitStatus} /></dd></div>
            <div><dt>Gửi đăng ký</dt><dd>{fmtTime(reg.requestedAt)}</dd></div>
          </dl>
        </div>
      </div>
      {visit.issues.length > 0 && (
        <p className="alert warn"><Icon name="alert" size={15} />{visit.issues.map((i) => i.message).join(' · ')}: dù duyệt lịch, cổng vẫn chặn cho đến khi xử lý xong.</p>
      )}
      {visit.peopleInside.length > 0 && <small className="muted">Đang trong kho: {visit.peopleInside.join(', ')}</small>}
    </div>
  )
}

function VisitCard({ facilityId, visit: v, query, regs, onRecorded }: {
  facilityId: number
  visit: VisitCandidate
  query: string
  regs: VisitRegistration[]
  onRecorded: (r: AccessRecord) => void
}) {
  const people: Person[] = [v.customer, ...v.authorizedPersons]
  // Searched by someone's CCCD or phone: preselect that person.
  const [personIdx, setPersonIdx] = useState(() =>
    Math.max(0, people.findIndex((p) => p.citizenId === query || p.phoneNumber === query)))
  const [citizenId, setCitizenId] = useState('')
  const cid = useInputFilter(CITIZEN_ID_FILTER)
  const [purpose, setPurpose] = useState('')
  const [denyReason, setDenyReason] = useState(v.issues[0]?.code ?? 'IdentityMismatch')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const person = people[personIdx]
  const typed = citizenId.trim()
  const matches = typed !== '' && typed === (person.citizenId ?? '').trim()
  const alreadyInside = v.peopleInside.includes(person.fullName)
  const reg = activeRegistration(regs, v.contractId, person.authorizedPersonId)

  const run = async (fn: () => Promise<AccessRecord>) => {
    setBusy(true)
    setError('')
    try {
      onRecorded(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const grant = () =>
    run(() =>
      api<AccessRecord>(`/api/gate/facilities/${facilityId}/entries`, {
        body: { contractId: v.contractId, visitRegistrationId: reg?.visitRegistrationId, authorizedPersonId: person.authorizedPersonId, citizenId: typed, purpose: purpose || reg?.purpose || null },
      }),
    )

  const deny = () =>
    run(() =>
      api<AccessRecord>(`/api/gate/facilities/${facilityId}/denials`, {
        body: { contractId: v.contractId, authorizedPersonId: person.authorizedPersonId, reason: denyReason },
      }),
    )

  return (
    <div className="visit-grid">
      <section className="panel stack">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Thông tin hợp đồng & khách hàng</h3>
            <p className="contract-no">{v.contractNumber}</p>
            <p className="muted">{fmtDate(v.startDate)} – {fmtDate(v.endDate)}</p>
          </div>
          <span className={`badge ${v.issues.length ? 'bad' : v.canEnter ? 'ok' : 'warn'}`}>{v.issues.length ? 'Không được vào' : v.canEnter ? 'Có lịch đã duyệt' : 'Chưa có lịch đã duyệt'}</span>
        </div>
        <dl className="kv-grid">
          <div><dt>Chủ hợp đồng</dt><dd>{v.customer.fullName}</dd></div>
          <div><dt>Số điện thoại</dt><dd>{v.customer.phoneNumber ?? '—'}</dd></div>
          <div><dt>Trạng thái hợp đồng</dt><dd><StatusBadge status={v.contractStatus} /></dd></div>
          <div><dt>Người được ủy quyền</dt><dd>{v.authorizedPersons.length || 'Không có'}</dd></div>
        </dl>
        <div className="assigned-unit">
          <span className="unit-code lg">{v.unitCode}</span>
          <div className="grow">
            <b>Kho {v.unitCode}</b>
            <small className="muted block">{v.peopleInside.length ? `Đang ở trong: ${v.peopleInside.join(', ')}` : 'Không có ai trong kho'}</small>
          </div>
          <StatusBadge status={v.unitStatus} />
        </div>
        {v.issues.map((i) => <p key={i.code} className="alert bad"><Icon name="alert" size={16} />{i.message}</p>)}
      </section>

      <section className="panel stack">
        <div>
          <h3 className="panel-title">Xác minh danh tính</h3>
          <p className="muted">Chọn người đang đứng tại cổng và gõ số trên thẻ CCCD của họ.</p>
        </div>
        <div className="person-picker">
          {people.map((p, i) => (
            <button key={i} type="button" className={`person-option ${i === personIdx ? 'active' : ''}`} onClick={() => { setPersonIdx(i); setCitizenId(''); setError('') }}>
              <span className="radio" />
              <span className="grow">
                <b>{p.fullName}</b>
                <small>{p.relationship ?? 'Ủy quyền'} · CCCD {maskId(p.citizenId)}</small>
              </span>
              {v.peopleInside.includes(p.fullName) && <span className="badge info">Đang trong kho</span>}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Số CCCD trên thẻ</span>
          <span className={`input-wrap ${typed ? (matches ? 'is-ok' : 'is-bad') : ''}`}>
            <Icon name="idCard" className="input-lead" />
            <input value={citizenId} inputMode="numeric" maxLength={12} placeholder="Gõ đủ 12 số trên thẻ của khách" onChange={(e) => { setCitizenId(cid.keep(e.target.value)); setError('') }} />
            {typed && <span className="match-flag">{matches ? <><Icon name="check" size={14} /> Khớp hồ sơ</> : <><Icon name="x" size={14} /> Chưa khớp</>}</span>}
          </span>
          <FieldNote text={cid.hint} />
        </label>
        <label className="field">
          <span>Mục đích (không bắt buộc)</span>
          <input value={purpose} maxLength={255} placeholder={reg?.purpose ?? 'Gửi đồ, lấy đồ…'} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        {reg
          ? <p className="reg-match ok"><Icon name="calendar" size={15} /> Lịch đã duyệt: {hhmm(reg.scheduledEntryAt)} – {hhmm(reg.scheduledExitAt)} · {reg.purpose}</p>
          : <p className="reg-match bad"><Icon name="alert" size={15} /> {person.fullName} chưa có lịch vào kho đã duyệt trong giờ này. Hướng dẫn khách đăng ký trên web, hoặc ghi nhận từ chối.</p>}
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <div className={`decision ${reg && !v.issues.length ? '' : 'blocked'}`}>
          <button className="btn primary block" disabled={busy || !reg || v.issues.length > 0 || !typed || alreadyInside} onClick={grant}>
            <Icon name="check" size={16} /> Xác nhận đúng người, cho vào
          </button>
          {alreadyInside && <small className="muted">Người này đang ở trong kho, hãy xác nhận ra trước.</small>}
          <div className="deny-row">
            <select value={denyReason} onChange={(e) => setDenyReason(e.target.value)}>
              {Object.entries(DenyReasons).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button className="btn danger" disabled={busy} onClick={deny}>Ghi nhận từ chối</button>
          </div>
        </div>
      </section>
    </div>
  )
}
