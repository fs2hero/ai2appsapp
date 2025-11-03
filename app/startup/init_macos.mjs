import{ dialog } from "electron";
// import { execFile } from "node:child_process";
// import { promisify } from "node:util";
// import os from "node:os";
// import path from "path";
// import fs from "node:fs/promises";
import { checkDeps as commonCheckDeps, installDeps as commonInstallDeps, TOOLS_NAME } from './deps_common.mjs';

/* the original long checkDeps body was removed in favor of delegating to deps_common.checkDeps */

/**
 * 检查依赖（委托到通用实现）
 * 传参与 `deps_common.checkDeps` 保持一致：可选 onLog 回调等
 */
export async function checkDeps(opts = {}) {
	// 直接委托给通用模块并返回结果
	return await commonCheckDeps(opts);
}

/**
 * 自动安装（按 UI 勾选的 key 执行）
 * 选项：
 *  - onLog(line)：日志回调
 *  - modifyRc：是否自动把 nvm 初始化代码写入 ~/.zshrc 与 ~/.zprofile
 *  - allowSudo：允许对 /usr/local/bin/timeout 建软链（可选）
 */
export async function installDeps(selected, { onLog, modifyRc = true, allowSudo = false ,win=null} = {}) {
	const log = (s) => onLog?.(s);
	if (!isMac()) throw new Error("仅支持 macOS");

	// 先保留并运行 macOS 特有的 GUI Xcode 安装处理（如果用户选择了 XCODE）
	const have = (k) => selected.includes(k);
	if (have(TOOLS_NAME.XCODE)) {
		const has = (await run("xcode-select -p")).ok;
		if (!has) {
			let pms;
			// 弹出“请完成安装后点继续”
			if(win){
				moveWindowToAlign(win,"right","bottom");
				pms = dialog.showMessageBox(win,{
					type: "info",
					buttons: ["我已完成安装，继续", "取消"],
					cancelId: 1,
					defaultId: 0,
					noLink: true,
					title: "请在弹窗中完成 Xcode CLT 安装",
					message: "启动 Xcode 命令行工具安装器，请完成安装后再返回AI2Apps继续。",
					detail: "请在系统弹出的安装器中完成安装。\n安装完成后，点击“我已完成安装，继续”以继续检测。"
				});
				await sleep(500);
				await run("/usr/bin/xcode-select --install");
				log("已触发 Xcode CLT 安装器，请完成后再检查。");
			} else {
				await run("/usr/bin/xcode-select --install");
				log("已触发 Xcode CLT 安装器，请完成后再检查。");
				pms = dialog.showMessageBox({
					type: "info",
					buttons: ["我已完成安装，继续", "取消"],
					cancelId: 1,
					defaultId: 0,
					noLink: true,
					title: "请在弹窗中完成 Xcode CLT 安装",
					message: "启动 Xcode 命令行工具安装器，请完成安装后再返回AI2Apps继续。",
					detail: "请在系统弹出的安装器中完成安装。\n安装完成后，点击“我已完成安装，继续”以继续检测。"
				});
			}
			await pms;
			moveWindowToAlign(win,"center","middle");
		} else {
			log("Xcode CLT 已就绪");
		}
	}

	// 把 XCODE 从要安装的集合里移除，剩余的交给通用实现处理
	const remaining = selected.filter(k => k !== TOOLS_NAME.XCODE);
	if (remaining.length > 0) {
		await commonInstallDeps(remaining, { onLog, modifyRc, allowSudo, win });
	}

	log("安装流程完成 ✅");
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