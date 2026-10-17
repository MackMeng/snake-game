/**
 * 领域层：食物实体。
 *
 * 纯逻辑模块，不触碰浏览器 API。随机性通过可注入的 rng 参数表达，
 * 便于写确定性测试。
 */

import { COLS, ROWS } from './config.js';

/**
 * 在未被蛇占据的格子里随机生成一个食物。
 *
 * 实现上先枚举全部空格再按索引随机取一个，而不是"随机重试直到不撞蛇"：
 * 后者在蛇很长时空格极少，会退化成近乎死循环。
 *
 * @param {{body: Point[]}} snake 当前蛇（只需其 body）
 * @param {() => number} [rng] 0..1 随机数生成器，默认 Math.random
 * @returns {Point|null} 无空格时返回 null（棋盘被蛇填满＝通关）
 */
export function spawnFood(snake, rng = Math.random) {
  // 用 y * COLS + x 把坐标压成整数键，避免在 Set 里存对象（对象按引用比较，去重会失效）
  const occupied = new Set(snake.body.map((point) => point.y * COLS + point.x));

  const free = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!occupied.has(y * COLS + x)) {
        free.push({ x, y });
      }
    }
  }

  if (free.length === 0) return null;

  // rng 是外部注入的，返回值不保证落在 [0,1)，故对索引做一次夹取，防止越界取到 undefined
  const raw = Math.floor(rng() * free.length);
  const index = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), free.length - 1) : 0;

  return free[index];
}
