import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, IS_DEMO } from '../api'
import { useAuth } from '../auth'
import { GATE_ROLES, roleLabel, Roles, type Facility } from '../types'
import { Icon, Logo } from './ui'
import { NotificationBell } from './NotificationBell'
import { Select } from './Select'
import { ActionBanner } from './ActionBanner'
import { ProfileDialog } from './ProfileDialog'

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

/**
 * Click the name in the header: a small menu with account information, security & log (customers) and sign out.
 * Closes on a click outside, Escape or page change.
 */
function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const close = (e: globalThis.MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!user) return null
  return (
    <div className="user-menu" ref={box}>
      <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar">{initials(user.fullName)}</span>
        <span className="user-chip-text"><b>{user.fullName}</b><small>{user.username}</small></span>
        <Icon name="arrowRight" size={14} className={`chevron ${open ? 'up' : 'down'}`} />
      </button>
      {open && (
        <div className="user-menu-list" role="menu">
          <Link to="/account/profile" role="menuitem"><Icon name="user" size={16} /> Thông tin tài khoản</Link>
          {user.role === Roles.Customer && <Link to="/account/security" role="menuitem"><Icon name="shield" size={16} /> Bảo mật &amp; nhật ký</Link>}
          <button type="button" role="menuitem" className="danger-text" onClick={() => { setOpen(false); logout(); navigate('/') }}><Icon name="logout" size={16} /> Đăng xuất</button>
        </div>
      )}
    </div>
  )
}

const initials = (name: string) => name.split(' ').filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase()

/** The portal logo opens the home page with a full reload, so every count and notice is fetched again. */
function goHomeFresh(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  if (IS_DEMO) { window.location.hash = '#/'; window.location.reload() }
  else window.location.assign(import.meta.env.BASE_URL)
}

export function PortalHeader() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])

  const isCustomer = user?.role === Roles.Customer
  const isStaff = user && GATE_ROLES.includes(user.role)

  return (
    <header className="portal-header">
      <div className="container portal-header-inner">
        <a href={IS_DEMO ? '#/' : import.meta.env.BASE_URL} className="brand-link" onClick={goHomeFresh}><Logo /></a>
        <button className="icon-btn menu-toggle" aria-label="Mở menu" onClick={() => setOpen(!open)}><Icon name={open ? 'x' : 'menu'} /></button>
        <nav className={`portal-nav ${open ? 'open' : ''}`}>
          <NavLink to="/" end>Trang Chủ</NavLink>
          {isCustomer ? (
            <>
              <NavLink to="/my-units">Kho Của Tôi</NavLink>
              <NavLink to="/invoices">Thanh Toán</NavLink>
              <NavLink to="/support">Hỗ Trợ</NavLink>
              <NavLink to="/rent">Thuê Kho</NavLink>
              <NavLink to="/visit">Đăng Ký Vào Kho</NavLink>
            </>
          ) : (
            <>
              <a href="#units" onClick={(e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('units')?.scrollIntoView({ behavior: 'smooth' }), 50) }}>Kho Lưu Trữ</a>
              <NavLink to="/pricing">Bảng Giá</NavLink>
              <a href="#facilities" onClick={(e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('facilities')?.scrollIntoView({ behavior: 'smooth' }), 50) }}>Cơ Sở</a>
            </>
          )}
          {isStaff && <NavLink to={user.role === Roles.Manager ? '/facility' : '/gate'}>{user.role === Roles.Manager ? 'Màn hình quản lý' : 'Màn hình nhân viên'}</NavLink>}
          {user?.role === Roles.Admin && <NavLink to="/admin">Màn hình quản trị</NavLink>}
          {user?.role === Roles.OpsManager && <NavLink to="/ops/facilities">Màn hình vận hành</NavLink>}
          <div className="portal-nav-actions">
            {user ? (
              <>
                <UserMenu />
                <NotificationBell />
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
  const [facilities, setFacilities] = useState<Pick<Facility, 'facilityId' | 'facilityName' | 'address' | 'district' | 'city'>[]>([])
  useEffect(() => { api<Facility[]>('/api/facilities').then((fs) => setFacilities(fs.filter((f) => f.status !== 'Closed'))).catch(() => {}) }, [])
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
          <span>Người vào kho dùng CCCD của chính họ</span>
          <span>Không dùng mã PIN</span>
        </div>
        <div>
          <h4>Liên Hệ Trực Tiếp</h4>
          <span className="footer-contact"><Icon name="phone" size={15} /> (028) 1234 5678</span>
          <span className="footer-contact"><Icon name="mail" size={15} /> contact@safekeep.com.vn</span>
          {/* One line per open facility (GET /api/facilities); the first address until the list loads. */}
          {(facilities.length ? facilities : [{ facilityId: 0, facilityName: '', address: '123 Nguyễn Thị Thập', district: 'Quận 7', city: 'TP. Hồ Chí Minh' }]).map((f) => (
            <span key={f.facilityId} className="footer-contact"><Icon name="pin" size={15} /> <span>{f.facilityName && <b>{f.facilityName}: </b>}{f.address}, {f.district}, {f.city}</span></span>
          ))}
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
      <ActionBanner />
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
  const [profileOpen, setProfileOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [pathname])

  useEffect(() => {
    api<Facility[]>('/api/gate/my-facilities')
      .then((fs) => {
        setFacilities(fs)
        if (fs.length) setFacilityId(fs[0].facilityId)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  const title = pathname === '/facility' ? 'Tổng Quan Cơ Sở'
    : pathname.startsWith('/facility-units') ? 'Kho Lưu Trữ'
    : pathname.startsWith('/facility-staff') ? 'Nhân Viên Cơ Sở'
    : pathname.startsWith('/facility-contracts') ? 'Hợp Đồng & Phụ Thu'
    : pathname.startsWith('/staff-cancellations') ? 'Yêu Cầu Hủy Đặt Kho'
    : pathname.startsWith('/reservations') ? 'Đặt Kho & Nhận Kho'
    : pathname.startsWith('/staff-billing') ? 'Hóa Đơn'
    : pathname.startsWith('/staff-contracts') ? 'Gia Hạn & Quá Hạn'
    : pathname.startsWith('/staff-return') ? 'Trả Kho & Hoàn Cọc'
    : pathname.startsWith('/staff-support') ? 'Hỗ Trợ Khách Hàng' : 'Cổng Ra Vào'

  return (
    <FacilityContext.Provider value={{ facilities, facilityId, setFacilityId, error }}>
      <div className="staff">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="sidebar-brand"><Logo area="Facility" light /></div>
          <nav className="sidebar-nav">
            <NavLink to="/gate"><Icon name="door" /> Cổng Ra Vào</NavLink>
            <NavLink to="/reservations"><Icon name="clipboard" /> Đặt Kho</NavLink>
            <NavLink to="/staff-billing"><Icon name="wallet" /> Hóa Đơn</NavLink>
            <NavLink to="/staff-contracts"><Icon name="refresh" /> Gia Hạn</NavLink>
            <NavLink to="/staff-return"><Icon name="key" /> Trả Kho</NavLink>
            <NavLink to="/staff-support"><Icon name="phone" /> Hỗ Trợ</NavLink>
            <NavLink to="/staff-cancellations"><Icon name="x" /> Hủy Đặt Kho</NavLink>
            <NavLink to="/facility-contracts"><Icon name="file" /> Hợp Đồng</NavLink>
          </nav>
          {user && (
            <div className="sidebar-user">
              <button type="button" className="sidebar-user-link" title="Xem thông tin cá nhân" onClick={() => setProfileOpen(true)}>
                <span className="avatar">{initials(user.fullName)}</span>
              <span className="grow">
                <b>{user.fullName}</b>
                <small>{roleLabel(user.role)}</small>
              </span>
              </button>
              {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
              <button type="button" className="sidebar-logout" title="Đăng xuất" onClick={() => { logout(); navigate('/login') }}><Icon name="logout" size={16} /> <span>Đăng xuất</span></button>
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
                <Select value={facilityId ?? ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
                  {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.facilityName}</option>)}
                </Select>
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
interface ConsoleNavItem { icon: string; label: string; to?: string; end?: boolean }

function ConsoleLayout({ area, nav, titles, customerLink = true }: { area: string; nav: ConsoleNavItem[]; titles: Record<string, string>; customerLink?: boolean }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [pathname])
  // Longest matching prefix, so /admin/units is not titled by /admin.
  const title = Object.entries(titles).filter(([path]) => pathname === path || pathname.startsWith(`${path}/`)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? ''

  return (
    <div className="staff">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><Logo area={area} light /></div>
        <nav className="sidebar-nav">
          {nav.map((n) => n.to
            ? <NavLink key={n.label} to={n.to} end={n.end}><Icon name={n.icon} /> {n.label}</NavLink>
            : <span key={n.label} className="soon" title="Chưa có màn hình"><Icon name={n.icon} /> {n.label}</span>)}
          {customerLink && <Link to="/"><Icon name="arrowRight" className="flip" /> Trang khách hàng</Link>}
        </nav>
        {user && (
          <div className="sidebar-user">
            <button type="button" className="sidebar-user-link" title="Xem thông tin cá nhân" onClick={() => setProfileOpen(true)}>
              <span className="avatar">{initials(user.fullName)}</span>
            <span className="grow">
              <b>{user.fullName}</b>
              <small>{roleLabel(user.role)}</small>
            </span>
            </button>
            {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
            <button type="button" className="sidebar-logout" title="Đăng xuất" onClick={() => { logout(); navigate('/login') }}><Icon name="logout" size={16} /> <span>Đăng xuất</span></button>
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
      area="Admin"
      customerLink={false}
      titles={{ '/admin/users': 'Nhân Viên Hệ Thống', '/admin/contracts': 'Hợp Đồng', '/admin/emails': 'Email Hệ Thống', '/admin/revenue': 'Doanh Thu & Thống Kê', '/admin/reports': 'Báo Cáo', '/admin/support': 'Hỗ Trợ Khách Hàng', '/admin/system': 'Giao Dịch & Nhật Ký',
        '/admin/storage': 'Kho Lưu Trữ Hệ Thống', '/admin/facilities': 'Quản Lý Cơ Sở', '/admin/customers': 'Khách Hàng',
        '/admin': 'Tổng Quan Quản Lý' }}
      nav={[
        { icon: 'grid', label: 'Tổng Quan', to: '/admin', end: true },
        { icon: 'building', label: 'Kho Lưu Trữ', to: '/admin/storage' },
        { icon: 'users', label: 'Khách Hàng', to: '/admin/customers' },
        { icon: 'user', label: 'Nhân Viên', to: '/admin/users' },
        { icon: 'grid', label: 'Cơ Sở', to: '/admin/facilities' },
        { icon: 'phone', label: 'Hỗ Trợ', to: '/admin/support' },
        { icon: 'file', label: 'Hợp Đồng', to: '/admin/contracts' },
        { icon: 'chart', label: 'Doanh Thu', to: '/admin/revenue' },
        { icon: 'file', label: 'Báo Cáo', to: '/admin/reports' },
      ]}
    />
  )
}

/** Business operations manager, menu of the Figma "facility-branch-management" screen. */
export function OpsLayout() {
  return (
    <ConsoleLayout
      area="Operations"
      titles={{ '/ops/facilities': 'Quản Lý Cơ Sở', '/ops/policies': 'Chính Sách & Giá', '/ops/revenue': 'Doanh Thu',
        '/ops/storage': 'Vận Hành Kho', '/ops': 'Tổng Quan Vận Hành' }}
      nav={[
        { icon: 'grid', label: 'Tổng Quan', to: '/ops', end: true },
        { icon: 'package', label: 'Vận Hành Kho', to: '/ops/storage' },
        { icon: 'building', label: 'Cơ Sở', to: '/ops/facilities' },
        { icon: 'chart', label: 'Doanh Thu', to: '/ops/revenue' },
        { icon: 'file', label: 'Chính Sách', to: '/ops/policies' },
      ]}
    />
  )
}
