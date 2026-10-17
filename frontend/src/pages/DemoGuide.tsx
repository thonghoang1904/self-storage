import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { DemoBar } from '../components/layout'
import { Icon, Logo } from '../components/ui'
import { homeFor } from '../types'

type Step = { title: string; api: string; account: string | null; path: string; how: string }
type Group = { name: string; icon: string; steps: Step[] }

/** Every backend feature, with the account to use and the page that exercises it. */
const GROUPS: Group[] = [
  { name: 'Tài khoản', icon: 'user', steps: [
    { title: 'Đăng ký tài khoản khách', api: 'POST /api/auth/register', account: null, path: '/register', how: 'Điền họ tên, CCCD, SĐT, email, tên đăng nhập, mật khẩu ≥ 8 ký tự.' },
    { title: 'Đăng nhập theo vai trò', api: 'POST /api/auth/login · GET /api/auth/me', account: null, path: '/login', how: 'Khách vào "Kho Của Tôi", nhân viên vào thẳng "Cổng Ra Vào".' },
    { title: 'Quên mật khẩu', api: 'POST /api/auth/forgot-password · reset-password', account: null, path: '/forgot-password', how: 'Nhập customer1@example.com → nhận mã qua email (bản demo hiện mã trên màn hình) → đặt mật khẩu mới.' },
  ] },
  { name: 'Danh mục', icon: 'building', steps: [
    { title: 'Cơ sở, loại kho, giá', api: 'GET /api/facilities · /api/unit-types', account: null, path: '/', how: 'Trang chủ: bảng giá loại kho và danh sách cơ sở.' },
    { title: 'Số kho còn trống', api: 'GET /api/facilities/{id}/availability', account: 'customer1', path: '/rent', how: 'Chọn cơ sở, số kho trống hiện cạnh từng loại.' },
  ] },
  { name: 'Đặt kho → Nhận kho', icon: 'clipboard', steps: [
    { title: 'Khách đặt kho', api: 'POST /api/reservations · GET /api/reservations/my', account: 'customer1', path: '/rent', how: 'Chọn loại kho, ngày bắt đầu, số tháng → giữ chỗ 24 giờ.' },
    { title: 'Nhân viên xác nhận cọc', api: 'POST /api/reservations/{id}/confirm-deposit', account: 'staff1', path: '/reservations', how: 'Đơn "Chờ đặt cọc" → bấm "Đã nhận cọc".' },
    { title: 'Bàn giao kho (tạo hợp đồng)', api: 'POST /api/reservations/{id}/check-in', account: 'staff1', path: '/reservations', how: 'Đơn "Chờ bàn giao" → chọn kho trống → "Bàn giao". Hợp đồng mới hiện bên khách.' },
  ] },
  { name: 'Hóa đơn & thanh toán', icon: 'wallet', steps: [
    { title: 'Hóa đơn cọc, gia hạn; thanh toán VNPay/MoMo', api: 'GET /api/invoices/my · POST /api/invoices/{id}/checkout/{provider}', account: 'customer1', path: '/invoices', how: 'Xem hóa đơn và trạng thái thanh toán. Thanh toán online cần backend thật và cấu hình VNPay/MoMo.' },
  ] },
  { name: 'Hợp đồng (khách)', icon: 'clipboard', steps: [
    { title: 'Danh sách & chi tiết hợp đồng', api: 'GET /api/contracts/my · /api/contracts/{id}', account: 'customer1', path: '/contracts', how: 'Xem thời hạn, phí thuê, tiền cọc, phí quá hạn.' },
    { title: 'Gửi yêu cầu gia hạn', api: 'POST/GET /api/contracts/{id}/renewals', account: 'customer1', path: '/contracts', how: 'Mở HD-DEMO-0002 (còn 5 ngày) → chọn số tháng → "Gửi Yêu Cầu Gia Hạn".' },
  ] },
  { name: 'Gia hạn · Quá hạn · Trả kho · Hoàn cọc (nhân viên)', icon: 'refresh', steps: [
    { title: 'Danh sách gia hạn & quá hạn, xác nhận thu phí', api: 'GET /api/contracts/facilities/{id} · …/renewals · …/overdue · POST renewals/{id}/confirm-payment · reject', account: 'staff1', path: '/staff-contracts', how: 'Lọc theo trạng thái, xuất CSV. Dòng "Chờ thu phí gia hạn" → "Đã thu phí" hoặc "Từ chối".' },
    { title: 'Kiểm tra trả kho (checklist) & hoàn tất trả kho', api: 'POST /api/contracts/{id}/return', account: 'staff1', path: '/staff-return', how: 'Chọn HD-DEMO-0004 → tick 7 mục → xác nhận → "Hoàn tất trả kho". Phí quá hạn tự cấn trừ vào cọc.' },
    { title: 'Hoàn cọc cho khách', api: 'POST /api/contracts/{id}/deposit-refunds', account: 'staff1', path: '/staff-return', how: 'Sau khi trả kho: chọn tiền mặt / chuyển khoản → tick khách đã nhận → "Xác nhận hoàn cọc".' },
  ] },
  { name: 'Ủy quyền & lịch sử ra vào', icon: 'users', steps: [
    { title: 'Thêm / thu hồi người được ủy quyền', api: 'GET/POST/DELETE /api/contracts/{id}/authorized-persons', account: 'customer1', path: '/my-units', how: 'Kho B-01 → "Người Ủy Quyền" → thêm người kèm CCCD, hoặc "Thu hồi".' },
    { title: 'Lịch sử ra vào của kho', api: 'GET /api/contracts/{id}/access-history', account: 'customer1', path: '/my-units', how: 'Kho B-01 → "Lịch Sử".' },
  ] },
  { name: 'Cổng ra vào (nhân viên)', icon: 'door', steps: [
    { title: 'Tra cứu khách tại cổng', api: 'GET /api/gate/facilities/{id}/lookup', account: 'staff1', path: '/gate', how: 'Gõ B-01, mã HĐ, CCCD hoặc SĐT (vd 079300000456).' },
    { title: 'Cho vào (đối chiếu CCCD) / từ chối', api: 'POST …/entries · POST …/denials', account: 'staff1', path: '/gate', how: 'Chọn người → gõ đúng CCCD → "Cho vào". C-02 quá hạn sẽ bị chặn → ghi từ chối.' },
    { title: 'Đang ở trong kho, xác nhận ra', api: 'GET …/inside · …/today · POST access-records/{id}/exit', account: 'staff1', path: '/gate', how: 'Danh sách "Đang ở trong kho" → "Xác nhận ra".' },
  ] },
  { name: 'Yêu cầu hỗ trợ', icon: 'phone', steps: [
    { title: 'Khách gửi & theo dõi yêu cầu', api: 'POST /api/support-requests · GET my · GET {id}/updates', account: 'customer1', path: '/support', how: 'Điền loại sự cố, mức độ, mô tả → "Gửi Yêu Cầu". Bấm yêu cầu để xem tiến trình.' },
    { title: 'Nhân viên tiếp nhận & xử lý', api: 'GET /api/support-requests/facilities/{id} · PUT {id}', account: 'staff1', path: '/staff-support', how: 'Mở yêu cầu → chọn "Tiếp nhận" / "Đã xử lý xong" → nhập nội dung gửi khách.' },
  ] },
]

const total = GROUPS.reduce((n, g) => n + g.steps.length, 0)

export default function DemoGuide() {
  const { user, login, logout } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const open = async (s: Step) => {
    setError('')
    setBusy(s.title)
    try {
      if (s.account === null) logout()
      else if (user?.username !== s.account) await login(s.account, 'Demo@12345')
      navigate(s.path)
    } catch (e) {
      setError(`${(e as Error).message}. Nếu vừa đổi mật khẩu ${s.account}, bấm "Đặt lại dữ liệu" ở thanh vàng.`)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="guide-page">
      <DemoBar />
      <div className="container guide-body stack-xl">
        <div className="row between wrap">
          <Logo />
          {user && <button className="btn ghost sm" onClick={() => navigate(homeFor(user.role))}>Về trang của {user.username} <Icon name="arrowRight" size={14} /></button>}
        </div>
        <div className="stack-sm">
          <h1>Hướng Dẫn Thử Toàn Bộ Chức Năng</h1>
          <p className="muted">{total} chức năng backend, chia {GROUPS.length} nhóm. Bấm "Thử" để tự đăng nhập đúng tài khoản (mật khẩu <b>Demo@12345</b>) và mở đúng trang.</p>
        </div>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        {GROUPS.map((g, gi) => (
          <section key={g.name} className="panel">
            <h2 className="panel-title"><span className="step-num sm">{gi + 1}</span> <Icon name={g.icon} size={18} className="cyan" /> {g.name}</h2>
            <div className="guide-list">
              {g.steps.map((s) => (
                <div key={s.title} className="guide-row">
                  <div className="grow">
                    <b>{s.title}</b>
                    <p className="muted">{s.how}</p>
                    <code>{s.api}</code>
                  </div>
                  <span className="pill muted">{s.account ?? 'khách vãng lai'}</span>
                  <button className="btn primary sm" disabled={!!busy} onClick={() => open(s)}>{busy === s.title ? 'Đang mở…' : 'Thử'} <Icon name="arrowRight" size={14} /></button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
