import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { AppointmentPicker } from '../components/appointment'
import { Empty, Eyebrow, Icon, splitTypeName, StatusBadge, UnitArt } from '../components/ui'
import { DenyReasons, type AccessRecord, type Contract, type Facility, type Person, type Reservation } from '../types'

const daysUntil = (iso: string) => Math.ceil((new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)

/** Customer dashboard: rented units, authorized persons, entry history and open reservations. */
export default function MyUnits() {
  const { user } = useAuth()
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [tab, setTab] = useState<'people' | 'history'>('people')
  const [error, setError] = useState('')

  useEffect(() => {
    api<Contract[]>('/api/contracts/my').then((cs) => {
      setContracts(cs)
      if (cs.length) setOpenId(cs[0].contractId)
    }).catch((e) => setError((e as Error).message))
    api<Reservation[]>('/api/reservations/my').then(setReservations).catch(() => {})
    api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {})
  }, [])

  const active = contracts?.filter((c) => c.status === 'Active' || c.status === 'Renewed').length ?? 0
  const open = contracts?.find((c) => c.contractId === openId)
  const openReservations = reservations.filter((r) => r.status === 'PendingDeposit' || r.status === 'Confirmed')
  const ending = contracts?.filter((c) => c.status === 'Active' && daysUntil(c.endDate) <= 45) ?? []

  const show = (id: number, t: 'people' | 'history') => {
    setOpenId(id)
    setTab(t)
    setTimeout(() => document.getElementById('contract-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Eyebrow dark>Tài khoản khách hàng</Eyebrow>
          <h1>Xin Chào, {user?.fullName}!</h1>
          <p>Quản lý kho lưu trữ của bạn · Ủy quyền người nhà · Theo dõi lịch sử ra vào.</p>
        </div>
      </section>

      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <section className="stack">
          <div className="row between wrap">
            <h2 className="section-title with-icon"><Icon name="package" size={20} className="cyan" /> Kho Lưu Trữ Của Tôi {active > 0 && <span className="pill">{active} đang hoạt động</span>}</h2>
          </div>
          <div className="my-unit-grid">
            {contracts?.map((c, i) => {
              const left = daysUntil(c.endDate)
              return (
                <article key={c.contractId} className={`my-unit-card ${c.contractId === openId ? 'selected' : ''}`}>
                  <div className="my-unit-media">
                    <UnitArt variant={(i + 1) % 4} />
                    <span className="tag-dark">{c.unitCode}</span>
                    <span className="tag-status"><StatusBadge status={c.status} /></span>
                  </div>
                  <div className="my-unit-body">
                    <h3>Kho {c.unitCode} <small>· {c.facilityName}</small></h3>
                    <ul className="meta-list">
                      <li><Icon name="calendar" size={14} /> Bắt đầu: {fmtDate(c.startDate)}</li>
                      <li><Icon name="clock" size={14} /> Hết hạn: <b>{fmtDate(c.endDate)}</b>{c.status === 'Active' && left >= 0 && left <= 45 && <span className="warn-text"> · còn {left} ngày</span>}</li>
                      <li><Icon name="card" size={14} /> Chi phí: <b className="cyan">{fmtMoney(c.monthlyRentFee)}/tháng</b></li>
                      <li><Icon name="clipboard" size={14} /> HĐ {c.contractNumber}</li>
                    </ul>
                    <div className="row">
                      <Link to={`/my-units/${c.contractId}?renew=1`} className="btn primary sm grow">Gia Hạn</Link>
                      <Link to={`/my-units/${c.contractId}`} className="btn outline sm grow">Chi Tiết</Link>
                    </div>
                    <div className="row">
                      <button className="btn ghost sm grow" onClick={() => show(c.contractId, 'people')}>Người Ủy Quyền</button>
                      <button className="btn ghost sm grow" onClick={() => show(c.contractId, 'history')}>Lịch Sử</button>
                    </div>
                  </div>
                </article>
              )
            })}
            <Link to="/rent" className="add-unit-card">
              <span className="add-circle"><Icon name="plus" size={22} /></span>
              <b>Thuê Thêm Kho</b>
              <small>Mở rộng không gian lưu trữ chỉ với vài bước đơn giản</small>
            </Link>
          </div>
          {contracts && contracts.length === 0 && <p className="muted">Bạn chưa có hợp đồng thuê kho nào. Sau khi đặt cọc, nhân viên sẽ bàn giao kho và hợp đồng sẽ hiện ở đây.</p>}
        </section>

        <div className="dash-grid">
          <section className="stack" id="contract-detail">
            {open ? (
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2 className="section-title">Kho {open.unitCode} · {open.facilityName}</h2>
                    <p className="muted">HĐ {open.contractNumber} · {fmtDate(open.startDate)} – {fmtDate(open.endDate)}</p>
                  </div>
                  <StatusBadge status={open.status} />
                </div>
                <div className="tabs">
                  <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Icon name="users" size={16} /> Người được ủy quyền</button>
                  <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Icon name="history" size={16} /> Lịch sử ra vào</button>
                </div>
                {tab === 'people' ? <AuthorizedPeople contractId={open.contractId} /> : <History contractId={open.contractId} />}
              </div>
            ) : contracts && contracts.length > 0 ? null : (
              <div className="panel"><Empty icon="package">Chưa có kho nào để quản lý.</Empty></div>
            )}
          </section>

          <aside className="stack-lg">
            <div className="stack">
              <h3 className="aside-title">Thao Tác Nhanh</h3>
              <Link to="/rent" className="quick-action">
                <span className="feature-icon sm"><Icon name="package" size={18} /></span>
                <span className="grow"><b>Đặt Thêm Kho</b><small>Chọn kích thước và giữ chỗ trong 24 giờ</small></span>
                <Icon name="arrowRight" size={16} className="cyan" />
              </Link>
              <Link to="/support" className="quick-action">
                <span className="feature-icon sm"><Icon name="phone" size={18} /></span>
                <span className="grow"><b>Liên Hệ Hỗ Trợ</b><small>Báo sự cố, theo dõi nhân viên xử lý</small></span>
                <Icon name="arrowRight" size={16} className="cyan" />
              </Link>
            </div>

            <div className="stack">
              <h3 className="aside-title">Thông Báo</h3>
              {openReservations.map((r) => (
                <div key={r.reservationId} className="notice">
                  <span className="notice-icon warn"><Icon name="wallet" size={16} /></span>
                  <div>
                    <b>{r.status === 'PendingDeposit' ? 'Chờ đặt cọc' : r.checkInAppointmentAt ? 'Đã hẹn nhận kho' : 'Đặt lịch nhận kho'}</b>
                    <p>
                      Đơn {r.reservationCode} ({splitTypeName(r.unitTypeName).name}, {r.facilityName})
                      {r.status === 'PendingDeposit' ? ` cần đặt cọc ${fmtMoney(r.depositAmount)} trước ${fmtTime(r.depositDeadline)}.`
                        : r.checkInAppointmentAt ? ` — đến cơ sở đúng giờ hẹn để nhân viên bàn giao kho.`
                        : ` đã nhận cọc. Chọn giờ đến nhận kho trong ngày ${fmtDate(r.expectedStartDate)}, nhân viên chỉ bàn giao từ giờ hẹn.`}
                    </p>
                    {r.status === 'Confirmed' && (
                      <AppointmentPicker reservation={r} operatingHours={facilities.find((f) => f.facilityName === r.facilityName)?.operatingHours}
                        onSaved={(u) => setReservations((rs) => rs.map((x) => (x.reservationId === u.reservationId ? u : x)))} />
                    )}
                  </div>
                </div>
              ))}
              {ending.map((c) => (
                <div key={c.contractId} className="notice">
                  <span className="notice-icon bad"><Icon name="alert" size={16} /></span>
                  <div>
                    <b>Sắp hết hạn hợp đồng</b>
                    <p>Kho {c.unitCode} kết thúc vào {fmtDate(c.endDate)}. <Link to={`/my-units/${c.contractId}?renew=1`} className="link">Gửi yêu cầu gia hạn</Link></p>
                  </div>
                </div>
              ))}
              <div className="notice">
                <span className="notice-icon info"><Icon name="idCard" size={16} /></span>
                <div>
                  <b>Khi đến kho</b>
                  <p>Bạn hoặc người được ủy quyền xuất trình CCCD cho nhân viên trực cổng để được vào.</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

function AuthorizedPeople({ contractId }: { contractId: number }) {
  const [people, setPeople] = useState<Person[]>([])
  const [form, setForm] = useState({ fullName: '', phoneNumber: '', citizenId: '', relationship: '' })
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const base = `/api/contracts/${contractId}/authorized-persons`

  const load = () => api<Person[]>(base).then(setPeople).catch((e) => setError((e as Error).message))
  useEffect(() => {
    setError('')
    void load()
  }, [contractId])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api(base, { body: { ...form, relationship: form.relationship || null } })
      setForm({ fullName: '', phoneNumber: '', citizenId: '', relationship: '' })
      setAdding(false)
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const revoke = async (p: Person) => {
    setConfirmId(null)
    try {
      await api(`${base}/${p.authorizedPersonId}`, { method: 'DELETE' })
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="stack">
      <p className="muted">Những người này được vào kho thay bạn khi xuất trình CCCD của chính họ cho nhân viên.</p>
      <div className="person-list">
        {people.map((p) => (
          <div key={p.authorizedPersonId} className="person-row">
            <span className="avatar sm">{p.fullName.split(' ').slice(-1)[0][0]}</span>
            <div className="grow">
              <b>{p.fullName}</b> {p.relationship && <span className="pill muted">{p.relationship}</span>}
              <small className="muted block">CCCD {p.citizenId} · SĐT {p.phoneNumber}</small>
            </div>
            {confirmId === p.authorizedPersonId ? (
              <span className="row">
                <button className="btn danger sm" onClick={() => revoke(p)}>Thu hồi quyền</button>
                <button className="btn ghost sm" onClick={() => setConfirmId(null)}>Giữ lại</button>
              </span>
            ) : (
              <button className="btn ghost sm danger-text" onClick={() => setConfirmId(p.authorizedPersonId)}>Thu hồi</button>
            )}
          </div>
        ))}
        {people.length === 0 && <Empty icon="users">Chưa ủy quyền cho ai.</Empty>}
      </div>
      {adding ? (
        <form onSubmit={add} className="add-person">
          <div className="form-grid">
            <label className="field"><span>Họ tên</span><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required autoFocus /></label>
            <label className="field"><span>Số CCCD</span><input value={form.citizenId} inputMode="numeric" onChange={(e) => setForm({ ...form, citizenId: e.target.value })} required /></label>
            <label className="field"><span>Số điện thoại</span><input value={form.phoneNumber} inputMode="tel" onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} required /></label>
            <label className="field"><span>Quan hệ</span><input value={form.relationship} placeholder="Vợ, con, nhân viên…" onChange={(e) => setForm({ ...form, relationship: e.target.value })} /></label>
          </div>
          <div className="row">
            <button className="btn primary sm" type="submit">Lưu người được ủy quyền</button>
            <button className="btn ghost sm" type="button" onClick={() => setAdding(false)}>Hủy</button>
          </div>
        </form>
      ) : (
        <button className="btn outline sm self-start" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Thêm người được ủy quyền</button>
      )}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
    </div>
  )
}

function History({ contractId }: { contractId: number }) {
  const [rows, setRows] = useState<AccessRecord[] | null>(null)
  useEffect(() => {
    setRows(null)
    api<AccessRecord[]>(`/api/contracts/${contractId}/access-history`).then(setRows).catch(() => setRows([]))
  }, [contractId])

  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Người vào</th><th>Kết quả</th><th>Vào</th><th>Ra</th><th>Nhân viên</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.accessRecordId}>
              <td><b>{r.visitorName}</b>{r.purpose && <><br /><small className="muted">{r.purpose}</small></>}</td>
              <td>{r.result === 'Granted'
                ? <span className="badge ok">Được vào</span>
                : <span className="badge bad">Từ chối · {DenyReasons[r.denyReason ?? 'Other'] ?? r.denyReason}</span>}</td>
              <td>{fmtTime(r.entryTime)}</td>
              <td>{r.exitTime ? fmtTime(r.exitTime) : r.result === 'Granted' ? <span className="badge info">Đang ở trong</span> : '—'}</td>
              <td>{r.verifiedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <Empty icon="history">Chưa có lượt ra vào.</Empty>}
    </div>
  )
}
