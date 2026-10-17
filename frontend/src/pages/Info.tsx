import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { PageHero } from '../components/layout'
import { Icon } from '../components/ui'
import type { Facility } from '../types'

const VALUES = [
  { icon: 'idCard', title: 'Người thật kiểm tra', text: 'Mỗi lượt vào kho đều được nhân viên trực cổng đối chiếu CCCD với hồ sơ, không dùng mã PIN dễ lộ.' },
  { icon: 'users', title: 'Ủy quyền minh bạch', text: 'Bạn tự thêm hoặc thu hồi người nhà, nhân viên được vào kho thay mình ngay trên tài khoản.' },
  { icon: 'history', title: 'Lịch sử rõ ràng', text: 'Ai vào, lúc nào, nhân viên nào xác nhận đều được ghi lại và bạn xem được bất cứ lúc nào.' },
  { icon: 'shield', title: 'Hợp đồng công bằng', text: 'Cọc một tháng, gia hạn trước 7 ngày, phí quá hạn tính theo ngày và cấn trừ minh bạch vào cọc.' },
]

const STEPS = [
  ['Đặt kho trực tuyến', 'Chọn cơ sở, loại kho và thời gian thuê, giữ chỗ trong 24 giờ.'],
  ['Đặt cọc & nhận kho', 'Đến cơ sở đặt cọc, nhân viên bàn giao kho và tạo hợp đồng.'],
  ['Ra vào bằng CCCD', 'Xuất trình CCCD tại cổng, nhân viên xác thực rồi cho vào.'],
  ['Gia hạn hoặc trả kho', 'Gia hạn trước ngày hết hạn, hoặc dọn kho và nhận lại cọc.'],
]

export function AboutUs() {
  return (
    <>
      <PageHero eyebrow="Về chúng tôi" title={<>SafeKeep — Kho Tự Quản <span className="cyan">An Toàn</span> Cho Mọi Người</>}>
        Chúng tôi cho thuê kho theo tháng cho gia đình, sinh viên và cửa hàng online, với quy trình ra vào do con người kiểm soát.
      </PageHero>
      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Giá trị cốt lõi</span>
            <h2>Vì Sao Chọn SafeKeep</h2>
          </div>
          <div className="feature-grid four">
            {VALUES.map((v) => (
              <div key={v.title} className="feature-card">
                <span className="feature-icon"><Icon name={v.icon} size={20} /></span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section tint">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Cách hoạt động</span>
            <h2>Bốn Bước Đơn Giản</h2>
          </div>
          <div className="steps-grid">
            {STEPS.map(([t, d], i) => (
              <div key={t} className="step-card">
                <span className="step-num">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="container cta-wrap" style={{ paddingTop: 88 }}>
        <div className="cta">
          <div>
            <h2>Sẵn Sàng Có Thêm Không Gian?</h2>
            <p>Xem các loại kho còn trống và đặt chỗ chỉ trong vài phút.</p>
          </div>
          <Link to="/rent" className="btn primary lg">Đặt Kho Ngay</Link>
        </div>
      </div>
    </>
  )
}

/** Contact page: hotline/email plus the real facility list from GET /api/facilities. */
export function Contact() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  useEffect(() => { api<Facility[]>('/api/facilities').then(setFacilities).catch(() => {}) }, [])

  return (
    <>
      <PageHero eyebrow="Liên hệ" title="Chúng Tôi Luôn Sẵn Sàng Hỗ Trợ">
        Gọi hotline, gửi email hoặc ghé trực tiếp cơ sở gần bạn. Khách đang thuê kho có thể gửi yêu cầu hỗ trợ ngay trong tài khoản.
      </PageHero>
      <div className="container page-body stack-xl">
        <div className="stat-grid three">
          <a className="quick-action" href="tel:02812345678">
            <span className="feature-icon sm"><Icon name="phone" size={18} /></span>
            <span className="grow"><b>Hotline</b><small>(028) 1234 5678 · 6:00 – 22:00</small></span>
          </a>
          <a className="quick-action" href="mailto:contact@safekeep.com.vn">
            <span className="feature-icon sm"><Icon name="mail" size={18} /></span>
            <span className="grow"><b>Email</b><small>contact@safekeep.com.vn</small></span>
          </a>
          <Link className="quick-action" to="/support">
            <span className="feature-icon sm"><Icon name="clipboard" size={18} /></span>
            <span className="grow"><b>Yêu cầu hỗ trợ</b><small>Dành cho khách đang thuê kho</small></span>
            <Icon name="arrowRight" size={16} className="cyan" />
          </Link>
        </div>
        <section className="stack-lg">
          <h2 className="section-title with-icon"><Icon name="building" size={20} className="cyan" /> Hệ Thống Cơ Sở</h2>
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
        </section>
      </div>
    </>
  )
}
