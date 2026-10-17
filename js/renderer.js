/**
 * 表现层：Canvas 绘制。
 *
 * 本模块是**唯一**调用 canvas 2D 上下文的模块。
 * 只读取传入的状态快照用于绘制，绝不修改游戏状态。
 *
 * 配色思路：深青黑底 + 冷色蛇身 + 暖色食物。
 * 蛇身从头到尾做「蓝 → 青绿」的 HSL 色相插值，长度与朝向一眼可辨；
 * 食物固定暖橙并带呼吸式发光，在满屏冷色蛇身里始终是最醒目的那个点。
 */

import { BOARD_WIDTH, BOARD_HEIGHT, CELL_SIZE } from './config.js';

/**
 * 画布配色。与 css/style.css 中的变量同属一套视觉语言。
 */
const PALETTE = {
  board: '#0a1417',
  grid: 'rgba(126, 200, 190, 0.055)',
  food: '#ff8a4c',
  foodGlow: 'rgba(255, 138, 76, 0.55)',
  eye: '#07141a',
};

/**
 * 蛇身渐变端点。
 * 用 HSL 分量而非直接插值 RGB：蓝到青绿的 RGB 插值会从灰色穿过，颜色发脏。
 */
const SNAKE_TAIL = { h: 214, s: 62, l: 40 };
const SNAKE_HEAD = { h: 158, s: 78, l: 64 };
const SNAKE_TAIL_DEAD = { h: 350, s: 48, l: 30 };
const SNAKE_HEAD_DEAD = { h: 358, s: 74, l: 60 };

/** 蛇头在四个朝向下眼睛的相对位置（格内比例坐标） */
const EYE_OFFSETS = {
  up: [[0.3, 0.28], [0.7, 0.28]],
  down: [[0.3, 0.72], [0.7, 0.72]],
  left: [[0.28, 0.3], [0.28, 0.7]],
  right: [[0.72, 0.3], [0.72, 0.7]],
};

/** 蛇身方块在格内的留白与圆角，留白让相邻格子之间透出底色，形成鳞节感 */
const CELL_INSET = 2;
const CELL_RADIUS = CELL_SIZE * 0.28;
const EYE_RADIUS = CELL_SIZE * 0.075;

/**
 * 绘制数据快照。渲染器不持有游戏状态，只消费这个只读视图。
 * @typedef {Object} RenderView
 * @property {import('./snake.js').SnakeState} snake
 * @property {Point|null} food
 * @property {boolean} isDead 死亡态下蛇身转为红色并闪烁
 * @property {number} now 毫秒时间戳，用于食物脉动与死亡闪烁
 */

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * 创建渲染器。
 * @param {HTMLCanvasElement} canvas
 * @returns {{ render: (view: RenderView) => void }}
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  // 只在初始化时设置一次画布分辨率。之后由 CSS 负责缩放显示尺寸——
  // 每次绘制都改 width/height 会清空画布并重置上下文状态。
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;

  /**
   * 求某节蛇身的颜色。
   * @param {number} t 0 = 蛇尾，1 = 蛇头
   * @param {boolean} dead
   * @returns {string}
   */
  function snakeColorAt(t, dead) {
    const tail = dead ? SNAKE_TAIL_DEAD : SNAKE_TAIL;
    const head = dead ? SNAKE_HEAD_DEAD : SNAKE_HEAD;
    const h = Math.round(lerp(tail.h, head.h, t));
    const s = Math.round(lerp(tail.s, head.s, t));
    const l = Math.round(lerp(tail.l, head.l, t));
    return `hsl(${h} ${s}% ${l}%)`;
  }

  /**
   * 画一个圆角方格。
   * @param {Point} point
   * @param {number} inset 格内留白
   * @param {number} radius
   * @param {string} fill
   */
  function drawCell(point, inset, radius, fill) {
    const size = CELL_SIZE - inset * 2;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(
      point.x * CELL_SIZE + inset,
      point.y * CELL_SIZE + inset,
      size,
      size,
      radius,
    );
    ctx.fill();
  }

  /**
   * 铺底色并画网格线。所有线合并进同一条路径再一次性 stroke，减少绘制调用。
   */
  function drawBoard() {
    ctx.fillStyle = PALETTE.board;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();

    // +0.5 让 1px 线条落在像素中心，避免抗锯齿把线糊成 2px 灰边
    for (let x = 1; x < BOARD_WIDTH / CELL_SIZE; x += 1) {
      const px = x * CELL_SIZE + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, BOARD_HEIGHT);
    }
    for (let y = 1; y < BOARD_HEIGHT / CELL_SIZE; y += 1) {
      const py = y * CELL_SIZE + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(BOARD_WIDTH, py);
    }

    ctx.stroke();
  }

  /**
   * 食物：呼吸式缩放 + 外发光，与冷色蛇身形成冷暖对比。
   * @param {Point} food
   * @param {number} now
   */
  function drawFood(food, now) {
    const pulse = (Math.sin(now / 300) + 1) / 2;

    ctx.save();
    ctx.shadowColor = PALETTE.foodGlow;
    ctx.shadowBlur = 14 + pulse * 8;
    drawCell(food, 3.5 - pulse * 1.2, CELL_SIZE * 0.3, PALETTE.food);
    ctx.restore();
  }

  /**
   * 蛇身与眼睛。从尾到头绘制，让蛇头压在最上层。
   * @param {import('./snake.js').SnakeState} snake
   * @param {boolean} isDead
   * @param {number} now
   */
  function drawSnake(snake, isDead, now) {
    const { body, direction } = snake;
    const lastIndex = body.length - 1;

    // 死亡时整条蛇闪烁，提示"这一局结束了"，同时避免遮挡遮罩层的出现时机
    if (isDead) {
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(now / 170));
    }

    for (let i = lastIndex; i >= 0; i -= 1) {
      const t = lastIndex === 0 ? 1 : 1 - i / lastIndex;
      drawCell(body[i], CELL_INSET, CELL_RADIUS, snakeColorAt(t, isDead));
    }

    ctx.globalAlpha = 1;
    drawEyes(body[0], direction, isDead);
  }

  /**
   * 眼睛：用两个深色圆点标示朝向，让蛇头一眼可辨。
   * @param {Point} head
   * @param {string} direction
   * @param {boolean} isDead
   */
  function drawEyes(head, direction, isDead) {
    const offsets = EYE_OFFSETS[direction] ?? EYE_OFFSETS.right;

    ctx.save();
    // 死亡时的闪烁作用于蛇身，眼睛要保持实心才能读清朝向
    ctx.globalAlpha = 1;
    ctx.fillStyle = isDead ? '#1a0505' : PALETTE.eye;

    for (const [offsetX, offsetY] of offsets) {
      ctx.beginPath();
      ctx.arc(
        (head.x + offsetX) * CELL_SIZE,
        (head.y + offsetY) * CELL_SIZE,
        EYE_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.restore();
  }

  return {
    /** @param {RenderView} view */
    render(view) {
      drawBoard();
      if (view.food) drawFood(view.food, view.now);
      drawSnake(view.snake, view.isDead, view.now);
    },
  };
}
