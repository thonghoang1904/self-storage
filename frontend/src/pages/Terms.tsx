import { Link } from 'react-router-dom'
import { PageHero } from '../components/layout'
import { Icon } from '../components/ui'

/**
 * Điều khoản & chính sách hợp đồng thuê kho. The rules are the ones the backend enforces
 * (deposit, 24-hour hold, cancellation fee, renewal window, 20:00 return, overdue lock and daily fee, CCCD at the gate).
 * Shown as its own page (/terms) and in the step where the customer agrees before a reservation is created.
 */
export const TERMS_VERSION = '2026-10'

export const TERMS: { title: string; icon: string; items: string[] }[] = [
  {
    title: 'Đặt chỗ & tiền cọc',
    icon: 'card',
    items: [
      'Đơn đặt kho được giữ trong thời gian giữ chỗ (mặc định 24 giờ). Quá hạn mà chưa đặt cọc, đơn tự hết hiệu lực.',
      'Tiền cọc tính theo chính sách thuê của cơ sở (mặc định bằng 1 tháng tiền thuê), thanh toán online qua VNPay hoặc tại quầy.',
      'Mã khuyến mãi chỉ áp dụng cho lần thuê đầu tiên, đúng thời gian và số tháng tối thiểu của chương trình; mức giảm trừ vào tiền thuê tháng đầu.',
    ],
  },
  {
    title: 'Nhận kho & thanh toán hằng tháng',
    icon: 'key',
    items: [
      'Sau khi cọc được xác nhận, khách đặt lịch nhận kho trước 20:00 ngày bắt đầu. Nhân viên chỉ bàn giao kho từ giờ hẹn.',
      'Hợp đồng được lập khi bàn giao kho. Tiền thuê phát hành hóa đơn theo từng kỳ một tháng kể từ ngày bắt đầu.',
    ],
  },
  {
    title: 'Hủy đơn đặt kho',
    icon: 'x',
    items: [
      'Khách gửi yêu cầu hủy khi chưa nhận kho; nhân viên cơ sở duyệt hoặc từ chối.',
      'Đơn chưa đặt cọc: hủy không mất phí. Đơn đã đặt cọc: hoàn lại tiền cọc sau khi trừ phí hủy theo chính sách thuê của cơ sở.',
    ],
  },
  {
    title: 'Gia hạn, trả kho & quá hạn',
    icon: 'calendar',
    items: [
      'Gửi yêu cầu gia hạn trong 7 ngày trước ngày hết hạn; hợp đồng được gia hạn sau khi thanh toán phí gia hạn.',
      'Trả kho trước 20:00 ngày hết hạn. Nhân viên kiểm tra kho, đối soát phí và hoàn lại phần cọc còn lại.',
      'Quá 24 giờ kể từ 20:00 ngày hết hạn, kho bị khóa và tính phí mỗi ngày bằng phí tháng / 30, cấn trừ vào tiền cọc. Phần vượt cọc lập thành hóa đơn.',
    ],
  },
  {
    title: 'Ra vào kho',
    icon: 'door',
    items: [
      'Mỗi lượt vào kho phải đăng ký lịch trước và được nhân viên duyệt; tại cổng, nhân viên đối chiếu CCCD.',
      'Chỉ chủ hợp đồng hoặc người được ủy quyền (dùng CCCD của chính họ) được vào kho. Không dùng mã PIN.',
      'Kho bị khóa do quá hạn hoặc đang bảo trì thì không được vào cho đến khi xử lý xong.',
    ],
  },
  {
    title: 'Hàng hóa & phụ phí',
    icon: 'package',
    items: [
      'Không lưu trữ chất cháy nổ, hóa chất độc hại, thực phẩm dễ hỏng, động vật, vũ khí và hàng cấm theo quy định pháp luật.',
      'Phụ phí theo bảng phí hiện hành khi làm mất chìa khóa, thẻ từ, cần vệ sinh sau trả kho hoặc thay ổ khóa do lỗi người dùng.',
    ],
  },
]

export default function TermsPage() {
  return (
    <>
      <PageHero center eyebrow={`Phiên bản ${TERMS_VERSION}`} title="Điều Khoản & Chính Sách Hợp Đồng">
        Những quy định áp dụng cho mọi hợp đồng thuê kho SafeKeep. Khách đồng ý các điều khoản này trước khi giữ chỗ và thanh toán cọc.
      </PageHero>
      <div className="container page-body terms-page">
        <TermsList />
        <div className="panel row between wrap">
          <span className="muted">Mức cọc, thời gian giữ chỗ và phí hủy cụ thể theo chính sách thuê của từng cơ sở tại thời điểm đặt kho.</span>
          <Link to="/rent" className="btn primary">Đặt kho ngay <Icon name="arrowRight" size={15} /></Link>
        </div>
      </div>
    </>
  )
}

export function TermsList({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`terms-list ${compact ? 'compact' : ''}`}>
      {TERMS.map((s, i) => (
        <li key={s.title}>
          <h3><span className="terms-no">{i + 1}</span><Icon name={s.icon} size={compact ? 15 : 18} /> {s.title}</h3>
          <ul>{s.items.map((t) => <li key={t}>{t}</li>)}</ul>
        </li>
      ))}
    </ol>
  )
}
