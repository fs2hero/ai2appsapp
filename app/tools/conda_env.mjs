import os from 'node:os';
import path from 'path';
import { isMac, isLinux, isArm } from '../utils/sys_utils.mjs';

// const isMac = () => process.platform === 'darwin';
// const isLinux = () => process.platform === 'linux';

export async function check(run) {
  const c = await run('command -v conda && conda --version');
  return { ok: c.ok, version: c.ok ? c.out.split('\n').slice(-1)[0] : '', fix: [isMac() ? 'brew install --cask miniconda' : 'curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh | bash -s -- -b -p $HOME/miniconda3'] };
}

export async function install({ run, onLog } = {}) {
  const log = (s) => onLog?.(s);
  if (isMac()) {
    if (!(await run('command -v brew')).ok) throw new Error('需要先安装 Homebrew');
    await run('brew install --cask miniconda');
    await run(`echo 'export PATH="$HOME/miniconda3/bin:$PATH"' >> ~/.zshrc`).catch(()=>{});
    log('conda: 安装完成（macOS）');
  } else if (isLinux()) {
    const inst = isArm ? 'Miniconda3-latest-Linux-aarch64.sh' : 'Miniconda3-latest-Linux-x86_64.sh';
    await run(`curl -fsSL https://repo.anaconda.com/miniconda/${inst} -o /tmp/${inst}`);
    const perm = `/bin/chmod 777 "/tmp/${inst}"`;
    await run(perm)
    await run(`/bin/bash /tmp/${inst} -u -b -p $HOME/miniconda3`);
    await run(`echo 'export PATH="$HOME/miniconda3/bin:$PATH"' >> ~/.bashrc`).catch(()=>{});
    log('conda: 安装完成（Linux）');
  } else {
    log('conda: 平台不支持安装');
  }
}

export async function detectCondaBase(run) {
  const info = await run('command -v conda >/dev/null 2>&1 && conda info --base');
  if (!info.ok || !info.out) {
    const guess = path.join(os.homedir(), 'miniconda3');
    return { baseDir: guess, python: path.join(guess, 'bin', 'python'), pip: path.join(guess, 'bin', 'pip') };
  }
  const baseDir = info.out.split(/\r?\n/).pop().trim();
  return { baseDir, python: path.join(baseDir, 'bin', 'python'), pip: path.join(baseDir, 'bin', 'pip') };
}

export default { check, install, detectCondaBase };
