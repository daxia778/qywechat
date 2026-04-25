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
  volume: 0.6,
  soundType: 'dingdong',
};

/** 音色预设定义 — 5 种音色 */
const SOUND_PRESETS = {
  dingdong: {
    label: '叮咚',
    desc: '经典门铃，两声清响',
    icon: 'bell-ring',
    play: (ctx, gain) => {
      [1319, 1047].forEach((freq, i) => {
        const t = ctx.currentTime + i * 0.18;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.6, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.15, t + 0.12);
        env.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
        osc.connect(env); env.connect(gain);
        osc.start(t); osc.stop(t + 0.4);
      });
    },
  },
  chord: {
    label: '和弦',
    desc: '大三和弦，温暖饱满',
    icon: 'music',
    play: (ctx, gain) => {
      [523, 659, 784].forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, ctx.currentTime);
        env.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.03);
        env.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.25);
        env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.connect(env); env.connect(gain);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.65);
      });
    },
  },
  droplet: {
    label: '水滴',
    desc: '清脆水珠，灵动跳跃',
    icon: 'droplets',
    play: (ctx, gain) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3000, ctx.currentTime);
      filter.Q.setValueAtTime(8, ctx.currentTime);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 0.005);
      env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.connect(filter); filter.connect(env); env.connect(gain);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    },
  },
  radar: {
    label: '脉冲',
    desc: '科技雷达，低沉有力',
    icon: 'radio',
    play: (ctx, gain) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.15);
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(300, ctx.currentTime + 0.22);
      osc2.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.28);
      osc2.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.38);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.01);
      env.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.15);
      env.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.22);
      env.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(env); osc2.connect(env); env.connect(gain);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      osc2.start(ctx.currentTime + 0.22); osc2.stop(ctx.currentTime + 0.55);
    },
  },
  triple: {
    label: '连响',
    desc: '急促三连，紧急提醒',
    icon: 'zap',
    play: (ctx, gain) => {
      for (let i = 0; i < 3; i++) {
        const t = ctx.currentTime + i * 0.1;
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1800, t);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.3, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.01, t + 0.06);
        osc.connect(filter); filter.connect(env); env.connect(gain);
        osc.start(t); osc.stop(t + 0.07);
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
      icon: val.icon,
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
