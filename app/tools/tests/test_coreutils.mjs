import assert from 'node:assert/strict';

export async function run() {
  const calls = [];
  const mockRun = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes('command -v greadlink')) return { ok: true, out: '/usr/local/bin/greadlink\ngreadlink (GNU coreutils) 8.32' };
    return { ok: true, out: '' };
  };

  const mod = await import('../../tools/coreutils_env.mjs');
  const chk = await mod.check(mockRun);
  assert.ok(chk.ok, 'coreutils check should report ok');

  const calls2 = [];
  const mockRun2 = async (cmd) => { calls2.push(cmd); return { ok: true, out: '' }; };
  await mod.install({ run: mockRun2, onLog: ()=>{} });
  assert.ok(calls2.length > 0, 'coreutils.install should call run');
}
