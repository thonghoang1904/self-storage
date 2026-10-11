import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { homeFor } from '../types'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const user = await login(username, password)
      navigate(homeFor(user.role))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="auth card stack" onSubmit={submit}>
      <h2>Đăng nhập</h2>
      <input placeholder="Tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      <input placeholder="Mật khẩu" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button className="btn primary" type="submit">Đăng nhập</button>
      <p className="muted">Chưa có tài khoản? <Link to="/register">Đăng ký</Link></p>
    </form>
  )
}

export function Register() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '', fullName: '', email: '', phoneNumber: '', citizenId: '' })
  const [error, setError] = useState('')
  const field = (key: keyof typeof form, placeholder: string, type = 'text') => (
    <input placeholder={placeholder} type={type} value={form[key]} required
      onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/api/auth/register', { body: form })
      await login(form.username, form.password)
      navigate('/rent')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="auth card stack" onSubmit={submit}>
      <h2>Đăng ký thuê kho</h2>
      {field('fullName', 'Họ tên')}
      {field('citizenId', 'Số CCCD (nhân viên sẽ đối chiếu khi bạn vào kho)')}
      {field('phoneNumber', 'Số điện thoại')}
      {field('email', 'Email', 'email')}
      {field('username', 'Tên đăng nhập')}
      {field('password', 'Mật khẩu (ít nhất 8 ký tự)', 'password')}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" type="submit">Đăng ký</button>
    </form>
  )
}
