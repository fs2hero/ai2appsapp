import assert from 'node:assert/strict';

export async function run() {
  const calls = [];
  const mockRun = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes('nvm --version')) return { ok: true, out: '0.39.7' };
    if (cmd.includes('[ -d "$HOME/.nvm" ]')) return { ok: true, out: 'yes' };
    return { ok: true, out: '' };
  };

  const mod = await import('../../tools/nvm_env.mjs');
  const chk = await mod.check(mockRun);
  assert.ok(chk.ok, 'nvm check should report ok when directory exists');

  const calls2 = [];
  const mockRun2 = async (cmd) => { calls2.push(cmd); return { ok: true, out: '' }; };
  await mod.install({ run: mockRun2, onLog: ()=>{}, modifyRc: false });
  assert.ok(calls2.length > 0, 'nvm.install should call run');
}
