import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { deviceLogin } from '../api/auth'
import { Loader2, ArrowRight, AlertCircle, Palette, MessageSquare, HeartHandshake, CheckCircle2 } from 'lucide-react'

/* ── 打字机循环 Hook ── */
function useTypewriter(texts, typingSpeed = 120, pauseTime = 2000) {
  const [displayText, setDisplayText] = useState('')
  const [textIndex, setTextIndex] = useState(0)

  useEffect(() => {
    const text = texts[textIndex]
    let i = 0
    let direction = 1
    let timer

    const tick = () => {
      if (direction === 1) {
        i++
        setDisplayText(text.slice(0, i))
        if (i === text.length) {
          direction = -1
          timer = setTimeout(tick, pauseTime)
        } else {
          timer = setTimeout(tick, typingSpeed)
        }
      } else {
        i--
        setDisplayText(text.slice(0, i))
        if (i === 0) {
          setTextIndex((prev) => (prev + 1) % texts.length)
          direction = 1
          timer = setTimeout(tick, 400)
        } else {
          timer = setTimeout(tick, typingSpeed * 0.4)
        }
      }
    }
    timer = setTimeout(tick, 600)
    return () => clearTimeout(timer)
  }, [texts, textIndex, typingSpeed, pauseTime])

  return displayText
}

/* ── 角色配置（不暴露佣金比例） ── */
const ROLES = [
  {
    id: 'designer',
    label: '设计师',
    desc: '接单设计，交付作品',
    icon: Palette,
    color: '#F97316',
    bgColor: 'rgba(249, 115, 22, 0.15)',
    className: 'role-designer',
  },
  {
    id: 'sales',
    label: '谈单客服',
    desc: '对接客户，促成下单',
    icon: MessageSquare,
    color: '#3B82F6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
    className: 'role-sales',
  },
  {
    id: 'follow',
    label: '跟单客服',
    desc: '售后跟进，安抚客户',
    icon: HeartHandshake,
    color: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.15)',
    className: 'role-follow',
  },
]

export default function LoginPage() {
  const [activationCode, setActivationCode] = useState('')
  const [selectedRole, setSelectedRole] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const { login } = useAuth()
  const toast = useToast()

  const titleText = useTypewriter(
    ['接单高效，协同无间。', '设计协同，一目了然。', '专属工作台，为你而建。'],
    100,
    2200
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 生成设备指纹（machine_id），用于设备绑定
  // 测试环境：激活码首次使用会绑定此指纹，后续同一台机器可免码登录
  // 如需重新测试不同员工，请在管理后台「激活码管理」页解绑设备
  const getMachineId = () => {
    // 优先从 localStorage 读取固定 ID（保证同一浏览器指纹一致）
    const stored = localStorage.getItem('staff_machine_id')
    if (stored) return stored
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillText('pdd-staff-fp', 2, 2)
    const fp = canvas.toDataURL().slice(-50)
    const ua = navigator.userAgent
    const scr = `${window.screen.width}x${window.screen.height}`
    const id = btoa(`${fp}|${ua}|${scr}`).slice(0, 32)
    localStorage.setItem('staff_machine_id', id)
    return id
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!activationCode.trim()) {
      setErrorMsg('请输入激活码')
      return
    }
    if (!selectedRole) {
      setErrorMsg('请选择你的角色')
      return
    }

    setLoading(true)
    setErrorMsg('')

    try {
      const machineId = getMachineId()
      const res = await deviceLogin(activationCode.trim(), machineId)
      // 后端返回: { token, employee_name, wecom_userid }
      const { token, employee_name, wecom_userid } = res.data

      login(token, {
        name: employee_name,
        wecom_userid,
        staffRole: selectedRole,
      })

      toast.success(`欢迎回来，${employee_name}`)
      navigate('/')
    } catch (err) {
      const msg = err.response?.data?.error || '激活码无效或设备不匹配'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row overflow-hidden" style={{ backgroundColor: '#0a0a0f' }}>
      {/* ─── 左侧品牌区 ─── */}
      <div className="hidden lg:flex flex-col flex-1 relative overflow-hidden">
        {/* 背景粒子 */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${15 + i * 14}%`,
              top: `${20 + (i % 3) * 25}%`,
              animationDelay: `${i * 1.2}s`,
              animationDuration: `${6 + i * 1.5}s`,
            }}
          />
        ))}

        {/* 背景 SVG 水印 */}
        <svg
          className="absolute right-[-6%] top-[50%] opacity-[0.03] pointer-events-none select-none watermark-float"
          width="480" height="480" viewBox="0 0 100 100" fill="none" aria-hidden="true"
        >
          <rect x="8" y="8" width="84" height="84" rx="18" stroke="white" strokeWidth="2" />
          <text x="50" y="56" textAnchor="middle" fill="white" fontSize="28" fontWeight="600" fontFamily="Outfit, sans-serif">Staff</text>
          <circle cx="50" cy="28" r="8" stroke="white" strokeWidth="1.5" fill="none" />
          <path d="M42 28 L50 36 L58 28" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>

        <div className="flex flex-col flex-1 justify-start px-12 xl:px-16 pt-[15vh] relative z-10">
          {/* 标语 */}
          <div className="tagline-card border border-white/[0.08] rounded-xl p-8 xl:p-10 mb-10 stagger-1">
            <h1 className="text-white text-[3rem] xl:text-[3.5rem] font-semibold leading-[1.1] tracking-tight mb-3">
              {titleText}<span className="typewriter-cursor">|</span>
            </h1>
            <p className="text-white/30 text-[16px] leading-relaxed">
              客服 & 设计师专属工作台，实时查看订单、高效协同。
            </p>
          </div>

          {/* 功能亮点 */}
          <div className="stagger-2 grid grid-cols-3 gap-5">
            {[
              { icon: '📋', title: '订单大厅', desc: '实时查看所有可接订单' },
              { icon: '📊', title: '我的工作', desc: '跟踪负责的订单进度' },
              { icon: '🔔', title: '消息通知', desc: '状态变更即时提醒' },
            ].map((item) => (
              <div key={item.title} className="border border-white/[0.06] rounded-xl p-5 bg-white/[0.02]">
                <div className="text-2xl mb-3">{item.icon}</div>
                <h3 className="text-white font-medium text-[14px] mb-1">{item.title}</h3>
                <p className="text-white/30 text-[12px] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* 底部版权 */}
          <p className="text-white/20 text-xs mt-auto pb-8 pl-1 copyright-fade">
            &copy; {new Date().getFullYear()} 单管家 &middot; 客服工作台
          </p>
        </div>
      </div>

      {/* ─── 右侧登录区 ─── */}
      <div className="w-full lg:w-[480px] xl:w-[500px] flex flex-col relative"
        style={{ background: 'linear-gradient(180deg, #111118 0%, #0d0d14 100%)' }}
      >
        {/* 顶部装饰线 */}
        <div className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, transparent, #F97316, transparent)' }}
        />

        {/* 移动端标题 */}
        <div className="lg:hidden flex items-center gap-2.5 px-6 pt-6 pb-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br from-orange-500 to-orange-700">
            <span className="text-white font-semibold text-xs">DG</span>
          </div>
          <span className="text-white text-sm font-bold tracking-tight">单管家 · 客服工作台</span>
        </div>

        {/* 表单居中 */}
        <div className="flex-1 flex items-center justify-center px-8 sm:px-10 lg:px-12">
          <div className="w-full max-w-[360px]">
            {/* 标题 */}
            <div className="mb-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 border border-white/[0.08]"
                style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(234,88,12,0.1))' }}
              >
                <svg className="w-6 h-6 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
              </div>
              <h2 className="text-white text-[28px] font-bold tracking-tight mb-1.5 font-[Outfit]">
                登录工作台
              </h2>
              <p className="text-white/35 text-[14px]">
                使用激活码登录你的客服 / 设计师工作台
              </p>
            </div>

            {/* 错误提示 */}
            {errorMsg && (
              <div className="flex items-center gap-2 text-[13px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 mb-5 animate-fade-in-up">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleLogin}>
              {/* 角色选择 */}
              <div className="mb-5">
                <label className="block text-[13px] font-medium text-white/50 mb-3">
                  选择你的角色
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {ROLES.map((role) => {
                    const Icon = role.icon
                    const isSelected = selectedRole === role.id
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          setSelectedRole(role.id)
                          setErrorMsg('')
                        }}
                        className={`relative flex flex-col items-center gap-2.5 py-4 px-2 rounded-xl border-2 transition-all duration-200 ${
                          isSelected
                            ? 'border-opacity-100 scale-[1.02]'
                            : 'border-white/[0.08] hover:border-white/[0.15]'
                        }`}
                        style={{
                          borderColor: isSelected ? role.color : undefined,
                          background: isSelected
                            ? `linear-gradient(135deg, ${role.color}15, ${role.color}08)`
                            : 'rgba(255,255,255,0.03)',
                        }}
                      >
                        {isSelected && (
                          <CheckCircle2
                            className="absolute top-1.5 right-1.5 w-3.5 h-3.5"
                            style={{ color: role.color }}
                          />
                        )}
                        <Icon className="w-5 h-5" style={{ color: isSelected ? role.color : 'rgba(255,255,255,0.4)' }} />
                        <span className={`text-[12px] font-medium ${isSelected ? 'text-white' : 'text-white/40'}`}>
                          {role.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 激活码 */}
              <div className="mb-5">
                <label htmlFor="code" className="block text-[13px] font-medium text-white/50 mb-1.5">
                  激活码
                </label>
                <input
                  ref={inputRef}
                  id="code"
                  type="text"
                  value={activationCode}
                  onChange={(e) => {
                    setActivationCode(e.target.value.toUpperCase())
                    setErrorMsg('')
                  }}
                  placeholder="输入你的激活码"
                  autoComplete="off"
                  spellCheck={false}
                  className="login-input tracking-[0.15em] text-center font-mono"
                />
              </div>

              {/* 登录按钮 */}
              <button type="submit" disabled={loading} className="login-btn group">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>验证中</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <span>进入工作台</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </button>
            </form>

            {/* 底部提示 */}
            <div className="mt-6 text-center">
              <p className="text-white/20 text-[11px]">
                激活码由管理员分配 &middot; 设备绑定验证
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
