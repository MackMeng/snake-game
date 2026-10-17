/**
 * 服务层：输入处理。
 *
 * 把原生键盘事件翻译成**语义化指令**交给编排层，自身不判断游戏规则
 * （禁止掉头、方向去重都是 game.js 的职责）。
 * 用 KeyboardEvent.code 而非 key，避免输入法与大小写干扰。
 */

import { KEY_TO_DIRECTION, KEY_PAUSE, KEY_START, KEY_RESTART } from './config.js';

/** 焦点落在这些元素上时，按键应当还给元素本身而不是被游戏吞掉 */
const INTERACTIVE_SELECTOR = 'button, input, textarea, select, a[href]';

/**
 * 判断事件目标是否为可交互元素。
 * 不直接用 `instanceof Element`，以便在无 DOM 环境下测试。
 * @param {unknown} target
 * @returns {boolean}
 */
function isInteractiveTarget(target) {
  return Boolean(
    target
    && typeof (/** @type {any} */ (target).closest) === 'function'
    && (/** @type {any} */ (target).closest(INTERACTIVE_SELECTOR)),
  );
}

/**
 * 绑定输入监听。
 *
 * @param {Object} handlers
 * @param {(direction: string) => void} handlers.onDirection 方向指令
 * @param {() => void} handlers.onTogglePause 暂停/继续
 * @param {() => void} handlers.onStart 开始，或从结束态重开
 * @param {() => void} handlers.onRestart 强制重开
 * @param {() => void} [handlers.onFirstInput] 首次用户交互时触发，用于解锁 AudioContext
 * @returns {() => void} 解绑函数
 */
export function bindInput(handlers) {
  const { onDirection, onTogglePause, onStart, onRestart, onFirstInput } = handlers;

  let firstInputHandled = false;

  /**
   * 上报首次交互。AudioContext 的自动播放限制只会因真实用户手势解除，
   * 且只需解除一次，故此处做去重。
   */
  function notifyFirstInput() {
    if (firstInputHandled) return;
    firstInputHandled = true;
    onFirstInput?.();
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    const { code } = event;

    const direction = KEY_TO_DIRECTION[code];
    const isPause = KEY_PAUSE.includes(code);
    const isStart = KEY_START.includes(code);
    const isRestart = KEY_RESTART.includes(code);

    if (!direction && !isPause && !isStart && !isRestart) return;

    // 组合键留给浏览器：Ctrl+R / Cmd+R 是刷新页面，不该被当成重开
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // 长按产生的重复事件不含新信息，方向队列去重后也是同一结果
    if (event.repeat) return;

    // 焦点在按钮上时把按键还给它，否则空格会既激活按钮又暂停游戏
    if (isInteractiveTarget(event.target)) return;

    // 方向键与空格会滚动页面，必须拦掉；Enter/R 无默认行为，不必拦
    if (direction || isPause) event.preventDefault();

    notifyFirstInput();

    if (direction) onDirection(direction);
    else if (isPause) onTogglePause();
    else if (isStart) onStart();
    else onRestart();
  }

  function handlePointerdown() {
    notifyFirstInput();
  }

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('pointerdown', handlePointerdown);

  return function unbind() {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('pointerdown', handlePointerdown);
  };
}
