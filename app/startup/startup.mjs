import{ app, BrowserWindow,BrowserView,ipcMain,screen,Menu,dialog,clipboard } from "electron";
import pathLib from 'path'
import os from "os";
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from'path';
import { fileURLToPath } from 'url'
import yauzl from 'yauzl';
import {checkNetFast} from './check_network.mjs';
import { isLinux, isMac, isWin, copyFileToDir, copyDirWithReplace, ensureDirSync, isArm } from '../utils/sys_utils.mjs';
import { sleep } from '../utils/helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathLib.dirname(__filename);

let serverPort=3015;
let isInPackage=false;
let baseDir="";
let fsp=fs.promises;

let setStartupState=null;


//---------------------------------------------------------------------------
function unzip(zipPath, targetDir) {
	return new Promise((resolve, reject) => {
		yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
			if (err) return reject(err);
			
			zipfile.readEntry();
			
			zipfile.on('entry', entry => {
				const entryPath = path.join(targetDir, entry.fileName);
				
				if (/\/$/.test(entry.fileName)) {
					ensureDirSync(entryPath);
					zipfile.readEntry();
				} else {
					ensureDirSync(path.dirname(entryPath));
					zipfile.openReadStream(entry, (err, readStream) => {
						if (err) return reject(err);
						const writeStream = fs.createWriteStream(entryPath);
						readStream.pipe(writeStream);
						writeStream.on('close', () => zipfile.readEntry());
					});
				}
			});
			
			zipfile.on('end', resolve);
			zipfile.on('error', reject);
		});
	});
}

//---------------------------------------------------------------------------
async function removeDirOrFile(targetPath) {
	await fsp.rm(targetPath, { recursive: true, force: true });
}

//---------------------------------------------------------------------------
function runBashScript(script,cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn('bash', ['-i'], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: process.env,
			cwd:cwd||undefined
		});
		
		let stdout = '';
		let stderr = '';
		let allout='';
		
		child.stdout.on('data', (data) => {
			let pos;
			stdout += data.toString();
			allout += data.toString();
			do {
				pos = allout.indexOf("\n");
				if (pos>=0){
					console.log(`[runBashScript] ${allout.substring(0,pos)}`);
					allout=allout.substring(pos+1);
				}
			}while(pos>=0)
		});
		
		child.stderr.on('data', (data) => {
			let pos;
			stderr += data.toString();
			allout += data.toString();
			do {
				pos = allout.indexOf("\n");
				if (pos>=0){
					console.log(`[runBashScript] ${allout.substring(0,pos+1)}`);
					allout=allout.substring(pos+1);
				}
			}while(pos>=0)
		});
		
		child.on('close', (code) => {
			if (code === 0) {
				let out=stdout.trim();
				console.log(`[runBashScript] ${allout}`);
				resolve(out);
			} else {
				let out=stderr;
				console.log(`[runBashScript] ${allout}`);
				reject(new Error(`Exited with code ${code}\n${stderr}`));
			}
		});
		
		child.stdin.write(script + '\n');
		child.stdin.end();
	});
}

//---------------------------------------------------------------------------
async function getNodePath(userDataDir,v){
	let nodePath;
	const nodePathCache = path.join(userDataDir, `.nvm_node_path_${v}`);
	if (!fs.existsSync(nodePathCache)) {
		return null;
	}
	nodePath = fs.readFileSync(nodePathCache, 'utf8').trim();
	if (!fs.existsSync(nodePath)){
		return null;
	}
	return nodePath;
}

//---------------------------------------------------------------------------
async function installNode(userDataDir,v,install=true){
	let nodePath;
	const nodePathCache = path.join(userDataDir, `.nvm_node_path_${v}`);
	let shellScript;
	if(install) {
		shellScript = `
      unset npm_config_prefix
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      nvm install ${v}
      nvm use ${v}
      which node
    `;
	}else{
		shellScript = `
      unset npm_config_prefix
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      nvm use ${v}
      which node
    `;
	}
	try {
		let result=await runBashScript(shellScript);
		nodePath = result.trimEnd().split('\n').at(-1);
		fs.writeFileSync(nodePathCache, nodePath);
	}catch(err){
		console.error("Get node path error:");
		console.error(err);
		return null;
	}
	console.log(`[NVM] 缓存 node 路径: ${nodePath}`);
	return nodePath;
}

//---------------------------------------------------------------------------
async function installNodePackages(userDataDir,nodeVersion){
	const shellScript = `
      unset npm_config_prefix
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      nvm use ${nodeVersion}
	  npm install
	`;
	try {
		await runBashScript(shellScript,userDataDir);
		return true;
	}catch(err){
		return false;
	}
}

//---------------------------------------------------------------------------
function readJson(filePath){
	try {
		if (!fs.existsSync(filePath)) {
			console.error(`File not found: ${filePath}`)
			return null
		}
		const fileContent = fs.readFileSync(filePath, 'utf8')
		try {
			const jsonData = JSON.parse(fileContent)
			return jsonData
		} catch (parseError) {
			console.error(`Error parsing JSON from ${filePath}:`, parseError)
			return null
		}
	} catch (readError) {
		console.error(`Error reading file ${filePath}:`, readError)
		return null
	}
}

//---------------------------------------------------------------------------
async function updateEnvFile(envfile, config) {
	let content = '';
	try {
		content = await fsp.readFile(envfile, 'utf-8');
	} catch (err) {
		if (err.code === 'ENOENT') {
			// 文件不存在则初始化为空
			content = '';
		} else {
			throw err;
		}
	}
	
	const lines = content.split('\n');
	const keys = new Set(Object.keys(config));
	const updated = [];
	
	for (let line of lines) {
		const match = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
		if (match) {
			const key = match[1];
			if (keys.has(key)) {
				updated.push(`${key}=${config[key]}`);
				keys.delete(key);
			} else {
				updated.push(line);
			}
		} else {
			updated.push(line); // 保留注释或空行
		}
	}
	
	// 添加新增的键值
	for (const key of keys) {
		updated.push(`${key}=${config[key]}`);
	}
	
	await fsp.writeFile(envfile, updated.join('\n'), 'utf-8');
}

//---------------------------------------------------------------------------
let StartupWindow,startupWindow;
StartupWindow=function(callback){
	let win;
	
	setStartupState=this.setStartupState.bind(this);
	this.startupCallback=callback;
	isInPackage=app.isPackaged||true;
	if(app.isPackaged){
		baseDir=process.resourcesPath;
	}else{
		baseDir=path.join(__dirname,"../..");
	}
	this.userDataDir=path.join(app.getPath('userData'),"local");
	this.serverJsonPath=path.join(this.userDataDir,"bundle.json");
	this.serverDir=isInPackage?path.join(this.userDataDir,"server"):path.join(baseDir,"local");
	this.serverJson=null;
	
	this.bundleDir=path.join(baseDir,"bundle");
	this.bundleJsonPath=path.join(this.bundleDir,"bundle.json");
	this.bundleZipPath=path.join(this.bundleDir,"bundle.zip");
	this.bundleJson=null;
	
	this.configJson=readJson(path.join(this.userDataDir,"config.json"));
	
	this.userDataJSON=null;
	
	win=new BrowserWindow({
		width: 600,
		height: 400,
		frame: false, // 移除原生标题栏
		//alwaysOnTop: true,
		modal: true,
		webPreferences: {
			preload: pathLib.join(__dirname, 'startup_preload.js'),
		}
	});
	if(!app.isPackaged) {
		win.webContents.openDevTools({ mode: 'detach' });
	}
	win.loadFile('startup/startup.html');
	win.eStartup=this;
	this.window=win;
	
	// IPC：前端要求切换 tab
	ipcMain.on('startup-ready', (event) => {
		this.startApp();
	});
	
	/*
	ipcMain.on('dashboard-ready', (event) => {
		console.log("Dashboard ready!");
		this.close();
	});*/
};
startupWindow=StartupWindow.prototype={};

//***************************************************************************
//启动/准备过程
//***************************************************************************
const LABELS = {
	xcode_clt: "Xcode Command Line Tools",
	brew: "Homebrew",
	git: "git",
	conda: "conda",
	coreutils: "coreutils",
	timeout: "timeout",
	nvm: "nvm",
	node22: "Node.js 22 (via nvm)",
	curl: 'curl',
};

//---------------------------------------------------------------------------
function formatFixTips(item) {
	const lines = [];
	if (item.note) lines.push(`# 说明：${item.note}`);
	if (item.fix?.length) {
		lines.push("# 手动安装步骤（逐条执行）：");
		for (const cmd of item.fix) {
			lines.push(typeof cmd === "string" ? cmd : String(cmd));
		}
	} else {
		lines.push("(无可用的手动安装指引。)");
	}
	return lines.join("\n");
}

//---------------------------------------------------------------------------
async function askPerItem(item) {
	let detailLines;
	const label = item.label || LABELS[item.key] || item.key;
	if(item.fix) {
		detailLines = [
			`缺失项：${label}`,
			item.version ? `已检测到版本信息：${item.version}` : "",
			"",
			"手动安装参考命令（已复制到剪贴板）：",
			...(item.fix || [])
		].filter(Boolean);
		// 把手动命令复制到剪贴板，方便用户开终端粘贴
		const toCopy = formatFixTips(item);
		clipboard.writeText(toCopy);
	}else if(item.termFix){
		detailLines = [
			`缺失项：${label}`,
			item.version ? `已检测到版本信息：${item.version}` : "",
			"",
			"需要在终端命令行里执行安装脚本：",
			...(item.termFix || [])
		].filter(Boolean);
	}
	
	
	const { response } = await dialog.showMessageBox({
		type: "warning",
		buttons: item.termFix?["使用终端命令行安装", "退出向导"]:["自动安装", "手动安装", "退出向导"],
		cancelId: item.termFix?1:2,
		defaultId: 0,
		noLink: true,
		title: "环境缺失项",
		message: `检测到缺失：${label}`,
		detail: detailLines.join("\n")
	});
	
	return response; // 0=自动安装, 1=手动安装, 2=退出
}

//---------------------------------------------------------------------------
async function showManualHelpAndWait(item) {
	const label = item.label || LABELS[item.key] || item.key;
	const tips = formatFixTips(item);
	
	// 再次复制，避免用户没注意到
	clipboard.writeText(tips);
	
	await dialog.showMessageBox({
		type: "info",
		buttons: ["我已手动完成，继续", "取消"],
		cancelId: 1,
		defaultId: 0,
		noLink: true,
		title: `手动安装：${label}`,
		message: `请按以下步骤在终端手动安装并配置：`,
		detail: tips
	});
}

//---------------------------------------------------------------------------
async function runDepsWizard(checkDeps,installDeps,win) {
	let installed=false;
	// 外层循环：直到没有缺失项，或用户退出
	while (true) {
		let vo,vo2,vo3;
		if(!vo) {
			setStartupState("Checking environment...");
			vo = await checkDeps();
		}
		if (vo.ok) {
			if(installed) {
				await dialog.showMessageBox({
					type: "info",
					buttons: ["好的"],
					title: "环境检查",
					message: "所有必需依赖已就绪 ✅"
				});
			}
			return vo;
		}
		
		// 取第一项缺失
		const missing = vo.items.filter(i => !i.ok);
		if (missing.length === 0) return vo; // 理论不会发生
		const item = missing[0];
		
		// 询问该项的处理方式
		setStartupState(`Asking install dependence: ${item.key}...`);
		const choice = await askPerItem(item);
		if ((item.fix && choice === 2) || (item.termFix && choice === 1)){
			// 退出向导
			await dialog.showMessageBox({
				type: "none",
				buttons: ["关闭"],
				title: "已退出环境引导",
				message: "你可以稍后在设置中再次运行环境检查。"
			});
			return null;
		}else if (item.fix && choice === 1) {
			// 手动安装流程
			setStartupState(`Wait use install: ${item.key}...`);
			await showManualHelpAndWait(item);
			
			// 用户点击“继续”后，重新检测当前这一项
			vo2 = await checkDeps();
			const stillMissing = vo2.items.find(i => i.key === item.key && !i.ok);
			if (stillMissing) {
				// 还没装好，提醒一下，继续下一轮（依然会从第一缺失项开始）
				await dialog.showMessageBox({
					type: "warning",
					buttons: ["继续"],
					title: "仍未检测到已安装",
					message: `${LABELS[item.key] || item.key} 似乎还未安装成功，请重试或选择自动安装。`
				});
			}
			installed=true;
			// 回到 while 顶部，继续循环
			continue;
		}
		
		// 自动安装（仅这一项）
		try {
			setStartupState(`Installing: ${item.key}...`);
			await installDeps([item.key], {
				modifyRc: true,    // 默认帮助写入 nvm/conda PATH、nvm 初始化
				allowSudo: true,   // 需要 root 的步骤会触发 macOS 弹窗（osascript）
				onLog: (s) => console.log("[deps]", s),
				win:win
			});
			installed=true;
		} catch (e) {
			await dialog.showMessageBox({
				type: "error",
				buttons: ["继续"],
				title: "自动安装失败",
				message: `安装 ${LABELS[item.key] || item.key} 失败`,
				detail: (e && e.message) ? String(e.message) : "未知错误"
			});
			vo=null;//Force re-checking
			continue;
		}
		
		// 安装后立即复检该项（并提示结果）
		setStartupState(`Checking environment...`);
		vo3 = await checkDeps();
		const after = vo3.items.find(i => i.key === item.key);
		if (after && after.ok) {
			await dialog.showMessageBox({
				type: "info",
				buttons: ["继续"],
				title: "安装完成",
				message: `${after.label || LABELS[after.key] || after.key} 安装成功 ✅`,
				detail: after.version ? `版本/状态：${after.version}` : ""
			});
		} else {
			await dialog.showMessageBox({
				type: "warning",
				buttons: ["继续"],
				title: "仍未检测到已安装",
				message: `${LABELS[item.key] || item.key} 似乎仍未安装成功，可以改用手动安装。`
			});
		}
		vo=vo3;
		// 回到 while 顶部，继续处理下一项缺失
	}
}


//---------------------------------------------------------------------------
startupWindow.startApp=async function(){
	let pms,callback,callerror,win;
	let nodePath,nodeVersion;
	
	win=this.window;
	
	pms=new Promise((resolve,reject)=>{
		callback=resolve;
		callerror=reject;
	});
	if(isInPackage){
		this.bundleJson=readJson(this.bundleJsonPath);
		this.serverJson=readJson(this.serverJsonPath);
		
		//Check network:
		{
			setStartupState("Checking network connections...");
			const r = await checkNetFast({
				tmo: 1500,
				onUpdate: partial => {
					// 可把 partial 推到 UI：追加显示 npm/ghcr/git_smart/DNS 的结果
					// console.log('update', partial);
				}
			});
			if(r.fast.likely_need_vpn){
				await dialog.showMessageBox({
					type: "info",
					buttons: ["OK"],
					title: "网络连接问题",
					message: `当前的网络连接存在问题: ${r.fast.reason}。\n当前AI2App可能会因为网络问题而无法正确的配置/执行，强烈推荐启用'科学上网'后再试。`
				});
			}
		}
		
		//Install system dependence:
		{
			let initFile,depVo;
			if(isMac()) {//MacOS:
				initFile = await import("./init_macos.mjs");
				depVo=await runDepsWizard(initFile.checkDeps,initFile.installDeps,win);
			}else if(isLinux()) {//Linux:
				initFile = await import("./init_linux.mjs");
				depVo=await runDepsWizard(initFile.checkDeps,initFile.installDeps,win);
			}else{
				//TODO: Add windows support:
			}
			if(depVo) {
				if (this.serverJson) {//Not first time:
				} else {//First time:
					let reqPath;
					setStartupState("Installing python requirements...");
					reqPath = path.join(this.serverDir, "agents/requirements.txt");
					await initFile.pipInstall(depVo.python,reqPath);
				}
			}else{
				//TODO: Notify system not ready.
			}
		}
		
		//Ensure system dirs:
		{
			// await fsp.mkdir(this.userDataDir, { recursive: true });
			// await fsp.mkdir(path.join(this.userDataDir,"rpa_data_dir"), { recursive: true });
			// await fsp.mkdir(path.join(this.userDataDir,"filehub"), { recursive: true });
			// await fsp.mkdir(path.join(this.userDataDir,"server"), { recursive: true });
			ensureDirSync(this.userDataDir);
			ensureDirSync(path.join(this.userDataDir,"rpa_data_dir"));
			ensureDirSync(path.join(this.userDataDir,"filehub"));
			ensureDirSync(path.join(this.userDataDir,"server"));
		}
		
		//Nvm should already be installed
		/*
		if(!await checkNvm()){
			const result = dialog.showMessageBoxSync(win, {
				type: 'question',
				buttons: ['Cancel', 'OK'],
				defaultId: 1,
				cancelId: 0,
				title:"Setup Node Environment",
				message:"Ai2Apps require 'nvm' tool to managed node environment. Can't detect 'nvm' on your system. Would you like to install 'nvm' now?"
			});
			if(result !== 1){
				throw "Nvm not detected, start Ai2apps aborted.";
			}
			this.setStartupState("Installing nvm tool...");
			await installNvm();
		}*/

		this.setStartupState("Check node version...");
		nodeVersion=this.bundleJson.node;
		nodePath=await getNodePath(this.userDataDir,nodeVersion);
		this.setStartupState(`Installing node version: ${nodeVersion}`);
		if(!nodePath) {
			nodePath = await installNode(this.userDataDir, nodeVersion, !!nodePath);
		}
		if(nodePath) {
			process.env.PATH = `${path.dirname(nodePath)}:${process.env.PATH}`;
		}else{
			dialog.showMessageBoxSync({
				type: 'info',
				title: 'Startup AI2Apps Error',
				message: "Can't locate node path.",
				buttons: ['Exit']
			});
			throw `Can't find node path!`;
		}
		
		if(!this.serverJson){//This is the first time we install AI2Apps
			//Unzip server dir:
			this.setStartupState("Unzip bundle files...");
			await unzip(this.bundleZipPath,this.serverDir);
			
			//Copy package.json:
			this.setStartupState("Copy package.json file...");
			await copyFileToDir(path.join(this.bundleDir,"package.json"),path.join(this.userDataDir));
			
			//Copy agents folder:
			this.setStartupState("Copy system agents...");
			await copyDirWithReplace(path.join(this.serverDir,"agents"),path.join(this.userDataDir,"agents"));
			
			//Make frpc executable:
			{
				// let platform=os.platform();
				let frpcName;
				if(isWin()){
					frpcName="frpc.exe";
				}else if(isMac()){
					frpcName="frpc.macos";
				} else if(isLinux()){
					if(isArm){
						frpcName="frpc.arm64";
					}else{
						frpcName="frpc.x86";
					}
				}

				let frpcPath=path.join(this.serverDir,"frpc",frpcName);
				if (!isWin()) {
					fs.chmodSync(frpcPath, 0o755); // macOS/Linux 设置可执行权限
				}
			}
			
			//Link agents, rpa_data_dir, filehub
			/*
			this.setStartupState("Link system folders...");
			await removeDirOrFile(path.join(this.serverDir,"agents"));
			await linkDir(path.join(this.userDataDir,"agents"),path.join(this.serverDir,"agents"));
			await linkDir(path.join(this.userDataDir,"rpa_data_dir"),path.join(this.serverDir,"rpa_data_dir"));
			await linkDir(path.join(this.userDataDir,"filehub"),path.join(this.serverDir,"filehub"));
			 */

			//Run npm install on userDataDir
			this.setStartupState("Install node packages...");
			await installNodePackages(this.userDataDir,nodeVersion);
			
			//Ensure user-data dirs:
			ensureDirSync(path.join(this.serverDir,"filehub"));
			ensureDirSync(path.join(this.serverDir,"rpa_data_dir"));
			
			//Seal install result:
			this.setStartupState("Finishing up...");
			await copyFileToDir(path.join(this.bundleDir,"bundle.json"),this.userDataDir);
		}else{
			if(this.serverJson.build<this.bundleJson.build){//Upgrade package files
				//Backup agents:
				this.setStartupState("Backup your agents...");
				await removeDirOrFile(path.join(this.userDataDir,"agents"));
				fs.rename(path.join(this.serverDir,"agents"),path.join(this.userDataDir,"agents"), (err) => {
					if (err) return console.error('Failed to move:', err);
					console.log('Directory moved successfully');
				});
				//await fsp.mkdir(path.join(this.userDataDir,"agents"), { recursive: true });
				//await copyDirWithReplace(path.join(this.serverDir,"agents"),path.join(this.userDataDir,"agents"));
				
				//Backup file-hub:
				this.setStartupState("Backup your files...");
				await removeDirOrFile(path.join(this.userDataDir,"filehub"));
				fs.rename(path.join(this.serverDir,"filehub"),path.join(this.userDataDir,"filehub"), (err) => {
					if (err) return console.error('Failed to move:', err);
					console.log('Directory moved successfully');
				});
				
				//Backup rpa-data:
				this.setStartupState("Backup your rpa data...");
				await removeDirOrFile(path.join(this.userDataDir,"rpa_data_dir"));
				fs.rename(path.join(this.serverDir,"rpa_data_dir"),path.join(this.userDataDir,"rpa_data_dir"), (err) => {
					if (err) return console.error('Failed to move:', err);
					console.log('Directory moved successfully');
				});
				
				//Remove server dir
				this.setStartupState("Upgrading local server...");
				await removeDirOrFile(this.serverDir);

				//Unzip server dir:
				this.setStartupState("Unzip new bundle files...");
				await unzip(this.bundleZipPath,this.serverDir);
				
				//Copy agents folder:
				this.setStartupState("Restore your agents...");
				await copyDirWithReplace(path.join(this.serverDir,"agents"),path.join(this.userDataDir,"agents"));
				await removeDirOrFile(path.join(this.serverDir,"agents"));
				fs.rename(path.join(this.userDataDir,"agents"),path.join(this.serverDir,"agents"), (err) => {
					if (err) return console.error('Failed to move:', err);
					console.log('Directory moved successfully');
				});
				//await fsp.mkdir(path.join(this.serverDir,"agents"), { recursive: true });
				//await copyDirWithReplace(path.join(this.userDataDir,"agents"),path.join(this.serverDir,"agents"));
				
				this.setStartupState("Restore your files...");
				await removeDirOrFile(path.join(this.serverDir,"filehub"));
				fs.rename(path.join(this.userDataDir,"filehub"), path.join(this.serverDir,"filehub"), (err) => {
					if (err) return console.error('Failed to move:', err);
					console.log('Directory moved successfully');
				});

				this.setStartupState("Restore your rpa data files...");
				await removeDirOrFile(path.join(this.serverDir,"rpa_data_dir"));
				fs.rename(path.join(this.serverDir,"rpa_data_dir"), path.join(this.userDataDir,"rpa_data_dir"), (err) => {
					if (err) return console.error('Failed to move:', err);
					console.log('Directory moved successfully');
				});

				//Ensure user-data dirs:
				ensureDirSync(path.join(this.serverDir,"filehub"));
				ensureDirSync(path.join(this.serverDir,"rpa_data_dir"));
				
				//Make frpc executable:
				{
					// let platform=os.platform();
					let frpcName;
					if(isWin()){
						frpcName="frpc.exe";
					}else if(isMac()){
						frpcName="frpc.macos";
					} else if(isLinux()){
						if(isArm){
							frpcName="frpc.arm64";
						}else{
							frpcName="frpc.x86";
						}
					}
					let frpcPath=path.join(this.serverDir,"frpc",frpcName);
					if (!isWin()) {
						fs.chmodSync(frpcPath, 0o755); // macOS/Linux 设置可执行权限
					}
				}

				//Copy package.json:
				this.setStartupState("Copy package.json file...");
				await copyFileToDir(path.join(this.bundleDir,"package.json"),path.join(this.userDataDir));
				
				//Run npm install on userDataDir
				this.setStartupState("Install node packages...");
				await installNodePackages(this.userDataDir);
				
				this.setStartupState("Finishing up...");
				await copyFileToDir(path.join(this.bundleDir,"bundle.json"),this.userDataDir);
			}
		}
	}else{
		//Do nothing?
	}
	await sleep(500);
	
	//Update .env file in server folder by config.json:
	this.setStartupState("Reading local config...");
	let configJson=this.configJson||{env:{}};
	serverPort=configJson.env["PORT"]||serverPort;
	//Set web-drive app path:
	configJson.env["WEBDRIVE_APP"]=path.join(this.bundleDir,"Acefox.app");
	await updateEnvFile(path.join(this.serverDir,".env"),configJson.env);

	this.setStartupState("Checking local server...");
	//Check if server is already running, mostly for debug
	try {
		const res = await fetch(`http://localhost:${serverPort}`, {
			redirect: 'manual'
		});
		if (res.status){
			this.setStartupState(`Find running server: ${res.status}`);
			this.startupCallback(null,serverPort);
			return;
		}
	}catch (err){
		//Server not start,
	}
	
	this.setStartupState("Starting local server...");
	//Start the local AI2Apps server:
// 	const cmd = `
// unset npm_config_prefix
// export NVM_DIR="$HOME/.nvm"
// [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
// nvm use 22
// node ${path.join(this.serverDir,"start.js")}
// `;
	//const child = spawn("bash", ['-c',cmd],{cwd:this.serverDir});
	const child = spawn("node", [path.join(this.serverDir,"start.js")],{cwd:this.serverDir,env:process.env});
	/*const child = spawn("zsh", ['-l','-c',`nvm use ${nodeVersion} && node ${path.join(this.serverDir,"start.js")}`],{
		cwd:this.serverDir,
		env:process.env
	});*/
	/*const child = spawn("bash", ['-l','-c',`node ${path.join(this.serverDir,"start.js")}`],{
		cwd:this.serverDir,
		env:process.env
	});*/
	//const child = spawn(nodePath, [path.join(this.serverDir,"start.js")],{cwd:this.serverDir});
	child.stdout.on('data', async (data) => {
		const text = data.toString();
		console.log('[server]', text);
		if (text.includes('READY:')) {
			this.setStartupState("Local server ready, starting AI2Apps dashboard...");
			await sleep(500);
			callback();
		}
	});
	
	child.stderr.on('data', (data) => {
		console.error('[server error]', data.toString());
	});
	
	child.on('exit', (code) => {
		console.log('Server exited with code', code);
	});
	await pms;
	this.startupCallback(child,serverPort);
};

//---------------------------------------------------------------------------
startupWindow.setStartupState=function (text){
	this.window.webContents.send('startup-state', text);
}

//---------------------------------------------------------------------------
startupWindow.close=function(){
	if(this.window) {
		this.window.close();
		this.window = null;
	}
};

//---------------------------------------------------------------------------
ipcMain.handle('get-app-version', () => {
	return app.getVersion();
});

export default StartupWindow;
export {StartupWindow,startupWindow};