import { useCallback, useRef, useEffect, useState } from 'react'

const STORAGE_KEY = 'pdd_sound_muted'
const SOUND_KEY = 'pdd_sound_type'
const VOLUME_KEY = 'pdd_sound_volume'

// ─── 模块级单例 AudioContext ───
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
let audioUnlocked = false

function initAudioOnUserGesture() {
  if (audioUnlocked) return
  const unlock = () => {
    audioUnlocked = true
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    document.removeEventListener('click', unlock)
    document.removeEventListener('touchstart', unlock)
  }
  document.addEventListener('click', unlock, { once: true })
  document.addEventListener('touchstart', unlock, { once: true })
}

// ─── 基础音频工具 ───

function playTone(frequency, duration, volume, type = 'sine', delay = 0) {
  try {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.type = type
    osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay)
    gain.gain.setValueAtTime(volume, ctx.currentTime + delay)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration)

    osc.start(ctx.currentTime + delay)
    osc.stop(ctx.currentTime + delay + duration)
  } catch {
    // 静默失败
  }
}

function playChord(frequencies, duration, volume, type = 'sine', delay = 0) {
  frequencies.forEach(f => playTone(f, duration, volume / frequencies.length, type, delay))
}

// ─── 通知音效库 ───
// 每种音效有 normal 和 urgent 两个变体

const SOUND_PRESETS = {
  // 1. 清脆铃铛 — 高频三和弦，像门铃
  chime: {
    label: '清脆铃铛',
    normal: (vol) => {
      playChord([523, 659, 784], 0.4, vol)       // C5 E5 G5 和弦
      playChord([659, 784, 1047], 0.5, vol, 'sine', 0.25) // E5 G5 C6
    },
    urgent: (vol) => {
      for (let i = 0; i < 3; i++) {
        playChord([784, 988, 1175], 0.3, vol, 'sine', i * 0.35)
      }
    },
  },

  // 2. 消息气泡 — 像微信/iMessage 的短促上升音
  bubble: {
    label: '消息气泡',
    normal: (vol) => {
      playTone(600, 0.08, vol, 'sine')
      playTone(900, 0.12, vol, 'sine', 0.08)
      playTone(1200, 0.18, vol * 0.8, 'sine', 0.16)
    },
    urgent: (vol) => {
      for (let i = 0; i < 2; i++) {
        const d = i * 0.4
        playTone(600, 0.08, vol, 'sine', d)
        playTone(900, 0.12, vol, 'sine', d + 0.08)
        playTone(1200, 0.18, vol * 0.8, 'sine', d + 0.16)
      }
    },
  },

  // 3. 企业钟声 — 低沉有力，像 Slack/Teams 通知
  bell: {
    label: '企业钟声',
    normal: (vol) => {
      playTone(440, 0.6, vol, 'sine')            // A4
      playTone(880, 0.5, vol * 0.5, 'sine')       // A5 泛音
      playTone(554, 0.5, vol * 0.7, 'sine', 0.15) // C#5
    },
    urgent: (vol) => {
      playTone(440, 0.3, vol, 'sine')
      playTone(554, 0.3, vol, 'sine', 0.3)
      playTone(440, 0.3, vol, 'sine', 0.6)
      playTone(554, 0.3, vol, 'sine', 0.9)
    },
  },

  // 4. 电子脉冲 — 科技感，像仪表盘告警
  pulse: {
    label: '电子脉冲',
    normal: (vol) => {
      playTone(800, 0.15, vol, 'square')
      playTone(1000, 0.15, vol * 0.8, 'square', 0.18)
    },
    urgent: (vol) => {
      for (let i = 0; i < 4; i++) {
        playTone(1000, 0.1, vol, 'square', i * 0.15)
      }
      playTone(1400, 0.2, vol, 'square', 0.6)
    },
  },

  // 5. 木琴旋律 — 柔和悦耳的下降三音
  marimba: {
    label: '木琴旋律',
    normal: (vol) => {
      playTone(1047, 0.25, vol, 'sine')           // C6
      playTone(784, 0.25, vol * 0.9, 'sine', 0.15) // G5
      playTone(523, 0.4, vol * 0.8, 'sine', 0.30)  // C5
    },
    urgent: (vol) => {
      for (let i = 0; i < 2; i++) {
        const d = i * 0.5
        playTone(1047, 0.15, vol, 'sine', d)
        playTone(1319, 0.15, vol, 'sine', d + 0.12)
        playTone(1568, 0.2, vol, 'sine', d + 0.24)
      }
    },
  },

  // 6. 经典叮咚 — 最简约的两音提示
  ding: {
    label: '经典叮咚',
    normal: (vol) => {
      playTone(880, 0.3, vol, 'sine')
      playTone(1320, 0.4, vol * 0.8, 'sine', 0.2)
    },
    urgent: (vol) => {
      for (let i = 0; i < 3; i++) {
        playTone(880, 0.2, vol, 'sine', i * 0.3)
        playTone(1320, 0.2, vol * 0.8, 'sine', i * 0.3 + 0.12)
      }
    },
  },
}

export const SOUND_OPTIONS = Object.entries(SOUND_PRESETS).map(([key, { label }]) => ({
  value: key,
  label,
}))

export const DEFAULT_SOUND = 'chime'
export const DEFAULT_VOLUME = 0.6

function safeVolume(raw) {
  const v = parseFloat(raw)
  return Number.isFinite(v) ? v : DEFAULT_VOLUME
}

export function previewSound(soundKey, type = 'normal', volume) {
  const preset = SOUND_PRESETS[soundKey]
  if (!preset) return
  const vol = volume != null ? volume : safeVolume(localStorage.getItem(VOLUME_KEY))
  preset[type](vol)
}

export default function useAudioAlert() {
  const mutedRef = useRef(localStorage.getItem(STORAGE_KEY) === 'true')
  const soundRef = useRef(localStorage.getItem(SOUND_KEY) || DEFAULT_SOUND)
  const volumeRef = useRef(safeVolume(localStorage.getItem(VOLUME_KEY)))
  const lastPlayRef = useRef(0)

  const [muted, _setMuted] = useState(mutedRef.current)
  const [soundType, _setSoundType] = useState(soundRef.current)
  const [volume, _setVolume] = useState(volumeRef.current)

  useEffect(() => {
    initAudioOnUserGesture()
  }, [])

  // 跨标签页同步
  useEffect(() => {
    const handler = (e) => {
      if (e.key === STORAGE_KEY) {
        const v = e.newValue === 'true'
        mutedRef.current = v
        _setMuted(v)
      }
      if (e.key === SOUND_KEY && e.newValue) {
        soundRef.current = e.newValue
        _setSoundType(e.newValue)
      }
      if (e.key === VOLUME_KEY && e.newValue) {
        const n = parseFloat(e.newValue)
        volumeRef.current = n
        _setVolume(n)
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const isMuted = useCallback(() => mutedRef.current, [])

  const setMuted = useCallback((val) => {
    mutedRef.current = val
    _setMuted(val)
    localStorage.setItem(STORAGE_KEY, String(val))
  }, [])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    setMuted(next)
    if (!next) {
      // 解除静音时播放一声确认
      playTone(660, 0.15, 0.3)
    }
    return next
  }, [setMuted])

  const setSoundType = useCallback((type) => {
    if (!SOUND_PRESETS[type]) return
    soundRef.current = type
    _setSoundType(type)
    localStorage.setItem(SOUND_KEY, type)
  }, [])

  const setVolume = useCallback((vol) => {
    const v = Math.max(0, Math.min(1, vol))
    volumeRef.current = v
    _setVolume(v)
    localStorage.setItem(VOLUME_KEY, String(v))
  }, [])

  // 播放提示音（防抖 2 秒）
  const play = useCallback((type = 'normal') => {
    if (mutedRef.current) return
    const now = Date.now()
    if (now - lastPlayRef.current < 2000) return
    lastPlayRef.current = now

    const preset = SOUND_PRESETS[soundRef.current] || SOUND_PRESETS[DEFAULT_SOUND]
    const variant = type === 'urgent' ? 'urgent' : 'normal'
    preset[variant](volumeRef.current)
  }, [])

  return {
    play,
    isMuted,
    muted,
    setMuted,
    toggleMute,
    soundType,
    setSoundType,
    volume,
    setVolume,
  }
}
