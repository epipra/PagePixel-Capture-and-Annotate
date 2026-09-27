// Tiny in-browser test runner: tests run against the real extension modules served over
// local HTTP (chrome.* is mocked only where a test needs it). Results come back as JSON.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export async function rejects(promise, check) {
  try {
    await promise;
  } catch (err) {
    check(err);
    return;
  }
  throw new Error('expected rejection');
}

export async function run(filter = '') {
  const out = [];
  for (const t of tests) {
    if (!t.name.includes(filter)) continue;
    const start = performance.now();
    try {
      await t.fn();
      out.push({ name: t.name, ok: true, ms: Math.round(performance.now() - start) });
    } catch (err) {
      out.push({ name: t.name, ok: false, error: String((err && err.message) || err) });
    }
  }
  return { passed: out.filter((r) => r.ok).length, failed: out.filter((r) => !r.ok).length, results: out };
}
