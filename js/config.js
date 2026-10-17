/**
 * 配置层 —— 全部可调参数的唯一来源。
 *
 * 其他模块禁止硬编码网格尺寸、速度、分值、存储 key 等数值，
 * 一律从此处导入，改平衡性时只需动这一个文件。
 */

/**
 * 坐标点（整数格）。
 * @typedef {{x: number, y: number}} Point
 */

// ---------- 棋盘 ----------

/** 横向格数 */
export const COLS = 20;
/** 纵向格数 */
export const ROWS = 20;
/** 每格边长（逻辑像素），画布尺寸由它推导 */
export const CELL_SIZE = 30;
/** 画布宽（逻辑像素） */
export const BOARD_WIDTH = COLS * CELL_SIZE;
/** 画布高（逻辑像素） */
export const BOARD_HEIGHT = ROWS * CELL_SIZE;

// ---------- 速度与难度 ----------

/** 初始移动间隔（毫秒），越大越慢 */
export const INITIAL_STEP_MS = 150;
/** 每提升一级减少的间隔（毫秒） */
export const SPEED_STEP_MS = 10;
/** 间隔下限，保证后期仍可操作 */
export const MIN_STEP_MS = 70;
/** 每吃多少个食物提升一级 */
export const FOODS_PER_LEVEL = 5;

// ---------- 计分 ----------

/** 每个食物的基础分值 */
export const SCORE_PER_FOOD = 10;

// ---------- 初始状态 ----------

/** 蛇初始长度（含蛇头） */
export const INITIAL_SNAKE_LENGTH = 3;
/** 蛇初始朝向 */
export const INITIAL_DIRECTION = 'right';

// ---------- 方向 ----------

/**
 * 方向名 → 单位位移向量。
 * @type {Record<string, Point>}
 */
export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** 每个方向的反向，用于禁止 180° 掉头 */
export const OPPOSITE_DIRECTION = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

// ---------- 输入映射 ----------

/**
 * KeyboardEvent.code → 方向名。
 * 用 code 而非 key：不受输入法状态与大小写影响。
 * @type {Record<string, string>}
 */
export const KEY_TO_DIRECTION = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

/** 暂停/继续按键 */
export const KEY_PAUSE = ['Space', 'KeyP'];
/** 开始/重开按键 */
export const KEY_START = ['Enter', 'NumpadEnter'];
/** 仅重开按键 */
export const KEY_RESTART = ['KeyR'];

// ---------- 音效 ----------

/**
 * 音效参数。集中在此便于统一调音，不必翻找 audio.js。
 * from/to 为起止频率（Hz），两者相等即平音；duration 单位为秒；gain 为峰值音量 0..1。
 * @type {{
 *   masterVolume: number,
 *   eat: {from: number, to: number, duration: number, gain: number, type: OscillatorType},
 *   die: {from: number, to: number, duration: number, gain: number, type: OscillatorType},
 *   start: {from: number, to: number, duration: number, gain: number, type: OscillatorType}
 * }}
 */
export const AUDIO = {
  masterVolume: 0.5,
  eat: { from: 660, to: 990, duration: 0.09, gain: 0.35, type: 'triangle' },
  die: { from: 340, to: 90, duration: 0.45, gain: 0.45, type: 'triangle' },
  start: { from: 520, to: 780, duration: 0.12, gain: 0.3, type: 'triangle' },
};

// ---------- 持久化 ----------

/** localStorage 键名，加前缀避免同域其他页面冲突 */
export const STORAGE_KEYS = {
  bestScore: 'snake.bestScore',
  muted: 'snake.muted',
};

// ---------- 状态机 ----------

/** 游戏状态枚举 */
export const GameState = Object.freeze({
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
});
