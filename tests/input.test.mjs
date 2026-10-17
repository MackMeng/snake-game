/**
 * input.js 输入翻译测试。
 *
 * Node 无 DOM，用假的 window 对象捕获监听器，再手动派发伪造事件。
 * 运行：node tests/input.test.mjs
 */

import { bindInput } from '../js/input.js';
import { createTest } from './harness.mjs';

const t = createTest();

// ---------- 假的 window：只记录监听器，由测试手动触发 ----------

/** @type {Map<string, Function[]>} */
let listeners = new Map();

globalThis.window = {
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  },
  removeEventListener(type, handler) {
    const list = listeners.get(type) ?? [];
    listeners.set(type, list.filter((item) => item !== handler));
  },
};

/**
 * 派发一个伪造事件。
 * @param {string} type
 * @param {Record<string, unknown>} props
 */
function dispatch(type, props = {}) {
  const event = {
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...props,
  };
  for (const handler of listeners.get(type) ?? []) handler(event);
  return event;
}

/** 记录所有回调触发情况 */
function createRecorder() {
  /** @type {string[]} */
  const log = [];
  return {
    log,
    handlers: {
      onDirection: (d) => log.push(`direction:${d}`),
      onTogglePause: () => log.push('pause'),
      onStart: () => log.push('start'),
      onRestart: () => log.push('restart'),
      onFirstInput: () => log.push('firstInput'),
    },
  };
}

// ---------- 方向键 ----------

listeners = new Map();
let rec = createRecorder();
bindInput(rec.handlers);

const DIRECTION_KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

for (const [code, direction] of Object.entries(DIRECTION_KEYS)) {
  rec.log.length = 0;
  dispatch('keydown', { code });
  t.ok(`${code} → ${direction}`, rec.log.includes(`direction:${direction}`), rec.log.join(','));
}

rec.log.length = 0;
const arrowEvent = dispatch('keydown', { code: 'ArrowUp' });
t.ok('方向键阻止页面滚动', arrowEvent.defaultPrevented);

// ---------- 控制键 ----------

rec.log.length = 0;
const spaceEvent = dispatch('keydown', { code: 'Space' });
t.ok('空格 → 暂停', rec.log.includes('pause'), rec.log.join(','));
t.ok('空格阻止页面滚动', spaceEvent.defaultPrevented);

rec.log.length = 0;
dispatch('keydown', { code: 'KeyP' });
t.ok('P → 暂停', rec.log.includes('pause'), rec.log.join(','));

rec.log.length = 0;
const enterEvent = dispatch('keydown', { code: 'Enter' });
t.ok('Enter → 开始', rec.log.includes('start'), rec.log.join(','));
t.equal('Enter 无默认行为，不拦截', enterEvent.defaultPrevented, false);

rec.log.length = 0;
dispatch('keydown', { code: 'NumpadEnter' });
t.ok('小键盘 Enter → 开始', rec.log.includes('start'), rec.log.join(','));

rec.log.length = 0;
dispatch('keydown', { code: 'KeyR' });
t.ok('R → 重开', rec.log.includes('restart'), rec.log.join(','));

// ---------- 应当被忽略的按键 ----------

rec.log.length = 0;
dispatch('keydown', { code: 'KeyQ' });
dispatch('keydown', { code: 'F5' });
dispatch('keydown', { code: 'Escape' });
t.equal('无关按键无任何反应', rec.log.length, 0);

rec.log.length = 0;
dispatch('keydown', { code: 'KeyR', ctrlKey: true });
dispatch('keydown', { code: 'KeyR', metaKey: true });
t.equal('Ctrl+R / Cmd+R 不被当成重开', rec.log.length, 0);

rec.log.length = 0;
dispatch('keydown', { code: 'ArrowUp', repeat: true });
t.equal('长按重复事件被忽略', rec.log.length, 0);

// ---------- 焦点在可交互元素上 ----------

rec.log.length = 0;
const focusable = { closest: (sel) => (sel.includes('button') ? {} : null) };
const spaceOnButton = dispatch('keydown', { code: 'Space', target: focusable });
t.equal('按钮上的空格不触发暂停', rec.log.length, 0);
t.equal('按钮上的空格不拦截默认行为', spaceOnButton.defaultPrevented, false);

rec.log.length = 0;
dispatch('keydown', { code: 'ArrowUp', target: focusable });
t.equal('按钮上的方向键同样不触发', rec.log.length, 0);

const plainTarget = { closest: () => null };
rec.log.length = 0;
dispatch('keydown', { code: 'ArrowUp', target: plainTarget });
t.ok('非交互元素上的方向键正常触发', rec.log.includes('direction:up'));

// ---------- 首次交互上报（需全新实例，前面的按键已消费掉标记）----------

listeners = new Map();
rec = createRecorder();
bindInput(rec.handlers);

t.equal('绑定后尚未上报', rec.log.length, 0);

dispatch('keydown', { code: 'ArrowUp' });
t.equal('首次按键触发上报', rec.log.filter((x) => x === 'firstInput').length, 1);

dispatch('keydown', { code: 'ArrowDown' });
dispatch('keydown', { code: 'Space' });
t.equal('后续按键不重复上报', rec.log.filter((x) => x === 'firstInput').length, 1);

// ---------- 首次交互的另一条路径 ----------

listeners = new Map();
rec = createRecorder();
bindInput(rec.handlers);
dispatch('pointerdown');
t.ok('指针按下也上报首次交互', rec.log.includes('firstInput'), rec.log.join(','));

// ---------- 解绑 ----------

listeners = new Map();
rec = createRecorder();
const unbind = bindInput(rec.handlers);
unbind();
rec.log.length = 0;
dispatch('keydown', { code: 'ArrowUp' });
dispatch('keydown', { code: 'Space' });
t.equal('解绑后不再响应任何按键', rec.log.length, 0);

t.finish('input');
