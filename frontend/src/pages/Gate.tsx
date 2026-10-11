import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtTime } from '../api'
import { DenyReasons, type AccessRecord, type Facility, type PendingAccess } from '../types'

const REFRESH_MS = 3000

/** Staff on duty: confirm the identity of visitors who entered a correct PIN, and confirm exits. */
export default function Gate() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingAccess[]>([])
  const [inside, setInside] = useState<AccessRecord[]>([])
  const [error, setError] = useState('')

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
      const [p, i] = await Promise.all([
        api<PendingAccess[]>(`/api/gate/facilities/${facilityId}/pending`),
        api<AccessRecord[]>(`/api/gate/facilities/${facilityId}/inside`),
      ])
      setPending(p)
      setInside(i)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const confirmExit = async (id: number) => {
    await api(`/api/gate/requests/${id}/exit`, { method: 'POST' })
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
      {error && <p className="error">{error}</p>}

      <h3>Chờ xác nhận danh tính ({pending.length})</h3>
      {pending.length === 0 && <p className="muted">Không có khách nào đang chờ.</p>}
      <div className="grid">
        {pending.map((p) => <PendingCard key={p.requestId} item={p} onDone={refresh} />)}
      </div>

      <h3>Đang ở trong kho ({inside.length})</h3>
      <table>
        <thead>
          <tr><th>Kho</th><th>Người vào</th><th>Mục đích</th><th>Vào lúc</th><th>Nhân viên duyệt</th><th></th></tr>
        </thead>
        <tbody>
          {inside.map((r) => (
            <tr key={r.requestId}>
              <td><b>{r.unitCode}</b></td>
              <td>{r.visitorName}</td>
              <td>{r.purpose ?? '—'}</td>
              <td>{fmtTime(r.entryTime)}</td>
              <td>{r.verifiedBy}</td>
              <td><button className="btn" onClick={() => confirmExit(r.requestId)}>Xác nhận ra</button></td>
            </tr>
          ))}
          {inside.length === 0 && <tr><td colSpan={6} className="muted">Không có ai trong kho.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function PendingCard({ item, onDone }: { item: PendingAccess; onDone: () => void }) {
  const people = [item.customer, ...item.authorizedPersons]
  const [personIdx, setPersonIdx] = useState(0)
  const [method, setMethod] = useState('CitizenID')
  const [documentNumber, setDocumentNumber] = useState('')
  const [purpose, setPurpose] = useState('')
  const [denyReason, setDenyReason] = useState('IdentityMismatch')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const person = people[personIdx]

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const approve = () =>
    run(() =>
      api(`/api/gate/requests/${item.requestId}/approve`, {
        body: {
          authorizedPersonId: person.authorizedPersonId,
          verificationMethod: method,
          documentNumber: documentNumber || null,
          purpose: purpose || null,
        },
      }),
    )

  const deny = () => run(() => api(`/api/gate/requests/${item.requestId}/deny`, { body: { reason: denyReason } }))

  return (
    <div className="card">
      <div className="row between">
        <span className="badge">Kho {item.unitCode}</span>
        <span className="muted">PIN lúc {fmtTime(item.pinEnteredAt)}</span>
      </div>
      <p className="muted">HĐ {item.contractNumber} · hết hạn {fmtDate(item.contractEndDate)}</p>

      <label>Người đang đứng tại cổng</label>
      <select value={personIdx} onChange={(e) => setPersonIdx(Number(e.target.value))}>
        {people.map((p, i) => <option key={i} value={i}>{p.fullName} ({p.relationship ?? 'Ủy quyền'})</option>)}
      </select>
      <div className="id-box">
        <div><span className="muted">CCCD trong hồ sơ</span><b>{person.citizenId ?? '—'}</b></div>
        <div><span className="muted">SĐT</span><b>{person.phoneNumber ?? '—'}</b></div>
      </div>

      <div className="row">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CitizenID">CCCD</option>
          <option value="Passport">Hộ chiếu</option>
          <option value="DriverLicense">Bằng lái</option>
        </select>
        <input
          placeholder={method === 'CitizenID' ? 'Nhập số CCCD trên thẻ' : 'Số giấy tờ (tùy chọn)'}
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
        />
      </div>
      <input placeholder="Mục đích (gửi đồ, lấy đồ...)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      {error && <p className="error">{error}</p>}

      <button className="btn primary" disabled={busy} onClick={approve}>Xác nhận đúng người, cho vào</button>
      <div className="row">
        <select value={denyReason} onChange={(e) => setDenyReason(e.target.value)}>
          {Object.entries(DenyReasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn danger" disabled={busy} onClick={deny}>Từ chối</button>
      </div>
    </div>
  )
}
