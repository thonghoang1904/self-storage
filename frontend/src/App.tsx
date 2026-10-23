import type { ReactNode } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { IS_DEMO } from './api'
import { AuthProvider, useAuth } from './auth'
import { AdminLayout, OpsLayout, PortalLayout, StaffLayout } from './components/layout'
import AdminUsers from './pages/AdminUsers'
import OpsFacilities from './pages/OpsFacilities'
import Pricing from './pages/Pricing'
import OpsPolicies from './pages/OpsPolicies'
import OpsRevenue from './pages/OpsRevenue'
import FacilityContracts from './pages/FacilityContracts'
import FacilityOverview from './pages/FacilityOverview'
import FacilityStaffPage from './pages/FacilityStaffPage'
import FacilityUnits from './pages/FacilityUnits'
import ForgotPassword from './pages/ForgotPassword'
import Gate from './pages/Gate'
import ContractDetail from './pages/ContractDetail'
import Home from './pages/Home'
import Invoices from './pages/Invoices'
import { Login, Register } from './pages/Login'
import MyUnits from './pages/MyUnits'
import Rent from './pages/Rent'
import StaffBilling from './pages/StaffBilling'
import StaffCancellations from './pages/StaffCancellations'
import StaffContracts from './pages/StaffContracts'
import StaffReturn from './pages/StaffReturn'
import StaffReservations from './pages/StaffReservations'
import StaffSupport from './pages/StaffSupport'
import Support from './pages/Support'
import TermsPage from './pages/Terms'
import VisitRegistrationPage from './pages/VisitRegistration'
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
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route element={<PortalLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/my-units" element={<RequireRole roles={[Roles.Customer]}><MyUnits /></RequireRole>} />
            <Route path="/my-units/:id" element={<RequireRole roles={[Roles.Customer]}><ContractDetail /></RequireRole>} />
            <Route path="/my-units/:id/visit" element={<RequireRole roles={[Roles.Customer]}><VisitRegistrationPage /></RequireRole>} />
            <Route path="/support" element={<RequireRole roles={[Roles.Customer]}><Support /></RequireRole>} />
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
            <Route path="/staff-cancellations" element={<StaffCancellations />} />
            <Route path="/facility-contracts" element={<FacilityContracts />} />
            <Route path="/facility" element={<RequireRole roles={[Roles.Manager]}><FacilityOverview /></RequireRole>} />
            <Route path="/facility-units" element={<RequireRole roles={[Roles.Manager]}><FacilityUnits /></RequireRole>} />
            <Route path="/facility-staff" element={<RequireRole roles={[Roles.Manager]}><FacilityStaffPage /></RequireRole>} />
          </Route>
          <Route element={<RequireRole roles={[Roles.Admin]}><AdminLayout /></RequireRole>}>
            <Route path="/admin/users" element={<AdminUsers />} />
          </Route>
          <Route element={<RequireRole roles={[Roles.OpsManager]}><OpsLayout /></RequireRole>}>
            <Route path="/ops/facilities" element={<OpsFacilities />} />
            <Route path="/ops/policies" element={<OpsPolicies />} />
            <Route path="/ops/revenue" element={<OpsRevenue />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
