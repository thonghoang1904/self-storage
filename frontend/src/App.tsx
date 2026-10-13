import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Gate from './pages/Gate'
import { Login, Register } from './pages/Login'
import MyUnits from './pages/MyUnits'
import Rent from './pages/Rent'
import StaffReservations from './pages/StaffReservations'
import { GATE_ROLES, homeFor, Roles } from './types'

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return children
}

function Layout() {
  const { user, logout } = useAuth()
  return (
    <>
      <header className="topbar">
        <b>Self Storage</b>
        <nav>
          {user?.role === Roles.Customer && (
            <>
              <NavLink to="/my-units">Kho của tôi</NavLink>
              <NavLink to="/rent">Thuê kho</NavLink>
            </>
          )}
          {user && GATE_ROLES.includes(user.role) && (
            <>
              <NavLink to="/gate">Cổng ra vào</NavLink>
              <NavLink to="/reservations">Đặt kho & nhận kho</NavLink>
            </>
          )}
        </nav>
        <span className="spacer" />
        {user ? (
          <span className="row">
            <span className="muted">{user.fullName}</span>
            <button className="btn ghost" onClick={logout}>Đăng xuất</button>
          </span>
        ) : (
          <NavLink to="/login">Đăng nhập</NavLink>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

function Home() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user && homeFor(user.role) !== '/') return <Navigate to={homeFor(user.role)} replace />
  if (user)
    return (
      <div className="page">
        <h2>Xin chào {user.fullName}</h2>
        <p className="muted">Vai trò "{user.role}" chưa có màn hình làm việc trên trang này.</p>
      </div>
    )
  return (
    <div className="page">
      <h2>Kho tự phục vụ</h2>
      <p>Thuê kho theo tháng. Khi đến kho, bạn xuất trình CCCD để nhân viên xác nhận và cho vào.</p>
      <p><NavLink to="/register" className="btn primary">Đăng ký thuê kho</NavLink></p>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/my-units" element={<RequireRole roles={[Roles.Customer]}><MyUnits /></RequireRole>} />
            <Route path="/rent" element={<RequireRole roles={[Roles.Customer]}><Rent /></RequireRole>} />
            <Route path="/gate" element={<RequireRole roles={GATE_ROLES}><Gate /></RequireRole>} />
            <Route path="/reservations" element={<RequireRole roles={GATE_ROLES}><StaffReservations /></RequireRole>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
