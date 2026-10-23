import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, IS_DEMO } from '../api'
import { useAuth } from '../auth'
import { GATE_ROLES, roleLabel, Roles, type Facility } from '../types'
import { Icon, Logo } from './ui'

// ------------------------------------------------------------------ demo bar

export function DemoBar() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  if (!IS_DEMO) return null
  const reset = async () => {
    const { resetDemoData } = await import('../mock/server')
    resetDemoData()
    logout()
    navigate('/login')
  }
  return (
    <div className="demo-bar">
      <span><b>Bản demo</b> · dữ liệu giả lập ngay trong trình duyệt, chưa nối backend thật</span>
      <button className="link-btn" onClick={reset}><Icon name="refresh" size={14} /> Đặt lại dữ liệu</button>
    </div>
  )
}

// ------------------------------------------------------------------ customer portal (top navigation + footer)

const initials = (name: string) => name.split(' ').filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase()

export function PortalHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])

  const isCustomer = user?.role === Roles.Customer
  const isStaff = user && GATE_ROLES.includes(user.role)

  return (
    <header className="portal-header">
      <div className="container portal-header-inner">
        <Link to="/" className="brand-link"><Logo /></Link>
        <button className="icon-btn menu-toggle" aria-label="Mở menu" onClick={() => setOpen(!open)}><Icon name={open ? 'x' : 'menu'} /></button>
        <nav className={`portal-nav ${open ? 'open' : ''}`}>
          <NavLink to="/" end>Trang Chủ</NavLink>
          {isCustomer ? (
            <>
              <NavLink to="/my-units">Kho Của Tôi</NavLink>
              <NavLink to="/invoices">Thanh Toán</NavLink>
              <NavLink to="/support">Hỗ Trợ</NavLink>
              <NavLink to="/rent">Thuê Kho</NavLink>
            </>
          ) : (
            <>
              <a href="#units" onClick={(e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('units')?.scrollIntoView({ behavior: 'smooth' }), 50) }}>Kho Lưu Trữ</a>
              <NavLink to="/pricing">Bảng Giá</NavLink>
              <a href="#facilities" onClick={(e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('facilities')?.scrollIntoView({ behavior: 'smooth' }), 50) }}>Cơ Sở</a>
            </>
          )}
          {isStaff && <NavLink to={user.role === Roles.Manager ? '/facility' : '/gate'}>{user.role === Roles.Manager ? 'Màn hình quản lý' : 'Màn hình nhân viên'}</NavLink>}
          {user?.role === Roles.Admin && <NavLink to="/admin/users">Màn hình quản trị</NavLink>}
          {user?.role === Roles.OpsManager && <NavLink to="/ops/facilities">Màn hình vận hành</NavLink>}
          <div className="portal-nav-actions">
            {user ? (
              <>
                <span className="user-chip">
                  <span className="avatar">{initials(user.fullName)}</span>
                  <span className="user-chip-text"><b>{user.fullName}</b><small>{user.username}</small></span>
                </span>
                <button className="btn outline sm" onClick={() => { logout(); navigate('/') }}>Đăng Xuất</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn ghost sm">Đăng Nhập</Link>
                <Link to="/rent" className="btn primary sm">Đặt Kho Ngay</Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-about">
          <Logo light />
          <p>Hệ thống kho tự phục vụ cho thuê theo tháng. Mỗi lượt vào kho đều được nhân viên trực cổng đối chiếu CCCD.</p>
        </div>
        <div>
          <h4>Kho Lưu Trữ</h4>
          <Link to="/rent">Đặt kho</Link>
          <Link to="/pricing">Bảng giá</Link>
          <Link to="/my-units">Kho của tôi</Link>
          <Link to="/support">Hỗ trợ</Link>
          <Link to="/register">Đăng ký tài khoản</Link>
          <Link to="/terms">Điều khoản hợp đồng</Link>
        </div>
        <div>
          <h4>Ra vào kho</h4>
          <span>Xuất trình CCCD tại cổng</span>
          <span>Người được ủy quyền dùng CCCD của chính họ</span>
          <span>Không dùng mã PIN</span>
        </div>
        <div>
          <h4>Liên Hệ Trực Tiếp</h4>
          <span className="footer-contact"><Icon name="phone" size={15} /> (028) 1234 5678</span>
          <span className="footer-contact"><Icon name="mail" size={15} /> contact@safekeep.com.vn</span>
          <span className="footer-contact"><Icon name="pin" size={15} /> 123 Nguyễn Thị Thập, Quận 7, TP. Hồ Chí Minh</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 SafeKeep Storage. Toàn Bộ Bản Quyền Được Bảo Lưu.</span>
      </div>
    </footer>
  )
}

export function PortalLayout() {
  return (
    <div className="portal">
      <DemoBar />
      <PortalHeader />
      <main className="portal-main"><Outlet /></main>
      <Footer />
    </div>
  )
}

/** Dark band at the top of portal pages. */
export function PageHero({ eyebrow, title, children, center = false }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <section className={`page-hero ${center ? 'center' : ''}`}>
      <div className="container">
        {eyebrow && <span className="eyebrow dark"><i />{eyebrow}</span>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ staff console (dark sidebar)

interface FacilityState {
  facilities: Facility[]
  facilityId: number | null
  setFacilityId: (id: number) => void
  error: string
}
const FacilityContext = createContext<FacilityState | null>(null)

/** The facility the staff member is working at; shared by all staff screens. */
export function useStaffFacility() {
  const ctx = useContext(FacilityContext)
  if (!ctx) throw new Error('useStaffFacility must be used inside StaffLayout')
  return ctx
}

export function StaffLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [pathname])

  useEffect(() => {
    api<Facility[]>('/api/gate/my-facilities')
      .then((fs) => {
        setFacilities(fs)
        if (fs.length) setFacilityId(fs[0].facilityId)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  const isManager = user?.role === Roles.Manager
  const title = pathname === '/facility' ? 'Tổng Quan Cơ Sở'
    : pathname.startsWith('/facility-units') ? 'Kho Lưu Trữ'
    : pathname.startsWith('/facility-staff') ? 'Nhân Viên Cơ Sở'
    : pathname.startsWith('/facility-contracts') ? 'Hợp Đồng & Phụ Thu'
    : pathname.startsWith('/staff-cancellations') ? 'Yêu Cầu Hủy Đặt Kho'
    : pathname.startsWith('/reservations') ? 'Đặt Kho & Nhận Kho'
    : pathname.startsWith('/staff-billing') ? 'Hóa Đơn & Thu Tiền'
    : pathname.startsWith('/staff-contracts') ? 'Gia Hạn & Quá Hạn'
    : pathname.startsWith('/staff-return') ? 'Trả Kho & Hoàn Cọc'
    : pathname.startsWith('/staff-support') ? 'Hỗ Trợ Khách Hàng' : 'Cổng Ra Vào'

  return (
    <FacilityContext.Provider value={{ facilities, facilityId, setFacilityId, error }}>
      <div className="staff">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="sidebar-brand"><Logo admin light /></div>
          <nav className="sidebar-nav">
            {isManager && (
              <>
                <small className="sidebar-group">Quản lý cơ sở</small>
                <NavLink to="/facility" end><Icon name="grid" /> Tổng Quan</NavLink>
                <NavLink to="/facility-units"><Icon name="package" /> Kho Lưu Trữ</NavLink>
                <NavLink to="/facility-staff"><Icon name="users" /> Nhân Viên</NavLink>
                <small className="sidebar-group">Vận hành hằng ngày</small>
              </>
            )}
            <NavLink to="/gate"><Icon name="door" /> Cổng Ra Vào</NavLink>
            <NavLink to="/reservations"><Icon name="clipboard" /> Đặt Kho & Nhận Kho</NavLink>
            <NavLink to="/staff-billing"><Icon name="wallet" /> Hóa Đơn & Thu Tiền</NavLink>
            <NavLink to="/staff-contracts"><Icon name="refresh" /> Gia Hạn & Quá Hạn</NavLink>
            <NavLink to="/staff-return"><Icon name="key" /> Trả Kho & Hoàn Cọc</NavLink>
            <NavLink to="/staff-support"><Icon name="phone" /> Hỗ Trợ Khách Hàng</NavLink>
            <NavLink to="/staff-cancellations"><Icon name="x" /> Yêu Cầu Hủy Đặt Kho</NavLink>
            <NavLink to="/facility-contracts"><Icon name="file" /> Hợp Đồng & Phụ Thu</NavLink>
            <Link to="/"><Icon name="grid" /> Trang khách hàng</Link>
          </nav>
          {user && (
            <div className="sidebar-user">
              <span className="avatar">{initials(user.fullName)}</span>
              <span className="grow">
                <b>{user.fullName}</b>
                <small>{roleLabel(user.role)}</small>
              </span>
              <button className="icon-btn" title="Đăng xuất" onClick={() => { logout(); navigate('/login') }}><Icon name="logout" /></button>
            </div>
          )}
        </aside>
        {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
        <div className="staff-main">
          <DemoBar />
          <header className="staff-topbar">
            <button className="icon-btn menu-toggle" aria-label="Mở menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
            <h2>{title}</h2>
            <span className="grow" />
            {facilities.length > 0 && (
              <label className="facility-select">
                <Icon name="building" size={16} />
                <select value={facilityId ?? ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
                  {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
                </select>
              </label>
            )}
          </header>
          <main className="staff-content"><Outlet /></main>
        </div>
      </div>
    </FacilityContext.Provider>
  )
}

// ------------------------------------------------------------------ management consoles (admin, operations manager): same dark sidebar

/** A sidebar entry: a built screen has a route, the rest of the Figma menu shows greyed out. */
interface ConsoleNavItem { icon: string; label: string; to?: string }

function ConsoleLayout({ nav, titles }: { nav: ConsoleNavItem[]; titles: Record<string, string> }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [pathname])
  const title = Object.entries(titles).find(([path]) => pathname.startsWith(path))?.[1] ?? ''

  return (
    <div className="staff">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><Logo admin light /></div>
        <nav className="sidebar-nav">
          {nav.map((n) => n.to
            ? <NavLink key={n.label} to={n.to}><Icon name={n.icon} /> {n.label}</NavLink>
            : <span key={n.label} className="soon" title="Chưa có màn hình"><Icon name={n.icon} /> {n.label}</span>)}
          <Link to="/"><Icon name="arrowRight" className="flip" /> Trang khách hàng</Link>
        </nav>
        {user && (
          <div className="sidebar-user">
            <span className="avatar">{initials(user.fullName)}</span>
            <span className="grow">
              <b>{user.fullName}</b>
              <small>{roleLabel(user.role)}</small>
            </span>
            <button className="icon-btn" title="Đăng xuất" onClick={() => { logout(); navigate('/login') }}><Icon name="logout" /></button>
          </div>
        )}
      </aside>
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
      <div className="staff-main">
        <DemoBar />
        <header className="staff-topbar">
          <button className="icon-btn menu-toggle" aria-label="Mở menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
          <h2>{title}</h2>
        </header>
        <main className="staff-content"><Outlet /></main>
      </div>
    </div>
  )
}

/** System administrator, menu of the Figma "staff-management" screen. */
export function AdminLayout() {
  return (
    <ConsoleLayout
      titles={{ '/admin/users': 'Nhân Viên Hệ Thống', '/admin/contracts': 'Hợp Đồng', '/admin/emails': 'Email Hệ Thống', '/admin/revenue': 'Doanh Thu' }}
      nav={[
        { icon: 'grid', label: 'Tổng Quan' },
        { icon: 'building', label: 'Kho Lưu Trữ' },
        { icon: 'users', label: 'Khách Hàng' },
        { icon: 'user', label: 'Nhân Viên', to: '/admin/users' },
        { icon: 'file', label: 'Hợp Đồng', to: '/admin/contracts' },
        { icon: 'chart', label: 'Doanh Thu', to: '/admin/revenue' },
        { icon: 'mail', label: 'Email Hệ Thống', to: '/admin/emails' },
        { icon: 'settings', label: 'Cài Đặt' },
      ]}
    />
  )
}

/** Business operations manager, menu of the Figma "facility-branch-management" screen. */
export function OpsLayout() {
  return (
    <ConsoleLayout
      titles={{ '/ops/facilities': 'Quản Lý Cơ Sở', '/ops/policies': 'Chính Sách & Giá', '/ops/revenue': 'Doanh Thu' }}
      nav={[
        { icon: 'grid', label: 'Tổng Quan' },
        { icon: 'package', label: 'Vận Hành Kho' },
        { icon: 'users', label: 'Khách Hàng' },
        { icon: 'phone', label: 'Hỗ Trợ' },
        { icon: 'building', label: 'Cơ Sở', to: '/ops/facilities' },
        { icon: 'chart', label: 'Doanh Thu', to: '/ops/revenue' },
        { icon: 'file', label: 'Chính Sách', to: '/ops/policies' },
        { icon: 'settings', label: 'Cài Đặt' },
      ]}
    />
  )
}
