import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'path';
import fs from 'node:fs/promises';
import * as brewEnv from '../tools/brew_env.mjs';
import * as condaEnv from '../tools/conda_env.mjs';
import * as coreutilsEnv from '../tools/coreutils_env.mjs';
import * as nvmEnv from '../tools/nvm_env.mjs';
import * as xcodeCtl from '../tools/xcode_ctl.mjs';
import * as curlEnv from '../tools/curl_env.mjs';

const sh = (cmd, env = {}) =>
  promisify(execFile)('/bin/bash', ['-lc', cmd], { timeout: 90_000, env: { ...process.env, ...env } });

const run = async (cmd) => {
  try {
    const { stdout } = await sh(cmd);
    return { ok: true, out: (stdout || '').trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || e.stderr || '').toString().trim(), code: e.code ?? -1 };
  }
};

const nvmRcLines = () => [
  `export NVM_DIR="$HOME/.nvm"`,
  `[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm`,
];

export const TOOLS_NAME = {
  XCODE: 'xcode_clt',
  BREW: 'brew',
  GIT: 'git',
  CONDA: 'conda',
  COREUTILS: 'coreutils',
  TIMEOUT: 'timeout',
  NVM: 'nvm',
  NODE22: 'node22',
  CURL: 'curl',
};

const isMac = () => process.platform === 'darwin';
const isLinux = () => process.platform === 'linux';

async function detectCondaBase() {
  const info = await run('command -v conda >/dev/null 2>&1 && conda info --base');
  if (!info.ok || !info.out) {
    const guess = path.join(os.homedir(), 'miniconda3');
    return { baseDir: guess, python: path.join(guess, 'bin', 'python'), pip: path.join(guess, 'bin', 'pip') };
  }
  const baseDir = info.out.split(/\r?\n/).pop().trim();
  return { baseDir, python: path.join(baseDir, 'bin', 'python'), pip: path.join(baseDir, 'bin', 'pip') };
}

export async function checkDeps() {
  const items = [];

  // Xcode (mac only)
  if (isMac()) {
    const x = await run('xcode-select -p');
    items.push({ key: TOOLS_NAME.XCODE, label: 'Xcode Command Line Tools', ok: x.ok, version: x.ok ? x.out : '', fix: ['xcode-select --install'], note: '若异常：sudo xcode-select --reset' });
  }

  // curl
  try {
    const cr = await curlEnv.check(run);
    items.push({ key: TOOLS_NAME.CURL, label: 'curl', ok: cr.ok, version: cr.version || '', fix: cr.fix || [] });
  } catch (e) {
    items.push({ key: TOOLS_NAME.CURL, label: 'curl', ok: false, version: '', fix: [] });
  }

  // Homebrew
  try {
    const br = await brewEnv.check(run);
    items.push({ key: TOOLS_NAME.BREW, label: 'Homebrew', ok: br.ok, version: br.version || '', fix: br.fix || [] });
  } catch (e) {
    items.push({ key: TOOLS_NAME.BREW, label: 'Homebrew', ok: false, version: '', fix: [] });
  }

  // conda
  try {
    const cr = await condaEnv.check(run);
    items.push({ key: TOOLS_NAME.CONDA, label: 'conda', ok: cr.ok, version: cr.version || '', fix: cr.fix || [] });
  } catch (e) {
    items.push({ key: TOOLS_NAME.CONDA, label: 'conda', ok: false, version: '', fix: [] });
  }

  // coreutils (greadlink)
  try {
    const cr = await coreutilsEnv.check(run);
    items.push({ key: TOOLS_NAME.COREUTILS, label: 'coreutils', ok: cr.ok, version: cr.version || '', fix: cr.fix || [] });
  } catch (e) {
    items.push({ key: TOOLS_NAME.COREUTILS, label: 'coreutils', ok: false, version: '', fix: [] });
  }

  // timeout (timeout or gtimeout)
  const t1 = await run('command -v timeout && timeout --version');
  const t2 = await run('command -v gtimeout && gtimeout --version');
  items.push({ key: TOOLS_NAME.TIMEOUT, label: 'timeout', ok: t1.ok || t2.ok, version: t1.ok ? t1.out : (t2.ok ? t2.out : ''), fix: [isMac() ? 'brew install coreutils' : 'apt install -y coreutils'] });

  // nvm
  try {
    const nr = await nvmEnv.check(run);
    items.push({ key: TOOLS_NAME.NVM, label: 'nvm', ok: nr.ok, version: nr.version || '', fix: nr.fix || [] });
  } catch (e) {
    items.push({ key: TOOLS_NAME.NVM, label: 'nvm', ok: false, version: '', fix: [] });
  }

  // Node 22 via nvm
  const nvmSrc = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`;
  const n22 = await run(`${nvmSrc}; nvm ls --no-colors | grep -E '\\bv?22(\\.|\\s|$)' || true`);
  const node22Ok = !!n22.out;
  const nodeV = await run('node -v');
  items.push({ key: TOOLS_NAME.NODE22, label: 'Node.js 22 (via nvm)', ok: node22Ok, version: nodeV.ok ? nodeV.out : '', fix: ['nvm install 22', 'nvm alias default 22', 'nvm use 22'] });

  // python / pip detection
  const py = { ok: false, version: '', pipPath: '', pythonPath: '' };
  const xOk = isMac() ? (await run('xcode-select -p')).ok : true;
  if (xOk) {
    const hasConda = (await run('command -v conda')).ok;
    if (hasConda) {
      const binfo = await detectCondaBase();
      const pyVer = await run(`${binfo.python} --version 2>&1`);
      const pipVer = await run(`${binfo.pip} --version 2>&1`);
      if (pyVer.ok && pipVer.ok) {
        py.ok = true; py.version = pyVer.out; py.pipPath = binfo.pip; py.pythonPath = binfo.python;
      }
    } else {
      const pyVer = await run('python3 --version 2>&1 || python --version 2>&1');
      const pipWhere = await run('command -v pip3 || command -v pip || true');
      if (pyVer.ok && pipWhere.ok && pipWhere.out) {
        py.ok = true; py.version = pyVer.out; py.pipPath = pipWhere.out; py.pythonPath = (await run('command -v python3 || command -v python || true')).out || '';
      }
    }
  }

  const missing = items.filter(i => !i.ok);
  return {
    ok: missing.length === 0,
    summary: missing.length ? `缺失 ${missing.length} 项：${missing.map(i => i.label).join(', ')}` : '所有依赖已就绪 ✅',
    items,
    python: py,
  };
}

export async function installDeps(selected = [], { onLog, modifyRc = true, allowSudo = false } = {}) {
  const log = (s) => onLog?.(s) || console.log(s);
  const have = (k) => selected.includes(k);
  const ok = async (cmd) => { log(`$ ${cmd}`); const r = await run(cmd); if (!r.ok) log(r.out || '(failed)'); return r.ok; };
  // Xcode (mac)
  if (have(TOOLS_NAME.XCODE) && isMac()) {
    await xcodeCtl.install({ run, onLog });
  }

  // curl
  if (have(TOOLS_NAME.CURL)) {
    const present = (await run('command -v curl')).ok;
    if (!present) await curlEnv.install({ run, onLog });
  }

  // Brew
  if (have(TOOLS_NAME.BREW)) {
    const present = (await run('command -v brew')).ok;
    if (!present) await brewEnv.install({ run, onLog });
  }

  // Conda
  if (have(TOOLS_NAME.CONDA)) {
    const present = (await run('command -v conda')).ok;
    if (!present) await condaEnv.install({ run, onLog });
  }

  // coreutils
  if (have(TOOLS_NAME.COREUTILS)) {
    const present = (await run('command -v greadlink')).ok;
    if (!present) await coreutilsEnv.install({ run, onLog });
  }

  // timeout - delegate to coreutils installer if missing
  if (have(TOOLS_NAME.TIMEOUT)) {
    const hasTimeout = (await run('command -v timeout')).ok;
    const hasGtimeout = (await run('command -v gtimeout')).ok;
    if (!hasTimeout && !hasGtimeout) await coreutilsEnv.install({ run, onLog });
  }

  // nvm
  if (have(TOOLS_NAME.NVM)) {
    const installed = (await run('command -v nvm')).ok || (await run('[ -d "$HOME/.nvm" ]')).ok;
    if (!installed) await nvmEnv.install({ run, onLog, modifyRc });
    else if (modifyRc) {
      // ensure rc lines exist
      const HOME_DIR = os.homedir();
      const zrc = path.join(HOME_DIR, '.bashrc');
      for (const line of nvmRcLines()) {
        await fs.appendFile(zrc, `\n${line}\n`).catch(() => {});
      }
    }
  }

  // node 22 via nvm
  if (have(TOOLS_NAME.NODE22)) {
    const nvmSrc = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`;
    if (!(await run(`${nvmSrc}; command -v nvm`)).ok) throw new Error('nvm 未就绪；请先安装 nvm 或开启 modifyRc 以加载。');
    await ok(`${nvmSrc}; nvm install 22`);
    await ok(`${nvmSrc}; nvm alias default 22`);
    await ok(`${nvmSrc}; nvm use 22`);
  }

  log('安装流程完成 ✅');
}
