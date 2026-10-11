import { useEffect, useState } from 'react'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { DenyReasons, type AccessRecord, type Contract, type Person } from '../types'

/** Customer: rented units, gate PIN, authorized persons and entry history. */
export default function MyUnits() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [error, setError] = useState('')

  const load = () => api<Contract[]>('/api/contracts/my').then(setContracts).catch((e) => setError(e.message))
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="page">
      <h2>Kho của tôi</h2>
      {error && <p className="error">{error}</p>}
      {contracts.length === 0 && <p className="muted">Bạn chưa thuê kho nào.</p>}
      {contracts.map((c) => <ContractCard key={c.contractId} contract={c} onChanged={load} />)}
    </div>
  )
}

function ContractCard({ contract: c, onChanged }: { contract: Contract; onChanged: () => void }) {
  const [tab, setTab] = useState<'pin' | 'people' | 'history'>('pin')
  return (
    <div className="card">
      <div className="row between">
        <div>
          <h3>Kho {c.unitCode} · {c.facilityName}</h3>
          <p className="muted">
            HĐ {c.contractNumber} · {fmtDate(c.startDate)} – {fmtDate(c.endDate)} · {fmtMoney(c.monthlyRentFee)}/tháng
          </p>
        </div>
        <span className={`badge ${c.status === 'Active' ? 'ok' : 'warn'}`}>{c.status}</span>
      </div>
      <div className="tabs">
        <button className={tab === 'pin' ? 'active' : ''} onClick={() => setTab('pin')}>Mã PIN</button>
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>Người được ủy quyền</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Lịch sử ra vào</button>
      </div>
      {tab === 'pin' && <PinForm contract={c} onChanged={onChanged} />}
      {tab === 'people' && <AuthorizedPeople contractId={c.contractId} />}
      {tab === 'history' && <History contractId={c.contractId} />}
    </div>
  )
}

function PinForm({ contract: c, onChanged }: { contract: Contract; onChanged: () => void }) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    setError('')
    try {
      await api(`/api/contracts/${c.contractId}/pin`, { method: 'PUT', body: { currentPin: currentPin || null, newPin } })
      setMsg('Đã lưu PIN mới.')
      setCurrentPin('')
      setNewPin('')
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <p className="muted">
        {c.hasPin ? 'Kho đã có PIN.' : 'Kho chưa có PIN, hãy đặt PIN để vào cổng.'} Khi đến kho, nhập mã kho và PIN tại cổng,
        sau đó xuất trình CCCD cho nhân viên.
        {c.pinLockedUntil && new Date(c.pinLockedUntil) > new Date() && ` PIN đang bị khóa đến ${fmtTime(c.pinLockedUntil)}.`}
      </p>
      {c.hasPin && (
        <input type="password" inputMode="numeric" maxLength={6} placeholder="PIN hiện tại"
          value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} />
      )}
      <input type="password" inputMode="numeric" maxLength={6} placeholder="PIN mới (6 chữ số)"
        value={newPin} onChange={(e) => setNewPin(e.target.value)} required />
      {error && <p className="error">{error}</p>}
      {msg && <p className="success">{msg}</p>}
      <button className="btn primary" type="submit">{c.hasPin ? 'Đổi PIN' : 'Đặt PIN'}</button>
    </form>
  )
}

function AuthorizedPeople({ contractId }: { contractId: number }) {
  const [people, setPeople] = useState<Person[]>([])
  const [form, setForm] = useState({ fullName: '', phoneNumber: '', citizenId: '', relationship: '' })
  const [error, setError] = useState('')
  const base = `/api/contracts/${contractId}/authorized-persons`

  const load = () => api<Person[]>(base).then(setPeople)
  useEffect(() => {
    void load()
  }, [contractId])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api(base, { body: { ...form, relationship: form.relationship || null } })
      setForm({ fullName: '', phoneNumber: '', citizenId: '', relationship: '' })
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const revoke = async (id: number) => {
    await api(`${base}/${id}`, { method: 'DELETE' })
    void load()
  }

  return (
    <div className="stack">
      <p className="muted">Những người này dùng PIN của bạn và xuất trình CCCD của chính họ cho nhân viên.</p>
      <table>
        <tbody>
          {people.map((p) => (
            <tr key={p.authorizedPersonId}>
              <td>{p.fullName}</td><td>{p.relationship}</td><td>{p.citizenId}</td><td>{p.phoneNumber}</td>
              <td><button className="btn ghost" onClick={() => revoke(p.authorizedPersonId!)}>Thu hồi</button></td>
            </tr>
          ))}
          {people.length === 0 && <tr><td className="muted">Chưa có ai.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={add} className="row wrap">
        <input placeholder="Họ tên" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
        <input placeholder="Số CCCD" value={form.citizenId} onChange={(e) => setForm({ ...form, citizenId: e.target.value })} required />
        <input placeholder="Số điện thoại" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} required />
        <input placeholder="Quan hệ" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
        <button className="btn primary" type="submit">Thêm</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function History({ contractId }: { contractId: number }) {
  const [rows, setRows] = useState<AccessRecord[]>([])
  useEffect(() => {
    api<AccessRecord[]>(`/api/contracts/${contractId}/access-history`).then(setRows)
  }, [contractId])

  return (
    <table>
      <thead><tr><th>Người vào</th><th>Kết quả</th><th>Vào</th><th>Ra</th><th>Nhân viên</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.requestId}>
            <td>{r.visitorName}</td>
            <td>
              {r.result === 'Granted' ? 'Được vào' : r.result === 'Pending' ? 'Chờ xác nhận'
                : `Từ chối: ${r.denyReason === 'Expired' ? 'Hết thời gian chờ' : DenyReasons[r.denyReason ?? 'Other'] ?? r.denyReason}`}
            </td>
            <td>{r.result === 'Granted' ? fmtTime(r.entryTime) : fmtTime(r.pinEnteredAt ?? r.entryTime)}</td>
            <td>{r.exitTime ? fmtTime(r.exitTime) : '—'}</td>
            <td>{r.verifiedBy ?? '—'}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="muted">Chưa có lượt ra vào.</td></tr>}
      </tbody>
    </table>
  )
}
