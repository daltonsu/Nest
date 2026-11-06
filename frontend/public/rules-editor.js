export function createRulesEditor({ request, onSaved }) {
  const $ = (selector) => document.querySelector(selector);
  const source = $("#rules-source");
  const state = { loaded: false, original: "", version: null, busy: null, mode: "overview" };
  const dirty = () => state.loaded && source.value !== state.original;

  function update() {
    const changed = dirty();
    $("#rules-file-status").textContent =
      state.busy === "save"
        ? "正在保存…"
        : state.busy === "load"
          ? "正在载入…"
          : !state.loaded
            ? "尚未载入"
            : changed
              ? "有未保存修改"
              : "已与文件同步";
    $("#rules-file-status").classList.toggle("attention", changed);
    for (const name of ["format", "validate", "save"])
      $("#rules-" + name).disabled = !state.loaded || !!state.busy || (name === "save" && !changed);
    $("#rules-reload").disabled = !!state.busy;
    source.disabled = !state.loaded || state.busy === "load";
    source.readOnly = state.busy === "save";
    $("#rules-line-numbers").textContent = Array.from(
      { length: source.value.split("\n").length },
      (_, i) => i + 1,
    ).join("\n");
    const before = source.value.slice(0, source.selectionStart).split("\n");
    $("#rules-position").textContent =
      `第 ${before.length} 行，第 ${before.at(-1).length + 1} 列 · ${source.value.length.toLocaleString("zh-CN")} 字符`;
  }

  function report(kind, title, issues = [], location) {
    const panel = $("#rules-feedback");
    panel.dataset.kind = kind;
    $("#rules-feedback-title").textContent = title;
    const list = $("#rules-issues");
    list.replaceChildren();
    if (location?.line) {
      const item = document.createElement("li");
      item.textContent = `位置：第 ${location.line} 行，第 ${location.column} 列`;
      list.append(item);
    }
    for (const issue of issues) {
      const item = document.createElement("li");
      item.textContent = issue;
      list.append(item);
    }
    list.hidden = !list.children.length;
  }

  function showValidation(result, success = "规则校验通过") {
    if (result.valid) {
      const { rules, agents, timezone } = result.summary;
      report("success", success, [`${rules} 条规则 · ${agents} 个 Agent`, `时区：${timezone}`]);
    } else report("error", "请修正以下问题", result.issues, result);
  }

  function showError(error) {
    if (error.details?.issues) report("error", error.message, error.details.issues, error.details);
    else
      report(
        error.status === 409 ? "conflict" : "error",
        error.status === 409 ? "文件有新版本，尚未保存" : "操作未完成",
        [error.message],
      );
  }

  async function load({ discard = false } = {}) {
    if (state.busy) return;
    if (dirty() && !discard) {
      $("#rules-reload-dialog").showModal();
      return;
    }
    state.busy = "load";
    update();
    try {
      const data = await request("/api/rules");
      source.value = data.content;
      source.setSelectionRange(0, 0);
      state.original = data.content;
      state.version = data.version;
      state.loaded = true;
      source.scrollTop = 0;
      $("#rules-line-numbers").scrollTop = 0;
      showValidation(data.validation, "已载入，规则校验通过");
    } catch (error) {
      showError(error);
    } finally {
      state.busy = null;
      update();
    }
  }

  async function validate() {
    if (!state.loaded || state.busy) return;
    const content = source.value;
    state.busy = "validate";
    update();
    report("pending", "正在检查 JSON 和规则配置…");
    try {
      const result = await request("/api/rules/validate", { content });
      if (source.value === content) showValidation(result);
      else report("pending", "内容已修改，请重新校验");
    } catch (error) {
      if (source.value === content) showError(error);
    } finally {
      state.busy = null;
      update();
    }
  }

  async function save() {
    if (!dirty() || state.busy) return;
    const content = source.value;
    state.busy = "save";
    update();
    report("pending", "正在校验并保存…");
    try {
      const data = await request("/api/rules", { content, version: state.version });
      state.original = data.content;
      state.version = data.version;
      report("success", "已保存到 rules.json", ["中台会自动载入；可在「规则概览」查看当前生效规则。"]);
      await onSaved();
    } catch (error) {
      showError(error);
    } finally {
      state.busy = null;
      update();
    }
  }

  function setMode(mode) {
    state.mode = mode;
    for (const button of document.querySelectorAll("[data-rules-mode]"))
      button.setAttribute("aria-pressed", String(button.dataset.rulesMode === mode));
    $("#rules-content").hidden = mode !== "overview";
    $("#rules-editor-panel").hidden = mode !== "editor";
    if (mode === "editor" && !state.loaded) load();
  }

  $("#rules-mode").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rules-mode]");
    if (button) setMode(button.dataset.rulesMode);
  });
  $("#rules-reload").addEventListener("click", () => load());
  $("#rules-cancel-reload").addEventListener("click", () => $("#rules-reload-dialog").close());
  $("#rules-confirm-reload").addEventListener("click", () => {
    $("#rules-reload-dialog").close();
    load({ discard: true });
  });
  $("#rules-validate").addEventListener("click", validate);
  $("#rules-save").addEventListener("click", save);
  $("#rules-format").addEventListener("click", () => {
    try {
      const formatted = JSON.stringify(JSON.parse(source.value), null, 2) + "\n";
      if (source.value !== formatted) {
        source.value = formatted;
        report("pending", "已格式化，尚未保存", ["点击「校验规则」检查配置，或直接保存。"]);
      }
      update();
    } catch {
      report("error", "暂时无法格式化", ["JSON 语法有误，请点击「校验规则」查看具体位置。"]);
    }
  });
  source.addEventListener("input", () => {
    update();
    report("pending", "修改尚未保存", ["保存时会再次校验 JSON 和规则配置。"]);
  });
  for (const event of ["click", "keyup", "select"]) source.addEventListener(event, update);
  source.addEventListener("scroll", () => ($("#rules-line-numbers").scrollTop = source.scrollTop));
  $("#rules-view").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.mode === "editor") {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  update();
}
