import assert from 'node:assert/strict';

export async function run() {
  // mock run that simulates brew present first
  const calls = [];
  const mockRun = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes('command -v brew')) return { ok: true, out: '/opt/homebrew/bin/brew\nHomebrew 4.0.0' };
    return { ok: true, out: '' };
  };

  const mod = await import('../../tools/brew_env.mjs');
  const chk = await mod.check(mockRun);
  assert.ok(chk.ok, 'brew check should report ok');
  assert.ok(chk.version.includes('Homebrew') || chk.version.length > 0, 'brew version should be present');

  // test install path: ensure install invokes expected script
  const calls2 = [];
  const mockRun2 = async (cmd) => { calls2.push(cmd); return { ok: true, out: '' }; };
  await mod.install({ run: mockRun2, onLog: ()=>{} });
  assert.ok(calls2.length > 0, 'install should call run at least once');
}
