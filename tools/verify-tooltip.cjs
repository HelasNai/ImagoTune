/*
 * v3.11 — 悬浮提示（Tooltip / InfoHint）子系统的 CDP 验收脚本（零依赖）。
 *
 * 运行方式：
 *   node tools/verify-tooltip.cjs
 *
 * 前置条件：
 *   - 已执行 `npm.cmd run build`（生产模式加载 dist-renderer）
 *   - 系统中没有其他 Electron 实例占用 9222 调试端口（脚本会先检测并报错退出）
 *
 * 实现约定（与 tools/verify-window-chrome.cjs 同构）：
 *   - 仅使用 Node >= 22 内置模块：child_process / fs / path / fetch / WebSocket。
 *   - 悬停一律走真实 CDP 输入（Input.dispatchMouseEvent 的 mouseMoved）——
 *     React 的 onMouseEnter 由原生 mouseover/mouseout 合成，
 *     合成 `new MouseEvent("mouseenter")` 不会触发它。
 *   - 断言结果只以退出码为准：任一 FAIL 时 process.exitCode = 1。
 *
 * 退出码：全部 PASS = 0；任一 FAIL 或清理失败 = 1。
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const evidenceDir = path.join(repoRoot, ".sisyphus", "evidence");
const PORT = 9222;

/** 提示词卡片内 ⓘ（InfoHint）触发器。 */
const HINT_SELECTOR = ".prompt-panel .tooltip-hint";
/** 期望气泡文案（ComposerPanel 提示词标题旁的 InfoHint content）。 */
const EXPECTED_HINT_TEXT = "正向描述画面；可保存为模板复用。";

let child = null;
let wsRef = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  console.log(String(line));
}

function check(label, ok, raw) {
  log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  log(`RAW: ${raw}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

/** 启动前检测 9222 是否被占用——占用时绝不复用，直接报告并失败退出。 */
async function portOccupied() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForPageTarget() {
  for (let i = 0; i < 30; i++) {
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
  if (!target) throw new Error(`no type=page CDP target on port ${PORT} within 15s`);

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
    const msg = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const detail = msg.result;
    if (!detail || !detail.result) {
      throw new Error(`Runtime.evaluate returned no result: ${JSON.stringify(msg)}`);
    }
    if (detail.exceptionDetails) {
      throw new Error(`Runtime.evaluate exception: ${JSON.stringify(detail.exceptionDetails)}`);
    }
    return detail.result.value;
  }

  async function screenshot(filePath) {
    const msg = await send("Page.captureScreenshot", { format: "png" });
    if (!msg.result || typeof msg.result.data !== "string") {
      throw new Error("Page.captureScreenshot returned no data");
    }
    const buffer = Buffer.from(msg.result.data, "base64");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return buffer.length;
  }

  await send("Page.enable", {});
  return {
    send,
    evaluate,
    screenshot,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** 等待渲染进程桥接与悬浮提示锚点（创作页 .prompt-panel 的 ⓘ）全部就绪。 */
async function waitForRenderer(cdp) {
  for (let i = 0; i < 60; i++) {
    try {
      const raw = await cdp.evaluate(
        `JSON.stringify({bridge: !!(window.imageStudio && window.imageStudio.windowControls), app: !!document.querySelector('.app'), hint: !!document.querySelector('${HINT_SELECTOR}'), queueNav: !!document.querySelector('.sidebar-queue-nav'), chip: !!document.querySelector('.queue-chip')})`
      );
      const state = JSON.parse(raw);
      if (state.bridge && state.app && state.hint && state.queueNav && state.chip) {
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

/** 元素视口矩形（含中心点）；元素不存在时返回 null。 */
async function rectOf(cdp, selector) {
  const raw = await cdp.evaluate(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'null';var r=el.getBoundingClientRect();return JSON.stringify({cx:r.left+r.width/2,cy:r.top+r.height/2,top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height});})()`
  );
  return JSON.parse(raw);
}

/** 气泡快照：不存在时 {present:false}。 */
async function bubbleSnap(cdp) {
  const raw = await cdp.evaluate(
    `(function(){var b=document.querySelector('.tooltip-bubble');if(!b)return JSON.stringify({present:false});var r=b.getBoundingClientRect();var cs=getComputedStyle(b);return JSON.stringify({present:true,id:b.id,text:b.textContent,role:b.getAttribute('role'),z:cs.zIndex,visibility:cs.visibility,top:+r.top.toFixed(2),left:+r.left.toFixed(2),right:+r.right.toFixed(2),bottom:+r.bottom.toFixed(2),width:+r.width.toFixed(2),height:+r.height.toFixed(2),innerW:window.innerWidth,innerH:window.innerHeight});})()`
  );
  return JSON.parse(raw);
}

/** 真实鼠标移动（CDP 原生输入，触发 React 合成的 mouseenter/mouseleave）。 */
async function mouseMove(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(x),
    y: Math.round(y),
    button: "none",
    buttons: 0,
  });
}

/** 真实 Escape 键（keyDown/keyUp）。 */
async function pressEscape(cdp) {
  const base = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

/** 把鼠标移到「无提示锚点」的中性位置：提示词输入框中心。 */
async function moveToNeutral(cdp) {
  const neutral = await rectOf(cdp, ".prompt-panel textarea");
  if (!neutral) throw new Error("neutral spot (.prompt-panel textarea) not found");
  await mouseMove(cdp, neutral.cx, neutral.cy);
}

/** 悬停到指定元素中心并等待气泡出现（> 300ms 延迟）。 */
async function hoverAndWaitOpen(cdp, selector, settleMs = 1000) {
  const rect = await rectOf(cdp, selector);
  if (!rect) throw new Error(`hover target not found: ${selector}`);
  await mouseMove(cdp, rect.cx, rect.cy);
  await sleep(settleMs);
  return rect;
}

async function runAssertions(cdp) {
  const { evaluate, screenshot } = cdp;

  // -------------------------------------------------------------------------
  // HOVER：真实鼠标悬停 ⓘ——150ms 时无气泡（延迟 300ms 未到期），450ms 后有气泡
  // -------------------------------------------------------------------------
  log("");
  log("--- HOVER-DELAY / HOVER-SHOW ---");
  const hintRect = await rectOf(cdp, HINT_SELECTOR);
  if (!hintRect) {
    check("HOVER trigger exists", false, `${HINT_SELECTOR} not found`);
    return;
  }
  await mouseMove(cdp, hintRect.cx, hintRect.cy);
  await sleep(150);
  const early = await bubbleSnap(cdp);
  check(
    "HOVER-DELAY no .tooltip-bubble at ~150ms (delay=300ms)",
    early.present === false,
    JSON.stringify(early)
  );
  await sleep(700);
  const opened = await bubbleSnap(cdp);
  check(
    "HOVER-SHOW .tooltip-bubble present after ~850ms of hover",
    opened.present === true,
    JSON.stringify(opened)
  );
  if (!opened.present) {
    log("ABORT: bubble never opened on hover; skipping dependent checks");
    return;
  }
  const shotBytes = await screenshot(path.join(evidenceDir, "tooltip-hover-open.png"));
  log(`SCREENSHOT tooltip-hover-open.png bytes=${shotBytes}`);
  check("SCREENSHOT tooltip-hover-open.png > 10KB", shotBytes > 10 * 1024, `bytes=${shotBytes}`);

  // -------------------------------------------------------------------------
  // CONTENT/ARIA：文案精确匹配 + role=tooltip + 触发器 aria-describedby == 气泡 id
  // -------------------------------------------------------------------------
  log("");
  log("--- CONTENT/ARIA ---");
  const ariaRaw = await evaluate(
    `(function(){var t=document.querySelector(${JSON.stringify(HINT_SELECTOR)});var b=document.querySelector('.tooltip-bubble');return JSON.stringify({triggerAria:t?t.getAttribute('aria-describedby'):null,bubbleId:b?b.id:null,text:b?b.textContent:null,role:b?b.getAttribute('role'):null});})()`
  );
  const aria = JSON.parse(ariaRaw);
  check(
    "CONTENT bubble text equals expected hint content",
    aria.text === EXPECTED_HINT_TEXT,
    ariaRaw
  );
  check(
    "ARIA role=tooltip and trigger aria-describedby === bubble id",
    aria.role === "tooltip" && aria.triggerAria !== null && aria.triggerAria === aria.bubbleId,
    ariaRaw
  );

  // -------------------------------------------------------------------------
  // POSITION：气泡在触发器上方，间距 ~8px（bottom <= trigger.top + 1，容差 1.5px）
  // -------------------------------------------------------------------------
  log("");
  log("--- POSITION ---");
  const gap = +(hintRect.top - opened.bottom).toFixed(2);
  check(
    "POSITION bubble above trigger with reasonable gap (0-14px)",
    opened.bottom <= hintRect.top + 1 && gap >= 0 && gap <= 14,
    JSON.stringify({ triggerTop: +hintRect.top.toFixed(2), bubbleBottom: opened.bottom, gap })
  );

  // -------------------------------------------------------------------------
  // Z-INDEX：计算样式 z-index 必须是 "80"（高于对话框 60 / 下拉 55，低于 toast 90）
  // -------------------------------------------------------------------------
  log("");
  log("--- Z-INDEX ---");
  check("Z-INDEX computed z-index of .tooltip-bubble is \"80\"", opened.z === "80", JSON.stringify({ z: opened.z }));

  // -------------------------------------------------------------------------
  // MOUSELEAVE：移开鼠标后气泡消失
  // -------------------------------------------------------------------------
  log("");
  log("--- MOUSELEAVE ---");
  await moveToNeutral(cdp);
  await sleep(250);
  const afterLeave = await bubbleSnap(cdp);
  check("MOUSELEAVE bubble disappears after moving mouse away", afterLeave.present === false, JSON.stringify(afterLeave));

  // -------------------------------------------------------------------------
  // FOCUS：键盘/程序聚焦立即显示（无 300ms 延迟，120ms 内必须已出现）
  // -------------------------------------------------------------------------
  log("");
  log("--- FOCUS ---");
  await evaluate(`(function(){var t=document.querySelector(${JSON.stringify(HINT_SELECTOR)});if(t)t.focus();return !!t;})()`);
  await sleep(120);
  const focused = await bubbleSnap(cdp);
  check("FOCUS bubble appears immediately on focus (<=120ms, no 300ms delay)", focused.present === true, JSON.stringify(focused));

  // -------------------------------------------------------------------------
  // ESCAPE：气泡打开时真实 Escape 键立即隐藏
  // -------------------------------------------------------------------------
  log("");
  log("--- ESCAPE ---");
  await pressEscape(cdp);
  await sleep(200);
  const afterEscape = await bubbleSnap(cdp);
  check("ESCAPE real Escape key hides the bubble", afterEscape.present === false, JSON.stringify(afterEscape));
  await evaluate(`(function(){var t=document.querySelector(${JSON.stringify(HINT_SELECTOR)});if(t)t.blur();return true;})()`);

  // -------------------------------------------------------------------------
  // MIGRATED：侧栏「任务队列」按钮（原生 title= 已迁移到 Tooltip）——
  // title 属性必须为空/缺失，且悬停出现内容非空的 .tooltip-bubble。
  // -------------------------------------------------------------------------
  log("");
  log("--- MIGRATED (sidebar queue nav) ---");
  const titleRaw = await evaluate(
    `(function(){var el=document.querySelector('.sidebar-queue-nav');if(!el)return 'null';return JSON.stringify({hasTitle:el.hasAttribute('title'),title:el.getAttribute('title')});})()`
  );
  const titleState = JSON.parse(titleRaw);
  check(
    "MIGRATED .sidebar-queue-nav carries no native title attribute",
    titleState !== null && titleState.hasTitle === false && !titleState.title,
    titleRaw
  );
  await moveToNeutral(cdp);
  await sleep(100);
  await hoverAndWaitOpen(cdp, ".sidebar-queue-nav");
  const navBubble = await bubbleSnap(cdp);
  check(
    "MIGRATED hovering sidebar queue nav shows .tooltip-bubble with non-empty content",
    navBubble.present === true && typeof navBubble.text === "string" && navBubble.text.trim().length > 0,
    JSON.stringify(navBubble)
  );
  await moveToNeutral(cdp);
  await sleep(250);

  // -------------------------------------------------------------------------
  // SCROLL：气泡打开时滚动 .app（捕获阶段监听）立即隐藏
  // -------------------------------------------------------------------------
  log("");
  log("--- SCROLL ---");
  await evaluate("document.querySelector('.app').scrollTo(0,0)");
  await sleep(200);
  await hoverAndWaitOpen(cdp, HINT_SELECTOR);
  const scrollOpened = await bubbleSnap(cdp);
  check("SCROLL pre-condition: bubble open before scrolling", scrollOpened.present === true, JSON.stringify(scrollOpened));
  await evaluate("document.querySelector('.app').scrollTop = 200");
  await sleep(250);
  const afterScroll = await bubbleSnap(cdp);
  check("SCROLL setting .app scrollTop hides the bubble", afterScroll.present === false, JSON.stringify(afterScroll));
  await evaluate("document.querySelector('.app').scrollTo(0,0)");
  await sleep(200);

  // -------------------------------------------------------------------------
  // VIEWPORT：header 右侧 .queue-chip 触发器贴近视口顶部（88px header 内），
  // 上方放不下气泡 → 翻转到下方；无论翻转与否，气泡必须完整落在视口内
  // （top >= 0 且 bottom <= innerHeight）。
  // -------------------------------------------------------------------------
  log("");
  log("--- VIEWPORT (header chip flip/clamp) ---");
  const chipRect = await rectOf(cdp, ".queue-chip");
  if (!chipRect) {
    check("VIEWPORT .queue-chip exists", false, ".queue-chip not found");
    return;
  }
  await moveToNeutral(cdp);
  await sleep(100);
  await hoverAndWaitOpen(cdp, ".queue-chip");
  const chipBubble = await bubbleSnap(cdp);
  const flipped = chipBubble.present && chipBubble.top >= chipRect.bottom - 1;
  const insideViewport =
    chipBubble.present === true &&
    chipBubble.top >= -0.5 &&
    chipBubble.bottom <= chipBubble.innerH + 0.5 &&
    chipBubble.left >= -0.5 &&
    chipBubble.right <= chipBubble.innerW + 0.5;
  check(
    "VIEWPORT bubble fully inside viewport (flip-to-below expected for header chip)",
    insideViewport,
    JSON.stringify({ bubble: chipBubble, triggerTop: +chipRect.top.toFixed(2), triggerBottom: +chipRect.bottom.toFixed(2), flipped })
  );
  check(
    "VIEWPORT header chip near viewport top flips bubble below trigger",
    chipBubble.present === true && flipped,
    JSON.stringify({ bubbleTop: chipBubble.top, triggerBottom: +chipRect.bottom.toFixed(2), flipped })
  );
  await moveToNeutral(cdp);
  await sleep(250);
}

/**
 * 本次启动进程树中仍存活的 PID（主进程 + 直接子进程）。
 * 用 PowerShell 按 PPID 圈定范围；返回 null 表示查询不可用（调用方降级为全局扫描）。
 */
function listSurvivingTreePids(rootPid) {
  const script =
    `@(Get-CimInstance Win32_Process -Filter "ProcessId = ${rootPid} OR ParentProcessId = ${rootPid}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId) -join ','`;
  const out = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  if (out.error || out.status !== 0) return null;
  const text = (out.stdout || "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
}

function listGlobalElectronLines() {
  const out = spawnSync("tasklist", [], { encoding: "utf8" });
  return (out.stdout || "").split(/\r?\n/).filter((line) => /electron\.exe/i.test(line));
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
  await sleep(2000);

  // 残留核查只圈定本次启动的 PID 树（主进程 + 直接子进程），不扫描全系统，
  // 避免把并存的其他 Electron 实例（如 npm run dev）误判为残留。
  const rootPid = child && child.pid ? child.pid : null;
  if (rootPid === null) {
    log("CLEANUP: no spawned process to verify");
    return;
  }
  let treeScoped = listSurvivingTreePids(rootPid) !== null;
  if (!treeScoped) {
    log("WARN: PID-scoped cleanup check unavailable (PowerShell); falling back to global electron.exe scan");
  }

  for (let i = 0; i < 10; i++) {
    let leftovers = null;
    if (treeScoped) {
      const treePids = listSurvivingTreePids(rootPid);
      if (treePids === null) {
        log("WARN: PID-scoped cleanup check failed mid-run; switching to global scan");
        treeScoped = false;
      } else {
        leftovers = treePids.map((pid) => `pid ${pid}`);
      }
    }
    if (leftovers === null) {
      leftovers = listGlobalElectronLines().map((line) => line.trim());
    }
    if (leftovers.length === 0) {
      log(treeScoped ? "CLEANUP: verification process tree gone" : "CLEANUP: no electron.exe remaining");
      return;
    }
    if (i === 9) {
      log(
        treeScoped
          ? "CLEANUP: verification process tree still alive after taskkill:"
          : "CLEANUP: electron.exe still present after taskkill:"
      );
      leftovers.forEach((line) => log("  " + line));
      process.exitCode = 1;
      return;
    }
    await sleep(500);
  }
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  log(`=== v3.11 CDP tooltip verification ===`);
  log(`repo: ${repoRoot}`);
  log(`node: ${process.version}`);

  if (!fs.existsSync(path.join(repoRoot, "dist-renderer", "index.html"))) {
    check("PRECONDITION dist-renderer built", false, "dist-renderer/index.html missing; run `npm.cmd run build` first");
    return;
  }
  if (await portOccupied()) {
    check("PRECONDITION port 9222 free", false, `port ${PORT} already occupied by another debuggee; refusing to reuse it`);
    return;
  }
  log(`PRECONDITION port ${PORT} free, dist-renderer present`);

  const electronPath = require("electron");
  log(`electron: ${electronPath}`);
  child = spawn(electronPath, [".", `--remote-debugging-port=${PORT}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  let cdp = null;
  try {
    cdp = await connectCdp();
    const ready = await waitForRenderer(cdp);
    if (!ready) {
      check("RENDERER tooltip anchors ready", false, "app/.tooltip-hint/.sidebar-queue-nav/.queue-chip not ready within 15s");
      return;
    }
    // 跳过首次启动的教程询问弹窗：验证实例 localStorage 可能无教程记录，
    // 弹窗（fixed 遮罩）会盖住页面并吞掉悬停目标。仅作用于验证实例。
    for (let i = 0; i < 12; i++) {
      const welcomeState = await cdp.evaluate(
        `(function(){var c=document.querySelector('.tutorial-welcome-card');if(!c)return 'none';var b=c.querySelector('.tutorial-close');if(b){b.click();return 'clicked';}return 'no-close';})()`
      );
      if (welcomeState !== "none") {
        log(`INFO tutorial welcome overlay: ${welcomeState}`);
        break;
      }
      await sleep(250);
    }
    await sleep(400);
    // 验证窗口被完全遮挡时 Chromium 会判定 visibilityState=hidden 并节流定时器，
    // 导致 Tooltip 的 300ms 延迟被显著拉长、hover 断言出现假阴性。先激活窗口再断言。
    await cdp.send("Page.bringToFront", {});
    await sleep(300);
    log(`INFO window visibilityState: ${await cdp.evaluate("document.visibilityState")}`);
    // 让鼠标先落在中性位置，保证后续 hover 一定经历 mouseenter 跳变
    await moveToNeutral(cdp);
    await runAssertions(cdp);
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
