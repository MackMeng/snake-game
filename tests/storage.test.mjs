/**
 * storage.js 持久化逻辑测试。
 *
 * 用内存 Map 冒充 localStorage，覆盖「有记录 / 脏数据 / 抛错」三类路径。
 * 运行：node tests/storage.test.mjs
 */

import { STORAGE_KEYS } from '../js/config.js';
import { loadBestScore, saveBestScore, loadMuted, saveMuted } from '../js/storage.js';
import { createTest } from './harness.mjs';

const t = createTest();

/**
 * 生成假的 localStorage。
 * @param {{throwOnAccess?: boolean}} [options]
 */
function installFakeStorage(options = {}) {
  /** @type {Map<string, string>} */
  const store = new Map();
  const guard = () => {
    // 隐私模式/禁用存储时，访问 localStorage 会直接抛错
    if (options.throwOnAccess) throw new Error('storage blocked');
  };

  globalThis.localStorage = {
    getItem: (k) => {
      guard();
      return store.has(k) ? store.get(k) : null;
    },
    setItem: (k, v) => {
      guard();
      store.set(k, String(v));
    },
  };

  return store;
}

// ---------- 正常路径 ----------

const store = installFakeStorage();

t.equal('无记录时最高分为 0', loadBestScore(), 0);
t.equal('无记录时静音为 false', loadMuted(), false);

saveBestScore(120);
t.equal('写入后可读回', loadBestScore(), 120);

saveBestScore(88.7);
t.equal('小数向下取整', loadBestScore(), 88);

// ---------- 脏数据 ----------

store.set(STORAGE_KEYS.bestScore, 'abc');
t.equal('非数字归 0', loadBestScore(), 0);

store.set(STORAGE_KEYS.bestScore, '-5');
t.equal('负数归 0', loadBestScore(), 0);

store.set(STORAGE_KEYS.bestScore, 'Infinity');
t.equal('Infinity 归 0', loadBestScore(), 0);

store.set(STORAGE_KEYS.bestScore, '');
t.equal('空串归 0', loadBestScore(), 0);

store.set(STORAGE_KEYS.bestScore, '12abc');
t.equal('带尾巴的数字取前缀', loadBestScore(), 12);

store.set(STORAGE_KEYS.bestScore, '300');
saveBestScore(NaN);
t.equal('写入 NaN 被拒绝，不覆盖已有记录', loadBestScore(), 300);

saveBestScore(-1);
t.equal('写入负数被拒绝', loadBestScore(), 300);

store.set(STORAGE_KEYS.muted, 'TRUE');
t.equal('静音只认小写 true', loadMuted(), false);

store.set(STORAGE_KEYS.muted, 'true');
t.equal('静音 true 被识别', loadMuted(), true);

saveMuted(false);
t.equal('取消静音可写回', loadMuted(), false);

// ---------- 存储不可用 ----------

installFakeStorage({ throwOnAccess: true });

t.noThrow('抛错时 saveBestScore 不崩溃', () => saveBestScore(999));
t.noThrow('抛错时 saveMuted 不崩溃', () => saveMuted(true));
t.equal('抛错时 loadBestScore 降级为 0', loadBestScore(), 0);
t.equal('抛错时 loadMuted 降级为 false', loadMuted(), false);

t.finish('storage');
