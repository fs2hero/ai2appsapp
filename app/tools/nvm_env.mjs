import os from 'node:os';
import path from 'path';
import fs from 'node:fs/promises';

const nvmRcLines = () => [
  `export NVM_DIR="$HOME/.nvm"`,
  `[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm`,
];

export async function check(run) {
  const nvmSrc = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`;
  const nvmCheck = await run(`${nvmSrc}; command -v nvm && nvm --version`);
  const nvmInstalled = nvmCheck.ok || (await run('[ -d "$HOME/.nvm" ] && echo yes')).ok;
  return { ok: nvmInstalled, version: nvmInstalled ? (nvmCheck.out.split('\n').slice(-1)[0] || 'installed') : '', fix: ['curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash', '# 安装后请新开一个 shell，或将 nvm 初始化加入 rc：', ...nvmRcLines().map(l => `echo '${l}' >> ~/.bashrc`)] };
}

export async function install({ run, onLog, modifyRc = true } = {}) {
  const log = (s) => onLog?.(s);
  const installed = (await run('command -v nvm')).ok || (await run('[ -d "$HOME/.nvm" ]')).ok;
  if (!installed) {
    await run('curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash');
  }
  if (modifyRc) {
    const HOME_DIR = os.homedir();
    const zrc = path.join(HOME_DIR, '.bashrc');
    for (const line of nvmRcLines()) {
      await fs.appendFile(zrc, `\n${line}\n`).catch(() => {});
    }
  }
  log('nvm: 安装流程完成');
}

export default { check, install };
