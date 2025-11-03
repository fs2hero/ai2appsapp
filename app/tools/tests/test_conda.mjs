import assert from 'node:assert/strict';

export async function run() {
  const calls = [];
  const mockRun = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes('command -v conda')) return { ok: true, out: '/home/user/miniconda3/bin/conda\nconda 23.0.0' };
    return { ok: true, out: '' };
  };

  const mod = await import('../../tools/conda_env.mjs');
  const chk = await mod.check(mockRun);
  assert.ok(chk.ok, 'conda should be reported ok when mockRun returns conda');

  // install should call run; simulate installation
  const calls2 = [];
  const mockRun2 = async (cmd) => { calls2.push(cmd); return { ok: true, out: '' }; };
  await mod.install({ run: mockRun2, onLog: ()=>{} });
  assert.ok(calls2.length > 0, 'conda.install should call run');
}
