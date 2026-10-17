/**
 * 服务层：Web Audio 音效合成。
 *
 * 用振荡器实时合成短音，避免引入音频文件与额外请求。
 * 注意：浏览器自动播放策略要求 AudioContext 在用户首次交互后才能出声，
 * 因此由上层在第一次按键时调用 unlock()。
 */

import { AUDIO } from './config.js';

/**
 * 音效参数（对应 config.js 中 AUDIO 的一项）。
 * @typedef {Object} ToneSpec
 * @property {number} from 起始频率 Hz
 * @property {number} to 结束频率 Hz，与 from 相等则为平音
 * @property {number} duration 时长（秒）
 * @property {number} gain 峰值音量 0..1
 * @property {OscillatorType} type 波形
 */

/**
 * 音效控制器接口。
 * @typedef {Object} AudioController
 * @property {() => void} unlock 首次用户交互时调用，解锁 AudioContext
 * @property {(muted: boolean) => void} setMuted 切换静音
 * @property {() => void} playEat 吃食物
 * @property {() => void} playDie 死亡
 * @property {() => void} playStart 开始/重开
 */

/**
 * 创建音效控制器。
 * @returns {AudioController}
 */
export function createAudio() {
  /** @type {AudioContext|null} 懒创建，避免页面加载即被自动播放策略标记 */
  let ctx = null;
  let muted = false;

  /**
   * 取（必要时创建）AudioContext。
   * @returns {AudioContext|null} 环境不支持时返回 null
   */
  function ensureContext() {
    if (ctx) return ctx;
    if (typeof AudioContext === 'undefined') return null;
    ctx = new AudioContext();
    return ctx;
  }

  /**
   * 播放一个带包络的短音。
   * @param {ToneSpec} spec
   * @returns {void}
   */
  function play(spec) {
    if (muted) return;

    const ac = ensureContext();
    if (!ac) return;

    // 自动播放策略下 context 可能仍是 suspended。
    // 这里发起 resume 但不等待——resume 是异步的，等待只会让音效延迟；
    // 若解锁失败，声音自然丢失，不影响游戏流程。
    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }

    const { from, to, duration, gain, type } = spec;
    const t0 = ac.currentTime;

    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) {
      // 指数滑音听感比线性自然；但指数曲线要求频率为正，故下限兜到 1Hz
      osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + duration);
    }

    const amp = ac.createGain();
    const peak = gain * AUDIO.masterVolume;
    // 直接开关 gain 会在音头音尾产生爆音（click），
    // 故用「8ms 快速起音 + 指数衰减到近零」的最小包络。
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(amp).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);

    // 播完即断开，否则长局下来会在音频图里累积大量废弃节点
    osc.addEventListener('ended', () => {
      osc.disconnect();
      amp.disconnect();
    }, { once: true });
  }

  function unlock() {
    const ac = ensureContext();
    if (ac && ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
  }

  function setMuted(next) {
    muted = Boolean(next);
  }

  return {
    unlock,
    setMuted,
    playEat: () => play(AUDIO.eat),
    playDie: () => play(AUDIO.die),
    playStart: () => play(AUDIO.start),
  };
}
