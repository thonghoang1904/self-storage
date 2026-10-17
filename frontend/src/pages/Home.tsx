import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney } from '../api'
import { useAuth } from '../auth'
import { CorridorArt, Eyebrow, Icon, splitTypeName, UnitArt } from '../components/ui'
import { homeFor, type Availability, type Facility, type UnitType } from '../types'

const FEATURES = [
  { icon: 'idCard', title: 'Xác Thực CCCD', text: 'Mỗi lượt vào kho đều được nhân viên trực cổng đối chiếu CCCD với hồ sơ hợp đồng.' },
  { icon: 'users', title: 'Ủy Quyền Người Nhà', text: 'Thêm người được ủy quyền ngay trên tài khoản. Họ vào kho bằng CCCD của chính mình.' },
  { icon: 'history', title: 'Lịch Sử Minh Bạch', text: 'Xem lại ai đã vào kho, lúc nào và do nhân viên nào xác nhận.' },
  { icon: 'snow', title: 'Kho Điều Hòa', text: 'Kho cỡ lớn có kiểm soát nhiệt độ và độ ẩm cho đồ điện tử, mỹ phẩm.' },
]

const STEPS = [
  { n: 1, title: 'Chọn kho & giữ chỗ', text: 'Chọn cơ sở, kích thước và số tháng thuê. Đơn được giữ 24 giờ để bạn đặt cọc.' },
  { n: 2, title: 'Đặt cọc & nhận kho', text: 'Nhân viên xác nhận cọc, bàn giao kho cụ thể và tạo hợp đồng cho bạn.' },
  { n: 3, title: 'Ra vào bằng CCCD', text: 'Đến cổng, xuất trình CCCD. Nhân viên đối chiếu và mở cửa cho bạn.' },
]

export default function Home() {
  const { user } = useAuth()
  const [types, setTypes] = useState<UnitType[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])

  useEffect(() => {
    api<UnitType[]>('/api/unit-types').then(setTypes).catch(() => {})
    api<Facility[]>('/api/facilities').then((fs) => {
      setFacilities(fs)
      if (fs.length) api<Availability[]>(`/api/facilities/${fs[0].facilityId}/availability`).then(setAvailability).catch(() => {})
    }).catch(() => {})
  }, [])

  const rentLink = user ? (homeFor(user.role) === '/my-units' ? '/rent' : homeFor(user.role)) : '/rent'
  const popularId = types.length > 2 ? types[2].unitTypeId : null

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <Eyebrow dark>Kho tự phục vụ · Thuê theo tháng</Eyebrow>
            <h1>Giải Pháp Lưu Trữ<br /><span className="cyan">An Toàn & Tiện Lợi</span></h1>
            <p>Thuê kho theo tháng tại SafeKeep. Đặt chỗ trực tuyến, nhận kho tại cơ sở, và mỗi lần vào kho đều được nhân viên xác thực bằng CCCD.</p>
            <div className="row wrap">
              <Link to={rentLink} className="btn primary lg">Tìm Kho Ngay</Link>
              <a href="#units" className="btn outline-light lg" onClick={(e) => { e.preventDefault(); document.getElementById('units')?.scrollIntoView({ behavior: 'smooth' }) }}>Xem Bảng Giá</a>
            </div>
            <div className="hero-stats">
              <div><b>{facilities.length || '—'}</b><span>Cơ sở đang hoạt động</span></div>
              <div><b>{types.length || '—'}</b><span>Kích thước kho</span></div>
              <div><b>100%</b><span>Lượt vào được xác thực</span></div>
            </div>
          </div>
          <div className="hero-visual"><CorridorArt /></div>
        </div>
      </section>

      <section className="section tint">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Dịch vụ vượt trội</span>
            <h2>An Tâm Tuyệt Đối Với Hệ Thống Đẳng Cấp</h2>
            <p>Quy trình ra vào chặt chẽ do con người kiểm soát, kết hợp hồ sơ số minh bạch cho cả bạn và người thân.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon"><Icon name={f.icon} size={20} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="units">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Kho lưu trữ phổ biến</span>
            <h2>Chọn Không Gian Phù Hợp Với Bạn</h2>
            <p>Đa dạng kích thước, giá thuê rõ ràng theo tháng. Tiền cọc bằng một tháng thuê.</p>
          </div>
          <div className="unit-grid">
            {types.map((t, i) => {
              const { name, size } = splitTypeName(t.typeName)
              const a = availability.find((x) => x.unitTypeId === t.unitTypeId)
              const popular = t.unitTypeId === popularId
              return (
                <article key={t.unitTypeId} className={`unit-card ${popular ? 'featured' : ''}`}>
                  <div className="unit-card-media"><UnitArt variant={i} /></div>
                  <div className="unit-card-body">
                    <div className="row between">
                      <h3>{name}</h3>
                      {popular ? <span className="pill solid">Ưa chuộng nhất</span> : t.hasClimateControl ? <span className="pill">Điều hòa</span> : <span className="pill">{(t.lengthMeters * t.widthMeters).toLocaleString('vi-VN')} m²</span>}
                    </div>
                    <p className="meta"><Icon name="size" size={14} /> {size || `Dài ${t.lengthMeters}m × Rộng ${t.widthMeters}m`} · Cao {t.heightMeters}m</p>
                    <p className="unit-desc">{t.description}</p>
                    <div className="unit-price">
                      <span className="muted">Giá thuê chỉ từ</span>
                      <span><b>{fmtMoney(t.baseMonthlyRate)}</b><small>/tháng</small></span>
                    </div>
                    {a && <p className="meta">{a.availableUnits > 0 ? `Còn ${a.availableUnits} kho trống tại ${facilities[0]?.facilityName}` : `Tạm hết chỗ tại ${facilities[0]?.facilityName}`}</p>}
                    <Link to={rentLink} className={`btn block ${popular ? 'primary' : 'outline'}`}>Đặt Thuê Ngay</Link>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="section tint">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Quy trình</span>
            <h2>Thuê Kho Chỉ Trong 3 Bước</h2>
          </div>
          <div className="steps-grid">
            {STEPS.map((s) => (
              <div key={s.n} className="step-card">
                <span className="step-num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="facilities">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Hệ thống cơ sở</span>
            <h2>Cơ Sở Gần Bạn</h2>
          </div>
          <div className="facility-grid">
            {facilities.map((f) => (
              <div key={f.facilityId} className="facility-card">
                <span className="feature-icon"><Icon name="building" size={20} /></span>
                <div className="stack-sm">
                  <h3>{f.facilityName}</h3>
                  <span className="meta"><Icon name="pin" size={14} /> {f.address}, {f.district}, {f.city}</span>
                  <span className="meta"><Icon name="clock" size={14} /> Mở cửa {f.operatingHours}</span>
                  <span className="meta"><Icon name="phone" size={14} /> {f.hotline}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container cta-wrap">
        <div className="cta">
          <div>
            <h2>Sẵn Sàng Giữ Chỗ Kho Của Bạn?</h2>
            <p>Đăng ký tài khoản bằng CCCD, chọn kho và giữ chỗ trong vài phút. Đơn được giữ 24 giờ để bạn đặt cọc.</p>
          </div>
          <div className="row wrap">
            <Link to={user ? rentLink : '/register'} className="btn primary lg">{user ? 'Đặt Kho Ngay' : 'Đăng Ký Miễn Phí'}</Link>
            <a href="tel:02812345678" className="btn dark lg">Gọi (028) 1234 5678</a>
          </div>
        </div>
      </section>
    </>
  )
}
