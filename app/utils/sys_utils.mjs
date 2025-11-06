// import{ dialog,screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// import os from "node:os";
import path from "path";
// import fs from "node:fs/promises";
import fs from 'fs';

const execFileP = promisify(execFile);
const fsp=fs.promises;

// export const username = process.env.SUDO_USER || process.env.USER || "root";
export const isArm = process.arch === "arm64";

export const isMac = () => process.platform === 'darwin';
export const isLinux = () => process.platform === 'linux';
export const isWin = () => process.platform === 'win32';


export function ensureDirSync(dirPath) {
    if (fs.existsSync(dirPath)) return;
    fs.mkdirSync(dirPath, { recursive: true });
}

export async function copyFileToDir(srcFile, targetDir,targetName) {
    const fileName = path.basename(srcFile);
    const destPath = path.join(targetDir, targetName||fileName);
    await fsp.mkdir(targetDir, { recursive: true }); // 确保目录存在
    await fsp.copyFile(srcFile, destPath);
}

//---------------------------------------------------------------------------
export async function copyDirWithReplace(srcDir, destDir) {
    await fsp.mkdir(destDir, { recursive: true });
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        
        if (entry.isDirectory()) {
            // 如果目标目录中已存在该子目录，先删除
            try {
                await fsp.rm(destPath, { recursive: true, force: true });
            } catch (e) {} // 忽略不存在等错误
            
            await copyDirWithReplace(srcPath, destPath);
        } else if (entry.isFile()) {
            await fsp.copyFile(srcPath, destPath);
        }
    }
}

export async function linkDir(srcDir, dstDir) {
	try {
		await fsp.mkdir(path.dirname(dstDir), { recursive: true });
		await fsp.symlink(srcDir, dstDir, 'dir');
		console.log(`链接创建成功: ${dstDir} -> ${srcDir}`);
	} catch (err) {
		console.error(`创建符号链接失败: ${err.message}`);
	}
}

export const sh = async (cmd, env = {}) => {
  const start = Date.now();
  // Log command (single-line) and a small env summary (don't print secrets)
  try {
    console.log(`[sh] RUN -> ${cmd.replace(/\n/g, ' ')} `);
    console.log(`[sh] ENV PATH=${(process.env.PATH || '').slice(0, 200)}${(process.env.PATH || '').length > 200 ? '...' : ''}`);
    const { stdout, stderr } = await execFileP('/bin/bash', ['-lc', cmd], { timeout: 120_000, env: { ...process.env, ...env } });
    const took = Date.now() - start;
    const sOut = (stdout || '').toString();
    const sErr = (stderr || '').toString();
    console.log(`[sh] OK  <- ${cmd.split('\n')[0].slice(0,80)}... (${took}ms) stdout=${sOut.slice(0,1000)}${sOut.length>1000?"...":""}`);
    if (sErr) console.log(`[sh] STDERR: ${sErr.slice(0,1000)}${sErr.length>1000?"...":""}`);
    return { stdout, stderr };
  } catch (e) {
    const took = Date.now() - start;
    const errOut = (e.stdout || e.stderr || '') .toString();
    console.error(`[sh] ERR  <- ${cmd.split('\n')[0].slice(0,80)}... (${took}ms) code=${e.code ?? 'N/A'} output=${errOut.slice(0,1000)}${errOut.length>1000?"...":""}`);
    throw e;
  }
};

export const run = async (cmd) => {
  try {
    const { stdout } = await sh(cmd);
    return { ok: true, out: (stdout || '').trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || e.stderr || '').toString().trim(), code: e.code ?? -1 };
  }
};