/**
 * 极简测试工具（零依赖）。
 *
 * 项目约定不引入任何 npm 包，因此不装 jest/vitest，
 * 只用 Node 内置能力实现「断言收集 + 结果打印 + 退出码」。
 */

/**
 * 把任意值格式化成便于阅读的一行文本。
 * @param {unknown} value
 * @returns {string}
 */
function format(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 创建测试收集器。
 * @returns {{
 *   equal: (name: string, actual: unknown, expected: unknown) => void,
 *   ok: (name: string, condition: boolean) => void,
 *   noThrow: (name: string, fn: () => void) => void,
 *   finish: (title: string) => void
 * }}
 */
export function createTest() {
  /** @type {{name: string, ok: boolean, actual?: unknown, expected?: unknown}[]} */
  const cases = [];

  return {
    /**
     * 严格相等断言。用 Object.is 而非 ===：能区分 +0/-0，且 NaN 与自身相等。
     */
    equal(name, actual, expected) {
      cases.push({ name, ok: Object.is(actual, expected), actual, expected });
    },

    /**
     * 布尔断言，用于「成立/不成立」类判断。
     * @param {string} name
     * @param {boolean} condition
     * @param {unknown} [actual] 失败时用于诊断的实际值；不传则只报用例名
     */
    ok(name, condition, actual) {
      cases.push({ name, ok: Boolean(condition), actual });
    },

    /**
     * 断言执行时不抛错，用于验证异常兜底路径。
     */
    noThrow(name, fn) {
      try {
        fn();
        cases.push({ name, ok: true });
      } catch (error) {
        cases.push({ name, ok: false, actual: /** @type {Error} */ (error).message, expected: '不抛错' });
      }
    },

    /**
     * 打印结果并以失败数决定退出码，供 CI 或链式脚本使用。
     * @param {string} title
     * @returns {never}
     */
    finish(title) {
      let failed = 0;
      for (const item of cases) {
        if (!item.ok) failed += 1;
        const detail = item.ok || item.actual === undefined
          ? ''
          : `  (got ${format(item.actual)}${item.expected === undefined ? '' : `, want ${format(item.expected)}`})`;
        console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${detail}`);
      }
      console.log(`\n${title}: ${cases.length - failed}/${cases.length} passed`);
      process.exit(failed === 0 ? 0 : 1);
    },
  };
}
