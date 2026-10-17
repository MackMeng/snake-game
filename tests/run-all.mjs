/**
 * 依次运行 tests/ 下全部 *.test.mjs，并汇总退出码。
 *
 * 用子进程而非动态 import 逐个加载：每个测试文件都调用 process.exit()，
 * 同进程内加载会让第一个文件结束掉整个 runner。
 *
 * 运行：node tests/run-all.mjs
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.error('未找到任何 *.test.mjs');
  process.exit(1);
}

/** @type {string[]} */
const failedSuites = [];

for (const file of files) {
  console.log(`\n${'─'.repeat(48)}\n${file}\n${'─'.repeat(48)}`);

  const result = spawnSync(process.execPath, [join(testsDir, file)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failedSuites.push(file);
  }
}

console.log(`\n${'═'.repeat(48)}`);
if (failedSuites.length === 0) {
  console.log(`全部通过（${files.length} 个测试文件）`);
  process.exit(0);
}

console.log(`失败 ${failedSuites.length}/${files.length}：${failedSuites.join(', ')}`);
process.exit(1);
