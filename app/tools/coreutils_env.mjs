import {isMac, isLinux} from '../utils/sys_utils.mjs';

// const isMac = () => process.platform === 'darwin';
// const isLinux = () => process.platform === 'linux';

export async function check(run) {
  const gr = await run('command -v greadlink && greadlink --version');
  return { ok: gr.ok, version: gr.ok ? (gr.out || '').split('\n')[0] : '', fix: [isMac() ? 'brew install coreutils' : 'apt install -y coreutils'] };
}

export async function install({ run, onLog } = {}) {
  const log = (s) => onLog?.(s);
  if (isMac()) {
    if (!(await run('command -v brew')).ok) throw new Error('需要先安装 Homebrew');
    await run('brew install coreutils');
    log('coreutils: 安装完成（macOS）');
  } else if (isLinux()) {
    await run('sudo apt-get update -y || true');
    await run('sudo apt-get install -y coreutils || true');
    log('coreutils: 尝试通过 apt 安装（Linux）');
  } else {
    log('coreutils: 平台不支持安装');
  }
}

export default { check, install };
