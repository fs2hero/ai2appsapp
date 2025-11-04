import{ app, BrowserWindow,nativeImage,Tray,screen,Menu,ipcMain,shell } from "electron";
import { spawn } from 'child_process';
import { fileURLToPath } from "url";
import pathLib from "path";
import {EBrowserWindow} from "./ebrowser/ebrowser.mjs";
import {StartupWindow} from "./startup/startup.mjs";
import fs from 'fs';
import fixPath from 'fix-path';
import au from 'electron-updater';
import path from 'path'
import os from 'os'
const autoUpdater=au.autoUpdater;
const fsp=fs.promises;
fixPath();


let mainWindow=null;
console.log(process.env.PATH);
const __filename = fileURLToPath(import.meta.url);
const __dirname = pathLib.dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;
const basePath = isPackaged ? pathLib.dirname(app.getPath('exe')) : __dirname;

const serverDir = pathLib.join(app.getAppPath(), '../local');
const nodeBin = pathLib.join(serverDir, 'node');
const serverJs = pathLib.join(serverDir, 'start.js');

const iconPath = pathLib.join(__dirname, 'icon/icon.png'); // 支持 png、icns
const trayIconPath = pathLib.join(__dirname, 'icon/iconTemplate@4x.png'); // 支持 png、icns
const image = nativeImage.createFromPath(iconPath);
const trayImage = nativeImage.createFromPath(trayIconPath);

let homepageUrl="http://localhost:3015";
let serverPort=3015;
//const homepageUrl="http://localhost:3301";

let tray=null;

let serverProcess=null;
let startUp=null;

app.name = 'AI2Apps';

const template = [
	{
		label: 'AI2Apps',
		submenu: [
			{
				label: 'New dashboard window',
				accelerator: 'CommandOrControl+N',
				click: () => {
					createWindow(true,true); // 创建新窗口
				}
			},
			{
				label: 'New empty window',
				accelerator: 'CommandOrControl+E',
				click: () => {
					createWindow(false,false); // 创建新窗口
				}
			},
			{ type: 'separator' },
			{
				label: 'Restart service...',
				click: () => {
					restartServer();
				},
			},
			{
				label: 'Settings...',
				accelerator: 'CmdOrCtrl+,',
				click: () => {
					openSettingsWindow();
				},
			},
			{ type: 'separator' },
			{
				role:"quit"
			},
		]
	},
	{
		label: 'Edit',
		submenu: [
			{ role: 'undo' },
			{ role: 'redo' },
			{ type: 'separator' },
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' },
			...(process.platform === 'darwin'
				? [
					{ role: 'pasteAndMatchStyle' },
					{ role: 'delete' },
					{ role: 'selectAll' },
					{ type: 'separator' },
					{
						label: 'Speech',
						submenu: [
							{ role: 'startSpeaking' },
							{ role: 'stopSpeaking' }
						]
					}
				]
				: [
					{ role: 'delete' },
					{ type: 'separator' },
					{ role: 'selectAll' }
				])
		]
	},
	{
		label: 'View',
		submenu: [
			{
				label: 'New tab',
				accelerator: 'CmdOrCtrl+T',
				click: (menuItem, browserWindow) => {
					if (browserWindow && browserWindow.eBrowser) {
						browserWindow.eBrowser.newTab();
					}
				}
			},
			{
				label: 'Reload tab page',
				accelerator: 'CmdOrCtrl+R',
				click: (menuItem, browserWindow) => {
					if (browserWindow && browserWindow.eBrowser) {
						browserWindow.eBrowser.reloadCurrentPage();
					}
				}
			},
			{ role: 'forceReload' },     // Shift+⌘R
			{
				label: 'Close tab',
				accelerator: 'CmdOrCtrl+W',
				click: (menuItem, browserWindow) => {
					if (browserWindow && browserWindow.eBrowser) {
						browserWindow.eBrowser.closeTab(-1);
					}
				}
			},
			{ role: 'toggleDevTools' },  // ⌥⌘I or Ctrl+Shift+I
			{ type: 'separator' },
			/*{ role: 'resetZoom' },
			{ role: 'zoomIn' },
			{ role: 'zoomOut' },*/
			{ type: 'separator' },
			{ role: 'togglefullscreen' }
		]
	}
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

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
async function updateTomlFile(envfile, config) {
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
				updated.push(`${key}=${JSON.stringify(config[key])}`);
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
async function writeJson(filePath, data) {
	const dir = path.dirname(filePath);
	await fsp.mkdir(dir, { recursive: true }); // 确保目录存在
	const jsonStr = JSON.stringify(data, null, 2); // 美化格式写入
	await fsp.writeFile(filePath, jsonStr, 'utf-8');
}

//---------------------------------------------------------------------------
function createWindow(openHome=true,fixHome=true) {
	let win=new EBrowserWindow(openHome?homepageUrl:"_blank",()=>{
		//Append startup into win:
		if(startUp) {
			startUp.window.setParentWindow(win.window);
			setTimeout(() => {
				let sw;
				sw = startUp;
				if (sw) {
					startUp = null;
					try {
						sw.close();
					} catch (err) {
						//Do nothing.
					}
				}
			}, 30000);
		}
	},{home:{fixed:fixHome}});
}

//---------------------------------------------------------------------------
function openSettingsWindow(){
	let win;
	//Find top window
	win=getTopWindow();
	if(win) {
		win.webContents.send("new-tab", `http://localhost:${serverPort}/~/-aae/app_config.html`);
	}
}

//---------------------------------------------------------------------------
function restartServer(){
	//TODO: Code this:
}

//---------------------------------------------------------------------------
let updateStart=false;
let updateTimer=null;
let updateFeedURL="";
let checkingUpdate=false;
let updateAvailable=false;
function startAutoUpdate(){
	function checkUpdate(){
		updateTimer=null;
		if(checkingUpdate){
			return;
		}
		console.log('Checking update');
		checkingUpdate=true;
		autoUpdater.forceDevUpdateConfig = true;
		autoUpdater.checkForUpdatesAndNotify().catch((err)=>{
		}).finally(() => {
			checkingUpdate = false;
			if(!updateAvailable){
				updateTimer=setTimeout(checkUpdate,60*1000);
			}
		});
	}
	if(updateStart){
		return;
	}
	updateStart=true;
	if(updateTimer){
		clearTimeout(updateTimer);
		updateTimer=null;
	}
	if(app.isPackaged){
		updateFeedURL="https://www.ai2apps.com/appupdate";
	}else{
		autoUpdater.autoDownload = true;
		autoUpdater.autoInstallOnAppQuit = false;
		//updateFeedURL=`file://${pathLib.join(__dirname,"download")}`;
		updateFeedURL="http://localhost:3301/appupdate";
	}
	autoUpdater.setFeedURL({
		provider: 'generic',
		url: updateFeedURL
	});
	autoUpdater.on('update-available', () => {
		console.log('Update available');
		const allWindows = BrowserWindow.getAllWindows();
		for(let win of allWindows){
			//Notify all windows:
			win.webContents.send("download-update");
		}
	});
	
	autoUpdater.on('update-downloaded', () => {
		console.log("New update ready!");
		updateAvailable=true;
		const allWindows = BrowserWindow.getAllWindows();
		for(let win of allWindows){
			//Notify all windows:
			win.webContents.send("update-ready");
		}
		setInterval(()=>{
			const allWindows = BrowserWindow.getAllWindows();
			for(let win of allWindows){
				//Notify all windows:
				win.webContents.send("update-ready");
			}
		},10*1000);//Notify all windows per 10 sec.
	});
	updateTimer=setTimeout(checkUpdate,2*1000);
}

//---------------------------------------------------------------------------
let updateLocked = false;
function safeForceQuitAndInstall() {
	if (updateLocked) return;
	updateLocked = true;
	// 移除退出钩子
	app.removeAllListeners('before-quit');
	app.removeAllListeners('window-all-closed');
	if(serverProcess){
		let sp=serverProcess;
		serverProcess=null;
		sp.kill();
	}
	// 强制关闭窗口
	for (const win of BrowserWindow.getAllWindows()) {
		win.removeAllListeners('close');
		win.destroy();
	}
	setTimeout(() => {
		autoUpdater.quitAndInstall();
	}, 500);
}

let lastActiveWindow = null;

//---------------------------------------------------------------------------
function getTopWindow() {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && focused.eBrowser && !focused.isDestroyed()) return focused;
	
	// 回退到最近激活的
	if (lastActiveWindow && lastActiveWindow.eBrowser && !lastActiveWindow.isDestroyed()) return lastActiveWindow;
	
	// 回退到任何可用窗口
	return BrowserWindow.getAllWindows().find(win => win.eBrowser && !win.isDestroyed());
}

//---------------------------------------------------------------------------
function restartApp() {
	app.relaunch();   // 重新启动 App（会使用相同的参数重新执行）
	app.exit(0);      // 退出当前实例（退出码可选）
}

//---------------------------------------------------------------------------
function startServerAndThenWindow() {
	console.log('startServerAndThenWindow')
	app.on('browser-window-focus', (event, window) => {
		lastActiveWindow = window;
	});
	
	startUp=new StartupWindow(async (child,port)=>{
		if (process.platform === 'darwin') {
			app.dock.setIcon(image);
			
			trayImage.setTemplateImage(true);
			tray = new Tray(trayIconPath); // macOS 顶栏图标
			
			tray.setToolTip('AI2Apps');
			tray.on('click', () => {
				//Focus on top BrowserWindow:
				let mainWindow=getTopWindow();
				if (mainWindow.isVisible()) {
					mainWindow.focus();
				} else {
					mainWindow.show();
					mainWindow.focus();
				}
			});
		}
		serverPort=port;
		serverProcess=child;
		if(serverPort){
			homepageUrl=`http://localhost:${serverPort}`;
		}
		createWindow(true);
	});
	// 可选：退出 app 时 kill 掉子进程
	app.on('before-quit', () => {
		if(serverProcess) {
			serverProcess.kill();
		}
	});
	
	//---------------------------------------------------------------------------
	ipcMain.on('dashboard-ready', (event) => {
		console.log("Dashboard ready!");
		if(startUp){
			startUp.close();
		}
	});
	
	
	//---------------------------------------------------------------------------
	ipcMain.handle('check-update', () => {
		if(updateAvailable){
			return true;
		}else{
			startAutoUpdate();
		}
	});
	
	//---------------------------------------------------------------------------
	ipcMain.handle('update-app', () => {
		if(updateAvailable){
			safeForceQuitAndInstall();
		}
	});
	
	//---------------------------------------------------------------------------
	ipcMain.handle('get-config', () => {
		let configJson,userDataDir;
		userDataDir=path.join(app.getPath('userData'),"local");
		configJson=readJson(path.join(userDataDir,"config.json"));
		if(configJson) {
			return configJson.env;
		}
		return {};
	});
	
	//---------------------------------------------------------------------------
	ipcMain.on('set-config', (event,config) => {
		let configJson,userDataDir;
		userDataDir=path.join(app.getPath('userData'),"local");
		configJson=readJson(path.join(userDataDir,"config.json"))||{};
		configJson.env=config;
		writeJson(path.join(userDataDir,"config.json"),configJson).then(()=>{
			restartApp();
		});
	});
	
	//---------------------------------------------------------------------------
	let frpcRuntime=null;
	ipcMain.on('shadow-domain', async (event,config) => {
		let userId;
		let frpcPath,cfgPath;
		let platform=os.platform();
		if(!config ||!config.key ||!config.userId){
			if(frpcRuntime){
				frpcRuntime.kill();
				frpcRuntime=null;
			}
			return;
		}
		userId=config.userId;
		frpcPath=path.join(app.getPath('userData'),"local","server","frpc");
		cfgPath=path.join(frpcPath,"frpc.toml");

		await updateTomlFile(cfgPath,{
			"metadatas.key":config.key,
			"localPort":serverPort,
			"name":`user-${userId}`,
			"metadatas.user":`${userId}`,
			"subdomain":`user-${config.domain}-${userId}`
			//"subdomain":`useraa00${userId}`
		});

		console.log('shadowDomain spawn frpc')
		frpcRuntime= spawn(path.join(frpcPath,platform==="win32"?"frpc.exe":"frpc"), ['-c', cfgPath], {
			cwd: frpcPath,
			stdio: 'inherit'
		});
		frpcRuntime.on('exit', code => {
			console.log(`frpc exited with code ${code}`);
			frpcRuntime=null;
		});
	});
	
	//---------------------------------------------------------------------------
	ipcMain.handle('shell-exec', async(event,url) => {
		try {
			await shell.openExternal(url);
		}catch(err){
			console.log("Shell-Exec error:");
			console.error(err);
		}
	});
}

console.log('electron start')
app.whenReady().then(startServerAndThenWindow);
