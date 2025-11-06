import { isMac, isLinux } from '../utils/sys_utils.mjs';

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
    log('Homebrew: 开始安装（Linux）');
    await run('NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    
    // 添加 Homebrew 到 PATH
    await run('test -d ~/.linuxbrew && eval "$(~/.linuxbrew/bin/brew shellenv)"');
    await run('test -d /home/linuxbrew/.linuxbrew && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"');
    
    // 确保 brew 命令可用
    const testBrew = await run('brew --version');
    if (!testBrew.ok) {
      log('Homebrew: 添加环境变量');
      // 添加到当前 shell 环境
      await run('echo "eval \\"\\$($(brew --prefix)/bin/brew shellenv)\\"" >> ~/.profile');
      await run('echo "eval \\"\\$($(brew --prefix)/bin/brew shellenv)\\"" >> ~/.bashrc');
      // 立即生效
      await run('eval "$($(brew --prefix)/bin/brew shellenv)"');
    }
    
    log('Homebrew: 安装完成（Linux）');
  } else {
    log('Homebrew: 平台不支持安装');
  }
}

export default { check, install };
