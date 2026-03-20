import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { validateToken } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('staff_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('staff_token')
    if (!token) {
      setLoading(false)
      return
    }
    validateToken()
      .then(() => setLoading(false))
      .catch(() => {
        localStorage.removeItem('staff_token')
        localStorage.removeItem('staff_user')
        setUser(null)
        setLoading(false)
      })
  }, [])

  const login = useCallback((token, userData) => {
    localStorage.setItem('staff_token', token)
    localStorage.setItem('staff_user', JSON.stringify(userData))
    setUser(userData)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('staff_token')
    localStorage.removeItem('staff_user')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
