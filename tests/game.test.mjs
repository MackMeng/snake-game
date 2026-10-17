/**
 * game.js 编排逻辑测试。
 *
 * 不依赖真实浏览器：伪造 requestAnimationFrame，由测试手动推进时间，
 * 从而精确控制「累计满一步才移动」这一核心时间模型。
 * 食物生成器可注入，用来把食物固定在指定格子，避免断言依赖随机结果。
 * 运行：node tests/game.test.mjs
 */

import {
  GameState,
  INITIAL_STEP_MS,
  SPEED_STEP_MS,
  SCORE_PER_FOOD,
  FOODS_PER_LEVEL,
} from '../js/config.js';
import { createGame } from '../js/game.js';
import { createTest } from './harness.mjs';

const t = createTest();

// ---------- 环境伪造 ----------

/** @type {Function[]} */
const rafQueue = [];
/** RAF 句柄 → 回调。真实浏览器给的是不透明句柄，不能直接用函数引用取消 */
const rafHandles = new Map();
let nextRafId = 0;
let now = 0;

globalThis.requestAnimationFrame = (fn) => {
  nextRafId += 1;
  rafHandles.set(nextRafId, fn);
  rafQueue.push(fn);
  return nextRafId;
};

globalThis.cancelAnimationFrame = (id) => {
  const fn = rafHandles.get(id);
  if (!fn) return;
  rafHandles.delete(id);
  const index = rafQueue.indexOf(fn);
  if (index >= 0) rafQueue.splice(index, 1);
};

const docListeners = new Map();
globalThis.document = {
  hidden: false,
  addEventListener(type, fn) { docListeners.set(type, fn); },
  removeEventListener(type) { docListeners.delete(type); },
};

/**
 * 推进时间并触发当前排队的 RAF 回调。
 * @param {number} ms
 */
function tick(ms) {
  now += ms;
  const pending = rafQueue.splice(0, rafQueue.length);
  for (const fn of pending) fn(now);
}

// ---------- 测试装配 ----------

function makeAudio() {
  const log = [];
  return {
    log,
    unlock: () => {},
    setMuted: () => {},
    playEat: () => log.push('eat'),
    playDie: () => log.push('die'),
    playStart: () => log.push('start'),
  };
}

function makeHud() {
  const stats = [];
  const states = [];
  return {
    stats,
    states,
    onStats: (data) => stats.push(data),
    onStateChange: (data) => states.push(data),
  };
}

/**
 * 每个场景都用全新实例，避免状态串扰。
 * @param {{best?: number, foods?: (Point|null)[]}} [options]
 */
function setup(options = {}) {
  rafQueue.length = 0;
  now = 0;
  globalThis.document.hidden = false;

  const audio = makeAudio();
  const hud = makeHud();
  const renders = [];
  const saved = [];
  /** @type {(Point|null)[]} */
  let foodQueue = [...(options.foods ?? [])];

  const game = createGame({
    render: (view) => renders.push(view),
    audio,
    loadBestScore: () => options.best ?? 0,
    saveBestScore: (score) => saved.push(score),
    // 默认把食物放到左上角，远离初始蛇所在的中部行，保证不会误吃
    spawnFood: () => (foodQueue.length > 0 ? foodQueue.shift() : { x: 0, y: 0 }),
    hud,
  });

  return { game, audio, hud, renders, saved };
}

/** @param {Point} point */
const key = (point) => `${point.x},${point.y}`;
const headOf = (view) => view.snake.body[0];

// ===========================================================================
// 初始状态
// ===========================================================================

{
  const h = setup({ best: 50 });

  t.equal('初始状态为 READY', h.game.getState(), GameState.READY);
  // 构造只排入首帧，真正绘制发生在下一帧
  t.equal('构造时不立即渲染', h.renders.length, 0);

  tick(0);
  t.equal('首帧完成初始渲染', h.renders.length, 1);
  t.equal('初始分数为 0', h.hud.stats[0].score, 0);
  t.equal('首屏即显示历史最高分', h.hud.stats[0].best, 50);
  t.equal('初始等级为 1', h.hud.stats[0].level, 1);

  tick(1000);
  t.equal('READY 状态不推进逻辑', key(headOf(h.renders.at(-1))), '10,10');
  h.game.destroy();
}

// ===========================================================================
// 开始与时间模型
// ===========================================================================

{
  const h = setup();
  h.game.start();

  t.equal('start 后进入 PLAYING', h.game.getState(), GameState.PLAYING);
  t.ok('播放开始音效', h.audio.log.includes('start'));

  // 第一帧只建立时间基准，不推进——否则开局会凭空多走一格
  tick(0);
  t.equal('首帧不移动', key(headOf(h.renders.at(-1))), '10,10');

  tick(INITIAL_STEP_MS - 1);
  t.equal('累计不足一步时不移动', key(headOf(h.renders.at(-1))), '10,10');

  tick(1);
  t.equal('累计满一步后前进一格', key(headOf(h.renders.at(-1))), '11,10');

  h.game.destroy();
}

{
  const h = setup();
  h.game.start();
  tick(0);

  // 单帧 delta 会被限幅到 250ms：150ms 走一格，余下 100ms 留待下一帧
  tick(250);
  t.equal('限幅内按累计时间推进', key(headOf(h.renders.at(-1))), '11,10');

  // 余数不丢失，再补 50ms 即可凑满第二步
  tick(50);
  t.equal('未用尽的累计时间保留到下一帧', key(headOf(h.renders.at(-1))), '12,10');

  h.game.destroy();
}

{
  const h = setup();
  h.game.start();
  tick(0);

  // 切后台等极端情况会给一个巨大 delta，必须封顶，否则蛇会瞬移撞墙
  tick(100000);
  t.equal('超大帧间隔被限幅', key(headOf(h.renders.at(-1))), '11,10');
  t.equal('限幅后仍在游戏中', h.game.getState(), GameState.PLAYING);

  h.game.destroy();
}

// ===========================================================================
// 吃食物与计分
// ===========================================================================

{
  // 构造时消耗第一个，start 的 resetBoard 消耗第二个
  const h = setup({ foods: [{ x: 0, y: 0 }, { x: 11, y: 10 }, { x: 0, y: 0 }] });
  h.game.start();
  tick(0);

  const before = h.renders.at(-1).snake.body.length;
  tick(INITIAL_STEP_MS);

  const view = h.renders.at(-1);
  t.equal('吃到食物后加分', h.hud.stats.at(-1).score, SCORE_PER_FOOD);
  t.equal('吃到食物后长度 +1', view.snake.body.length, before + 1);
  t.ok('播放进食音效', h.audio.log.includes('eat'));
  t.equal('食物已重新生成', view.food !== null, true);
  t.equal('新食物位置来自注入队列', key(view.food), '0,0');

  h.game.destroy();
}

// ===========================================================================
// 难度递增
// ===========================================================================

{
  // 第 1 个在构造时消耗，第 2 个成为开局食物，之后每吃一个消耗一个
  const foods = [{ x: 0, y: 0 }];
  for (let i = 0; i < FOODS_PER_LEVEL; i += 1) foods.push({ x: 11 + i, y: 10 });
  foods.push({ x: 0, y: 0 });

  const h = setup({ foods });
  h.game.start();
  tick(0);

  for (let i = 0; i < FOODS_PER_LEVEL; i += 1) tick(INITIAL_STEP_MS);

  t.equal('吃满一组后等级 +1', h.hud.stats.at(-1).level, 1 + 1);
  t.equal('分数按食物数量累加', h.hud.stats.at(-1).score, FOODS_PER_LEVEL * SCORE_PER_FOOD);

  // 提速后步长应为 INITIAL_STEP_MS - SPEED_STEP_MS，用「差 1ms 不移动」验证
  const fasterStep = INITIAL_STEP_MS - SPEED_STEP_MS;
  tick(fasterStep - 1);
  t.equal('提速后不足新步长不移动', h.renders.at(-1).snake.body.length, FOODS_PER_LEVEL + 3);

  tick(1);
  t.equal('提速后按新步长推进', h.renders.at(-1).snake.body[0].x, 11 + FOODS_PER_LEVEL);

  h.game.destroy();
}

// ===========================================================================
// 撞墙
// ===========================================================================

{
  const h = setup();
  h.game.start();
  tick(0);

  // 蛇头在 x=10，向右撞墙需要 9 步到达 x=19，第 10 步越界
  for (let i = 0; i < 9; i += 1) tick(INITIAL_STEP_MS);
  t.equal('贴边后仍在游戏中', h.game.getState(), GameState.PLAYING);

  tick(INITIAL_STEP_MS);
  t.equal('撞墙后游戏结束', h.game.getState(), GameState.GAME_OVER);
  t.ok('播放死亡音效', h.audio.log.includes('die'));
  t.equal('死亡后再渲染带 isDead 标记', h.renders.at(-1).isDead, true);

  h.game.destroy();
}

// ===========================================================================
// 撞自身
// ===========================================================================

{
  // 先吃三个食物把蛇加长到 6 节，再绕一圈撞回自己身体
  const h = setup({
    foods: [
      { x: 0, y: 0 }, // 构造时消耗；下一个（11,10）成为开局食物
      { x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 },
      { x: 0, y: 0 },
    ],
  });
  h.game.start();
  tick(0);

  for (let i = 0; i < 3; i += 1) tick(INITIAL_STEP_MS);
  t.equal('已增长到 6 节', h.renders.at(-1).snake.body.length, 6);

  h.game.handleDirection('up');
  tick(INITIAL_STEP_MS);
  h.game.handleDirection('left');
  tick(INITIAL_STEP_MS);
  t.equal('转弯后仍在游戏中', h.game.getState(), GameState.PLAYING);

  h.game.handleDirection('down');
  tick(INITIAL_STEP_MS);
  t.equal('撞到自身后游戏结束', h.game.getState(), GameState.GAME_OVER);

  h.game.destroy();
}

// ===========================================================================
// 方向队列
// ===========================================================================

{
  const h = setup();
  h.game.start();
  tick(0);

  // 同一帧内快速连按两个方向，应逐帧依次执行而不是被合并
  h.game.handleDirection('up');
  h.game.handleDirection('left');

  tick(INITIAL_STEP_MS);
  t.equal('队列第一个方向先执行', key(headOf(h.renders.at(-1))), '10,9');

  tick(INITIAL_STEP_MS);
  t.equal('队列第二个方向随后执行', key(headOf(h.renders.at(-1))), '9,9');

  h.game.destroy();
}

{
  const h = setup();
  h.game.start();
  tick(0);

  // 禁止 180° 掉头：向右时按左应被丢弃
  h.game.handleDirection('left');
  tick(INITIAL_STEP_MS);
  t.equal('反向输入被忽略', key(headOf(h.renders.at(-1))), '11,10');

  // 相对「队列末尾」校验：上→下 应被丢弃，上→左 应保留
  h.game.handleDirection('up');
  h.game.handleDirection('down');
  tick(INITIAL_STEP_MS);
  t.equal('相对队列末尾的反向输入被忽略', key(headOf(h.renders.at(-1))), '11,9');

  h.game.destroy();
}

{
  const h = setup();
  h.game.start();
  tick(0);

  // 未开始时方向输入不生效
  const ready = setup();
  ready.game.handleDirection('up');
  ready.game.start();
  tick(0);
  tick(INITIAL_STEP_MS);
  t.equal('READY 期间的方向输入不进入新局', key(headOf(ready.renders.at(-1))), '11,10');

  h.game.destroy();
  ready.game.destroy();
}

// ===========================================================================
// 暂停 / 继续
// ===========================================================================

{
  const h = setup();
  h.game.start();
  tick(0);
  tick(INITIAL_STEP_MS);
  const beforePause = key(headOf(h.renders.at(-1)));

  h.game.togglePause();
  t.equal('空格后进入 PAUSED', h.game.getState(), GameState.PAUSED);

  tick(INITIAL_STEP_MS * 5);
  t.equal('暂停期间不推进逻辑', key(headOf(h.renders.at(-1))), beforePause);

  h.game.togglePause();
  t.equal('再次空格恢复 PLAYING', h.game.getState(), GameState.PLAYING);

  // 恢复后第一帧只重建基准，不应把暂停时长补进来
  tick(0);
  t.equal('恢复后不因暂停时长跳步', key(headOf(h.renders.at(-1))), beforePause);

  tick(INITIAL_STEP_MS);
  t.equal('恢复后正常推进', key(headOf(h.renders.at(-1))), '12,10');

  h.game.destroy();
}

{
  const h = setup();
  h.game.start();
  tick(0);
  h.game.togglePause();
  h.game.start();
  t.equal('暂停中按开始不重置局面', h.game.getState(), GameState.PAUSED);

  h.game.destroy();
}

// ===========================================================================
// 重开
// ===========================================================================

{
  const h = setup({ foods: [{ x: 0, y: 0 }, { x: 11, y: 10 }, { x: 0, y: 0 }] });
  h.game.start();
  tick(0);
  tick(INITIAL_STEP_MS);
  t.equal('本局已得分', h.hud.stats.at(-1).score, SCORE_PER_FOOD);

  h.game.restart();
  tick(0); // 重开本身只改状态，画面在下一帧才更新

  t.equal('重开回到 PLAYING', h.game.getState(), GameState.PLAYING);
  t.equal('重开清空分数', h.hud.stats.at(-1).score, 0);
  t.equal('重开恢复初始长度', h.renders.at(-1).snake.body.length, 3);
  t.equal('重开恢复初始位置', key(headOf(h.renders.at(-1))), '10,10');

  h.game.destroy();
}

// ===========================================================================
// 最高分与破纪录
// ===========================================================================

{
  const h = setup({ best: 5, foods: [{ x: 0, y: 0 }, { x: 11, y: 10 }, { x: 0, y: 0 }] });
  h.game.start();
  tick(0);
  tick(INITIAL_STEP_MS);

  // 继续向右直到撞墙
  for (let i = 0; i < 9; i += 1) tick(INITIAL_STEP_MS);

  const lastState = h.hud.states.at(-1);
  t.equal('结束事件带 isNewRecord', lastState.isNewRecord, true);
  t.equal('最高分被更新为本局分数', lastState.best, SCORE_PER_FOOD);
  t.equal('最高分已持久化', h.saved.at(-1), SCORE_PER_FOOD);
  t.equal('HUD 最高分同步', h.hud.stats.at(-1).best, SCORE_PER_FOOD);

  h.game.destroy();
}

{
  const h = setup({ best: 999, foods: [{ x: 0, y: 0 }, { x: 11, y: 10 }, { x: 0, y: 0 }] });
  h.game.start();
  tick(0);
  tick(INITIAL_STEP_MS);
  for (let i = 0; i < 9; i += 1) tick(INITIAL_STEP_MS);

  t.equal('未破纪录时不标记', h.hud.states.at(-1).isNewRecord, false);
  t.equal('未破纪录时不写入存储', h.saved.length, 0);
  t.equal('沿用历史最高分', h.hud.stats.at(-1).best, 999);

  h.game.destroy();
}

// ===========================================================================
// 通关（棋盘被填满）
// ===========================================================================

{
  // 吃完这个食物后没有空格可放食物 → 通关
  const h = setup({ foods: [{ x: 0, y: 0 }, { x: 11, y: 10 }, null] });
  h.game.start();
  tick(0);
  tick(INITIAL_STEP_MS);

  t.equal('填满棋盘后进入 GAME_OVER', h.game.getState(), GameState.GAME_OVER);
  t.equal('结束事件标记为通关', h.hud.states.at(-1).won, true);

  h.game.destroy();
}

// ===========================================================================
// 后台自动暂停
// ===========================================================================

{
  const h = setup();
  h.game.start();
  tick(0);

  globalThis.document.hidden = true;
  docListeners.get('visibilitychange')?.();
  t.equal('切后台自动暂停', h.game.getState(), GameState.PAUSED);

  globalThis.document.hidden = false;
  t.equal('回到前台不会自动继续', h.game.getState(), GameState.PAUSED);

  h.game.destroy();
}

// ===========================================================================
// 销毁
// ===========================================================================

{
  const h = setup();
  h.game.start();
  tick(0);
  const renderCount = h.renders.length;
  h.game.destroy();

  tick(INITIAL_STEP_MS * 3);
  t.equal('destroy 后不再渲染', h.renders.length, renderCount);
}

t.finish('game');
