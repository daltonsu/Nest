// Prevent a combined launch from leaving one service behind after shutdown or a port conflict.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));
async function socket() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error("等待前后端状态超时。");
}
async function healthy(url) {
  try {
    return (await fetch(url + "/healthz", { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}
async function fixture(t, occupied = false) {
  const home = await mkdtemp(join(tmpdir(), "nest-stack-test-"));
  let hubSocket, webSocket, child, exited;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (exited) await exited;
    for (const server of [hubSocket, webSocket])
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  hubSocket = await socket();
  webSocket = await socket();
  const hubPort = hubSocket.address().port,
    webPort = webSocket.address().port;
  await new Promise((resolve) => hubSocket.close(resolve));
  if (!occupied) await new Promise((resolve) => webSocket.close(resolve));
  const env = { ...process.env, AGENT_AUTOLOOP_HOME: home, AUTOLOOP_WEB_PORT: String(webPort) };
  execFileSync(
    process.execPath,
    [
      join(repository, "bin/agent-autoloop.ts"),
      "init",
      "--command",
      `${process.execPath} ${join(root, "test/fixture-agent.mjs")}`,
      "--no-service",
      "--port",
      String(hubPort),
    ],
    { env, stdio: "pipe" },
  );
  for (const file of ["config.json", "rules.json"]) {
    const path = join(home, file),
      data = JSON.parse(await readFile(path, "utf8"));
    data.channels = {};
    await writeFile(path, JSON.stringify(data), { mode: 0o600 });
  }
  child = spawn(process.execPath, [join(repository, "scripts/start.mjs")], {
    cwd: repository,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  return {
    home,
    child,
    exited,
    output: () => output,
    hubURL: `http://127.0.0.1:${hubPort}`,
    webURL: `http://127.0.0.1:${webPort}`,
    webSocket,
  };
}

test("one command starts both services and SIGTERM stops both", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  await until(async () => {
    if (f.child.exitCode !== null) throw new Error(f.output());
    return (await healthy(f.hubURL)) && (await healthy(f.webURL));
  });
  const response = await fetch(f.webURL + "/api/state", { headers: { "x-autoloop-request": "1" } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).tasks, []);
  f.child.kill("SIGTERM");
  assert.equal(await f.exited, 0);
  assert.equal(await healthy(f.webURL), false);
  assert.equal(await healthy(f.hubURL), false);
  await assert.rejects(access(join(f.home, "up.pid")));
});

test(
  "an occupied frontend port stops its backend without touching the existing listener",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t, true);
    assert.notEqual(await f.exited, 0);
    assert.match(f.output(), /已被占用/);
    assert.equal(await healthy(f.hubURL), false);
    assert.equal(f.webSocket.listening, true);
  },
);
