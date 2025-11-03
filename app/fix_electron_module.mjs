#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function log(...args){ console.log('[fix-electron-macos]', ...args); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const distPath = path.join(electronDir, 'dist');

try {
  // macOS 特有修复
  if (process.platform === 'darwin') {
    if (!fs.existsSync(distPath)) {
      log('无法找到 electron/dist，可能未安装 electron。请先运行 npm install。');
      process.exit(1);
    }

    const appPath = path.join(distPath, 'Electron.app');
    if (fs.existsSync(appPath)) {
      log('找到 Electron.app，移除 quarantine 标记（xattr）并修正可执行权限...');
      try { execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' }); } catch (e) { log('xattr 执行失败：', e.message); }
      const binPath = path.join(appPath, 'Contents', 'MacOS', 'Electron');
      if (fs.existsSync(binPath)) { try { fs.chmodSync(binPath, 0o755); log('已设置 Electron 可执行文件权限'); } catch (e) { log('chmod 失败：', e.message); } }
    } else {
      log('Electron.app 未找到；请检查 node_modules/electron 的安装。');
    }

    log('尝试重建本地二进制（npm rebuild --update-binary）...');
    try { execFileSync('npm', ['rebuild', '--update-binary'], { stdio: 'inherit' }); } catch (e) { log('npm rebuild 失败：', e.message); }
    log('macOS 修复步骤完成。');
    process.exit(0);
  }

  // 非 macOS：如果 node_modules/electron/dist 中包含 macOS 的 Electron.app，说明安装错了平台的包
  if (fs.existsSync(distPath)) {
    const appPath = path.join(distPath, 'Electron.app');
    if (fs.existsSync(appPath)) {
      log('检测到 node_modules/electron/dist 中包含 macOS 的 Electron.app，但当前平台不是 macOS。');
      log('将尝试删除 node_modules/electron 并重新安装与 package.json 对应的 electron 版本（以获取当前平台的二进制）...');

      try { execFileSync('rm', ['-rf', electronDir], { stdio: 'inherit' }); log('已删除 node_modules/electron'); } catch (e) { log('删除 node_modules/electron 失败：', e.message); }

      // 从 app/package.json 读取 electron 版本
      try {
        const pkgPath = path.join(root, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const version = (pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron) || 'latest';
        log('将安装 electron@' + version);
        try { execFileSync('npm', ['install', `electron@${version}`], { stdio: 'inherit' }); log('electron 重新安装完成'); } catch (e) { log('npm install electron 失败：', e.message); }
      } catch (e) { log('读取 package.json 失败：', e.message); }

      log('尝试执行 npm rebuild --update-binary 以确保本地二进制一致...');
      try { execFileSync('npm', ['rebuild', '--update-binary'], { stdio: 'inherit' }); } catch (e) { log('npm rebuild 失败：', e.message); }
      log('修复完成，请重新运行 `npm start`。');
      process.exit(0);
    }
  }

  log('未检测到需要修复的 Electron 二进制（dist 下无 Electron.app）。如果仍然报错，请手动检查 node_modules/electron 目录。');
  process.exit(0);
} catch (e) {
  console.error('执行修复脚本时发生错误：', e && e.stack ? e.stack : e);
  process.exit(2);
}
