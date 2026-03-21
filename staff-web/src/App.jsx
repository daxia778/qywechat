import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import LoginPage from './pages/LoginPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter basename="/s">
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <div style={{ padding: 40, color: '#fff', background: '#0a0a0f', minHeight: '100vh' }}>
                  <h1>工作台（建设中）</h1>
                  <p style={{ color: '#888', marginTop: 8 }}>订单大厅、我的订单等功能即将上线。</p>
                </div>
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

