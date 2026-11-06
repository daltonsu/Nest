import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

for (const [name, args] of [
  ["后端", ["--disable-warning=ExperimentalWarning", "bin/agent-autoloop.ts", "up"]],
  ["前端", ["frontend/server.mjs"]],
]) {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
  children.add(child);
  child.once("error", (error) => {
    console.error(`${name}启动失败：${error.message}`);
    stop(1);
  });
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name}已退出，正在停止另一端。常驻服务运行时，请先运行 npm run service:stop。`);
      stop(code || 1);
    }
  });
}
