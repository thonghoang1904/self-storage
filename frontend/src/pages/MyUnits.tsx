import { useEffect, useState } from 'react'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { DenyReasons, type AccessRecord, type Contract, type Person } from '../types'

/** Customer: rented units, authorized persons and entry history. */
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
      {contracts.map((c) => <ContractCard key={c.contractId} contract={c} />)}
    </div>
  )
}

function ContractCard({ contract: c }: { contract: Contract }) {
  const [tab, setTab] = useState<'people' | 'history'>('people')
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
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>Người được ủy quyền</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Lịch sử ra vào</button>
      </div>
      <p className="muted">Khi đến kho, bạn hoặc người được ủy quyền xuất trình CCCD cho nhân viên trực cổng để được vào.</p>
      {tab === 'people' && <AuthorizedPeople contractId={c.contractId} />}
      {tab === 'history' && <History contractId={c.contractId} />}
    </div>
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
      <p className="muted">Những người này được vào kho thay bạn khi xuất trình CCCD của chính họ cho nhân viên.</p>
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
          <tr key={r.accessRecordId}>
            <td>{r.visitorName}</td>
            <td>
              {r.result === 'Granted' ? 'Được vào' : `Từ chối: ${DenyReasons[r.denyReason ?? 'Other'] ?? r.denyReason}`}
            </td>
            <td>{fmtTime(r.entryTime)}</td>
            <td>{r.exitTime ? fmtTime(r.exitTime) : '—'}</td>
            <td>{r.verifiedBy}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="muted">Chưa có lượt ra vào.</td></tr>}
      </tbody>
    </table>
  )
}
