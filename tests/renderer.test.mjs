/**
 * renderer.js 绘制行为测试。
 *
 * Node 里没有 canvas，用 Proxy 记录全部绘制调用来验证：
 * 画布初始化、绘制顺序与数量、配色插值、死亡态处理。
 * 像素观感无法自动化验证，需在浏览器里人工确认。
 * 运行：node tests/renderer.test.mjs
 */

import { BOARD_WIDTH, BOARD_HEIGHT, COLS, ROWS, CELL_SIZE } from '../js/config.js';
import { createSnake } from '../js/snake.js';
import { createRenderer } from '../js/renderer.js';
import { createTest } from './harness.mjs';

const t = createTest();

/**
 * 假 canvas 2D 上下文：记录方法调用与属性赋值。
 */
function createFakeContext() {
  /** @type {unknown[][]} */
  const calls = [];
  const state = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
  };

  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push([String(prop), ...args]);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push([`set:${String(prop)}`, value]);
      return true;
    },
  });

  return { ctx, calls, state };
}

/** @param {unknown[][]} calls @param {string} name */
const countOf = (calls, name) => calls.filter((call) => call[0] === name).length;

/** @param {unknown[][]} calls */
const fillStyleSequence = (calls) =>
  calls.filter((call) => call[0] === 'set:fillStyle').map((call) => call[1]);

// ---------- 初始化 ----------

const { ctx, calls } = createFakeContext();
/** @type {any} */
const canvas = { width: 0, height: 0, getContext: () => ctx };
const renderer = createRenderer(canvas);

t.equal('画布宽度按配置设置', canvas.width, BOARD_WIDTH);
t.equal('画布高度按配置设置', canvas.height, BOARD_HEIGHT);
t.equal('构造时不绘制任何内容', calls.length, 0);

// ---------- 正常帧 ----------

const snake = createSnake();
const food = { x: 0, y: 0 };

t.noThrow('渲染一帧不抛错', () => {
  renderer.render({ snake, food, isDead: false, now: 0 });
});

t.equal('网格线数量 = 竖线 + 横线', countOf(calls, 'moveTo'), (COLS - 1) + (ROWS - 1));
t.equal('圆角方块数量 = 食物 + 蛇身', countOf(calls, 'roundRect'), 1 + snake.body.length);
t.equal('描边只调用一次（网格合并为单条路径）', countOf(calls, 'stroke'), 1);
t.equal('眼睛绘制两个圆点', countOf(calls, 'arc'), 2);

// 绘制顺序：底色 → 食物 → 蛇尾 → 蛇头 → 眼睛
const fills = fillStyleSequence(calls);
t.equal('底色', fills[0], '#0a1417');
t.equal('食物用暖橙色', fills[1], '#ff8a4c');
t.equal('蛇尾为暗蓝色', fills[2], 'hsl(214 62% 40%)');
t.equal('蛇身中段处于渐变中位', fills[3], 'hsl(186 70% 52%)');
t.equal('蛇头为亮青绿色', fills[4], 'hsl(158 78% 64%)');
t.equal('眼睛用深色', fills[5], '#07141a');
t.equal('颜色调用总数符合预期', fills.length, 6);

// ---------- 死亡帧 ----------

const dead = createFakeContext();
/** @type {any} */
const deadCanvas = { width: 0, height: 0, getContext: () => dead.ctx };
createRenderer(deadCanvas).render({ snake, food, isDead: true, now: 0 });

const alphas = dead.calls.filter((call) => call[0] === 'set:globalAlpha').map((call) => call[1]);
t.ok('死亡时蛇身设置了半透明', alphas.some((alpha) => typeof alpha === 'number' && alpha < 1));
t.equal('渲染结束恢复完全不透明', alphas.at(-1), 1);

const deadFills = fillStyleSequence(dead.calls);
t.equal('死亡时蛇头转红', deadFills[4], 'hsl(358 74% 60%)');
t.ok('死亡时不使用正常蛇色', !deadFills.includes('hsl(158 78% 64%)'));

// ---------- 边界情况 ----------

const noFood = createFakeContext();
/** @type {any} */
const noFoodCanvas = { width: 0, height: 0, getContext: () => noFood.ctx };
const noFoodRenderer = createRenderer(noFoodCanvas);

t.noThrow('食物为 null 时不抛错', () => {
  noFoodRenderer.render({ snake, food: null, isDead: false, now: 0 });
});
t.equal('无食物时只画蛇身', countOf(noFood.calls, 'roundRect'), snake.body.length);
t.ok('无食物时不出现食物色', !fillStyleSequence(noFood.calls).includes('#ff8a4c'));

// 单节蛇：t 会除以 0，需回退到纯头部色
const oneCell = createFakeContext();
/** @type {any} */
const oneCellCanvas = { width: 0, height: 0, getContext: () => oneCell.ctx };
createRenderer(oneCellCanvas).render({
  snake: { body: [{ x: 5, y: 5 }], direction: 'right' },
  food: null,
  isDead: false,
  now: 0,
});

// 无食物时 fillStyle 序列为 [底色, 蛇身, 眼睛]，蛇身在索引 1
t.equal('单节蛇用头部色（避免除以 0）', fillStyleSequence(oneCell.calls)[1], 'hsl(158 78% 64%)');

// 未知方向时眼睛回退到默认布局，不应取到 undefined
const badDir = createFakeContext();
/** @type {any} */
const badDirCanvas = { width: 0, height: 0, getContext: () => badDir.ctx };
createRenderer(badDirCanvas).render({
  snake: { body: [{ x: 5, y: 5 }, { x: 4, y: 5 }], direction: 'sideways' },
  food: null,
  isDead: false,
  now: 0,
});
t.equal('未知朝向仍画出两只眼睛', countOf(badDir.calls, 'arc'), 2);

// ---------- 时间动画 ----------

/** @param {number} now */
function shadowBlurAt(now) {
  const frame = createFakeContext();
  createRenderer(/** @type {any} */ ({ width: 0, height: 0, getContext: () => frame.ctx }))
    .render({ snake, food, isDead: false, now });
  return frame.calls.filter((call) => call[0] === 'set:shadowBlur').map((call) => call[1])[0];
}

// 脉动周期为 600π ms，取样点需避开同相位（π 的整数倍）才看得出变化
const glowAtZero = shadowBlurAt(0);
const glowAtPeak = shadowBlurAt(300 * Math.PI / 2);

t.ok('食物发光随 time 变化', glowAtZero !== glowAtPeak, `${glowAtZero} vs ${glowAtPeak}`);
t.ok('食物发光在合理区间内', glowAtZero >= 14 && glowAtZero <= 22, glowAtZero);

t.equal('每格边长与画布推导一致', CELL_SIZE * COLS, BOARD_WIDTH);

t.finish('renderer');
