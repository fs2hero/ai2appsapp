import assert from 'node:assert/strict';

export async function run() {
  const calls = [];
  const mockRun = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes('xcode-select -p')) return { ok: true, out: '/Applications/Xcode.app/Contents/Developer' };
    return { ok: true, out: '' };
  };

  const mod = await import('../../tools/xcode_ctl.mjs');
  const chk = await mod.check(mockRun);
  assert.ok(chk.ok, 'xcode check should report ok');

  const calls2 = [];
  const mockRun2 = async (cmd) => { calls2.push(cmd); return { ok: true, out: '' }; };
  await mod.install({ run: mockRun2, onLog: ()=>{} });
  assert.ok(calls2.length > 0, 'xcode.install should call run');
}
