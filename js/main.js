/**
 * 入口模块：装配依赖、更新 DOM、启动游戏。
 *
 * 这里是唯一持有 DOM 引用的模块；其余模块通过注入的回调与它交互。
 * 本身不含游戏规则，只负责把 game 的状态翻译成界面文案。
 */

import { GameState } from './config.js';
import { createRenderer } from './renderer.js';
import { createAudio } from './audio.js';
import { createGame } from './game.js';
import { bindInput } from './input.js';
import { loadBestScore, saveBestScore, loadMuted, saveMuted } from './storage.js';

// ---------- DOM 引用 ----------

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
const scoreEl = el('score');
const bestEl = el('best');
const levelEl = el('level');
const muteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('mute'));
const overlayEl = el('overlay');
const overlayTitleEl = el('overlay-title');
const overlayTextEl = el('overlay-text');

// ---------- 服务层实例 ----------

const renderer = createRenderer(canvas);
const audio = createAudio();

// ---------- 音效开关 ----------

let muted = loadMuted();

/** 把静音状态同步到音频控制器与按钮外观 */
function applyMuted() {
  audio.setMuted(muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
}

applyMuted();

muteBtn.addEventListener('click', () => {
  muted = !muted;
  saveMuted(muted);
  applyMuted();
  // 切到「开」时给一次即时反馈，否则用户听不出变化
  if (!muted) audio.playStart();
});

// ---------- 遮罩层 ----------

/** @type {ReturnType<typeof setTimeout> | null} */
let overlayTimer = null;

/**
 * @param {string} title
 * @param {string} text
 * @param {boolean} danger 标题是否使用警示色
 */
function showOverlay(title, text, danger = false) {
  overlayTitleEl.textContent = title;
  overlayTextEl.textContent = text;
  overlayTitleEl.classList.toggle('overlay__title--danger', danger);
  overlayEl.hidden = false;
}

function hideOverlay() {
  overlayEl.hidden = true;
}

/** 破纪录时重播一次放大动画（先移除再强制重排，否则同一个类不会重新触发） */
function flashRecord() {
  bestEl.classList.remove('hud__value--record');
  void bestEl.offsetWidth;
  bestEl.classList.add('hud__value--record');
}

/**
 * 根据状态更新遮罩文案。
 * @param {{state: string, score: number, best: number, isNewRecord: boolean, won: boolean}} data
 */
function applyState(data) {
  const { state, score, best, isNewRecord, won } = data;

  if (state === GameState.READY) {
    showOverlay('贪吃蛇', '按 Enter 开始');
    return;
  }

  if (state === GameState.PLAYING) {
    hideOverlay();
    return;
  }

  if (state === GameState.PAUSED) {
    showOverlay('已暂停', '按空格继续');
    return;
  }

  // GAME_OVER
  if (isNewRecord) flashRecord();
  showOverlay(
    won ? '通关！' : '游戏结束',
    isNewRecord
      ? `新纪录 ${score} 分 · 按 Enter 重开`
      : `本局 ${score} 分 · 最高分 ${best} · 按 Enter 重开`,
    !won,
  );
}

/**
 * @param {{state: string, score: number, best: number, isNewRecord: boolean, won: boolean}} data
 */
function handleStateChange(data) {
  // 重开可能发生在延迟显示遮罩之前，先取消上一次的待显示任务
  if (overlayTimer !== null) {
    clearTimeout(overlayTimer);
    overlayTimer = null;
  }

  if (data.state === GameState.GAME_OVER) {
    // 让死亡闪烁先播完，再把画面交给遮罩层
    overlayTimer = setTimeout(() => applyState(data), 420);
  } else {
    applyState(data);
  }
}

// ---------- 游戏实例 ----------

const game = createGame({
  render: (view) => renderer.render(view),
  audio,
  loadBestScore,
  saveBestScore,
  hud: {
    onStats({ score, best, level }) {
      scoreEl.textContent = String(score);
      bestEl.textContent = String(best);
      levelEl.textContent = String(level);
    },
    onStateChange: handleStateChange,
  },
});

// ---------- 输入 ----------

bindInput({
  onDirection: (direction) => game.handleDirection(direction),
  onTogglePause: () => game.togglePause(),
  onStart: () => game.start(),
  onRestart: () => game.restart(),
  // 浏览器只允许在真实用户手势中解锁音频，这里是最早的可靠时机
  onFirstInput: () => audio.unlock(),
});
