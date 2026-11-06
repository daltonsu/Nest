// Prevent invalid rules, stale browser drafts, or cross-site requests from replacing the active rules file.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createRulesStore } from "../lib/rules.mjs";

const example = () => ({
  sources: { local: { name: "本机" } },
  agents: { demo: { name: "测试程序", worker: "local", use: "command", command: ["true"] } },
  rules: [{ name: "示例规则", when: { source: "local", types: ["try.*"] }, to: "demo", cwd: "/tmp" }],
});
async function fixture(t, content = JSON.stringify(example(), null, 2) + "\n") {
  const home = await mkdtemp(join(tmpdir(), "nest-rules-test-"));
  const file = join(home, "rules.json");
  await writeFile(file, content, { mode: 0o600 });
  await writeFile(join(home, "config.json"), JSON.stringify({ owner: "must-not-leak" }), { mode: 0o600 });
  const app = createApp({ port: 0, rules: createRulesStore({ home }) });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.address().port}`;
  const request = (path = "/api/rules", body, headers = {}) =>
    fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-autoloop-request": "1",
        ...(body !== undefined && { origin: url, "content-type": "application/json" }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  return { file, home, url, request, original: content };
}

test("the editor can load and diagnose a broken file without exposing config or accepting a path", async (t) => {
  const f = await fixture(t, '{\n  "rules": [],\n}');
  const response = await f.request("/api/rules?path=config.json");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.content, f.original);
  assert.match(data.version, /^[a-f0-9]{64}$/);
  assert.equal(data.validation.valid, false);
  assert.equal(data.validation.line, 3);
  assert.equal(data.validation.column, 1);
  assert.ok(!JSON.stringify(data).includes("must-not-leak"));
  assert.ok(!JSON.stringify(data).includes(f.home));
  assert.equal((await fetch(f.url + "/api/rules")).status, 403);
});

test("validation catches JSON syntax and backend business rules without writing", async (t) => {
  const f = await fixture(t);
  for (const content of ["{", JSON.stringify({ ...example(), rules: [{ ...example().rules[0], to: "missing" }] })]) {
    const response = await f.request("/api/rules/validate", { content });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.valid, false);
    assert.ok(data.issues.length);
    assert.equal(await readFile(f.file, "utf8"), f.original);
  }
  const valid = await (await f.request("/api/rules/validate", { content: f.original })).json();
  assert.equal(valid.valid, true);
  assert.equal(valid.summary.rules, 1);
  const unknownPosition = await (await f.request("/api/rules/validate", { content: "}" })).json();
  assert.equal(unknownPosition.valid, false);
  assert.equal(unknownPosition.line, undefined);
});

test("saving validates and preserves the authored JSON rather than parser defaults", async (t) => {
  const f = await fixture(t);
  const { version } = await (await f.request()).json();
  const changed = example();
  changed.rules[0].name = "修改后的规则";
  const content = JSON.stringify(changed, null, 2) + "\n";
  const response = await f.request("/api/rules", { version, content, path: "config.json" });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.content, content);
  assert.notEqual(saved.version, version);
  assert.equal(await readFile(f.file, "utf8"), content);
  assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(f.home, "config.json"), "utf8")).owner, "must-not-leak");
});

test("invalid and cross-site saves leave the original rules untouched", async (t) => {
  const f = await fixture(t);
  const { version } = await (await f.request()).json();
  const invalid = await f.request("/api/rules", { version, content: "{" });
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).issues.length);
  assert.equal(
    (await f.request("/api/rules", { version, content: f.original }, { origin: "https://untrusted.example" })).status,
    403,
  );
  assert.equal(await readFile(f.file, "utf8"), f.original);
});

test("an external edit blocks an old draft and concurrent saves have only one winner", async (t) => {
  const f = await fixture(t);
  const first = await (await f.request()).json();
  const external = example();
  external.rules[0].name = "外部编辑";
  await writeFile(f.file, JSON.stringify(external));
  assert.equal((await f.request("/api/rules", { version: first.version, content: first.content })).status, 409);
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).rules[0].name, "外部编辑");
  const current = await (await f.request()).json();
  const responses = await Promise.all(
    ["窗口一", "窗口二"].map((name) => {
      const next = example();
      next.rules[0].name = name;
      return f.request("/api/rules", { version: current.version, content: JSON.stringify(next) });
    }),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});

test("rules larger than the card body limit can be saved but oversized documents are rejected", async (t) => {
  const f = await fixture(t);
  const { version } = await (await f.request()).json();
  const large = example();
  large.rules[0].prompt = "a".repeat(20000);
  assert.equal((await f.request("/api/rules", { version, content: JSON.stringify(large) })).status, 200);
  const oversized = await f.request("/api/rules/validate", { content: " ".repeat(256 * 1024 + 1) });
  assert.equal(oversized.status, 413);
});
