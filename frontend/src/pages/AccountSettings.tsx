import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/ui'
import { Roles, roleLabel, type UserDto } from '../types'

/**
 * "Cài Đặt" of the administrator and the operations manager: the signed-in account (GET /api/auth/me), what the
 * role is allowed to do, a way to change the password (the forgot-password flow) and signing out.
 * There is no Figma frame and no settings API, so it stays a plain account page.
 */

const PERMISSIONS: Record<string, string[]> = {
  [Roles.Admin]: [
    'Xem tổng quan, doanh thu và kho của mọi cơ sở',
    'Quản lý tài khoản nhân viên: thêm, đổi vai trò, khóa',
    'Tra cứu khách hàng, sửa hợp đồng, trả kho',
    'Theo dõi email hệ thống và gửi lại email lỗi',
  ],
  [Roles.OpsManager]: [
    'Xem tổng quan và doanh thu của mọi cơ sở',
    'Thêm, sửa thông tin cơ sở',
    'Đặt giá thuê, chính sách, phí và khuyến mãi',
    'Theo dõi tình trạng kho từng cơ sở',
  ],
}

export default function AccountSettings() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [me, setMe] = useState<UserDto | null>(user)

  useEffect(() => { api<UserDto>('/api/auth/me').then(setMe).catch(() => {}) }, [])
  if (!me) return null
  const initials = me.fullName.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase()

  return (
    <div className="stack-xl settings-page">
      <div className="page-title-row">
        <h1>Cài Đặt Tài Khoản</h1>
        <p className="muted">Thông tin tài khoản đang đăng nhập và quyền của vai trò này.</p>
      </div>

      <section className="panel">
        <div className="row wrap settings-profile">
          <span className="avatar lg">{initials}</span>
          <div className="grow">
            <h2 className="panel-title">{me.fullName}</h2>
            <p className="muted">{roleLabel(me.role)}</p>
          </div>
        </div>
        <dl className="kv-grid">
          <div><dt>Tên đăng nhập</dt><dd>{me.username}</dd></div>
          <div><dt>Mã tài khoản</dt><dd>#{me.userId}</dd></div>
          <div><dt>Vai trò</dt><dd>{roleLabel(me.role)}</dd></div>
          <div><dt>Đổi thông tin cá nhân</dt><dd className="muted">{me.role === Roles.Admin ? 'Sửa ở mục Nhân Viên' : 'Nhờ quản trị hệ thống sửa ở mục Nhân Viên'}</dd></div>
        </dl>
      </section>

      {PERMISSIONS[me.role] && (
        <section className="panel">
          <h2 className="panel-title"><Icon name="shield" size={18} className="cyan" /> Quyền của vai trò</h2>
          <ul className="check-list">{PERMISSIONS[me.role].map((p) => <li key={p}><Icon name="check" size={15} /> {p}</li>)}</ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title"><Icon name="lock" size={18} className="cyan" /> Bảo mật</h2>
        <div className="row between wrap">
          <div>
            <b>Mật khẩu</b>
            <p className="muted">Đổi mật khẩu bằng mã xác minh gửi về email của tài khoản.</p>
          </div>
          <Link className="btn outline" to="/forgot-password">Đổi mật khẩu</Link>
        </div>
        <div className="row between wrap">
          <div>
            <b>Đăng xuất</b>
            <p className="muted">Thoát tài khoản trên trình duyệt này.</p>
          </div>
          <button className="btn danger" onClick={() => { logout(); navigate('/login') }}><Icon name="logout" size={16} /> Đăng xuất</button>
        </div>
      </section>
    </div>
  )
}
