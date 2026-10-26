import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney } from '../api'
import { useAuth } from '../auth'
import { PageHero } from '../components/layout'
import { Icon, splitTypeName, UnitArt } from '../components/ui'
import { homeFor, type Availability, type Facility, type UnitType } from '../types'

/**
 * Public pricing page, Figma "storage-pricing": every unit type with its real price (GET /api/unit-types),
 * free units across all facilities (GET /api/facilities/{id}/availability), a comparison table and FAQs.
 * The Figma copy promises 24/7 access, key cards and insurance; the texts here follow the system's actual
 * rules instead (CCCD checked by staff at the gate, opening hours per facility, deposit of one month).
 */

const FAQS = [
  {
    q: 'Thời hạn thuê kho tối thiểu là bao lâu?',
    a: 'Bạn thuê theo tháng, từ 1 tháng trở lên tùy chính sách của từng cơ sở. Bạn có thể gia hạn sớm ngay trên tài khoản bất cứ lúc nào khi hợp đồng còn hiệu lực; thời hạn mới cộng tiếp từ ngày hết hạn hiện tại.',
  },
  {
    q: 'Giờ mở cửa và cách vào kho như thế nào?',
    a: 'Mỗi cơ sở có giờ hoạt động riêng (xem ở trang Liên hệ). Khi đến kho, bạn xuất trình CCCD tại cổng; nhân viên đối chiếu với hồ sơ hợp đồng rồi mới cho vào. Hệ thống không dùng mã PIN hay thẻ từ.',
  },
  {
    q: 'Người nhà có vào kho thay tôi được không?',
    a: 'Được. Bạn thêm người được ủy quyền trong mục "Kho của tôi". Người đó vào kho bằng CCCD của chính họ, và bạn xem được lịch sử ra vào của từng người.',
  },
  {
    q: 'Thủ tục đặt và nhận kho diễn ra thế nào?',
    a: 'Bạn chọn cơ sở, loại kho và số tháng rồi đặt chỗ trực tuyến. Hệ thống giữ chỗ 24 giờ để bạn đặt cọc bằng một tháng tiền thuê. Sau khi cọc được xác nhận, bạn hẹn giờ đến nhận kho và nhân viên bàn giao, tạo hợp đồng.',
  },
  {
    q: 'Nếu trả kho trễ hạn thì sao?',
    a: 'Bạn trả kho từ 20:00 ngày hết hạn. Nếu quá 24 giờ chưa trả hoặc chưa gia hạn, kho bị khóa và tính phí mỗi ngày bằng 1/30 tiền thuê tháng, trừ dần vào tiền cọc.',
  },
]

/** Free units of each unit type, summed over every facility. */
function useAvailability(facilities: Facility[]) {
  const [free, setFree] = useState<Record<number, number> | null>(null)
  useEffect(() => {
    if (!facilities.length) return
    Promise.all(facilities.filter((f) => f.status === 'Active')
      .map((f) => api<Availability[]>(`/api/facilities/${f.facilityId}/availability`).catch(() => [] as Availability[])))
      .then((lists) => {
        const sum: Record<number, number> = {}
        for (const a of lists.flat()) sum[a.unitTypeId] = (sum[a.unitTypeId] ?? 0) + a.availableUnits
        setFree(sum)
      })
  }, [facilities])
  return free
}

export default function Pricing() {
  const { user } = useAuth()
  const [types, setTypes] = useState<UnitType[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(0)
  const free = useAvailability(facilities)

  useEffect(() => {
    api<UnitType[]>('/api/unit-types').then(setTypes).catch((e) => setError((e as Error).message))
    api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {})
  }, [])

  const rentLink = user ? (homeFor(user.role) === '/my-units' ? '/rent' : homeFor(user.role)) : '/rent'
  // Same "most popular" pick as the home page.
  const popularId = types.length > 2 ? types[2].unitTypeId : null
  const hotline = facilities[0]?.hotline

  const area = (t: UnitType) => (t.lengthMeters * t.widthMeters).toLocaleString('vi-VN')
  const rows: { label: string; value: (t: UnitType) => ReactNode }[] = [
    { label: 'Diện tích', value: (t) => `${area(t)} m²` },
    { label: 'Kích thước (Dài × Rộng × Cao)', value: (t) => `${t.lengthMeters} × ${t.widthMeters} × ${t.heightMeters} m` },
    { label: 'Thể tích', value: (t) => `${t.volumeCubicMeters.toLocaleString('vi-VN')} m³` },
    { label: 'Điều hòa, kiểm soát độ ẩm', value: (t) => (t.hasClimateControl ? <Icon name="check" size={16} className="cyan" /> : <span className="muted">—</span>) },
    { label: 'Giá thuê theo ngày', value: (t) => fmtMoney(t.baseDailyRate) },
    { label: 'Giá thuê theo tháng', value: (t) => <b>{fmtMoney(t.baseMonthlyRate)}</b> },
    { label: 'Tiền cọc (1 tháng thuê)', value: (t) => fmtMoney(t.baseMonthlyRate) },
    { label: 'Kho đang trống', value: (t) => (free ? `${free[t.unitTypeId] ?? 0} kho` : '…') },
  ]

  return (
    <>
      <PageHero center eyebrow="Bảng giá minh bạch · Không phát sinh chi phí ẩn" title="Kho Lưu Trữ & Bảng Giá Dịch Vụ">
        Đủ kích thước từ tủ khóa cá nhân đến kho lớn cho cả căn nhà. Giá thuê theo tháng, tiền cọc bằng một tháng thuê, ra vào kho được nhân viên xác thực bằng CCCD.
      </PageHero>

      <section className="section tint">
        <div className="container">
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <div className="unit-grid pricing-grid">
            {types.map((t, i) => {
              const { name, size } = splitTypeName(t.typeName)
              const popular = t.unitTypeId === popularId
              return (
                <article key={t.unitTypeId} className={`unit-card ${popular ? 'featured' : ''}`}>
                  <div className="unit-card-media"><UnitArt variant={i} /></div>
                  <div className="unit-card-body">
                    <div className="row between">
                      <h3>{name}</h3>
                      {popular && <span className="pill solid">Phổ biến nhất</span>}
                    </div>
                    <p className="meta"><Icon name="size" size={14} /> {size || `Dài ${t.lengthMeters}m × Rộng ${t.widthMeters}m`} · Cao {t.heightMeters}m</p>
                    <ul className="price-features">
                      <li><Icon name="check" size={14} /> {area(t)} m², thể tích {t.volumeCubicMeters.toLocaleString('vi-VN')} m³</li>
                      {t.description && <li><Icon name="check" size={14} /> {t.description}</li>}
                      <li><Icon name="check" size={14} /> {t.hasClimateControl ? 'Có điều hòa, kiểm soát độ ẩm' : 'Kho khô ráo, thông thoáng'}</li>
                      <li><Icon name="check" size={14} /> Vào kho bằng CCCD, có nhân viên xác nhận</li>
                    </ul>
                    <div className="unit-price">
                      <span className="muted">Giá thuê chỉ từ</span>
                      <span><b>{fmtMoney(t.baseMonthlyRate)}</b><small>/tháng</small></span>
                    </div>
                    {free && <p className="meta">{free[t.unitTypeId] ? `Còn ${free[t.unitTypeId]} kho trống trên toàn hệ thống` : 'Tạm hết chỗ'}</p>}
                    <Link to={rentLink} className={`btn block ${popular ? 'primary' : 'outline'}`}>Đặt Thuê Ngay</Link>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      {types.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-head">
              <span className="kicker">So sánh chi tiết</span>
              <h2>So Sánh Các Loại Kho</h2>
            </div>
            <div className="table-card">
              <table className="compare-table">
                <thead>
                  <tr><th>Thông tin</th>{types.map((t) => <th key={t.unitTypeId}>{splitTypeName(t.typeName).name}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}><td>{r.label}</td>{types.map((t) => <td key={t.unitTypeId}>{r.value(t)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="section tint">
        <div className="container faq-wrap">
          <div className="section-head">
            <span className="kicker">Câu hỏi thường gặp</span>
            <h2>Giải Đáp Mọi Thắc Mắc Của Bạn</h2>
          </div>
          <div className="faq-list">
            {FAQS.map((f, i) => (
              <div key={f.q} className={`faq-item ${open === i ? 'open' : ''}`}>
                <button type="button" className="faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                  <span>{f.q}</span><Icon name="plus" size={18} />
                </button>
                {open === i && <p className="faq-a">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container cta-wrap" style={{ paddingTop: 88 }}>
        <div className="cta">
          <div>
            <h2>Có Mã Khuyến Mãi?</h2>
            <p>Nhập mã khi đặt kho để được giảm trên hóa đơn thuê đầu tiên. Áp dụng cho khách chưa từng thuê kho tại SafeKeep.</p>
          </div>
          <div className="row wrap">
            <Link to={user ? rentLink : '/register'} className="btn primary lg">{user ? 'Đặt Kho Ngay' : 'Đăng Ký Miễn Phí'}</Link>
            {hotline && <a href={`tel:${hotline}`} className="btn dark lg">Gọi {hotline}</a>}
          </div>
        </div>
      </section>
    </>
  )
}
