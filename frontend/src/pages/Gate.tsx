import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, fmtDate, fmtTime, IS_DEMO } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import { DenyReasons, type AccessRecord, type Person, type VisitCandidate } from '../types'

const REFRESH_MS = 5000

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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [searching, setSearching] = useState(false)

  const refresh = useCallback(async () => {
    if (!facilityId) return
    try {
      const [i, t] = await Promise.all([
        api<AccessRecord[]>(`/api/gate/facilities/${facilityId}/inside`),
        api<AccessRecord[]>(`/api/gate/facilities/${facilityId}/today`),
      ])
      setInside(i)
      setToday(t)
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
      ? { tone: 'ok', text: `Đã cho ${rec.visitorName} vào kho ${rec.unitCode} lúc ${fmtTime(rec.entryTime)}.` }
      : { tone: 'bad', text: `Đã ghi nhận từ chối ${rec.visitorName} (kho ${rec.unitCode}): ${DenyReasons[rec.denyReason ?? 'Other']}.` })
    setCandidates(null)
    setQuery('')
    void refresh()
  }

  const confirmExit = async (r: AccessRecord) => {
    try {
      await api(`/api/gate/access-records/${r.accessRecordId}/exit`, { method: 'POST' })
      setNotice({ tone: 'ok', text: `${r.visitorName} đã ra khỏi kho ${r.unitCode}.` })
      void refresh()
    } catch (e) {
      setError((e as Error).message)
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
        <p className="muted">Nhập mã kho, số hợp đồng, số CCCD hoặc số điện thoại của khách hay người được ủy quyền.</p>
        <form className="search-row" onSubmit={search}>
          <span className="input-wrap grow">
            <Icon name="search" className="input-lead" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="vd: B-01, HD-DEMO-0001, 079300000456" />
          </span>
          <button className="btn primary" type="submit" disabled={searching || query.trim().length < 2}><Icon name="search" size={16} /> {searching ? 'Đang tìm…' : 'Kiểm tra'}</button>
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
        <VisitCard key={`${c.contractId}-${searched}`} facilityId={facilityId!} visit={c} query={searched} onRecorded={onRecorded} />
      ))}

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
                  <td><b>{r.visitorName}</b><br /><small className="muted">HĐ {r.contractNumber}</small></td>
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
                  <td>{r.visitorName}</td>
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

function VisitCard({ facilityId, visit: v, query, onRecorded }: {
  facilityId: number
  visit: VisitCandidate
  query: string
  onRecorded: (r: AccessRecord) => void
}) {
  const people: Person[] = [v.customer, ...v.authorizedPersons]
  // Searched by someone's CCCD or phone: preselect that person.
  const [personIdx, setPersonIdx] = useState(() =>
    Math.max(0, people.findIndex((p) => p.citizenId === query || p.phoneNumber === query)))
  const [citizenId, setCitizenId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [denyReason, setDenyReason] = useState(v.issues[0]?.code ?? 'IdentityMismatch')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const person = people[personIdx]
  const typed = citizenId.trim()
  const matches = typed !== '' && typed === (person.citizenId ?? '').trim()
  const alreadyInside = v.peopleInside.includes(person.fullName)

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
        body: { contractId: v.contractId, authorizedPersonId: person.authorizedPersonId, citizenId: typed, purpose: purpose || null },
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
          <span className={`badge ${v.canEnter ? 'ok' : 'bad'}`}>{v.canEnter ? 'Được phép vào' : 'Không được vào'}</span>
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
            <input value={citizenId} inputMode="numeric" placeholder="Gõ đủ số trên thẻ của khách" onChange={(e) => { setCitizenId(e.target.value); setError('') }} />
            {typed && <span className="match-flag">{matches ? <><Icon name="check" size={14} /> Khớp hồ sơ</> : <><Icon name="x" size={14} /> Chưa khớp</>}</span>}
          </span>
        </label>
        <label className="field">
          <span>Mục đích (không bắt buộc)</span>
          <input value={purpose} placeholder="Gửi đồ, lấy đồ…" onChange={(e) => setPurpose(e.target.value)} />
        </label>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <div className={`decision ${v.canEnter ? '' : 'blocked'}`}>
          <button className="btn primary block" disabled={busy || !v.canEnter || !typed || alreadyInside} onClick={grant}>
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
