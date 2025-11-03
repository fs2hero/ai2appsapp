import {isMac, isLinux} from '../utils/sys_utils.mjs';

// const isMac = () => process.platform === 'darwin';
// const isLinux = () => process.platform === 'linux';

export async function check(run) {
  const b = await run('command -v brew && brew --version');
  return { ok: b.ok, version: b.ok ? (b.out || '').split('\n')[0] : '', fix: [isMac() ? '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' : 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'] };
}

export async function install({ run, onLog } = {}) {
  const log = (s) => onLog?.(s);
  if (isMac()) {
    await run('NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    await run('eval "$(/opt/homebrew/bin/brew shellenv)" || true');
    log('Homebrew: 安装完成（macOS）');
  } else if (isLinux()) {
    await run('sh -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    log('Homebrew: 安装完成（Linux）');
  } else {
    log('Homebrew: 平台不支持安装');
  }
}

export default { check, install };
