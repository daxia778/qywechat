import { useCallback, useRef, useEffect } from 'react'

const STORAGE_KEY = 'pdd_sound_muted'

// 模块级单例 AudioContext，避免每次 playTone 创建新实例（浏览器限制约 6 个）
let sharedCtx = null

function getAudioContext() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume()
  }
  return sharedCtx
}

// 在首次用户交互时解锁 AudioContext（移动端 autoplay policy）
function initAudioOnUserGesture() {
  const unlock = () => {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    document.removeEventListener('click', unlock)
    document.removeEventListener('touchstart', unlock)
  }
  document.addEventListener('click', unlock, { once: true })
  document.addEventListener('touchstart', unlock, { once: true })
}

function playTone(frequency = 880, duration = 0.15, volume = 0.3) {
  try {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {
    // 浏览器不支持或用户未交互，静默失败
  }
}

// 双音提示（更醒目）
function playDoubleBeep() {
  playTone(880, 0.12, 0.3)
  setTimeout(() => playTone(1100, 0.15, 0.3), 160)
}

// 紧急三连音
function playUrgentBeep() {
  playTone(1000, 0.1, 0.4)
  setTimeout(() => playTone(1200, 0.1, 0.4), 140)
  setTimeout(() => playTone(1400, 0.15, 0.4), 280)
}

export default function useAudioAlert() {
  const mutedRef = useRef(localStorage.getItem(STORAGE_KEY) === 'true')
  const lastPlayRef = useRef(0)

  // 首次挂载时注册用户手势解锁
  useEffect(() => {
    initAudioOnUserGesture()
  }, [])

  // 同步 muted 状态到 ref
  useEffect(() => {
    const handler = () => {
      mutedRef.current = localStorage.getItem(STORAGE_KEY) === 'true'
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const isMuted = useCallback(() => mutedRef.current, [])

  const setMuted = useCallback((val) => {
    mutedRef.current = val
    localStorage.setItem(STORAGE_KEY, String(val))
  }, [])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    setMuted(next)
    // 开启声音时播放一声确认
    if (!next) playTone(660, 0.1, 0.2)
    return next
  }, [setMuted])

  // 播放提示音（防抖 2 秒，避免短时间密集响铃）
  const play = useCallback((type = 'normal') => {
    if (mutedRef.current) return
    const now = Date.now()
    if (now - lastPlayRef.current < 2000) return
    lastPlayRef.current = now

    if (type === 'urgent') {
      playUrgentBeep()
    } else {
      playDoubleBeep()
    }
  }, [])

  return { play, isMuted, setMuted, toggleMute }
}
