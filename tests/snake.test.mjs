/**
 * snake.js 领域逻辑测试。
 * 运行：node tests/snake.test.mjs
 */

import { COLS, ROWS, INITIAL_SNAKE_LENGTH, INITIAL_DIRECTION } from '../js/config.js';
import { createSnake, getHead, nextHead, step, occupies } from '../js/snake.js';
import { createTest } from './harness.mjs';

const t = createTest();

/** @param {Point} point */
const key = (point) => `${point.x},${point.y}`;
const CENTER = `${Math.floor(COLS / 2)},${Math.floor(ROWS / 2)}`;

// ---------- createSnake ----------

const initial = createSnake();

t.equal('初始长度', initial.body.length, INITIAL_SNAKE_LENGTH);
t.equal('初始朝向', initial.direction, INITIAL_DIRECTION);
t.equal('蛇头位于棋盘中央', key(getHead(initial)), CENTER);
t.ok('身体全部在界内', initial.body.every((p) => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS));
t.ok(
  '身体逐格连续',
  initial.body.every((p, i) => i === 0 || Math.abs(p.x - initial.body[i - 1].x) + Math.abs(p.y - initial.body[i - 1].y) === 1),
);
t.equal('身体无重叠', new Set(initial.body.map(key)).size, initial.body.length);

// ---------- nextHead ----------

const DIRECTION_DELTAS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

for (const [direction, [dx, dy]] of Object.entries(DIRECTION_DELTAS)) {
  const head = getHead(initial);
  t.equal(`nextHead 朝 ${direction}`, key(nextHead(initial, direction)), `${head.x + dx},${head.y + dy}`);
}

t.equal('非法方向回退到当前朝向', key(nextHead(initial, 'diagonal')), key(nextHead(initial, initial.direction)));

// ---------- step ----------

const moved = step(initial, 'right', false);
const grown = step(initial, 'right', true);

t.equal('不生长时长度不变', moved.body.length, initial.body.length);
t.equal('不生长时尾部移出', key(moved.body.at(-1)), key(initial.body.at(-2)));
t.equal('不生长时头部前进一格', key(getHead(moved)), `${getHead(initial).x + 1},${getHead(initial).y}`);
t.equal('移动后朝向更新', moved.direction, 'right');

t.equal('生长时长度 +1', grown.body.length, initial.body.length + 1);
t.equal('生长时原尾部保留', key(grown.body.at(-1)), key(initial.body.at(-1)));
t.equal('生长时旧头成为第二节', key(grown.body[1]), key(getHead(initial)));

// 不可变性：step 不得原地修改传入状态
t.equal('step 不修改原状态长度', initial.body.length, INITIAL_SNAKE_LENGTH);
t.equal('step 不修改原状态头坐标', key(getHead(initial)), CENTER);

// ---------- occupies ----------

const tail = initial.body.at(-1);

t.equal('命中蛇头', occupies(initial, getHead(initial)), true);
t.equal('未命中空格', occupies(initial, { x: 0, y: 0 }), false);
t.equal('默认统计蛇尾', occupies(initial, tail), true);
t.equal('ignoreTail 时排除蛇尾', occupies(initial, tail, true), false);
t.equal('单节蛇 ignoreTail 后无身体', occupies({ body: [{ x: 1, y: 1 }] }, { x: 1, y: 1 }, true), false);

// 追尾场景：两节蛇蛇头移入蛇尾格。蛇尾本回合会先移开，应判定为合法。
const twoSegment = { body: [{ x: 5, y: 5 }, { x: 4, y: 5 }], direction: 'right' };
t.equal('追尾格判定为合法', occupies(twoSegment, { x: 4, y: 5 }, true), false);
t.equal('非尾部同格仍判定为撞身', occupies(twoSegment, { x: 5, y: 5 }, true), true);

// ---------- 模拟行走 ----------

let sim = createSnake();
while (getHead(sim).x + 1 < COLS) {
  sim = step(sim, 'right', false);
}

t.equal('模拟行走后头部贴右边界', getHead(sim).x, COLS - 1);
t.equal('模拟行走不增加长度', sim.body.length, INITIAL_SNAKE_LENGTH);
t.ok('下一步越界可被上层察觉', nextHead(sim, 'right').x >= COLS);

t.finish('snake');
