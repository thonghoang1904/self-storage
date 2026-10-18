import type { ReactNode } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { IS_DEMO } from './api'
import { AuthProvider, useAuth } from './auth'
import { PortalLayout, StaffLayout } from './components/layout'
import Gate from './pages/Gate'
import ContractDetail from './pages/ContractDetail'
import Home from './pages/Home'
import Invoices from './pages/Invoices'
import { Login, Register } from './pages/Login'
import MyUnits from './pages/MyUnits'
import Rent from './pages/Rent'
import StaffBilling from './pages/StaffBilling'
import StaffContracts from './pages/StaffContracts'
import StaffReturn from './pages/StaffReturn'
import StaffReservations from './pages/StaffReservations'
import StaffSupport from './pages/StaffSupport'
import { GATE_ROLES, homeFor, Roles } from './types'

// The demo build is served as a static page, so it keeps the route in the URL hash.
const Router = IS_DEMO ? HashRouter : BrowserRouter

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<PortalLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/my-units" element={<RequireRole roles={[Roles.Customer]}><MyUnits /></RequireRole>} />
            <Route path="/my-units/:id" element={<RequireRole roles={[Roles.Customer]}><ContractDetail /></RequireRole>} />
            <Route path="/rent" element={<RequireRole roles={[Roles.Customer]}><Rent /></RequireRole>} />
            <Route path="/invoices" element={<RequireRole roles={[Roles.Customer]}><Invoices /></RequireRole>} />
            <Route path="/payment-result" element={<RequireRole roles={[Roles.Customer]}><Invoices /></RequireRole>} />
          </Route>
          <Route element={<RequireRole roles={GATE_ROLES}><StaffLayout /></RequireRole>}>
            <Route path="/gate" element={<Gate />} />
            <Route path="/reservations" element={<StaffReservations />} />
            <Route path="/staff-billing" element={<StaffBilling />} />
            <Route path="/staff-contracts" element={<StaffContracts />} />
            <Route path="/staff-return" element={<StaffReturn />} />
            <Route path="/staff-support" element={<StaffSupport />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
