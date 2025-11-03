import { isMac, isLinux } from '../utils/sys_utils.mjs';

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
    const inst = 'Miniconda3-latest-Linux-x86_64.sh';
    await run(`curl -fsSL https://repo.anaconda.com/miniconda/${inst} -o /tmp/${inst}`);
    await run(`bash /tmp/${inst} -b -p $HOME/miniconda3`);
    await run(`echo 'export PATH="$HOME/miniconda3/bin:$PATH"' >> ~/.bashrc`).catch(()=>{});
    log('conda: 安装完成（Linux）');
  } else {
    log('conda: 平台不支持安装');
  }
}

export default { check, install };
