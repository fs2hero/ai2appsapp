import path from 'path';
import fs from 'fs';

const tests = [
  './tests/test_brew.mjs',
  './tests/test_conda.mjs',
  './tests/test_coreutils.mjs',
  './tests/test_nvm.mjs',
  './tests/test_xcode.mjs',
];

async function runAll() {
  const results = [];
  for (const t of tests) {
    const p = path.join(path.dirname(new URL(import.meta.url).pathname), t);
    try {
      const mod = await import(p);
      if (typeof mod.run !== 'function') throw new Error('test must export run()');
      process.stdout.write(`RUN ${t} ... `);
      await mod.run();
      console.log('OK');
      results.push({ test: t, ok: true });
    } catch (e) {
      console.log('FAILED');
      console.error(e && e.stack ? e.stack : e);
      results.push({ test: t, ok: false, err: e });
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log('\nSummary:');
  results.forEach(r => console.log(`${r.ok ? '✓' : '✗'} ${r.test}`));
  process.exit(failed.length ? 1 : 0);
}

runAll();
