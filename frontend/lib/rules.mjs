import {
  readFileSync,
  realpathSync,
  statSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parseRules, RulesError } from "../../protocol/rules.ts";
import { AppError } from "./hub.mjs";

const MAX_BYTES = 256 * 1024;
const versionOf = (content) => createHash("sha256").update(content).digest("hex");

function checkContent(content) {
  if (typeof content !== "string") throw new AppError(400, "规则内容必须是文本。");
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new AppError(413, "规则文件最多 256 KB，请缩小后重试。");
}

export function validateRules(content) {
  checkContent(content);
  try {
    JSON.parse(content);
  } catch (error) {
    const position = /position (\d+)/.exec(error.message);
    const offset = position ? Number(position[1]) : /Unexpected end/.test(error.message) ? content.length : null;
    const lines = offset === null ? null : content.slice(0, offset).split("\n");
    return {
      valid: false,
      issues: ["JSON 语法错误：" + error.message],
      ...(lines && { line: lines.length, column: lines.at(-1).length + 1 }),
    };
  }
  try {
    const rules = parseRules(content, Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    return {
      valid: true,
      issues: [],
      summary: { rules: rules.rules.length, agents: Object.keys(rules.agents).length, timezone: rules.timezone },
    };
  } catch (error) {
    if (error instanceof RulesError) return { valid: false, issues: error.issues };
    throw error;
  }
}

export function createRulesStore({
  home = process.env.AGENT_AUTOLOOP_HOME || join(homedir(), ".agent-autoloop"),
  file = process.env.AGENT_AUTOLOOP_RULES || join(home, "rules.json"),
} = {}) {
  const rulesFile = resolve(file);
  function readCurrent() {
    try {
      const target = realpathSync(rulesFile),
        stats = statSync(target);
      if (stats.size > MAX_BYTES) throw new AppError(413, "规则文件超过 256 KB，暂时无法在页面中编辑。");
      const content = readFileSync(target, "utf8");
      return { target, mode: stats.mode & 0o777, content, version: versionOf(content) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        error.code === "ENOENT"
          ? "找不到 rules.json，请确认中台的数据目录。"
          : "无法读取 rules.json，请检查本机文件权限。",
      );
    }
  }
  function read() {
    const { content, version } = readCurrent();
    return { content, version, validation: validateRules(content) };
  }
  function save({ content, version } = {}) {
    if (typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version))
      throw new AppError(400, "请先载入规则，再保存修改。");
    const validation = validateRules(content);
    if (!validation.valid) {
      const error = new AppError(422, "规则未通过校验，文件没有修改。");
      error.details = validation;
      throw error;
    }
    // Keep the version check and replacement synchronous so two browser saves cannot both win.
    const current = readCurrent();
    if (current.version !== version)
      throw new AppError(409, "文件已被其他窗口或程序修改。草稿已保留，请先复制草稿，再重新载入。");
    if (content === current.content) return { content, version, validation };
    const temporary = join(dirname(current.target), `.${basename(current.target)}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, "wx", current.mode);
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, current.target);
    } catch {
      throw new AppError(503, "无法保存 rules.json，请检查本机目录权限；草稿仍保留在页面中。");
    } finally {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(temporary);
      } catch {}
    }
    return { content, version: versionOf(content), validation };
  }
  return { read, validate: validateRules, save };
}
