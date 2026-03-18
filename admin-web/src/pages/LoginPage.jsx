import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Eye, EyeOff, Loader2, ArrowRight, AlertCircle } from 'lucide-react';

/* ── 打字机循环 Hook ── */
function useTypewriter(text, typingSpeed = 200, pauseTime = 1500) {
  const [displayText, setDisplayText] = useState('');
  useEffect(() => {
    let i = 0;
    let direction = 1; // 1=打字, -1=删除
    let timer;
    const tick = () => {
      if (direction === 1) {
        i++;
        setDisplayText(text.slice(0, i));
        if (i === text.length) {
          direction = -1;
          timer = setTimeout(tick, pauseTime);
        } else {
          timer = setTimeout(tick, typingSpeed);
        }
      } else {
        i--;
        setDisplayText(text.slice(0, i));
        if (i === 0) {
          direction = 1;
          timer = setTimeout(tick, 500);
        } else {
          timer = setTimeout(tick, typingSpeed * 0.5);
        }
      }
    };
    timer = setTimeout(tick, 800);
    return () => clearTimeout(timer);
  }, [text, typingSpeed, pauseTime]);
  return displayText;
}

/* ── 数字递增 Hook ── */
function useCountUp(target, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [started, target, duration]);

  return value;
}

/* ── 数据卡片组件 ── */
function StatCard({ icon, value, suffix, label, color, rotate }) {
  const numericTarget = parseInt(value.replace(/[^0-9]/g, ''), 10) || 0;
  const prefix = value.match(/^[^0-9]*/)?.[0] || '';
  const count = useCountUp(numericTarget, 1400, 800);

  return (
    <div
      className="glass-card"
      data-text={label}
      style={{
        '--r': rotate,
      }}
    >
      {/* 图标 + 数字 */}
      <div className="flex flex-col items-center gap-5">
        <div className="glass-card-icon" style={{ backgroundColor: `${color}20` }}>
          <svg
            className="w-8 h-8"
            style={{ color }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </div>
        <p className="text-white font-bold tracking-tight tabular-nums leading-none" style={{ fontSize: '36px', fontFamily: "'Outfit', sans-serif" }}>
          {prefix}{count}{suffix}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const titleText = useTypewriter('接单协同，一站管控。', 180, 2000);

  const usernameRef = useRef(null);
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    const saved = localStorage.getItem('pdd_remember_username');
    if (saved) {
      setUsername(saved);
      setRememberMe(true);
    }
    usernameRef.current?.focus();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await login(username.trim(), password.trim());
      if (rememberMe) {
        localStorage.setItem('pdd_remember_username', username.trim());
      } else {
        localStorage.removeItem('pdd_remember_username');
      }
      navigate('/');
    } catch (err) {
      setErrorMsg(err.response?.data?.error || '账号或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex overflow-hidden">
      {/* ─── 左侧品牌区 ─── */}
      <div
        className="hidden lg:flex flex-col flex-1 relative overflow-hidden"
        style={{ backgroundColor: '#0a0a0f' }}
      >
        {/* 背景 SVG 水印 */}
        <svg
          className="absolute right-[-6%] top-[50%] opacity-[0.03] pointer-events-none select-none watermark-float"
          width="480" height="480" viewBox="0 0 100 100" fill="none" aria-hidden="true"
        >
          <rect x="8" y="8" width="84" height="84" rx="18" stroke="white" strokeWidth="2" />
          <text x="50" y="58" textAnchor="middle" fill="white" fontSize="32" fontWeight="600" fontFamily="Outfit, sans-serif">PD</text>
          <path d="M25 75 L50 85 L75 75" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <circle cx="50" cy="28" r="8" stroke="white" strokeWidth="1.5" fill="none" />
          <path d="M42 28 L50 36 L58 28" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>

        <div className="flex flex-col flex-1 justify-start px-12 xl:px-10 pt-[15vh] relative z-10">
          {/* 标语主卡片 */}
          <div className="tagline-card border border-white/[0.08] rounded-xl p-8 xl:p-10 mb-4 stagger-1">
            <h1 className="text-white text-[3.75rem] xl:text-[4.0rem] font-semibold leading-[1.08] tracking-tight mb-3 whitespace-nowrap">
              {titleText}<span className="typewriter-cursor">|</span>
            </h1>
            <p className="text-white/30 text-[17px] leading-relaxed">
              从客服录单到设计交付，全流程自动化。让每一笔订单清晰透明。
            </p>
          </div>

          {/* 三个数据卡片 — 玻璃扇形 */}
          <div className="stagger-2">
            <div className="glass-container">
            <StatCard
              icon={<>
                {/* 订单面板 — 精致剪贴板 */}
                <rect x="5" y="4" width="14" height="17" rx="2" />
                <path d="M9 2h6a1 1 0 011 1v1H8V3a1 1 0 011-1z" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="9" y1="13" x2="13" y2="13" />
                <line x1="9" y1="16" x2="11" y2="16" />
                <path d="M15.5 15.5l1.5 1.5 3-3" />
              </>}
              value="100"
              suffix="+"
              label="日均订单处理"
              color="#818cf8"
              rotate={-15}
            />
            <StatCard
              icon={<>
                {/* 速度仪表 — 精致闪电+时钟 */}
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
                <path d="M12 7v1" />
                <path d="M12 16v1" />
                <path d="M7 12h1" />
                <path d="M16 12h1" />
                <path d="M8.46 8.46l.71.71" />
                <path d="M14.83 14.83l.71.71" />
                <path d="M14.83 9.17l.71-.71" />
                <path d="M8.46 15.54l.71-.71" />
                <path d="M12 12l2.5-3.5" />
              </>}
              value="<3"
              suffix="s"
              label="OCR 识别速度"
              color="#34d399"
              rotate={5}
            />
            <StatCard
              icon={<>
                {/* 安全盾牌 — 精致锁盾 */}
                <path d="M12 2l8 4v5c0 5.25-3.5 10.74-8 12-4.5-1.26-8-6.75-8-12V6l8-4z" />
                <circle cx="12" cy="11" r="2" />
                <path d="M12 13v2.5" />
                <path d="M10 9.67A2 2 0 0112 9a2 2 0 012 .67" />
              </>}
              value="100"
              suffix="%"
              label="金额防篡改"
              color="#fbbf24"
              rotate={25}
            />
            </div>
          </div>

          {/* 底部版权 — pl 与标语卡片内边距对齐 */}
          <p className="text-white/20 text-xs mt-23 pl-8 xl:pl-10 copyright-fade">
            &copy; {new Date().getFullYear()} PDD 派单系统 &middot; 企业微信深度集成
          </p>
        </div>
      </div>

      {/* ─── 右侧登录区 ─── */}
      <div className="w-full lg:w-[460px] xl:w-[480px] flex flex-col bg-white">
        {/* 移动端 Logo */}
        <div className="lg:hidden flex items-center gap-2.5 px-6 pt-6 pb-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: '#4f46e5' }}>
            <span className="text-white font-semibold text-xs">PD</span>
          </div>
          <span className="text-slate-900 text-sm font-semibold">PDD 企微中控</span>
        </div>

        {/* 表单居中 */}
        <div className="flex-1 flex items-center justify-center px-8 sm:px-10 lg:px-12">
          <div className="w-full max-w-[320px]">
            <h2 className="text-slate-900 text-2xl font-semibold tracking-tight mb-1.5">
              欢迎回来
            </h2>
            <p className="text-slate-400 text-[13px] mb-8">
              使用管理员账号登录系统
            </p>

            {/* 错误 */}
            {errorMsg && (
              <div className="flex items-center gap-2 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleLogin}>
              {/* 账号 */}
              <div className="mb-4">
                <label htmlFor="username" className="block text-[13px] font-medium text-slate-600 mb-1.5">
                  账号
                </label>
                <input
                  ref={usernameRef}
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="管理员账号"
                  autoComplete="username"
                  className="login-input"
                />
              </div>

              {/* 密码 */}
              <div className="mb-4">
                <label htmlFor="password" className="block text-[13px] font-medium text-slate-600 mb-1.5">
                  密码
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入密码"
                    autoComplete="current-password"
                    className="login-input"
                    style={{ paddingRight: '36px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-300 hover:text-slate-500 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 记住我 */}
              <label className="flex items-center gap-2 cursor-pointer select-none mb-5">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-3.5 h-3.5 rounded-sm border transition-colors flex items-center justify-center ${rememberMe ? 'bg-slate-900 border-slate-900' : 'border-slate-300'
                    }`}
                >
                  {rememberMe && (
                    <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-[13px] text-slate-500">记住账号</span>
              </label>

              {/* 登录按钮 */}
              <button type="submit" disabled={loading} className="login-btn group">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>验证中</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <span>登录</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </button>
            </form>

            <p className="text-center text-slate-300 text-[11px] mt-6">
              TLS 加密 &middot; 安全连接
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
