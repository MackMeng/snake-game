/**
 * audio.js 行为测试。
 *
 * Node 里没有音频硬件，故用假的 AudioContext 验证控制流：
 * 懒创建、静音短路、suspended 自动恢复、环境不支持时静默。
 * 音色本身无法自动化验证，只能人工试听。
 * 运行：node tests/audio.test.mjs
 */

import { createAudio } from '../js/audio.js';
import { createTest } from './harness.mjs';

const t = createTest();

/** 统计 AudioContext 创建次数，用于验证懒创建 */
let created = 0;
/** 统计 resume 调用次数 */
let resumed = 0;
/** 记录 oscillator 的 start/stop 调用 */
const timeline = [];

/**
 * 假 AudioContext，仅实现 audio.js 用到的部分。
 * @param {string} initialState
 */
function makeFakeContext(initialState = 'running') {
  return class FakeAudioContext {
    constructor() {
      created += 1;
      this.state = initialState;
      this.currentTime = 0;
      this.destination = { name: 'destination' };
    }

    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect: (node) => node,
        start: (at) => timeline.push(['start', at]),
        stop: (at) => timeline.push(['stop', at]),
        disconnect() {},
        addEventListener() {},
      };
    }

    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect: (node) => node,
        disconnect() {},
      };
    }

    resume() {
      resumed += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  };
}

// ---------- 懒创建 ----------

globalThis.AudioContext = makeFakeContext();

const audio = createAudio();
t.equal('构造时不创建 AudioContext', created, 0);

audio.playEat();
audio.playDie();
audio.playStart();
t.equal('三次播放只创建一个 AudioContext', created, 1);
t.equal('每次播放成对调用 start/stop', timeline.length, 6);
t.equal('stop 晚于 start', timeline[1][1] > timeline[0][1], true);

// ---------- 静音 ----------

created = 0;
const muted = createAudio();
muted.setMuted(true);
muted.playEat();
muted.playDie();
muted.playStart();
t.equal('静音时不创建 AudioContext', created, 0);

muted.setMuted(false);
muted.playEat();
t.equal('取消静音后恢复播放', created, 1);

// ---------- suspended 自动恢复 ----------

globalThis.AudioContext = makeFakeContext('suspended');
resumed = 0;
createAudio().playEat();
t.equal('suspended 时触发一次 resume', resumed, 1);

// ---------- 环境不支持 ----------

delete globalThis.AudioContext;
const unsupported = createAudio();
t.noThrow('无 AudioContext 时 playEat 不抛错', () => unsupported.playEat());
t.noThrow('无 AudioContext 时 playDie 不抛错', () => unsupported.playDie());
t.noThrow('无 AudioContext 时 playStart 不抛错', () => unsupported.playStart());
t.noThrow('无 AudioContext 时 unlock 不抛错', () => unsupported.unlock());
t.noThrow('无 AudioContext 时 setMuted 不抛错', () => unsupported.setMuted(true));

t.finish('audio');
