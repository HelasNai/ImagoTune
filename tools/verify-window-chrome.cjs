/*
 * T8 — 系统原生 WCO 窗口 chrome 的 CDP 验证脚本（零依赖）。
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
        `JSON.stringify({bridge: !!(window.imageStudio && window.imageStudio.windowControls)})`
      );
      const state = JSON.parse(raw);
      if (state.bridge) {
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

/**
 * FRAMELESS 段还原 toggleMaximize 后等待窗口真正回到稳定 restored 态：
 * 轮询 isMaximized() === false 且连续两次窗口尺寸读数完全一致，
 * 取代固定 sleep(800)，消除慢环境下还原动画未结束就进入后续断言导致的偶发假失败。
 */
async function waitForRestoredStable(cdp) {
  let previous = null;
  for (let i = 0; i < 20; i++) {
    const raw = await cdp.evaluate(
      `window.imageStudio.windowControls.isMaximized().then(function(r){return JSON.stringify({maximized:r.maximized,outerH:window.outerHeight,innerH:window.innerHeight,outerW:window.outerWidth,innerW:window.innerWidth});})`
    );
    const state = JSON.parse(raw);
    if (
      previous &&
      state.maximized === false &&
      previous.maximized === false &&
      state.outerH === previous.outerH &&
      state.innerH === previous.innerH &&
      state.outerW === previous.outerW &&
      state.innerW === previous.innerW
    ) {
      log(`INFO restored state stable after ~${i * 150}ms: ${raw}`);
      return true;
    }
    previous = state;
    await sleep(150);
  }
  log("WARN restored state not stable within ~3s; continuing anyway");
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
  await waitForRestoredStable(cdp);

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
  // DRAG：header 拖拽（.queue-chip no-drag）；header::after 作为原生按钮条挖除区 no-drag
  // -------------------------------------------------------------------------
  log("");
  log("--- DRAG ---");
  const dragRaw = await evaluate(
    `(function(){function g(sel){var el=document.querySelector(sel);if(!el)return null;var cs=getComputedStyle(el);return cs['-webkit-app-region']||cs.getPropertyValue('-webkit-app-region')||cs.getPropertyValue('app-region');}function region(cs){return cs['-webkit-app-region']||cs.getPropertyValue('-webkit-app-region')||cs.getPropertyValue('app-region');}function pseudoRect(p){var cs=getComputedStyle(document.querySelector('header'),p);var l=parseFloat(cs.left)||0;var t=parseFloat(cs.top)||0;var w=parseFloat(cs.width)||0;var h=parseFloat(cs.height)||0;return {left:+l.toFixed(2),top:+t.toFixed(2),right:+(l+w).toFixed(2),bottom:+(t+h).toFixed(2)};}var hd=document.querySelector('header');var hb=hd.getBoundingClientRect();return JSON.stringify({header:g('header'),queueChip:g('.queue-chip'),headerAfter:region(getComputedStyle(hd,'::after')),headerBefore:region(getComputedStyle(hd,'::before')),headerBox:{width:+hb.width.toFixed(2),height:+hb.height.toFixed(2)},beforeRect:pseudoRect('::before'),afterRect:pseudoRect('::after')});})()`
  );
  const drag = JSON.parse(dragRaw);
  check(
    "DRAG header=drag, .queue-chip=no-drag, header::after=no-drag (native button strip carve-out)",
    drag.header === "drag" && drag.queueChip === "no-drag" && drag.headerAfter === "no-drag",
    dragRaw
  );
  // v2.5 回归防线：Chromium 按伪元素的「布局矩形」收集窗口拖拽区，且不受 header
  // overflow:hidden 裁剪——伪元素矩形一旦越出 header 盒，header 下方的页面区域
  // （窗口右侧、至 y≈300px）会被误判为拖拽/标题栏区（拖动=拖窗口、双击=最大化）。
  // 故 before/after 的布局矩形必须完全落在 header 盒内。
  const headerBox = drag.headerBox;
  const insideHeader = (rect) =>
    rect.left >= -0.5 &&
    rect.top >= -0.5 &&
    rect.right <= headerBox.width + 0.5 &&
    rect.bottom <= headerBox.height + 0.5;
  check(
    "DRAG header::before / ::after layout rects stay inside header box (no drag-region spill)",
    insideHeader(drag.beforeRect) && insideHeader(drag.afterRect),
    JSON.stringify({ headerBox, beforeRect: drag.beforeRect, afterRect: drag.afterRect })
  );

  // -------------------------------------------------------------------------
  // WCO：窗口按钮改由系统原生 Window Controls Overlay 承载——
  // DOM 内不再有 .window-controls；navigator.windowControlsOverlay 可见。
  // 注意：Electron 44 未实现 navigator.windowControlsOverlay.getTitleBarAreaRect()
  // （实测 typeof === "undefined"），标题栏区域改用 CSS env(titlebar-area-*) 探测，
  // 与 styles.css v1.8 的挖除逻辑同源。
  // -------------------------------------------------------------------------
  log("");
  log("--- WCO ---");
  const wcoRaw = await evaluate(
    `(function(){
      function rect(r){return {x:+r.x.toFixed(2),y:+r.y.toFixed(2),width:+r.width.toFixed(2),height:+r.height.toFixed(2)};}
      var overlay=navigator.windowControlsOverlay;
      var probe=document.createElement('div');
      probe.style.paddingRight='env(titlebar-area-width, 0px)';
      probe.style.paddingTop='env(titlebar-area-height, 0px)';
      probe.style.paddingLeft='env(titlebar-area-x, 0px)';
      document.body.appendChild(probe);
      var cs=getComputedStyle(probe);
      var areaWidth=parseFloat(cs.paddingRight)||0;
      var areaHeight=parseFloat(cs.paddingTop)||0;
      var areaX=parseFloat(cs.paddingLeft)||0;
      probe.remove();
      var stack=document.querySelector('.header-stack');
      var chip=document.querySelector('.queue-chip');
      return JSON.stringify({hasControls:!!document.querySelector('.window-controls'),overlayType:typeof overlay,visible:overlay?overlay.visible:null,titlebarAreaX:areaX,titlebarAreaWidth:areaWidth,titlebarAreaHeight:areaHeight,headerStack:stack?rect(stack.getBoundingClientRect()):null,queueChip:chip?rect(chip.getBoundingClientRect()):null,clientWidth:document.documentElement.clientWidth});
    })()`
  );
  const wco = JSON.parse(wcoRaw);
  check(
    "WCO no .window-controls in DOM; navigator.windowControlsOverlay visible; titlebar-area width/height > 0",
    wco.hasControls === false &&
      wco.overlayType === "object" &&
      wco.visible === true &&
      wco.titlebarAreaWidth > 0 &&
      wco.titlebarAreaHeight > 0,
    wcoRaw
  );
  // 几何 sanity：header-stack / .queue-chip 必须落在原生按钮条左侧。
  // 按钮条左缘 = titlebar-area-x + titlebar-area-width（x 通常为 0，按钮条贴窗口右缘；
  // 注意不是 clientWidth - titlebar-area-width——titlebar-area-width 是「内容区宽度」，
  // 旧公式会把按钮条左缘算成按钮条自身宽度，窗口越宽越早误报 FAIL）。
  const buttonStripLeft = wco.titlebarAreaX + wco.titlebarAreaWidth;
  const stackRight = wco.headerStack ? wco.headerStack.x + wco.headerStack.width : 0;
  const chipRight = wco.queueChip ? wco.queueChip.x + wco.queueChip.width : 0;
  check(
    "WCO header-stack / .queue-chip clear of native button strip (right edge <= button strip left)",
    wco.headerStack !== null &&
      wco.queueChip !== null &&
      wco.titlebarAreaWidth > 0 &&
      stackRight <= buttonStripLeft + 1 &&
      chipRight <= buttonStripLeft + 1,
    JSON.stringify({ stackRight: +stackRight.toFixed(2), chipRight: +chipRight.toFixed(2), buttonStripLeft: +buttonStripLeft.toFixed(2) })
  );

  // -------------------------------------------------------------------------
  // MAX-ROUNDTRIP：toggleMaximize 走 IPC -> isMaximized true，再 toggle 回 false
  // （原生 WCO 按钮由系统绘制、无法从 DOM 点击，改用桥方法驱动）
  // -------------------------------------------------------------------------
  log("");
  log("--- MAX-ROUNDTRIP ---");
  await evaluate("window.imageStudio.windowControls.toggleMaximize()");
  await sleep(450);
  const maximizeState = JSON.parse(
    await evaluate("window.imageStudio.windowControls.isMaximized().then(function(r){return JSON.stringify(r);})")
  );
  check(
    "MAX-ROUNDTRIP after toggle: isMaximized()=true",
    maximizeState.ok === true && maximizeState.maximized === true,
    JSON.stringify({ state: maximizeState })
  );
  const maximizedShotBytes = await screenshot(path.join(evidenceDir, "task-8-maximized.png"));
  log(`SCREENSHOT task-8-maximized.png bytes=${maximizedShotBytes}`);

  await evaluate("window.imageStudio.windowControls.toggleMaximize()");
  await sleep(450);
  const restoreState = JSON.parse(
    await evaluate("window.imageStudio.windowControls.isMaximized().then(function(r){return JSON.stringify(r);})")
  );
  check(
    "MAX-ROUNDTRIP after second toggle: isMaximized()=false",
    restoreState.ok === true && restoreState.maximized === false,
    JSON.stringify({ state: restoreState })
  );

  // -------------------------------------------------------------------------
  // SCROLL-STABLE：.app 为页面滚动容器（顶部从 header 下方开始），滚动后 window 不滚动、
  // 无 data-condensed、header 保持全宽（原生 WCO 按钮不参与 DOM，无需再比对控件 rect）
  // -------------------------------------------------------------------------
  log("");
  log("--- SCROLL-STABLE ---");
  await evaluate("document.querySelector('.app').scrollTo(0,0)");
  await sleep(350);
  const beforeRaw = await evaluate(
    `(function(){var h=document.querySelector('header').getBoundingClientRect();var a=document.querySelector('.app').getBoundingClientRect();return JSON.stringify({headerWidth:+h.width.toFixed(2),headerBottom:+h.bottom.toFixed(2),appTop:+a.top.toFixed(2)});})()`
  );
  await evaluate("document.querySelector('.app').scrollTo(0,2000)");
  await sleep(600);
  const scrolledRaw = await evaluate(
    `(function(){var h=document.querySelector('header').getBoundingClientRect();var app=document.querySelector('.app');return JSON.stringify({condensed:app.dataset.condensed,appScrollTop:app.scrollTop,appTop:+app.getBoundingClientRect().top.toFixed(2),windowScrollY:window.scrollY,headerWidth:+h.width.toFixed(2)});})()`
  );
  const scrolled = JSON.parse(scrolledRaw);
  const before = JSON.parse(beforeRaw);
  const stable =
    scrolled.condensed === undefined &&
    before.appTop === before.headerBottom &&
    scrolled.appScrollTop > 0 &&
    scrolled.windowScrollY === 0 &&
    scrolled.appTop === before.headerBottom &&
    scrolled.headerWidth === before.headerWidth;
  check(
    "SCROLL-STABLE .app scrolls below header (appTop==headerBottom), window unscrolled, no data-condensed, header full-width",
    stable,
    JSON.stringify({ before, after: scrolled })
  );
  const scrolledShotBytes = await screenshot(path.join(evidenceDir, "task-8-scrolled.png"));
  log(`SCREENSHOT task-8-scrolled.png bytes=${scrolledShotBytes}`);

  await evaluate("document.querySelector('.app').scrollTo(0,0)");
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
    "task-8-scrolled.png": scrolledShotBytes,
  };
  for (const [name, bytes] of Object.entries(shots)) {
    if (!(bytes > 10 * 1024)) {
      log(`[FAIL] screenshot ${name} is not > 10KB (bytes=${bytes})`);
      process.exitCode = 1;
    }
  }
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
      check("RENDERER bridge ready", false, "not ready within 10s");
      return;
    }
    // 跳过首次启动的教程询问弹窗：验证实例使用生产产物 origin，localStorage 无教程记录，
    // 弹窗（fixed 遮罩）会盖住截图证据。仅作用于验证实例，不触碰用户日常 origin 的数据。
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
