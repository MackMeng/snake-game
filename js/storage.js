/**
 * 服务层：localStorage 持久化封装（最高分、静音开关）。
 *
 * 职责：读写持久化数据，并吞掉浏览器异常（隐私模式/禁用存储时 localStorage 会抛错），
 * 保证存储不可用只是"不记住"，而不是让整个游戏崩掉。
 * 不参与任何游戏规则判定。
 */

import { STORAGE_KEYS } from './config.js';

/**
 * 读取原始字符串。任何异常都降级为 null，调用方无需处理抛错。
 * @param {string} key
 * @returns {string|null}
 */
function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 写入原始字符串。失败（如配额满、隐私模式）时静默忽略。
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储不可用不应中断游戏，丢弃这次写入即可
  }
}

/**
 * 读取历史最高分。
 * @returns {number} 无记录、格式非法或读取失败时返回 0
 */
export function loadBestScore() {
  const raw = readRaw(STORAGE_KEYS.bestScore);
  if (raw === null) return 0;

  const value = Number.parseInt(raw, 10);
  // 用 isFinite 同时挡掉 NaN 与 Infinity；负数视为脏数据
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 写入历史最高分。
 * @param {number} score
 * @returns {void}
 */
export function saveBestScore(score) {
  if (!Number.isFinite(score) || score < 0) return;
  writeRaw(STORAGE_KEYS.bestScore, String(Math.floor(score)));
}

/**
 * 读取静音开关状态。
 * @returns {boolean} 无记录或读取失败时返回 false（默认开启音效）
 */
export function loadMuted() {
  return readRaw(STORAGE_KEYS.muted) === 'true';
}

/**
 * 写入静音开关状态。
 * @param {boolean} muted
 * @returns {void}
 */
export function saveMuted(muted) {
  writeRaw(STORAGE_KEYS.muted, muted ? 'true' : 'false');
}
