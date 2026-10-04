/*
 * Todo 12 — i18n（中/英）CDP 语言与 CJK 残留扫描工具（零依赖）。
 *
 * 运行方式：
 *   node tools/verify-i18n.cjs [--locale=zh|en] [--page=all|settings|gallery|composer|localai|queue|tutorial|shell]
 *
 * 默认：--locale=zh --page=all。
 *
 * 前置条件：
 *   - 已执行 `npm.cmd run build`（脚本会在产物缺失时自动补跑；存在时绝不重建）；
 *   - 没有其他 Electron 实例占用本脚本的调试端口。
 *
 * 实现约定（照 tools/verify-layout.cjs 范式）：
 *   - 仅使用 Node >= 22 内置模块：child_process / fs / path / os / fetch / WebSocket。
 *   - 不依赖 puppeteer / playwright / ws 等任何第三方自动化库。
 *   - 以独立 `--user-data-dir=<临时目录>` 启动生产产物，保证隔离与可复现，绝不触碰真实 userData。
 *   - 断言结果只以退出码为准：en 模式下发现任一 CJK 残留即 process.exitCode = 1。
 *
 * 工具职责（严格只读 + 语言切换 + 导航）：
 *   1) 启动构建产物（隔离 userData）→ 等待 renderer；
 *   2) 如 --locale=en：经设置页真实语言 UI 切换并轮询 settings.get().locale 确认持久化；
 *      --locale=zh：已是 zh 则跳过，否则同样经 UI 切回；
 *   3) 遍历请求的页面（经 .nav[data-mode=...] 导航；queue 入口在 SidebarProjects），
 *      打开关键面板 / 聚焦信息提示以露出 tooltip 文本，然后采集：
 *        a. 可见文本（等价 document.body.innerText，但按 skip 选择器与可见性过滤）
 *        b. 全部 [placeholder] / [aria-label] / [title] 值
 *        c. .tooltip-bubble 文本（若存在）
 *   4) en 模式：断言采集文本无 CJK（[\u4e00-\u9fff]），输出违规清单（页面 / 来源类型 / 选择器上下文 / 原文），
 *      任一违规 → exit 1；zh 模式：不做 CJK 断言，仅打印基线摘要（本工具不断言 zh）。
 *
 * skip 列表维护规则（见下方 SKIP_SELECTORS / DATA_LITERALS，脚本头部单一来源）：
 *   - 用户内容：图库卡片、侧栏项目 / 图片标题与相对时间、模型名 / 供应商名、textarea/input 值
 *     （值不采集；placeholder 单独检查）、参考图文件名、本地源图标题、队列任务提示词。
 *   - 文件路径 / 目录展示：设置页 saveDir（.storage-path code）、本地模型目录
 *     （.model-manager .section-head small）——默认路径含「图库」等中文，否则必然误报。
 *   - 语言切换器 endonym：「简体中文」按钮在 en 模式下也是合法中文，已同时：
 *       ① 按钮加 data-i18n-skip（SettingsPanel）；② 通用 [data-i18n-skip] 子树跳过。
 *   - 数据值：DATA_LITERALS 仅用于剥离「持久化的默认数据」（如收件箱项目名），
 *     用于拼接行；剥离后剩余文本仍参与 CJK 判定（绝不会掩盖同一行里的 UI 文案残留）。
 *   - 新增合法中文来源时：优先加选择器到 SKIP_SELECTORS；确属「持久化数据」才加 DATA_LITERALS。
 *
 * 退出码：全部通过 = 0；en 模式发现 CJK 残留、或清理失败 = 1。
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const repoRoot = path.resolve(__dirname, "..");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");
const PORT = 9444;

const LOCALES = ["zh", "en"];
const PAGES = ["all", "settings", "gallery", "composer", "localai", "queue", "tutorial", "shell"];
/** all 的遍历顺序。 */
const PAGE_ORDER = ["composer", "settings", "gallery", "localai", "queue", "tutorial", "shell"];

/** CJK 判定范围（与计划一致：汉字基本区）。 */
const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * 页面 → 导航与就绪锚点。tutorial / shell 特殊处理（见 preparePage / activatePage）。
 * 导航锚点：.nav[data-mode]（T5 约定）；queue 入口在 SidebarProjects 的 .nav[data-mode="queue"]。
 */
const PAGE_SPECS = {
  composer: { mode: "generate", ready: ".composer" },
  settings: { mode: "settings", ready: ".card.settings" },
  gallery: { mode: "gallery", ready: ".gallery-workbench" },
  localai: { mode: "local-ai", ready: ".local-ai-workbench" },
  queue: { mode: "queue", ready: ".queue-panel" },
};

/**
 * 选择性跳过：元素命中（或祖先命中）这些选择器时，其文本 / 属性 / tooltip 不采集。
 * 单一来源，新增合法中文来源时在此扩展。
 */
const SKIP_SELECTORS = [
  // 通用子树跳过（如语言切换器「简体中文」按钮）
  "[data-i18n-skip]",
  // 用户内容：侧栏项目 / 图片标题与相对时间
  ".sidebar-project-name",
  ".sidebar-project-item-title",
  ".sidebar-project-item-time",
  // 用户内容：图库卡片（标题 / 模型 / 提示词 / 标签整块）
  ".archive-meta",
  // 用户内容：模型名与供应商名（配置数据）
  ".model-id",
  ".provider-card-title strong",
  ".dock-model-trigger strong",
  // 文件路径 / 目录展示（默认路径含「图库」等中文）
  ".storage-path code",
  ".model-manager .section-head small",
  // 用户输入值：textarea 的 value 不采集（placeholder 另行检查）
  "textarea",
  // select 中的用户内容（项目名 / 模板名 / 布局方案名）；本地化下拉不在此列，仍会被检查
  ".project-strip select",
  ".prompt-template-actions select",
  ".negative-template-actions select",
  ".layout-preset-select select",
  ".bulk-group select",
  // 用户内容：队列任务提示词
  ".queue-list article > div > p",
  // 用户内容：本地 AI 源图标题 / 参考图文件名
  ".local-source-preview strong",
  ".reference-item span",
];

/**
 * 持久化数据字面量：仅用于从拼接文本中剥离「默认数据值」（如收件箱项目名），
 * 剥离后剩余文本仍参与 CJK 判定——不会掩盖同一行的 UI 文案残留。
 */
const DATA_LITERALS = ["收件箱"];

let child = null;
let wsRef = null;
let userDataDir = null;
/** fail() 调用计数：runPage 用它判定「本页 preparePage 是否失败」（而非全局 exitCode）。 */
let failCount = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  console.log(String(line));
}

/** 断言样式输出：与 verify-layout 一致，任一 FAIL 置 exitCode=1。 */
function fail(label, raw) {
  log(`[FAIL] ${label}`);
  if (raw !== undefined) log(`RAW: ${raw}`);
  failCount += 1;
  process.exitCode = 1;
}

function info(label, raw) {
  log(`[INFO] ${label}${raw !== undefined ? " " + raw : ""}`);
}

function parseArgs(argv) {
  const options = { locale: "zh", page: "all" };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      log("usage: node tools/verify-i18n.cjs [--locale=zh|en] [--page=" + PAGES.join("|") + "]");
      process.exit(0);
    }
    const localeMatch = /^--locale=(.+)$/.exec(arg);
    if (localeMatch) {
      options.locale = localeMatch[1];
      continue;
    }
    const pageMatch = /^--page=(.+)$/.exec(arg);
    if (pageMatch) {
      options.page = pageMatch[1];
      continue;
    }
    fail(`unknown argument: ${arg}`, `expected --locale=zh|en and --page=${PAGES.join("|")}`);
  }
  if (!LOCALES.includes(options.locale)) fail(`invalid --locale=${options.locale}`, `expected one of ${LOCALES.join(", ")}`);
  if (!PAGES.includes(options.page)) fail(`invalid --page=${options.page}`, `expected one of ${PAGES.join(", ")}`);
  return options;
}

/** 构建产物缺失时自动补跑 `npm run build`（存在时绝不重建）。 */
function ensureBuild() {
  const renderer = path.join(repoRoot, "dist-renderer", "index.html");
  const main = path.join(repoRoot, "dist-electron", "main.js");
  if (fs.existsSync(renderer) && fs.existsSync(main)) {
    log("build artifacts present: skip npm run build");
    return true;
  }
  log("build artifacts missing: running npm run build ...");
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(cmd, ["run", "build"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    fail(`npm run build exited with status ${String(result.status)}`);
    return false;
  }
  return true;
}

/**
 * 并发防护（T27 可能同时在跑 npm run package:win 重构建）：
 * 产物存在但疑似写入中（0 字节）时短暂等待并重试一次。
 */
async function waitForStableArtifacts() {
  const targets = [path.join(repoRoot, "dist-renderer", "index.html"), path.join(repoRoot, "dist-electron", "main.js")];
  const readSizes = () => targets.map((file) => (fs.existsSync(file) ? fs.statSync(file).size : -1));
  let sizes = readSizes();
  if (sizes.every((size) => size > 0)) return true;
  info("artifacts look mid-write, waiting 3s before retry", JSON.stringify(sizes));
  await sleep(3000);
  sizes = readSizes();
  const ok = sizes.every((size) => size > 0);
  if (!ok) fail("build artifacts not ready (mid-write)", JSON.stringify(sizes));
  return ok;
}

async function waitForPageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      /* 调试端口尚未就绪，继续轮询 */
    }
    await sleep(500);
  }
  return null;
}

async function connectCdp() {
  const target = await waitForPageTarget();
  if (!target) throw new Error(`no type=page CDP target on port ${PORT} within 20s`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("CDP websocket failed to open"));
  });
  wsRef = ws;

  let nextId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
    else entry.resolve(msg);
  };

  ws.onerror = () => {
    for (const entry of pending.values()) entry.reject(new Error("CDP websocket error"));
    pending.clear();
  };

  function send(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const msg = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const detail = msg.result;
    if (!detail || !detail.result) throw new Error(`Runtime.evaluate returned no result: ${JSON.stringify(msg)}`);
    if (detail.exceptionDetails) throw new Error(`Runtime.evaluate exception: ${JSON.stringify(detail.exceptionDetails)}`);
    return detail.result.value;
  }

  await send("Page.enable", {});
  return {
    send,
    evaluate,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function waitForRenderer(cdp) {
  for (let i = 0; i < 60; i++) {
    try {
      const raw = await cdp.evaluate(`JSON.stringify({bridge:!!(window.imageStudio && window.imageStudio.settings), nav:document.querySelectorAll('.nav').length})`);
      const state = JSON.parse(raw);
      if (state.bridge && state.nav > 0) {
        log(`renderer ready after ~${i * 250}ms: ${raw}`);
        return true;
      }
    } catch {
      /* 页面尚未加载完成 */
    }
    await sleep(250);
  }
  return false;
}

/** 跳过首次启动的教程询问弹窗（隔离 userData 无教程记录时会弹出）。 */
async function dismissTutorial(cdp) {
  for (let i = 0; i < 16; i++) {
    let state = "none";
    try {
      state = await cdp.evaluate(`(function(){var c=document.querySelector('.tutorial-welcome-card');if(!c)return 'none';var b=c.querySelector('.tutorial-close');if(b){b.click();return 'clicked';}return 'no-close';})()`);
    } catch {
      /* 忽略 */
    }
    if (state !== "none") {
      info(`tutorial welcome overlay: ${state}`);
      break;
    }
    await sleep(250);
  }
  await sleep(300);
  try {
    await cdp.evaluate(`(function(){var c=document.querySelector('.tutorial-close');if(c)c.click();return true;})()`);
  } catch {
    /* ignore */
  }
  await sleep(200);
}

async function currentLocale(cdp) {
  const raw = await cdp.evaluate(`(async function(){try{var s=await window.imageStudio.settings.get();return (s&&s.locale)||'';}catch(e){return '';}})()`);
  return typeof raw === "string" ? raw : "";
}

async function selectorCount(cdp, selector) {
  const value = await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  return typeof value === "number" ? value : 0;
}

async function waitForSelector(cdp, selector, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await selectorCount(cdp, selector)) > 0) return true;
    await sleep(150);
  }
  return false;
}

async function clickMode(cdp, mode) {
  return cdp.evaluate(`(function(){var b=document.querySelector('.nav[data-mode=${JSON.stringify(mode)}]');if(b){b.click();return true;}return false;})()`);
}

/** 经设置页真实语言 UI 切换语言，并轮询 settings.get().locale 确认持久化生效。 */
async function ensureLocale(cdp, target) {
  const before = await currentLocale(cdp);
  log(`locale before: ${before || "(unknown)"} -> target: ${target}`);
  if (before === target) {
    log(`locale already ${target}: skip switch`);
    return true;
  }
  const clickedMode = await clickMode(cdp, "settings");
  if (!clickedMode || !(await waitForSelector(cdp, ".card.settings"))) {
    fail("could not open settings page to switch language");
    return false;
  }
  const buttonText = target === "en" ? "English" : "简体中文";
  const clicked = await cdp.evaluate(`(function(){var bs=document.querySelectorAll('.card.settings button[aria-pressed]');for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()===${JSON.stringify(buttonText)}){bs[i].click();return true;}}return false;})()`);
  if (!clicked) {
    fail(`language button not found: ${buttonText}`, `aria-pressed buttons=${await selectorCount(cdp, ".card.settings button[aria-pressed]")}`);
    return false;
  }
  for (let i = 0; i < 30; i++) {
    if ((await currentLocale(cdp)) === target) {
      log(`locale switched to ${target} (settings.get confirmed)`);
      return true;
    }
    await sleep(200);
  }
  fail(`locale did not persist to ${target}`);
  return false;
}

/** tutorial 页：打开教程中心模态；shell 页：只扫描 header / aside / toast 外壳。 */
const SHELL_ROOT_SELECTOR = "header, aside, .feedback-toast";

/**
 * 进入指定页面并打开关键面板 / 聚焦信息提示，返回采集用的 rootSelector（null = 整页）。
 */
async function preparePage(cdp, page) {
  if (page === "tutorial") {
    const opened = await cdp.evaluate(`(function(){if(document.querySelector('.tutorial-center-modal'))return true;var b=document.querySelector('.sidebar-help');if(b){b.click();return true;}return false;})()`);
    if (!opened) {
      fail("tutorial: .sidebar-help not found");
      return null;
    }
    await waitForSelector(cdp, ".tutorial-center-modal", 4000);
    await sleep(250);
    return null;
  }

  if (page === "shell") {
    await sleep(150);
    return SHELL_ROOT_SELECTOR;
  }

  const spec = PAGE_SPECS[page];
  if (!spec) {
    fail(`unknown page: ${page}`);
    return null;
  }
  const navigated = await clickMode(cdp, spec.mode);
  if (!navigated) {
    fail(`page ${page}: nav .nav[data-mode="${spec.mode}"] not found`);
    return null;
  }
  if (!(await waitForSelector(cdp, spec.ready))) {
    fail(`page ${page}: ready selector not found`, spec.ready);
    return null;
  }
  await sleep(200);

  // 打开关键面板（仅本地组件态，离开页面即释放；不改应用持久状态）。
  if (page === "composer") {
    await cdp.evaluate(`(function(){var b=document.querySelector('.dock-model-trigger');if(b){b.click();return true;}return false;})()`);
    await sleep(300);
  } else if (page === "settings") {
    await cdp.evaluate(`(function(){var b=document.querySelector('.provider-block-head button.secondary');if(b){b.click();return true;}return false;})()`);
    await sleep(300);
  }
  return null;
}

/** 聚焦首个信息提示按钮以露出 tooltip 气泡文本（聚焦即时显示）。 */
async function focusInfoHint(cdp) {
  try {
    await cdp.evaluate(`(function(){var h=document.querySelector('.tooltip-hint');if(h){h.focus();return true;}return false;})()`);
    await sleep(250);
  } catch {
    /* ignore */
  }
}

async function blurActive(cdp) {
  try {
    await cdp.evaluate(`(function(){var a=document.activeElement;if(a&&a.blur)a.blur();return true;})()`);
  } catch {
    /* ignore */
  }
}

/** 关闭为观察而打开的面板（composer 的快捷切换面板 / tutorial 中心），避免污染后续页面扫描。 */
async function closePanels(cdp, page) {
  if (page === "composer") {
    await cdp.evaluate(`(function(){var b=document.querySelector('.dock-model-trigger');if(b){b.click();return true;}return false;})()`);
    await sleep(150);
  } else if (page === "tutorial") {
    await cdp.evaluate(`(function(){var b=document.querySelector('.tutorial-center .tutorial-close');if(b){b.click();return true;}return false;})()`);
    await sleep(200);
  }
}

/**
 * 页面内采集函数。以 `.toString()` 注入 CDP，避免转义；三个参数：
 * page / rootSelector / skipSelectors。返回 JSON 字符串：
 * { page, items: [{kind, context, text}], truncated, innerTextLength }。
 *
 * 文本采用 TreeWalker（等价 document.body.innerText，但按可见性 + skip 选择器过滤），
 * 逐文本节点收集，保证 skip 子树与隐藏节点（如收起态侧栏）被排除。
 */
function collectInPage(page, rootSelector, skipSelectors) {
  var SKIP = skipSelectors;
  var skipSel = SKIP.join(",");
  var MAX_ITEMS = 4000;
  var MAX_TEXT = 240;

  function isSkipped(el) {
    if (!el) return false;
    try {
      return !!el.closest(skipSel);
    } catch (e) {
      return false;
    }
  }

  function visible(el) {
    if (!el) return false;
    try {
      if (typeof el.checkVisibility === "function") {
        return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: false, visibilityProperty: true });
      }
      return el.offsetParent !== null;
    } catch (e) {
      return true;
    }
  }

  function contextOf(el) {
    var parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push("#" + el.id);
    var cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) parts.push("." + cls.join("."));
    var mode = el.getAttribute("data-mode");
    if (mode) parts.push('[data-mode="' + mode + '"]');
    return parts.join("");
  }

  var items = [];
  var truncated = false;
  function push(kind, el, value) {
    if (items.length >= MAX_ITEMS) {
      truncated = true;
      return;
    }
    var text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return;
    items.push({ kind: kind, context: contextOf(el), text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text });
  }

  var roots = rootSelector ? Array.prototype.slice.call(document.querySelectorAll(rootSelector)) : [document.body];
  roots.forEach(function (root) {
    if (!root) return;
    // 1) 可见文本节点
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue;
      if (!value || !value.trim()) continue;
      var parent = node.parentElement;
      if (!parent) continue;
      var tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") continue;
      if (isSkipped(parent)) continue;
      if (!visible(parent)) continue;
      push("text", parent, value);
    }
    // 2) 属性值
    var attrEls = root.querySelectorAll("[placeholder],[aria-label],[title]");
    Array.prototype.forEach.call(attrEls, function (el) {
      if (isSkipped(el)) return;
      if (!visible(el)) return;
      ["placeholder", "aria-label", "title"].forEach(function (attr) {
        var attrValue = el.getAttribute(attr);
        if (attrValue && attrValue.trim()) push(attr, el, attrValue);
      });
    });
    // 3) tooltip 气泡文本
    var bubbles = root.querySelectorAll(".tooltip-bubble");
    Array.prototype.forEach.call(bubbles, function (el) {
      if (isSkipped(el)) return;
      push("tooltip", el, el.innerText || el.textContent || "");
    });
  });

  var innerTextLength = 0;
  try {
    innerTextLength = (document.body.innerText || "").length;
  } catch (e) {
    innerTextLength = -1;
  }

  return JSON.stringify({ page: page, items: items, truncated: truncated, innerTextLength: innerTextLength });
}

async function collectPage(cdp, page, rootSelector) {
  await focusInfoHint(cdp);
  const raw = await cdp.evaluate(`(${collectInPage.toString()})(${JSON.stringify(page)}, ${JSON.stringify(rootSelector || null)}, ${JSON.stringify(SKIP_SELECTORS)})`);
  await blurActive(cdp);
  const parsed = JSON.parse(raw);
  if (parsed.truncated) info(`page ${page}: item list truncated at 4000`);
  return parsed;
}

/** 从文本中剥离持久化数据字面量，返回仍参与 CJK 判定的剩余文本。 */
function stripDataLiterals(text) {
  let out = text;
  for (const literal of DATA_LITERALS) out = out.split(literal).join("");
  return out;
}

/** 采集结果 → 违规清单（en 模式）：CJK 出现在剥离数据值后的文本即违规。 */
function findViolations(page, items) {
  const violations = [];
  for (const item of items) {
    const remainder = stripDataLiterals(item.text);
    if (CJK_RE.test(remainder)) violations.push({ page: page, kind: item.kind, context: item.context, text: item.text });
  }
  return violations;
}

function summarizeItems(items) {
  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1;
  return counts;
}

async function runPage(cdp, page, locale) {
  log("");
  log(`--- PAGE ${page} (locale=${locale}) ---`);
  const failCountBefore = failCount;
  const rootSelector = await preparePage(cdp, page);
  if (failCount > failCountBefore && page !== "tutorial" && page !== "shell") {
    // 本页导航失败：preparePage 已记录；跳过采集。前页违规不得短路本页。
    await closePanels(cdp, page);
    return null;
  }
  const collected = await collectPage(cdp, page, rootSelector);
  await closePanels(cdp, page);

  const items = collected.items || [];
  const counts = summarizeItems(items);
  log(`collected: ${items.length} items ${JSON.stringify(counts)}; body.innerText length=${collected.innerTextLength}`);

  if (locale === "zh") {
    log(`[PASS] ${page}: zh baseline collected (no CJK assertion)`);
    return { page, locale, items: items.length, counts, innerTextLength: collected.innerTextLength, violations: 0 };
  }

  const violations = findViolations(page, items);
  if (violations.length === 0) {
    log(`[PASS] ${page}: no CJK residue in en mode`);
  } else {
    log(`[FAIL] ${page}: ${violations.length} CJK residue item(s) in en mode`);
    const shown = violations.slice(0, 100);
    for (const v of shown) log(`  [VIOLATION] page=${v.page} kind=${v.kind} ctx=${v.context} text=${JSON.stringify(v.text)}`);
    if (violations.length > shown.length) log(`  ... ${violations.length - shown.length} more`);
    process.exitCode = 1;
  }
  return { page, locale, items: items.length, counts, innerTextLength: collected.innerTextLength, violations: violations.length };
}

/** 本次启动进程树中仍存活的 PID（主进程 + 直接子进程），null = PowerShell 查询不可用。 */
function listSurvivingTreePids(rootPid) {
  const script = `@(Get-CimInstance Win32_Process -Filter "ProcessId = ${rootPid} OR ParentProcessId = ${rootPid}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId) -join ','`;
  const out = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  if (out.error || out.status !== 0) return null;
  const text = (out.stdout || "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
}

async function cleanup() {
  log("");
  log("--- CLEANUP ---");
  if (wsRef) {
    try {
      wsRef.close();
    } catch {
      /* ignore */
    }
  }
  if (child && child.pid) {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  await sleep(1500);

  const rootPid = child && child.pid ? child.pid : null;
  if (rootPid !== null) {
    for (let i = 0; i < 10; i++) {
      const treePids = listSurvivingTreePids(rootPid);
      if (treePids !== null && treePids.length === 0) {
        log("CLEANUP: verification process tree gone");
        break;
      }
      if (i === 9) {
        if (treePids === null) log("WARN: PID-scoped cleanup check unavailable (PowerShell)");
        else {
          log("CLEANUP: verification process tree still alive after taskkill:");
          treePids.forEach((pid) => log(`  pid ${pid}`));
          process.exitCode = 1;
        }
      }
      await sleep(500);
    }
  }

  if (userDataDir) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      log(`CLEANUP: removed temp user-data dir ${userDataDir}`);
    } catch (error) {
      log(`WARN: failed to remove temp user-data dir: ${(error && error.message) || error}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.exitCode) return;

  fs.mkdirSync(evidenceDir, { recursive: true });
  const pages = options.page === "all" ? PAGE_ORDER : [options.page];
  log("=== Todo 12 CDP i18n locale/CJK verification ===");
  log(`repo: ${repoRoot}`);
  log(`node: ${process.version}`);
  log(`locale: ${options.locale}; pages: ${pages.join(", ")}`);

  if (!ensureBuild()) return;
  if (!(await waitForStableArtifacts())) return;

  const electronPath = require("electron");
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imagotune-i18n-"));
  log(`electron: ${electronPath}`);
  log(`userDataDir: ${userDataDir}`);

  child = spawn(electronPath, [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  const summaries = [];
  let cdp = null;
  try {
    cdp = await connectCdp();
    const ready = await waitForRenderer(cdp);
    if (!ready) {
      fail("RENDERER ready", "not ready within 15s");
      return;
    }
    await dismissTutorial(cdp);

    if (!(await ensureLocale(cdp, options.locale))) return;

    for (const page of pages) {
      const summary = await runPage(cdp, page, options.locale);
      if (summary) summaries.push(summary);
    }

    const totalViolations = summaries.reduce((sum, entry) => sum + entry.violations, 0);
    fs.writeFileSync(
      path.join(evidenceDir, `task-12-i18n-summary-${options.locale}-${options.page}.json`),
      JSON.stringify({ locale: options.locale, page: options.page, pages: summaries, totalViolations }, null, 2),
    );

    log("");
    log("--- RESULT SUMMARY ---");
    for (const entry of summaries) {
      log(`page=${entry.page} items=${entry.items} violations=${entry.violations} innerTextLen=${entry.innerTextLength}`);
    }
    if (options.locale === "zh") {
      log(`zh baseline complete: ${summaries.length} page(s) collected, no CJK assertion (this is the baseline run).`);
    } else {
      log(`en scan complete: totalCjkViolations=${totalViolations}`);
    }
  } finally {
    if (cdp) cdp.close();
    await cleanup();
  }
}

main()
  .then(() => {
    log("");
    log(`RESULT: ${process.exitCode ? "FAILURES PRESENT (exit 1)" : "ALL PASS (exit 0)"}`);
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    log("");
    log(`ERROR: ${(error && error.stack) || error}`);
    process.exitCode = 1;
    process.exit(1);
  });
