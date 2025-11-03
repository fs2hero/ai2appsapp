export async function check(run) {
  const x = await run('xcode-select -p');
  return { ok: x.ok, version: x.ok ? x.out : '', fix: ['xcode-select --install'] };
}

export async function install({ run, onLog } = {}) {
  const log = (s) => onLog?.(s);
  await run('/usr/bin/xcode-select --install');
  log('Xcode CLT: 安装触发');
}

export default { check, install };
