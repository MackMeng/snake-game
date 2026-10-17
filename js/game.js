/**
 * 编排层：状态机、主循环与规则判定。
 *
 * 串联领域层（snake/food）与服务层（audio/storage），并驱动表现层（render）。
 * 不直接操作 DOM/canvas，只调用注入进来的依赖。
 *
 * 时间模型：requestAnimationFrame 每帧渲染；逻辑推进用「累计时间」判定，
 * 只有累计满一个 stepMs 才前进一格。这样掉帧时蛇的速度不会漂移，
 * 也不会因显示器刷新率不同而忽快忽慢。
 */

import {
  COLS,
  ROWS,
  INITIAL_STEP_MS,
  SPEED_STEP_MS,
  MIN_STEP_MS,
  FOODS_PER_LEVEL,
  SCORE_PER_FOOD,
  OPPOSITE_DIRECTION,
  GameState,
} from './config.js';
import { createSnake, nextHead, step as stepSnake, occupies } from './snake.js';
import { spawnFood as defaultSpawnFood } from './food.js';

/**
 * 单帧累计时间的上限（毫秒）。切后台、系统卡顿时 RAF 会突然给一个超大 delta，
 * 若不封顶会一次连走几十格。配合 visibilitychange 自动暂停，正常情况不会触顶。
 */
const MAX_FRAME_DELTA = 250;

/**
 * 创建游戏实例。
 *
 * @param {Object} deps 外部依赖（由 main.js 注入，便于替换与测试）
 * @param {(view: import('./renderer.js').RenderView) => void} deps.render 渲染回调
 * @param {import('./audio.js').AudioController} deps.audio 音效控制器
 * @param {() => number} deps.loadBestScore 读取最高分
 * @param {(score: number) => void} deps.saveBestScore 写入最高分
 * @param {(snake: import('./snake.js').SnakeState) => Point|null} [deps.spawnFood] 食物生成器，测试时注入以固定食物位置
 * @param {Object} deps.hud 回调：把分数/最高分/速度等级/遮罩文案交给 main.js 更新 DOM
 * @param {(data: {score: number, best: number, level: number}) => void} deps.hud.onStats
 * @param {(data: {state: string, score: number, best: number, isNewRecord: boolean, won: boolean}) => void} deps.hud.onStateChange
 * @returns {{
 *   start: () => void,
 *   togglePause: () => void,
 *   restart: () => void,
 *   handleDirection: (direction: string) => void,
 *   getState: () => string,
 *   destroy: () => void
 * }}
 */
export function createGame(deps) {
  const {
    render,
    audio,
    loadBestScore,
    saveBestScore,
    spawnFood = defaultSpawnFood,
    hud,
  } = deps;

  // ---------- 运行时状态 ----------

  let state = GameState.READY;
  let snake = createSnake();
  let food = spawnFood(snake);
  let foodsEaten = 0;
  let score = 0;
  let best = loadBestScore();
  /** 本局是否刷新了最高分，只在结束时置真 */
  let newRecord = false;

  /** @type {string[]} 待消费的方向队列，每帧最多消费一个 */
  let pendingDirections = [];

  let stepMs = INITIAL_STEP_MS;
  /** 上一帧时间戳；null 表示「还没收到过播放中的帧」，用作首帧哨兵 */
  let lastTs = null;
  let accumulator = 0;
  let rafId = null;

  // ---------- 派生计算 ----------

  /** 当前速度等级，从 1 开始 */
  const currentLevel = () => Math.floor(foodsEaten / FOODS_PER_LEVEL) + 1;

  /** 当前移动间隔（毫秒） */
  const currentStepMs = () =>
    Math.max(INITIAL_STEP_MS - Math.floor(foodsEaten / FOODS_PER_LEVEL) * SPEED_STEP_MS, MIN_STEP_MS);

  const isDead = () => state === GameState.GAME_OVER;

  // ---------- 通知 HUD ----------

  function emitStats() {
    hud.onStats({ score, best, level: currentLevel() });
  }

  function emitStateChange(won = false) {
    hud.onStateChange({ state, score, best, isNewRecord: newRecord, won });
  }

  // ---------- 状态迁移 ----------

  /** 清空到新一局的初始状态，不改变 state 本身 */
  function resetBoard() {
    snake = createSnake();
    food = spawnFood(snake);
    foodsEaten = 0;
    score = 0;
    pendingDirections = [];
    stepMs = INITIAL_STEP_MS;
    accumulator = 0;
    newRecord = false;
  }

  function start() {
    // start 只从 READY 或 GAME_OVER 进入，进行中/暂停中忽略，避免误触重置局面
    if (state !== GameState.READY && state !== GameState.GAME_OVER) return;
    resetBoard();
    state = GameState.PLAYING;
    lastTs = null;
    audio.playStart();
    emitStats();
    emitStateChange();
  }

  function restart() {
    resetBoard();
    state = GameState.PLAYING;
    lastTs = null;
    audio.playStart();
    emitStats();
    emitStateChange();
  }

  function togglePause() {
    if (state === GameState.PLAYING) {
      state = GameState.PAUSED;
      emitStateChange();
    } else if (state === GameState.PAUSED) {
      state = GameState.PLAYING;
      // 暂停期间时间没有流逝，若沿用旧时间戳会让恢复后的第一帧 delta 巨大，
      // 故清空计时基准，下一帧从 0 开始重新累计
      lastTs = null;
      emitStateChange();
    }
  }

  /**
   * 结束本局（死亡或通关）。
   * @param {boolean} won 是否通关（棋盘被蛇填满）
   */
  function endGame(won) {
    newRecord = score > best;
    if (newRecord) {
      best = score;
      saveBestScore(best);
    }

    if (won) audio.playStart();
    else audio.playDie();

    state = GameState.GAME_OVER;
    emitStats();
    emitStateChange(won);
  }

  // ---------- 输入 ----------

  function handleDirection(direction) {
    if (state !== GameState.PLAYING) return;

    // 参照方向取「队列末尾（若无则当前朝向）」，而非当前朝向：
    // 快速连按「上、左」时，第二个方向应相对第一个、而不是相对尚未执行的当前朝向校验，
    // 否则会出现头尾相接的 180° 掉头自撞。
    const reference = pendingDirections.length > 0
      ? pendingDirections[pendingDirections.length - 1]
      : snake.direction;

    if (direction === reference || direction === OPPOSITE_DIRECTION[reference]) return;

    pendingDirections.push(direction);
  }

  // ---------- 逻辑推进 ----------

  function advance() {
    const direction = pendingDirections.length > 0 ? pendingDirections.shift() : snake.direction;
    const head = nextHead(snake, direction);

    // 撞墙
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      endGame(false);
      return;
    }

    // 是否吃到食物要在移动前判定：吃了就不删尾（生长）
    const willGrow = food !== null && head.x === food.x && head.y === food.y;

    // 撞自身。不生长时蛇尾本回合会移开，故判定时忽略蛇尾（追尾一格是合法的）
    if (occupies(snake, head, !willGrow)) {
      endGame(false);
      return;
    }

    snake = stepSnake(snake, direction, willGrow);

    if (willGrow) {
      foodsEaten += 1;
      score = foodsEaten * SCORE_PER_FOOD;
      stepMs = currentStepMs();
      food = spawnFood(snake);
      audio.playEat();
      emitStats();

      // 棋盘被蛇填满：无空格可放食物 → 通关
      if (food === null) {
        endGame(true);
      }
    }
  }

  // ---------- 主循环 ----------

  /**
   * @param {number} ts RAF 提供的毫秒时间戳
   */
  function frame(ts) {
    rafId = requestAnimationFrame(frame);

    if (state === GameState.PLAYING) {
      if (lastTs !== null) {
        const delta = Math.min(ts - lastTs, MAX_FRAME_DELTA);
        accumulator += delta;
        while (accumulator >= stepMs) {
          advance();
          accumulator -= stepMs;
          // 推进过程中可能死亡/通关，状态已变，立即退出累积循环
          if (state !== GameState.PLAYING) break;
        }
      }
      lastTs = ts;
    } else {
      // 非 PLAYING 状态丢弃时间基准，恢复播放时从下一帧重新累计
      lastTs = null;
    }

    render({ snake, food, isDead: isDead(), now: ts });
  }

  // ---------- 后台自动暂停 ----------

  function handleVisibilityChange() {
    if (document.hidden && state === GameState.PLAYING) {
      state = GameState.PAUSED;
      emitStateChange();
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  // READY 首屏也要显示历史最高分，不必等到开局才更新
  emitStats();

  // 立即启动渲染循环：READY 状态下也要画出初始蛇与食物（在遮罩层后面）
  rafId = requestAnimationFrame(frame);

  return {
    start,
    togglePause,
    restart,
    handleDirection,
    getState: () => state,
    destroy() {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}
