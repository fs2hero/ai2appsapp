import{ dialog,screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "path";
import fs from "node:fs/promises";

const execFileP = promisify(execFile);

export const username = process.env.SUDO_USER || process.env.USER || "root";
export const isArm = process.arch === "arm64";

const isMac = () => process.platform === "darwin";
const HOME = os.homedir();

export const sh = (cmd, env = {}) =>
    promisify(execFile)("/bin/bash", ["-lc", cmd], { timeout: 90_000, env: { ...process.env, ...env } });

export const run = async (cmd) => {
    try {
        const { stdout } = await sh(cmd);
        return { ok: true, out: (stdout || "").trim() };
    }catch (e){
        return { ok: false, out: (e.stdout || e.stderr || "").toString().trim(), code: e.code ?? -1 };
    }
};

/** 用 macOS 系统弹窗（管理员权限）执行单条 shell 命令 */
export async function runAdmin(cmd) {
    // 注意：cmd 会进入 AppleScript 的 "do shell script \"...\""，需要转义双引号和反斜杠
    const esc = cmd.replace(/([\"\\])/g, "\\$1");
    return run(`osascript -e 'do shell script "${esc}" with administrator privileges'`);
}

/** 用 macOS 系统弹窗（管理员权限）执行多条 shell 命令 */
export async function runAdminScript(cmds) {
    // cmds 可是字符串或字符串数组；会以一条 osascript 执行，最多只弹一次密码框
    const script = Array.isArray(cmds) ? cmds.join(" && ") : String(cmds);
    const esc = script.replace(/(["\\])/g, "\\$1");
    return run(`osascript -e 'do shell script "${esc}" with administrator privileges'`);
}


export function runInTerminal(cmd) {
    if(Array.isArray(cmd)){
        cmd=cmd.join(" && ");
    }
    return new Promise((resolve, reject) => {
        const script = `
      tell application "Terminal"
        activate
        do script "${cmd.replace(/(["\\])/g, '\\$1')}"
      end tell
    `;
        execFile("osascript", ["-e", script], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export async function runStepsInTerminal(steps) {
    // steps: string[] 每个元素一条 shell 命令
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "electron-steps-"));
    const scriptPath = path.join(tmpDir, "run.command");
    
    // 用 zsh 更贴近用户默认环境；加 -e 出错即退出；最后留一行提示避免窗口一闪而过
    const content =
        `#!/bin/zsh
        set -e
        ${steps.join("\n")}

        echo ""
        read -sk 1 -p "执行完成。按任意键关闭窗口…"
        echo ""`;
    
    await fs.writeFile(scriptPath, content, { mode: 0o755 });
    
    // 用引号包裹路径，防空格
    await execFileP("open", ["-a", "Terminal", scriptPath]);
}

export async function showDialogInfo(title, msg, detail, buttons = ["确定","取消"]) {
    return dialog.showMessageBox(win,{
                type: "info",
                buttons: buttons,
                cancelId: 1,
                defaultId: 0,
                noLink: true,
                title: title,
                message: msg,
                detail: detail
            });
}

export function moveWindowToAlign(win, hAlign = 'center', vAlign = 'middle') {
    if (!win || win.isDestroyed()) return;
    
    // 规范化输入
    const H = String(hAlign).toLowerCase();
    const V = String(vAlign).toLowerCase().replace('center', 'middle');
    
    const wb = win.getBounds();
    const display = screen.getDisplayMatching(wb);      // 以窗口所在显示器为准
    const wa = display.workArea;                        // 可用区域（排除菜单栏/Dock）
    
    // 计算 X
    const x =
        H === 'left'   ? wa.x :
            H === 'right'  ? wa.x + wa.width - wb.width :
                wa.x + Math.round((wa.width  - wb.width)  / 2); // center
    
    // 计算 Y
    const y =
        V === 'top'     ? wa.y :
            V === 'bottom'  ? wa.y + wa.height - wb.height :
                wa.y + Math.round((wa.height - wb.height) / 2); // middle
    
    // 若窗口比可用区域还大，做下限位
    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
    const maxX = wa.x + Math.max(0, wa.width  - wb.width);
    const maxY = wa.y + Math.max(0, wa.height - wb.height);
    
    win.setPosition(clamp(x, wa.x, maxX), clamp(y, wa.y, maxY));
}