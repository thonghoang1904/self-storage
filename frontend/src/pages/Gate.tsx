import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtTime } from '../api'
import { DenyReasons, type AccessRecord, type Facility, type VisitCandidate } from '../types'

const REFRESH_MS = 5000

/**
 * Staff on duty at the gate. A visitor arrives, staff finds their contract, checks the ID card
 * and records entry or denial; when the visitor leaves, staff confirms the exit.
 */
export default function Gate() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<VisitCandidate[] | null>(null)
  const [inside, setInside] = useState<AccessRecord[]>([])
  const [today, setToday] = useState<AccessRecord[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    api<Facility[]>('/api/gate/my-facilities')
      .then((fs) => {
        setFacilities(fs)
        if (fs.length) setFacilityId(fs[0].facilityId)
      })
      .catch((e) => setError(e.message))
  }, [])

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
    void refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    try {
      setCandidates(await api<VisitCandidate[]>(`/api/gate/facilities/${facilityId}/lookup?q=${encodeURIComponent(query)}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const onRecorded = (rec: AccessRecord) => {
    setNotice(rec.result === 'Granted'
      ? `Đã cho ${rec.visitorName} vào kho ${rec.unitCode}.`
      : `Đã ghi nhận từ chối ${rec.visitorName} (kho ${rec.unitCode}).`)
    setCandidates(null)
    setQuery('')
    void refresh()
  }

  const confirmExit = async (id: number) => {
    await api(`/api/gate/access-records/${id}/exit`, { method: 'POST' })
    void refresh()
  }

  if (!facilities.length) {
    return <div className="page"><h2>Cổng ra vào</h2><p className="muted">{error || 'Bạn chưa được phân công tại cơ sở nào.'}</p></div>
  }

  return (
    <div className="page">
      <div className="row between">
        <h2>Cổng ra vào</h2>
        <select value={facilityId ?? ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
          {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
        </select>
      </div>

      <form className="row" onSubmit={search}>
        <input
          className="grow"
          autoFocus
          placeholder="Khách đến: nhập mã kho, số CCCD, số điện thoại hoặc số hợp đồng"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn primary" type="submit">Tìm</button>
      </form>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      {candidates && candidates.length === 0 && <p className="muted">Không tìm thấy hợp đồng nào ở cơ sở này.</p>}
      <div className="grid">
        {candidates?.map((c) => (
          <VisitCard key={c.contractId} facilityId={facilityId!} visit={c} query={query.trim()} onRecorded={onRecorded} />
        ))}
      </div>

      <h3>Đang ở trong kho ({inside.length})</h3>
      <table>
        <thead>
          <tr><th>Kho</th><th>Người vào</th><th>Mục đích</th><th>Vào lúc</th><th>Nhân viên duyệt</th><th></th></tr>
        </thead>
        <tbody>
          {inside.map((r) => (
            <tr key={r.accessRecordId}>
              <td><b>{r.unitCode}</b></td>
              <td>{r.visitorName}{r.companionCount > 0 && <span className="muted"> +{r.companionCount} người</span>}</td>
              <td>{r.purpose ?? '—'}</td>
              <td>{fmtTime(r.entryTime)}</td>
              <td>{r.verifiedBy}</td>
              <td><button className="btn" onClick={() => confirmExit(r.accessRecordId)}>Xác nhận ra</button></td>
            </tr>
          ))}
          {inside.length === 0 && <tr><td colSpan={6} className="muted">Không có ai trong kho.</td></tr>}
        </tbody>
      </table>

      <h3>Nhật ký hôm nay ({today.length})</h3>
      <table>
        <thead><tr><th>Giờ</th><th>Kho</th><th>Người</th><th>Kết quả</th><th>Ra lúc</th><th>Nhân viên</th></tr></thead>
        <tbody>
          {today.map((r) => (
            <tr key={r.accessRecordId}>
              <td>{fmtTime(r.entryTime)}</td>
              <td>{r.unitCode}</td>
              <td>{r.visitorName}</td>
              <td>{r.result === 'Granted' ? 'Cho vào' : `Từ chối: ${DenyReasons[r.denyReason ?? 'Other'] ?? r.denyReason}`}</td>
              <td>{r.exitTime ? fmtTime(r.exitTime) : '—'}</td>
              <td>{r.verifiedBy}</td>
            </tr>
          ))}
          {today.length === 0 && <tr><td colSpan={6} className="muted">Chưa có lượt nào.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function VisitCard({ facilityId, visit: v, query, onRecorded }: {
  facilityId: number
  visit: VisitCandidate
  query: string
  onRecorded: (r: AccessRecord) => void
}) {
  const people = [v.customer, ...v.authorizedPersons]
  // Searched by someone's CCCD or phone: preselect that person.
  const [personIdx, setPersonIdx] = useState(() =>
    Math.max(0, people.findIndex((p) => p.citizenId === query || p.phoneNumber === query)))
  const [citizenId, setCitizenId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [companionCount, setCompanionCount] = useState(0)
  const [denyReason, setDenyReason] = useState(v.issues[0]?.code ?? 'IdentityMismatch')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const person = people[personIdx]

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

  const grant = (moveOut = false) =>
    run(() =>
      api<AccessRecord>(`/api/gate/facilities/${facilityId}/entries`, {
        body: {
          contractId: v.contractId,
          authorizedPersonId: person.authorizedPersonId,
          citizenId: citizenId.trim(),
          purpose: purpose || null,
          companionCount,
          moveOut,
        },
      }),
    )

  const deny = () =>
    run(() =>
      api<AccessRecord>(`/api/gate/facilities/${facilityId}/denials`, {
        body: {
          contractId: v.contractId,
          authorizedPersonId: person.authorizedPersonId,
          reason: denyReason,
        },
      }),
    )

  return (
    <div className="card">
      <div className="row between">
        <span className="badge">Kho {v.unitCode}</span>
        <span className={`badge ${v.canEnter ? 'ok' : 'warn'}`}>{v.canEnter ? 'Được phép vào' : 'Không được vào'}</span>
      </div>
      <p className="muted">HĐ {v.contractNumber} · {fmtDate(v.startDate)} – {fmtDate(v.endDate)} · {v.contractStatus}</p>
      {v.issues.map((i) => <p key={i.code} className="error">{i.message}</p>)}
      {v.peopleInside.length > 0 && <p className="muted">Đang ở trong: {v.peopleInside.join(', ')}</p>}

      <label>Người đang đứng tại cổng</label>
      <select value={personIdx} onChange={(e) => setPersonIdx(Number(e.target.value))}>
        {people.map((p, i) => <option key={i} value={i}>{p.fullName} ({p.relationship ?? 'Ủy quyền'})</option>)}
      </select>
      <div className="id-box">
        <div><span className="muted">CCCD trong hồ sơ</span><b>{person.citizenId ?? '—'}</b></div>
        <div><span className="muted">SĐT</span><b>{person.phoneNumber ?? '—'}</b></div>
      </div>

      <input
        placeholder="Nhập số CCCD trên thẻ của khách"
        inputMode="numeric"
        value={citizenId}
        onChange={(e) => setCitizenId(e.target.value)}
      />
      <input placeholder="Mục đích (gửi đồ, lấy đồ...)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <label>Số người đi cùng (không tính người vào)</label>
      <input
        type="number"
        min={0}
        max={50}
        value={companionCount}
        onChange={(e) => setCompanionCount(Math.min(50, Math.max(0, Number(e.target.value) || 0)))}
      />
      {error && <p className="error">{error}</p>}

      {v.canEnter || !v.canEnterForMoveOut ? (
        <button className="btn primary" disabled={busy || !v.canEnter || !citizenId.trim()} onClick={() => grant()}>Xác nhận đúng người, cho vào</button>
      ) : (
        <>
          <p className="muted">Hợp đồng đã hết hạn hoặc quá hạn nhưng chưa trả kho: chỉ cho vào để dọn đồ trả kho.</p>
          <button className="btn primary" disabled={busy || !citizenId.trim()} onClick={() => grant(true)}>Xác nhận đúng người, cho vào dọn kho</button>
        </>
      )}
      <div className="row">
        <select className="grow" value={denyReason} onChange={(e) => setDenyReason(e.target.value)}>
          {Object.entries(DenyReasons).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="btn danger" disabled={busy} onClick={deny}>Ghi nhận từ chối</button>
      </div>
    </div>
  )
}
