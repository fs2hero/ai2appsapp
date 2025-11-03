const isMac = () => process.platform === 'darwin';
const isLinux = () => process.platform === 'linux';

export async function check(run) {
  const r = await run('command -v curl && curl --version');
  return { ok: r.ok, version: r.ok ? (r.out || '').split('\n')[0] : '', fix: [isMac() ? 'brew install curl' : 'sudo apt-get install -y curl'] };
}

export async function install({ run, onLog } = {}) {
  const log = (s) => onLog?.(s) || console.log(s);
  if (isMac()) {
    if (!(await run('command -v brew')).ok) {
      log('Homebrew 未安装，无法通过 brew 安装 curl。请先安装 Homebrew 或手动安装 curl。');
      return;
    }
    await run('brew install curl');
    log('curl: macOS 下通过 Homebrew 安装完成（如有必要请重启 shell）。');
    return;
  }

  if (isLinux()) {
    // 尝试多种包管理器
    const tryCmds = [
      'sudo apt-get update -y && sudo apt-get install -y curl',
      'sudo dnf install -y curl',
      'sudo pacman -Sy --noconfirm curl',
      'sudo zypper install -y curl'
    ];
    for (const cmd of tryCmds) {
      const r = await run(cmd);
      if (r.ok) { log('curl: 已通过系统包管理器安装或已经存在'); return; }
    }
    log('curl: 无法通过已知包管理器自动安装，请使用系统包管理器手动安装 curl。');
    return;
  }

  log('curl: 当前平台不支持自动安装');
}

export default { check, install };
