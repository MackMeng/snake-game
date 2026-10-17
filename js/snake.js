/**
 * 领域层：蛇实体。
 *
 * 纯逻辑模块——不触碰 DOM、canvas、localStorage、AudioContext。
 * 函数接收状态并返回新状态或布尔结果，便于脱离浏览器单独验证。
 *
 * 不可变约定：SnakeState.body 内的 Point 一旦创建就不再被原地修改，
 * 因此 step() 返回的新状态可以安全复用旧格子对象，无需深拷贝。
 */

import { COLS, ROWS, INITIAL_SNAKE_LENGTH, INITIAL_DIRECTION, DIRECTIONS } from './config.js';

/**
 * 蛇的状态。
 * @typedef {Object} SnakeState
 * @property {Point[]} body 身体格子，body[0] 为蛇头，末位为蛇尾
 * @property {string} direction 当前朝向（DIRECTIONS 的键）
 */

/**
 * 创建初始蛇：位于棋盘中央，水平朝向 INITIAL_DIRECTION，长度为 INITIAL_SNAKE_LENGTH。
 *
 * 身体沿朝向的**反方向**依次排开，使蛇头前方留出足够空间，
 * 避免开局第一步就撞墙。
 *
 * @returns {SnakeState}
 */
export function createSnake() {
  const delta = DIRECTIONS[INITIAL_DIRECTION];
  const headX = Math.floor(COLS / 2);
  const headY = Math.floor(ROWS / 2);

  const body = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i += 1) {
    body.push({ x: headX - delta.x * i, y: headY - delta.y * i });
  }

  return { body, direction: INITIAL_DIRECTION };
}

/**
 * 取蛇头坐标。不改变原状态。
 * @param {SnakeState} snake
 * @returns {Point}
 */
export function getHead(snake) {
  return snake.body[0];
}

/**
 * 计算头部下一格坐标（仅推算，不落地）。
 * @param {SnakeState} snake
 * @param {string} direction 要前进的方向；非法值回退到当前朝向，避免算出 NaN
 * @returns {Point}
 */
export function nextHead(snake, direction) {
  const delta = DIRECTIONS[direction] ?? DIRECTIONS[snake.direction];
  const head = getHead(snake);
  return { x: head.x + delta.x, y: head.y + delta.y };
}

/**
 * 推进一帧：头部按 direction 前进一格；未吃到食物时移除蛇尾。
 * @param {SnakeState} snake
 * @param {string} direction 本次移动朝向
 * @param {boolean} grow 是否生长（吃到食物为 true）
 * @returns {SnakeState} 新状态
 */
export function step(snake, direction, grow) {
  const head = nextHead(snake, direction);
  // 头部先落地；grow 时保留原有的全部身体（长度 +1）
  const body = grow
    ? [head, ...snake.body]
    : [head, ...snake.body.slice(0, -1)];

  return { body, direction };
}

/**
 * 判断某格是否被蛇身占据。
 * @param {SnakeState} snake
 * @param {Point} point
 * @param {boolean} [ignoreTail] 忽略蛇尾。判定"蛇头能否移入该格"时传 true：
 *   本回合蛇尾会先移开，所以蛇头追着自己尾巴那一格是合法的。
 * @returns {boolean}
 */
export function occupies(snake, point, ignoreTail = false) {
  const body = ignoreTail ? snake.body.slice(0, -1) : snake.body;
  return body.some((segment) => segment.x === point.x && segment.y === point.y);
}
