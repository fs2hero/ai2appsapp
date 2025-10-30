import{ dialog,screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "path";
import fs from "node:fs/promises";


const brewPrefix = isArm ? "/opt/homebrew" : "/usr/local";
const brewBin    = `${brewPrefix}/bin/brew`;


async function detectCondaBase() {
	// 优先通过 `conda info --base` 获取安装前缀
	const info = await run("command -v conda >/dev/null 2>&1 && conda info --base");
	if (!info.ok || !info.out) {
		// 退化到常见安装路径（brew 与官方脚本通常一致）
		const guess = path.join(os.homedir(), "miniconda3");
		return { baseDir: guess, python: path.join(guess, "bin", "python"), pip: path.join(guess, "bin", "pip") };
	}
	const baseDir = info.out.split(/\r?\n/).pop().trim();
	return { baseDir, python: path.join(baseDir, "bin", "python"), pip: path.join(baseDir, "bin", "pip") };
}


const ZSHRC = `${HOME}/.zshrc`;
const ZPROFILE = `${HOME}/.zprofile`;

const KEYS = {
	XCODE: "xcode_clt",
	BREW: "brew",
	GIT: "git",
	CONDA: "conda",
	COREUTILS: "coreutils",
	TIMEOUT: "timeout",
	NVM: "nvm",
	NODE22: "node22"
};

const nvmSrc = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`;
const nvmRun = (cmd) => `${nvmSrc}; ${cmd}`;

/** 生成可写入到 rc 的 nvm 初始化片段 */
function nvmRcLines() {
	return [
		`export NVM_DIR="$HOME/.nvm"`,
		`[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm`,
	];
}

async function ensureBrewDirsWritable(log) {
	const dirs = [
		brewPrefix,
		`${brewPrefix}/bin`,
		`${brewPrefix}/etc`,
		`${brewPrefix}/include`,
		`${brewPrefix}/lib`,
		`${brewPrefix}/sbin`,
		`${brewPrefix}/share`,
		`${brewPrefix}/var`,
		`${brewPrefix}/Cellar`,
		`${brewPrefix}/Frameworks`,
	];
	
	// 用 install -d 一次性创建目录并设置权限；再补一条 chown -R 兜底
	const mk = `/usr/bin/install -d -m 0755 -o "${username}" -g admin ${dirs.map(d => `"${d}"`).join(" ")}`;
	const own = `/usr/sbin/chown -R "${username}":admin "${brewPrefix}"`;
	const perm = `/bin/chmod -R u+rwX "${brewPrefix}"`;
	
	log?.(`准备 Homebrew 目录（一次提权）：${brewPrefix}`);
	const r = await runAdminScript([mk, own, perm]);
	return r.ok;
}

/** 检测依赖，返回 VO */
export async function checkDeps() {
	if (!isMac()) return { ok: false, summary: "仅支持 macOS", items: [] };
	
	const items = [];
	
	// Xcode CLT
	const x = await run("xcode-select -p");
	items.push({
		key: KEYS.XCODE, label: "Xcode Command Line Tools",
		ok: x.ok, version: x.ok ? x.out : "", fix: ["xcode-select --install"], note: "若异常：sudo xcode-select --reset"
	});
	
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "Brew",
	// });
	// brew（保留：给 git/conda/coreutils 用；不再用它装 node）
	const b = await run("brew --version");
	items.push({ key: KEYS.BREW, label: "Homebrew", ok: b.ok, version: b.ok ? b.out.split("\n")[0] : "",
		fix: [
			'/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
			'echo \'eval "$(/opt/homebrew/bin/brew shellenv)"\' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"'
		]
	});
	
	// await sleep(500);
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "Conda",
	// });
	// conda
	const c = await run("command -v conda && conda --version");
	items.push({ key: KEYS.CONDA, label: "conda", ok: c.ok, version: c.ok ? c.out.split("\n").slice(-1)[0] : "",
		fix: b.ok
			? ["brew install --cask miniconda", 'echo \'export PATH="$HOME/miniconda3/bin:$PATH"\' >> ~/.zshrc && source ~/.zshrc']
			: ["（先安装 Homebrew）", "brew install --cask miniconda", 'echo \'export PATH="$HOME/miniconda3/bin:$PATH"\' >> ~/.zshrc && source ~/.zshrc']
	});
	
	// await sleep(500);
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "coreutils",
	// });
	// coreutils
	const gr = await run("command -v greadlink && greadlink --version");
	items.push({ key: KEYS.COREUTILS, label: "coreutils", ok: gr.ok, version: gr.ok ? gr.out.split("\n")[0] : "",
		fix: b.ok ? ["brew install coreutils"] : ["（先安装 Homebrew）", "brew install coreutils"]
	});
	
	// await sleep(500);
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "Timeout",
	// });
	// timeout（允许 gtimeout / timeout 任一存在）
	const t1 = await run("command -v timeout && timeout --version");
	const t2 = await run("command -v gtimeout && gtimeout --version");
	items.push({ key: KEYS.TIMEOUT, label: "timeout", ok: t1.ok || t2.ok,
		version: (t1.ok ? t1.out : (t2.ok ? t2.out : "")),
		fix: b.ok ? ["brew install coreutils", "# 若必须裸名：sudo ln -sf \"$(brew --prefix)/opt/coreutils/libexec/gnubin/timeout\" /usr/local/bin/timeout || true",
				"echo 'alias timeout=gtimeout' >> ~/.zshrc && source ~/.zshrc"]
			: ["（先安装 Homebrew）", "brew install coreutils"]
	});
	
	// await sleep(500);
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "nvm",
	// });
	// nvm
	const nvm = await run(`${nvmSrc}; command -v nvm && nvm --version`);
	const nvmInstalled = nvm.ok || (await run("[ -d \"$HOME/.nvm\" ] && echo yes")).ok;
	items.push({
		key: KEYS.NVM, label: "nvm", ok: nvmInstalled,
		version: nvmInstalled ? (nvm.out.split("\n").slice(-1)[0] || "installed") : "",
		fix: [
			'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
			"# 安装后请新开一个 shell，或将以下行追加到 rc：",
			...nvmRcLines().map(l => `echo '${l}' >> ~/.zshrc`), "source ~/.zshrc"
		],
		note: "用 nvm 管理 Node 版本，避免与 brew node 冲突。"
	});
	
	// await sleep(500);
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "Node 22",
	// });
	// Node 22（用 nvm 检测）
	const n22 = await run(nvmRun("nvm ls --no-colors | grep -E '\\bv?22(\\.|\\s|$)' || true"));
	const node22Ok = !!n22.out; // 有安装记录
	// 再次确认当前 node -v 是否 22.x（仅信息）
	const nodeV = await run("node -v");
	items.push({
		key: KEYS.NODE22, label: "Node.js 22 (via nvm)",
		ok: node22Ok,
		version: nodeV.ok ? nodeV.out : "",
		fix: [
			...(!nvmInstalled ? ['# 先安装 nvm（见上）'] : []),
			"nvm install 22",
			"nvm alias default 22",
			"nvm use 22"
		]
	});
	
	// await sleep(500);
	// await dialog.showMessageBox({
	// 	type: "info",
	// 	buttons: ["继续"],
	// 	defaultId: 0,
	// 	noLink: true,
	// 	title: "Check steps",
	// 	message: "Py",
	// });
	const py = { ok: false, version: "", pipPath: "", pythonPath: "" };
	if(x.ok){
		const hasConda = (await run("command -v conda")).ok;
		
		if (hasConda) {
			const b = await detectCondaBase();
			// 直接用 base 的 python/pip
			const pyVer = await run(`${b.python} --version 2>&1`);
			const pipVer = await run(`${b.pip} --version 2>&1`);
			if (pyVer.ok && pipVer.ok) {
				py.ok = true;
				py.version = pyVer.out;     // e.g. "Python 3.12.4"
				py.pipPath = b.pip;         // e.g. "/Users/xx/miniconda3/bin/pip"
				py.pythonPath = b.python;   // e.g. "/Users/xx/miniconda3/bin/python"
			}
		} else {
			// 没有 conda 的情况下，尝试系统 python/pip（仅做信息参考）
			const pyVer = await run("python3 --version 2>&1 || python --version 2>&1");
			const pipWhere = await run("command -v pip3 || command -v pip || true");
			if (pyVer.ok && pipWhere.ok && pipWhere.out) {
				py.ok = true;
				py.version = pyVer.out;
				py.pipPath = pipWhere.out;
				py.pythonPath = (await run("command -v python3 || command -v python || true")).out || "";
			}
		}
	}
	
	const missing = items.filter(i => !i.ok);
	return {
		ok: missing.length === 0,
		summary: missing.length ? `缺失 ${missing.length} 项：${missing.map(i => i.label).join(", ")}` : "所有依赖已就绪 ✅",
		items,
		python:py
	};
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
	
	const have = (k) => selected.includes(k);
	const ok = async (cmd) => { log(`$ ${cmd}`); const r = await run(cmd); if (!r.ok) log(r.out || "(failed)"); return r.ok; };
	
	// Xcode
	if (have(KEYS.XCODE)) {
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
				//await sleep(500);
				//win.blur();
				log("已触发 Xcode CLT 安装器，请完成后再检查。");
			}else {
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
		}else{
			log("Xcode CLT 已就绪");
		}
	}
	
	// brew
	const brewPresent = (await run("brew --version")).ok;
	if (have(KEYS.BREW)) {
		const present = (await run("brew --version")).ok;
		if (!present) {
			//*****************************************************************
			//打开Terminal的方案
			//*****************************************************************
			{
				if(win){
					moveWindowToAlign(win,"right","bottom");
					await dialog.showMessageBox({
						type: "info",
						buttons: ["继续"],
						noLink: true,
						title: "安装Homebrew",
						message: "将要启动命令行终端执行安装Homebrew的脚本。",
						detail: "请在Homebrew安装成功或失败后，返回AI2Apps继续其它项目的配置/安装。"
					});
				}else{
					await dialog.showMessageBox(win,{
						type: "info",
						buttons: ["继续"],
						noLink: true,
						title: "安装Homebrew",
						message: "将要启动命令行终端执行安装Homebrew的脚本。",
						detail: "请在Homebrew安装成功或失败后，返回AI2Apps继续其它项目的配置/安装。"
					});
				}
				//const brewInstallCmd= 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
				//await runInTerminal(brewInstallCmd);
				await runStepsInTerminal([
					// 可选：准备目录，避免脚本里频繁 sudo（也可以删掉这两行）
					'sudo mkdir -p /opt/homebrew && sudo chown -R "$(whoami)" /opt/homebrew',
					// 官方安装脚本。这里你可以加或不加 NONINTERACTIVE=1（终端里有 TTY，交互也能顺利进行）
					'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
					// 初始化 shellenv（Apple Silicon 示例）
					'echo \'eval "$(/opt/homebrew/bin/brew shellenv)"\' >> ~/.zprofile',
					'eval "$(/opt/homebrew/bin/brew shellenv)"',
					'brew --version'
				]);
				if(win) {
					await dialog.showMessageBox(win,{
						type: "info",
						buttons: ["继续"],
						noLink: true,
						title: "继续配置Homebrew",
						message: "请等待Homebrew脚本执行，完成或失败后，点击继续。",
					});
					moveWindowToAlign(win, "center", "middle");
				}else{
					await dialog.showMessageBox({
						type: "info",
						buttons: ["继续"],
						noLink: true,
						title: "继续配置Homebrew",
						message: "请等待Homebrew脚本执行，完成或失败后，点击继续。",
					});
					
				}
			}

			//*****************************************************************
			//先下载脚本，patch脚本，然后运行的方案，不是很好使
			//*****************************************************************
			if(0){
				let r;
				log("创建brew目录");
				await dialog.showMessageBox({
					type: "info",
					buttons: ["继续"],
					defaultId: 0,
					noLink: true,
					title: "Install steps",
					message: "创建brew目录",
				});

				const okPrep = await ensureBrewDirsWritable(log);   // ← 只弹一次
				if (!okPrep) return false;
				
				log("安装brew…");
				await dialog.showMessageBox({
					type: "info",
					buttons: ["继续"],
					defaultId: 0,
					noLink: true,
					title: "Install steps",
					message: "安装brew",
				});
				// 说明：把整段安装命令丢给 runAdmin，这样内部需要 sudo 的步骤能弹出系统密码框
				//const installCmd = 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
				//const r = await run(installCmd);
				
				// 下载脚本
				r = await run('curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o /tmp/install.sh');
				if (!r.ok) {
					await dialog.showMessageBox({
						type: "info",
						buttons: ["继续"],
						defaultId: 0,
						noLink: true,
						title: "Run error",
						message: `Download error: out: ${r.out}, Code:${r.code}`
					});
					return false;
				}
				// 读取脚本，删除所有 sudo 调用
				// const fs = await import("node:fs/promises");
				// let script = await fs.readFile("/tmp/install.sh", "utf8");
				//
				// // 最简单：去掉所有包含 "sudo" 的行
				// script = script
				// 	.split("\n")
				// 	.filter(line => !/^\s*sudo\b/.test(line))
				// 	.join("\n");
				//
				// await fs.writeFile("/tmp/install.sh", script, "utf8");
				
				r = await run('NONINTERACTIVE=1 /bin/bash /tmp/install.sh');
				if (!r.ok) {
					await dialog.showMessageBox({
						type: "info",
						buttons: ["继续"],
						defaultId: 0,
						noLink: true,
						title: "Run error",
						message: `Install error: out: ${r.out}, Code:${r.code}`,
						detail: `Install error: out: ${r.out}, Code:${r.code}`,
					});
					return false;
				}
				
				// 执行脚本（非交互模式，当前用户）
				// r=await run('NONINTERACTIVE=1 /bin/bash /tmp/install.sh');
				// if (!r.ok) {
				// 	return false;
				// }
			}
			
			//*****************************************************************
			//安装brew之后，配置路径的步骤
			//*****************************************************************
			if(0){
				log("配置brew路径…");
				await dialog.showMessageBox({
					type: "info",
					buttons: ["继续"],
					defaultId: 0,
					noLink: true,
					title: "Install steps",
					message: "配置brew路径",
				});
				// 初始化 shell 环境（当次进程 & 写入 rc）
				// Apple Silicon 多为 /opt/homebrew，Intel 多为 /usr/local
				const prefix = (await run("test -x /opt/homebrew/bin/brew && echo /opt/homebrew || echo /usr/local")).out || "/opt/homebrew";
				const brew = `${prefix}/bin/brew`;
				await run(`echo 'eval "$(${brew} shellenv)"' >> ~/.zprofile`);
				await run(`eval "$(${brew} shellenv)"`);
				log(`Homebrew 安装完成（prefix: ${prefix}）`);
			}
		} else {
			log("Homebrew 已就绪");
		}
	}
	
	// git
	/*if (have(KEYS.GIT) && !(await run("git --version")).ok) {
		if (!await run("brew --version").then(r=>r.ok)) throw new Error("需要先安装 Homebrew");
		if (!await ok("brew install git")) throw new Error("git 安装失败");
	}*/
	
	// conda
	if (have(KEYS.CONDA) && !(await run("command -v conda")).ok) {
		if (!await run("brew --version").then(r=>r.ok)) throw new Error("需要先安装 Homebrew");
		if (!await ok("brew install --cask miniconda")) throw new Error("miniconda 安装失败");
		await ok(`echo 'export PATH="$HOME/miniconda3/bin:$PATH"' >> ${ZSHRC}`);
		await ok(`source ${ZSHRC}`);
	}
	
	// coreutils / timeout
	if (have(KEYS.COREUTILS) && !(await run("command -v greadlink")).ok) {
		if (!await run("brew --version").then(r=>r.ok)) throw new Error("需要先安装 Homebrew");
		if (!await ok("brew install coreutils")) throw new Error("coreutils 安装失败");
	}
	if (have(KEYS.TIMEOUT)) {
		const hasTimeout = (await run("command -v timeout")).ok;
		const hasGtimeout = (await run("command -v gtimeout")).ok;
		
		if (!hasTimeout && !hasGtimeout) {
			if (!(await run("brew --version")).ok) throw new Error("需要先安装 Homebrew");
			await ok("brew install coreutils");
		}
		
		// 如果只有 gtimeout，没有裸名 timeout，则尝试用弹窗提权创建软链
		if (!(await run("command -v timeout")).ok && (await run("command -v gtimeout")).ok) {
			const src = '$(brew --prefix)/opt/coreutils/libexec/gnubin/timeout';
			const dstDir = "/usr/local/bin";
			const dst = `${dstDir}/timeout`;
			
			if (allowSudo) {
				// 先确保目标目录存在，再创建/覆盖软链（两条命令分开发，便于错误提示）
				const mk = await runAdmin(`/bin/mkdir -p "${dstDir}"`);
				if (!mk.ok) log("创建 /usr/local/bin 失败（已取消或权限问题）");
				
				const ln = await runAdmin(`/bin/ln -sf "${src}" "${dst}"`);
				if (ln.ok) log("已通过弹窗授权创建 /usr/local/bin/timeout 软链");
				else log("创建 timeout 软链失败（已取消或权限问题），可改用 alias：echo 'alias timeout=gtimeout' >> ~/.zshrc");
			} else {
				log("未启用 allowSudo，跳过创建 /usr/local/bin/timeout 软链。可改用 alias 或开启 allowSudo。");
			}
		}
		
		log("timeout 已就绪（有 gtimeout 亦可）");
	}
	// nvm
	if (have(KEYS.NVM)) {
		const installed = (await run(`${nvmSrc}; command -v nvm && nvm --version`)).ok || (await run('[ -d "$HOME/.nvm" ]')).ok;
		if (!installed) {
			if (!await ok('curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash')) {
				throw new Error("nvm 安装失败");
			}
		}
		if (modifyRc) {
			for (const line of nvmRcLines()) {
				await fs.appendFile(ZSHRC, `\n${line}\n`).catch(()=>{});
				await fs.appendFile(ZPROFILE, `\n${line}\n`).catch(()=>{});
			}
			await ok(`source ${ZSHRC}`);
		} else {
			log("提示：未写入 rc，若在新 shell 中找不到 nvm，请手动追加 nvm 初始化行。");
		}
	}
	
	// Node 22（通过 nvm）
	if (have(KEYS.NODE22)) {
		const ensureNvm = async () => {
			const r = await run(`${nvmSrc}; command -v nvm`);
			if (!r.ok) throw new Error("nvm 未就绪；请先安装 nvm 或开启 modifyRc 以加载。");
		};
		await ensureNvm();
		if (!await ok(nvmRun("nvm ls --no-colors | grep -E '\\bv?22(\\.|\\s|$)' || true"))) { /* ignore grep exit */ }
		// 安装&切换
		await ensureNvm();
		if (!await ok(nvmRun("nvm install 22"))) throw new Error("nvm install 22 失败");
		await ok(nvmRun("nvm alias default 22"));
		await ok(nvmRun("nvm use 22"));
		// 提示可能与 brew node 冲突
		const brewNode = await run("brew list --versions node");
		if (brewNode.ok) {
			log("提示：检测到 brew 安装的 node。建议 `brew unlink node`，以避免与 nvm 冲突（PATH 顺序导致的 node 版本漂移）。");
		}
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