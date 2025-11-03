// import{ dialog,screen } from "electron";
// import { execFile } from "node:child_process";
// import { promisify } from "node:util";
// import os from "node:os";
// import path from "path";
// import fs from "node:fs/promises";
import { checkDeps as commonCheckDeps, installDeps as commonInstallDeps } from './deps_common.mjs';


const sh = (cmd, env = {}) =>
  promisify(execFile)('/bin/bash', ['-lc', cmd], { timeout: 90_000, env: { ...process.env, ...env } });

export const run = async (cmd) => {
    try {
        const { stdout } = await sh(cmd);
        return { ok: true, out: (stdout || "").trim() };
    }catch (e){
        return { ok: false, out: (e.stdout || e.stderr || "").toString().trim(), code: e.code ?? -1 };
    }
};


// const brewPrefix = isArm ? "/opt/homebrew" : "/usr/local";
// const brewBin    = `${brewPrefix}/bin/brew`;


// async function detectCondaBase() {
// 	// 优先通过 `conda info --base` 获取安装前缀
// 	const info = await run("command -v conda >/dev/null 2>&1 && conda info --base");
// 	if (!info.ok || !info.out) {
// 		// 退化到常见安装路径（brew 与官方脚本通常一致）
// 		const guess = path.join(os.homedir(), "miniconda3");
// 		return { baseDir: guess, python: path.join(guess, "bin", "python"), pip: path.join(guess, "bin", "pip") };
// 	}
// 	const baseDir = info.out.split(/\r?\n/).pop().trim();
// 	return { baseDir, python: path.join(baseDir, "bin", "python"), pip: path.join(baseDir, "bin", "pip") };
// }


// const ZSHRC = `${HOME}/.zshrc`;
// const ZPROFILE = `${HOME}/.zprofile`;

// const KEYS = {
// 	XCODE: "xcode_clt",
// 	BREW: "brew",
// 	GIT: "git",
// 	CONDA: "conda",
// 	COREUTILS: "coreutils",
// 	TIMEOUT: "timeout",
// 	NVM: "nvm",
// 	NODE22: "node22"
// };

// const nvmSrc = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`;
// const nvmRun = (cmd) => `${nvmSrc}; ${cmd}`;

// /** 生成可写入到 rc 的 nvm 初始化片段 */
// function nvmRcLines() {
// 	return [
// 		`export NVM_DIR="$HOME/.nvm"`,
// 		`[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm`,
// 	];
// }

// async function ensureBrewDirsWritable(log) {
// 	const dirs = [
// 		brewPrefix,
// 		`${brewPrefix}/bin`,
// 		`${brewPrefix}/etc`,
// 		`${brewPrefix}/include`,
// 		`${brewPrefix}/lib`,
// 		`${brewPrefix}/sbin`,
// 		`${brewPrefix}/share`,
// 		`${brewPrefix}/var`,
// 		`${brewPrefix}/Cellar`,
// 		`${brewPrefix}/Frameworks`,
// 	];
	
// 	// 用 install -d 一次性创建目录并设置权限；再补一条 chown -R 兜底
// 	const mk = `/usr/bin/install -d -m 0755 -o "${username}" -g admin ${dirs.map(d => `"${d}"`).join(" ")}`;
// 	const own = `/usr/sbin/chown -R "${username}":admin "${brewPrefix}"`;
// 	const perm = `/bin/chmod -R u+rwX "${brewPrefix}"`;
	
// 	log?.(`准备 Homebrew 目录（一次提权）：${brewPrefix}`);
// 	const r = await runAdminScript([mk, own, perm]);
// 	return r.ok;
// }

/** 检测依赖，返回 VO */
export async function checkDeps() {
	// delegate to shared implementation (supports macOS and Linux)
	return commonCheckDeps();
}

/**
 * 自动安装（按 UI 勾选的 key 执行）
 * 选项：
 */
export async function installDeps(selected, opts = {}) {
	// delegate to shared implementation
	return commonInstallDeps(selected, opts);
}


export async function pipInstall(pythonVo, reqPath, { onLog } = {}) {
	const log = (s) => {
		if(onLog){
			onLog(s);
		}else{
			console.log(s);
		}
	}
	// 优先使用 conda run 确保在 base 环境里执行（如果存在 conda）
	const hasConda = (await run("command -v conda")).ok;
	
	if (hasConda) {
		log?.("使用 `conda run -n base pip install -r` 安装依赖…");
		const r = await run(`conda run -n base pip install -r "${reqPath.replace(/(["\\ ])/g, "\\$1")}"`);
		if (!r.ok) { log?.(r.out); return false; }
		log?.(r.out); return true;
	}
	
	// 否则退化到 VO 里的 pipPath 或系统 pip
	const pip = pythonVo?.pipPath || "pip3";
	log?.(`使用 pip: ${pip}`);
	const r = await run(`${pip} install -r "${reqPath.replace(/(["\\ ])/g, "\\$1")}"`);
	if (!r.ok) { log?.(r.out); return false; }
	log?.(r.out); return true;
}