/*
 * T8 — 无边框窗口 chrome 的 CDP 验证脚本（零依赖）。
 *
 * 运行方式：
 *   node tools/verify-window-chrome.cjs
 *
 * 前置条件：
 *   - 已执行 `npm.cmd run build`（生产模式加载 dist-renderer）
 *   - 系统中没有其他 Electron 实例（避免占用 9222 调试端口）
 *
 * 实现约定：
 *   - 仅使用 Node >= 22 内置模块：child_process / fs / path / fetch / WebSocket。
 *   - 不依赖 puppeteer / playwright / ws 等任何第三方自动化库。
 *   - 通过 `--remote-debugging-port` 连接真实渲染进程；所有页面交互与状态读取
 *     均走 `window.imageStudio`（contextBridge），绝不直接触碰 ipcRenderer。
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

const WINDOW_CONTROL_METHODS = [
  "minimize",
  "toggleMaximize",
  "close",
  "isMaximized",
  "getZoom",
  "setZoom",
  "onMaximizedChange",
];

let child = null;
let wsRef = null;
const report = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  const text = String(line);
  report.push(text);
  console.log(text);
}

function check(label, ok, raw) {
  log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  log(`RAW: ${raw}`);
  if (!ok) process.exitCode = 1;
  return ok;
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

async function waitForRenderer(cdp) {
  for (let i = 0; i < 40; i++) {
    try {
      const raw = await cdp.evaluate(
        `JSON.stringify({bridge: !!(window.imageStudio && window.imageStudio.windowControls), controls: !!document.querySelector('.window-controls'), buttons: document.querySelectorAll('.window-controls button').length})`
      );
      const state = JSON.parse(raw);
      if (state.bridge && state.controls && state.buttons === 3) {
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

async function runAssertions(cdp, initialShotBytes) {
  const { evaluate, screenshot } = cdp;

  // -------------------------------------------------------------------------
  // FRAMELESS：最大化态断言 outerHeight - innerHeight < 2
  // restored 态含 Windows DWM 隐形缩放边框（保留 thickFrame 的边缘 resize 能力），
  // 因此按已裁定口径在最大化态执行规格原表达式；restored 原始值同时留档。
  // -------------------------------------------------------------------------
  log("");
  log("--- FRAMELESS ---");
  const restoredRaw = await evaluate(
    `JSON.stringify({state:'restored', outerH:window.outerHeight, innerH:window.innerHeight, delta:window.outerHeight-window.innerHeight, outerW:window.outerWidth, innerW:window.innerWidth, wDelta:window.outerWidth-window.innerWidth, dpr:window.devicePixelRatio})`
  );
  log(`INFO restored-state (DWM invisible border artifact): ${restoredRaw}`);
  await evaluate("window.imageStudio.windowControls.toggleMaximize()");
  await sleep(900);
  const maximizedRaw = await evaluate(
    `JSON.stringify({state:'maximized', outerH:window.outerHeight, innerH:window.innerHeight, delta:window.outerHeight-window.innerHeight, outerW:window.outerWidth, innerW:window.innerWidth})`
  );
  const maximizedFrame = JSON.parse(maximizedRaw);
  check(
    "FRAMELESS delta < 2 (maximized state; spec expression)",
    maximizedFrame.delta < 2,
    maximizedRaw
  );
  await evaluate("window.imageStudio.windowControls.toggleMaximize()");
  await sleep(800);

  // -------------------------------------------------------------------------
  // BRIDGE：window.imageStudio.windowControls 的 7 个方法全部存在且为函数
  // -------------------------------------------------------------------------
  log("");
  log("--- BRIDGE ---");
  const bridgeRaw = await evaluate(
    `JSON.stringify({typeofWc: typeof window.imageStudio.windowControls, keys: Object.keys(window.imageStudio.windowControls), types: ${JSON.stringify(
      WINDOW_CONTROL_METHODS
    )}.map(function (k) { return [k, typeof window.imageStudio.windowControls[k]]; })})`
  );
  const bridge = JSON.parse(bridgeRaw);
  check(
    "BRIDGE windowControls = object, 7 methods all function",
    bridge.typeofWc === "object" &&
      bridge.keys.length === WINDOW_CONTROL_METHODS.length &&
      bridge.types.length === WINDOW_CONTROL_METHODS.length &&
      bridge.types.every((entry) => entry[1] === "function"),
    bridgeRaw
  );

  // -------------------------------------------------------------------------
  // DRAG：header 拖拽，.queue-chip / .window-controls 不拖拽
  // -------------------------------------------------------------------------
  log("");
  log("--- DRAG ---");
  const dragRaw = await evaluate(
    `(function(){function g(sel){var el=document.querySelector(sel);if(!el)return null;var cs=getComputedStyle(el);return cs['-webkit-app-region']||cs.getPropertyValue('-webkit-app-region')||cs.getPropertyValue('app-region');}return JSON.stringify({header:g('header'),queueChip:g('.queue-chip'),windowControls:g('.window-controls')});})()`
  );
  const drag = JSON.parse(dragRaw);
  check(
    "DRAG header=drag, .queue-chip=.window-controls=no-drag",
    drag.header === "drag" && drag.queueChip === "no-drag" && drag.windowControls === "no-drag",
    dragRaw
  );

  // -------------------------------------------------------------------------
  // CONTROLS：3 个按钮、data-action 集合、type/aria-label/svg
  // -------------------------------------------------------------------------
  log("");
  log("--- CONTROLS ---");
  const controlsRaw = await evaluate(
    `(function(){return JSON.stringify(Array.from(document.querySelectorAll('.window-controls button')).map(function(b){return {action:b.dataset.action,type:b.getAttribute('type'),label:b.getAttribute('aria-label'),hasSvg:!!b.querySelector('svg'),svgInner:b.querySelector('svg')?b.querySelector('svg').innerHTML:null};}));})()`
  );
  const buttons = JSON.parse(controlsRaw);
  const actionSet = new Set(buttons.map((b) => b.action));
  const controlsOk =
    buttons.length === 3 &&
    actionSet.size === 3 &&
    ["minimize", "maximize", "close"].every((a) => actionSet.has(a)) &&
    buttons.every((b) => b.type === "button" && typeof b.label === "string" && b.label.length > 0 && b.hasSvg === true);
  check(
    "CONTROLS 3 buttons, actions {minimize,maximize,close}, type=button, aria-label, svg",
    controlsOk,
    controlsRaw
  );

  // -------------------------------------------------------------------------
  // NO-OVERLAP：.window-controls 与 .header-stack / .queue-chip 交集为 0 且右侧留白
  // -------------------------------------------------------------------------
  log("");
  log("--- NO-OVERLAP ---");
  const overlapRaw = await evaluate(
    `(function(){
      function rect(el){var b=el.getBoundingClientRect();return {x:+b.x.toFixed(2),y:+b.y.toFixed(2),width:+b.width.toFixed(2),height:+b.height.toFixed(2),right:+b.right.toFixed(2),bottom:+b.bottom.toFixed(2)};}
      function area(a,b){var w=Math.min(a.right,b.right)-Math.max(a.x,b.x);var h=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);return (w>0&&h>0)?+(w*h).toFixed(2):0;}
      var controls=document.querySelector('.window-controls');
      var stack=document.querySelector('.header-stack');
      var chip=document.querySelector('.queue-chip');
      var cr=rect(controls);
      return JSON.stringify({controls:cr,headerStack:rect(stack),queueChip:rect(chip),interStack:area(cr,rect(stack)),interChip:area(cr,rect(chip)),clientWidth:document.documentElement.clientWidth,gutterOk:cr.x+cr.width<=document.documentElement.clientWidth-12});
    })()`
  );
  const overlap = JSON.parse(overlapRaw);
  check(
    "NO-OVERLAP intersections = 0 and controls right <= clientWidth - 12",
    overlap.interStack === 0 && overlap.interChip === 0 && overlap.gutterOk === true,
    overlapRaw
  );

  // -------------------------------------------------------------------------
  // MAX-ROUNDTRIP：点击 maximize -> isMaximized true + aria-label 还原窗口，再点回
  // -------------------------------------------------------------------------
  log("");
  log("--- MAX-ROUNDTRIP ---");
  const labelExpr =
    "document.querySelector('.window-controls button[data-action=\"maximize\"]').getAttribute('aria-label')";
  const initialLabel = await evaluate(labelExpr);
  check(
    "MAX-ROUNDTRIP initial aria-label === 最大化窗口",
    initialLabel === "最大化窗口",
    JSON.stringify(initialLabel)
  );

  await evaluate("document.querySelector('.window-controls button[data-action=\"maximize\"]').click()");
  await sleep(450);
  const maximizeState = JSON.parse(
    await evaluate("window.imageStudio.windowControls.isMaximized().then(function(r){return JSON.stringify(r);})")
  );
  const maximizedLabel = await evaluate(labelExpr);
  check(
    "MAX-ROUNDTRIP after click: isMaximized()=true and aria-label === 还原窗口",
    maximizeState.ok === true && maximizeState.maximized === true && maximizedLabel === "还原窗口",
    JSON.stringify({ state: maximizeState, label: maximizedLabel })
  );
  const maximizedShotBytes = await screenshot(path.join(evidenceDir, "task-8-maximized.png"));
  log(`SCREENSHOT task-8-maximized.png bytes=${maximizedShotBytes}`);

  await evaluate("document.querySelector('.window-controls button[data-action=\"maximize\"]').click()");
  await sleep(450);
  const restoreState = JSON.parse(
    await evaluate("window.imageStudio.windowControls.isMaximized().then(function(r){return JSON.stringify(r);})")
  );
  const restoredLabel = await evaluate(labelExpr);
  check(
    "MAX-ROUNDTRIP after second click: isMaximized()=false and aria-label === 最大化窗口",
    restoreState.ok === true && restoreState.maximized === false && restoredLabel === "最大化窗口",
    JSON.stringify({ state: restoreState, label: restoredLabel })
  );

  // -------------------------------------------------------------------------
  // COLLAPSE-STABLE：滚动后进入折叠态，.header-spacer 仍在，控件 rect 不变
  // -------------------------------------------------------------------------
  log("");
  log("--- COLLAPSE-STABLE ---");
  await evaluate("window.scrollTo(0,0)");
  await sleep(350);
  const beforeRect = await evaluate(
    `(function(){var b=document.querySelector('.window-controls').getBoundingClientRect();return JSON.stringify({x:+b.x.toFixed(2),y:+b.y.toFixed(2),width:+b.width.toFixed(2),height:+b.height.toFixed(2)});})()`
  );
  await evaluate("window.scrollTo(0,2000)");
  await sleep(600);
  const collapsedRaw = await evaluate(
    `(function(){var b=document.querySelector('.window-controls').getBoundingClientRect();return JSON.stringify({condensed:document.querySelector('.app').dataset.condensed,spacer:!!document.querySelector('.header-spacer'),scrollY:window.scrollY,x:+b.x.toFixed(2),y:+b.y.toFixed(2),width:+b.width.toFixed(2),height:+b.height.toFixed(2)});})()`
  );
  const collapsed = JSON.parse(collapsedRaw);
  const before = JSON.parse(beforeRect);
  const stable =
    collapsed.condensed === "true" &&
    collapsed.spacer === true &&
    collapsed.x === before.x &&
    collapsed.y === before.y &&
    collapsed.width === before.width &&
    collapsed.height === before.height;
  check(
    "COLLAPSE-STABLE data-condensed=true, header-spacer exists, controls rect unchanged",
    stable,
    JSON.stringify({ before, after: collapsed })
  );
  const collapsedShotBytes = await screenshot(path.join(evidenceDir, "task-8-collapsed.png"));
  log(`SCREENSHOT task-8-collapsed.png bytes=${collapsedShotBytes}`);

  await evaluate("window.scrollTo(0,0)");
  await sleep(300);

  // -------------------------------------------------------------------------
  // 截图体积断言（初始态截图已在断言开始前捕获）
  // -------------------------------------------------------------------------
  log("");
  log("--- SCREENSHOTS ---");
  log(`SCREENSHOT task-8-initial.png bytes=${initialShotBytes}`);
  const shots = {
    "task-8-initial.png": initialShotBytes,
    "task-8-maximized.png": maximizedShotBytes,
    "task-8-collapsed.png": collapsedShotBytes,
  };
  for (const [name, bytes] of Object.entries(shots)) {
    if (!(bytes > 10 * 1024)) {
      log(`[FAIL] screenshot ${name} is not > 10KB (bytes=${bytes})`);
      process.exitCode = 1;
    }
  }
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
  for (let i = 0; i < 10; i++) {
    const out = spawnSync("tasklist", [], { encoding: "utf8" });
    const lines = (out.stdout || "").split(/\r?\n/).filter((line) => /electron\.exe/i.test(line));
    if (lines.length === 0) {
      log("CLEANUP: no electron.exe remaining");
      return;
    }
    if (i === 9) {
      log("CLEANUP: electron.exe still present after taskkill:");
      lines.forEach((line) => log("  " + line.trim()));
      process.exitCode = 1;
      return;
    }
    await sleep(500);
  }
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  log(`=== T8 CDP window-chrome verification ===`);
  log(`repo: ${repoRoot}`);
  log(`node: ${process.version}`);

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
      check("RENDERER bridge + 3 window-controls buttons ready", false, "not ready within 10s");
      return;
    }
    // 初始态截图：在任何状态变更（最大化 / 滚动）之前捕获
    const initialBytes = await cdp.screenshot(path.join(evidenceDir, "task-8-initial.png"));
    await runAssertions(cdp, initialBytes);
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
