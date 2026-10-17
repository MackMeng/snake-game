/**
 * food.js 领域逻辑测试。
 * 运行：node tests/food.test.mjs
 */

import { COLS, ROWS } from '../js/config.js';
import { createSnake } from '../js/snake.js';
import { spawnFood } from '../js/food.js';
import { createTest } from './harness.mjs';

const t = createTest();

/** @param {Point} point */
const key = (point) => `${point.x},${point.y}`;

const snake = createSnake();
const bodyKeys = new Set(snake.body.map(key));

// ---------- 随机分布 ----------

let invalid = 0;
for (let i = 0; i < 500; i += 1) {
  const food = spawnFood(snake);
  const inBounds = food.x >= 0 && food.x < COLS && food.y >= 0 && food.y < ROWS;
  if (!inBounds || bodyKeys.has(key(food))) invalid += 1;
}
t.equal('500 次随机生成均落在合法空格', invalid, 0);

// ---------- 随机源注入（确定性） ----------

t.equal('rng=0 取第一个空格', key(spawnFood(snake, () => 0)), '0,0');
// rng 返回 1.0 会让索引越界，必须被夹取到最后 N 格而不是返回 undefined
t.equal('rng 返回 1.0 时夹取到最后一格', key(spawnFood(snake, () => 1)), `${COLS - 1},${ROWS - 1}`);
t.equal('rng 返回负数时夹取到第一格', key(spawnFood(snake, () => -5)), '0,0');
t.equal('rng 返回 NaN 时回退到第一格', key(spawnFood(snake, () => NaN)), '0,0');

// ---------- 满盘与边界 ----------

/** @type {Point[]} */
const allCells = [];
for (let y = 0; y < ROWS; y += 1) {
  for (let x = 0; x < COLS; x += 1) allCells.push({ x, y });
}

t.equal('棋盘被填满时返回 null', spawnFood({ body: allCells }), null);
t.equal('只剩一格时必取该格', key(spawnFood({ body: allCells.slice(0, -1) })), key(allCells.at(-1)));

// 食物不得落在蛇身：蛇只占 (0,0) 时，(0,0) 必须被跳过
t.equal('跳过被占据的格子', key(spawnFood({ body: [{ x: 0, y: 0 }] }, () => 0)), '1,0');

t.finish('food');
