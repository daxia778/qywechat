/**
 * Notification Sound Engine — Web Audio API 音效合成
 *
 * 设计思路:
 * - 使用纯 Web Audio API 合成提示音，不依赖任何外部音频文件
 * - 3 种音色预设 + 音量控制 + 开关
 * - 偏好持久化到 localStorage
 * - 防连发: 500ms 内不重复播放
 */

const STORAGE_KEY = 'pdd_notif_sound_prefs';

/** 默认偏好设定 */
const DEFAULT_PREFS = {
  enabled: true,
  volume: 0.6,     // 0-1
  soundType: 'crystal', // 'crystal' | 'gentle' | 'alert'
};

/** 音色预设定义 */
const SOUND_PRESETS = {
  crystal: {
    label: '清脆',
    desc: '水晶铃声，清亮悦耳',
    play: (ctx, gain) => {
      // 双音叠加 — C6 + E6 快闪
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(1047, ctx.currentTime);  // C6
      osc2.frequency.setValueAtTime(1319, ctx.currentTime);  // E6
      osc1.frequency.exponentialRampToValueAtTime(1568, ctx.currentTime + 0.08); // G6
      osc2.frequency.exponentialRampToValueAtTime(2093, ctx.currentTime + 0.08); // C7

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 0.015);
      env.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.08);
      env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

      osc1.connect(env);
      osc2.connect(env);
      env.connect(gain);
      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);
    },
  },
  gentle: {
    label: '柔和',
    desc: '轻柔提示，不打扰工作',
    play: (ctx, gain) => {
      // 柔和正弦波 — 低频暖音
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523, ctx.currentTime);  // C5
      osc.frequency.exponentialRampToValueAtTime(659, ctx.currentTime + 0.15); // E5

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, ctx.currentTime);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.04);
      env.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.15);
      env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      osc.connect(filter);
      filter.connect(env);
      env.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.55);
    },
  },
  alert: {
    label: '急促',
    desc: '双响短促，紧急提醒',
    play: (ctx, gain) => {
      // 双响急促 — 两下短 beep
      for (let i = 0; i < 2; i++) {
        const offset = i * 0.12;
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, ctx.currentTime + offset);  // A5

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, ctx.currentTime + offset);

        const env = ctx.createGain();
        env.gain.setValueAtTime(0, ctx.currentTime + offset);
        env.gain.linearRampToValueAtTime(0.35, ctx.currentTime + offset + 0.01);
        env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.08);

        osc.connect(filter);
        filter.connect(env);
        env.connect(gain);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.1);
      }
    },
  },
};

class NotificationSoundEngine {
  constructor() {
    this._ctx = null;
    this._lastPlayTime = 0;
    this._prefs = this._loadPrefs();
  }

  /** 获取/延迟创建 AudioContext（需要用户交互后才能创建） */
  _getContext() {
    if (!this._ctx) {
      try {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        console.warn('[NotifSound] Web Audio API not available');
        return null;
      }
    }
    // Resume if suspended (autoplay policy)
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  }

  _loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_PREFS };
  }

  _savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._prefs));
    } catch { /* ignore */ }
  }

  /** 获取当前偏好 */
  getPrefs() {
    return { ...this._prefs };
  }

  /** 设置偏好 */
  setPrefs(updates) {
    this._prefs = { ...this._prefs, ...updates };
    this._savePrefs();
  }

  /** 获取所有可选音色 */
  getSoundTypes() {
    return Object.entries(SOUND_PRESETS).map(([key, val]) => ({
      key,
      label: val.label,
      desc: val.desc,
    }));
  }

  /**
   * 播放通知音
   * @param {Object} options
   * @param {boolean} options.force - 忽略 enabled 设置强制播放（用于试听）
   * @param {string} options.type - 指定音色（覆盖偏好设置）
   */
  play(options = {}) {
    const { force = false, type } = options;

    // 检查是否启用
    if (!force && !this._prefs.enabled) return;

    // 防连发
    const now = Date.now();
    if (now - this._lastPlayTime < 500) return;
    this._lastPlayTime = now;

    const ctx = this._getContext();
    if (!ctx) return;

    const soundType = type || this._prefs.soundType;
    const preset = SOUND_PRESETS[soundType];
    if (!preset) return;

    try {
      // Master gain
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this._prefs.volume, ctx.currentTime);
      masterGain.connect(ctx.destination);

      preset.play(ctx, masterGain);
    } catch (err) {
      console.warn('[NotifSound] Play failed:', err);
    }
  }

  /**
   * 试听指定音色
   */
  preview(type) {
    this.play({ force: true, type });
  }
}

/** 单例 */
const notificationSound = new NotificationSoundEngine();
export default notificationSound;
export { SOUND_PRESETS };
