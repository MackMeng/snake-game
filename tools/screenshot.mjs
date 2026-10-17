/**
 * 生成 README 用的游戏截图：无头 Chrome 真实运行游戏，自动操控吃到几个食物后截屏。
 *
 * 为什么不用手绘示意图：截图里必须是 renderer.js 真实绘制的画面，
 * 否则配色、渐变、发光一改，README 就和游戏对不上了。
 *
 * 只用 Node 内置能力和 Chrome 的 DevTools 协议，不引入任何依赖。
 *
 * 用法：node tools/screenshot.mjs [输出路径]
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CELL_SIZE,
  COLS,
  ROWS,
  INITIAL_DIRECTION,
  OPPOSITE_DIRECTION,
  STORAGE_KEYS,
} from '../js/config.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'docs', 'screenshot.png'));

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const VIEWPORT = { width: 760, height: 800 };
const TARGET_SCORE = 50; // 5 个食物：蛇长 8 节、速度升到 2 级，渐变与等级都可见
const SEEDED_BEST = 120; // 模拟老玩家的历史最高分，避免出现「分数 50 / 最高分 0」的突兀对照
const MAX_WAIT_MS = 60_000;
const TURN_COOLDOWN_MS = 170; // 略大于一个 step，避免连续入队多个转向

const KEY = {
  up: { code: 'ArrowUp', vk: 38 },
  down: { code: 'ArrowDown', vk: 40 },
  left: { code: 'ArrowLeft', vk: 37 },
  right: { code: 'ArrowRight', vk: 39 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 静态服务 ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const filePath = path.resolve(ROOT, '.' + (urlPath === '/' ? '/index.html' : urlPath));

    // 只允许读取项目目录内的文件
    if (!filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }

    createReadStream(filePath)
      .on('error', () => res.writeHead(404).end())
      .on('open', () => {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
      })
      .pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------- DevTools 协议 ----------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

/** 启动无头浏览器并返回页面会话 */
async function launchBrowser() {
  const executable = await findExecutable();
  const profileDir = await mkdtemp(path.join(tmpdir(), 'snake-shot-'));
  const userDataDir = path.join(profileDir, 'profile');

  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  await waitForFile(portFile);
  const port = (await readFile(portFile, 'utf8')).split('\n')[0].trim();

  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await response.json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return {
    cdp: new Cdp(ws),
    async close() {
      ws.close();
      child.kill();
      await sleep(300);
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function findExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续找下一个
    }
  }
  throw new Error('Chrome / Edge not found');
}

// ---------- 页面内探针 ----------

/** 采样每个格子中心的颜色：蛇头是青绿最亮的格，食物是暖橙色的格 */
const BOARD_PROBE = `(() => {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cell = ${CELL_SIZE};
  const cols = ${COLS};
  const rows = ${ROWS};

  const sample = (x, y) => {
    const cx = Math.round(x * cell + cell / 2);
    const cy = Math.round(y * cell + cell / 2);
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -3; dy <= 3; dy += 3) {
      for (let dx = -3; dx <= 3; dx += 3) {
        const px = Math.min(canvas.width - 1, Math.max(0, cx + dx));
        const py = Math.min(canvas.height - 1, Math.max(0, cy + dy));
        const i = (py * canvas.width + px) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    return { r: r / n, g: g / n, b: b / n };
  };

  let head = null;
  let headScore = -Infinity;
  let food = null;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const { r, g, b } = sample(x, y);
      // 头部 hsl(158 78% 64%) 绿色占绝对优势；尾部偏蓝、食物偏红，都会被这条排除
      const headLike = g - (r + b) / 2;
      if (headLike > headScore) { headScore = headLike; head = { x, y }; }
      // 食物 #ff8a4c：红通道远超蓝通道
      if (r > 170 && r > g + 35 && r > b + 60) food = { x, y };
    }
  }

  const overlay = document.getElementById('overlay');
  return {
    head,
    food,
    playing: overlay.hidden,
    score: Number(document.getElementById('score').textContent),
  };
})()`;

async function probe(cdp) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: BOARD_PROBE, returnByValue: true });
  return result.value;
}

// ---------- 自动操作 ----------

async function pressKey(cdp, { code, vk }) {
  const event = { code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

/** 贪心朝食物走；掉头方向被游戏规则拦截，这里提前排除 */
function chooseDirection(head, food, heading) {
  if (!food) return heading;

  const candidates = [];
  if (food.y < head.y) candidates.push('up');
  if (food.y > head.y) candidates.push('down');
  if (food.x < head.x) candidates.push('left');
  if (food.x > head.x) candidates.push('right');

  const distance = {
    up: head.y - food.y,
    down: food.y - head.y,
    left: head.x - food.x,
    right: food.x - head.x,
  };

  candidates.sort((a, b) => distance[b] - distance[a]);
  const safe = candidates.find((direction) => OPPOSITE_DIRECTION[heading] !== direction);
  if (safe) return safe;

  // 食物正在正后方时只能先侧移，朝棋盘内侧拐，避免撞墙
  return head.y > 0 ? 'up' : 'down';
}

async function playUntilScore(cdp, targetScore, deadline) {
  let heading = INITIAL_DIRECTION;
  let lastTurnAt = 0;
  let best = 0;

  while (Date.now() < deadline) {
    await sleep(60);
    const state = await probe(cdp);

    if (!state.playing) {
      // 撞死或撞墙：重开一局继续，截图要的是进行中的画面
      await sleep(500);
      await pressKey(cdp, { code: 'Enter', vk: 13 });
      await sleep(300);
      heading = INITIAL_DIRECTION;
      continue;
    }

    best = Math.max(best, state.score);
    if (state.score >= targetScore) return true;
    if (!state.head || !state.food) continue;

    const desired = chooseDirection(state.head, state.food, heading);
    if (desired !== heading && Date.now() - lastTurnAt > TURN_COOLDOWN_MS) {
      await pressKey(cdp, KEY[desired]);
      heading = desired;
      lastTurnAt = Date.now();
    }
  }

  console.warn(`warn: target score not reached (best ${best}), capturing as-is`);
  return false;
}

// ---------- 主流程 ----------

const { server, port } = await startServer();
const browser = await launchBrowser();

try {
  const { cdp } = browser;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 2,
    mobile: false,
  });

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(1200);

  // 预热 localStorage 后重新加载，让 HUD 从一开始就带着历史最高分
  await cdp.send('Runtime.evaluate', {
    expression: `localStorage.setItem(${JSON.stringify(STORAGE_KEYS.bestScore)}, '${SEEDED_BEST}')`,
  });
  await cdp.send('Page.reload');
  await sleep(1200);

  await pressKey(cdp, { code: 'Enter', vk: 13 });
  await sleep(400);

  await playUntilScore(cdp, TARGET_SCORE, Date.now() + MAX_WAIT_MS);

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, Buffer.from(data, 'base64'));
  console.log(`saved ${path.relative(ROOT, OUT)}`);
} finally {
  await browser.close();
  server.close();
}
