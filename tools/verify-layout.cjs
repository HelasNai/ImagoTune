/*
 * Todo 15 — 布局编辑模式（双单位坐标系）CDP 窗口矩阵验收脚本（零依赖）。
 *
 * 运行方式：
 *   node tools/verify-layout.cjs
 *
 * 前置条件：
 *   - 已执行 `npm.cmd run build`（脚本会在产物缺失时自动补跑）；
 *   - 系统中没有其他 Electron 实例占用 9222 调试端口。
 *
 * 实现约定（照 tools/verify-window-chrome.cjs 范式）：
 *   - 仅使用 Node >= 22 内置模块：child_process / fs / path / os / fetch / WebSocket。
 *   - 不依赖 puppeteer / playwright / ws 等任何第三方自动化库。
 *   - 以独立 `--user-data-dir=<临时目录>` 启动生产产物，保证隔离与可复现。
 *   - 断言结果只以退出码为准：任一 FAIL 时 process.exitCode = 1。
 *
 * 验收命题（v4 双单位坐标）：
 *   ① 尺寸矩阵 1920/1452/1280/1050/901/900/800/701/700/560 上：
 *      a) 每个可见模块根与 .app / documentElement 无横向溢出；
 *      b) 模块 min-height == 快照行数 × 16（垂直行单位与窗口无关）；
 *         内容稳定模块（prompt，无尺寸档位）的 top 不随 colWidth 成比例缩小；
 *      c) .layout-handle 矩形与对应模块矩形差 ≤1px；
 *      d) .controls 按「模块自身宽度」切换 grid-template-columns（<680 → 2 列、<560 → 1 列），
 *         并用 CDP Input 真实拖拽 .layout-handle-resize.e 复核（退路：写 v4 快照 + Page.reload）；
 *      e) 901/900 与 701/700 的卡片宽跳变被记录，且该点无溢出 / 无重叠；
 *      f) 垂直缩放真实拖拽（.layout-handle-resize.s）：先拉高 +160px 再拉矮 -260px，
 *         高度必须能变小（回归「只能拉高不能拉矮」：实测撑开值曾把拉矮永久钳住）并回到初始附近。
 *      g) 纵向推挤回流真实 move 拖拽（references → controls）：拖动中目标模块渲染 top 实时增大（live 预览）；
 *         松手后 A 快照 y == ghost 落点、B 快照 y 持久化且渲染 top 无跳变；Ctrl+Z 单步撤销还原 A/B 坐标。
 *
 * 退出码：全部 PASS = 0；任一 FAIL 或清理失败 = 1。
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const repoRoot = path.resolve(__dirname, "..");
const evidenceDir = path.join(repoRoot, ".sisyphus", "evidence");
const PORT = 9222;
const STORAGE_KEY = "imagotune:layout:v1";
const GRID_PX = 16;
const LAYOUT_COLS = 64;

/** 尺寸矩阵（视口宽；顺序固定，首点 1920 作为快照测量基准）。 */
const MATRIX = [1920, 1452, 1280, 1050, 901, 900, 800, 701, 700, 560];

/** 视口高度（水平验收与高度无关，取一固定值即可）。 */
const VIEWPORT_H = 900;

/** 「内容稳定」模块：LAYOUT_SIZE_THRESHOLDS 为空对象——模块内不随宽度重排，
 *  自身实测高度与宽度无关；用于反证垂直 top 只由行坐标决定（不随 colWidth 比例缩放）。
 *  （v3.8.4：presets 已并入 controls，stable 池仅剩 prompt。） */
const STABLE_TOPS = ["prompt"];

/**
 * 模块表镜像 src/lib/layout.ts 的 LAYOUT_MODULES（id / 可见模式 / minW / minH）与
 * LAYOUT_SIZE_THRESHOLDS（controls 档位）。外部验收脚本刻意不 import 渲染层源码，
 * 保持零依赖；两处若漂移，脚本会用本地存储的 v4 快照 + 计算样式读值暴露差异。
 */
const MODULES = [
  { id: "project-strip", modes: ["generate", "edit", "outpaint"], minW: 400, minH: 64 },
  { id: "prompt", modes: ["generate", "edit", "outpaint"], minW: 360, minH: 160 },
  { id: "negative-prompt", modes: ["generate", "edit", "outpaint"], minW: 360, minH: 112 },
  { id: "reverse-prompt", modes: ["generate", "edit", "outpaint"], minW: 320, minH: 48 },
  { id: "upload", modes: ["edit", "outpaint"], minW: 320, minH: 48 },
  { id: "mask", modes: ["edit"], minW: 360, minH: 240 },
  { id: "references", modes: ["generate", "edit"], minW: 320, minH: 120 },
  { id: "outpaint-panel", modes: ["outpaint"], minW: 360, minH: 160 },
  { id: "controls", modes: ["generate", "edit", "outpaint"], minW: 480, minH: 144 },
];
const CONTROLS = { compact: 680, narrow: 560 };

const MODE = "generate";

/** 推挤回流验收：A（被拖动）落到 B（目标）上时 B 实时下推，松手后二者坐标持久化；Ctrl+Z 单步还原。
 *  A/B 均在 generate 模式下可见且横向重叠（x=0 全宽），且 A 在 B 上方；handle 标签用于定位 A 的拖动热区。 */
const PUSH_A = "references";
const PUSH_B = "controls";
const PUSH_LABEL_A = "参考图";

let child = null;
let wsRef = null;
let userDataDir = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  console.log(String(line));
}

/** 断言助手：记录原始值，任一 FAIL 置 exitCode=1（绝不「跳过」）。 */
function check(label, ok, raw) {
  log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  log(`RAW: ${raw}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

/** 构建产物缺失时自动补跑 `npm.cmd run build`（保证 `node tools/verify-layout.cjs` 自包含）。 */
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
    log(`[FAIL] npm run build exited with status ${String(result.status)}`);
    process.exitCode = 1;
    return false;
  }
  return true;
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

  async function screenshot(filePath) {
    const msg = await send("Page.captureScreenshot", { format: "png" });
    if (!msg.result || typeof msg.result.data !== "string") throw new Error("Page.captureScreenshot returned no data");
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
  for (let i = 0; i < 60; i++) {
    try {
      const raw = await cdp.evaluate(`JSON.stringify({bridge:!!(window.imageStudio && window.imageStudio.settings), composer:!!document.querySelector('.composer'), nav:document.querySelectorAll('.nav').length})`);
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

/**
 * 跳过首次启动的教程询问弹窗：验证实例使用独立 userData，localStorage 无教程记录，
 * fixed 遮罩会吞掉步骤 d 的 Input 事件。仅作用于验证实例，不触碰用户日常 origin 的数据。
 */
async function dismissTutorial(cdp) {
  for (let i = 0; i < 16; i++) {
    let state = "none";
    try {
      state = await cdp.evaluate(`(function(){var c=document.querySelector('.tutorial-welcome-card');if(!c)return 'none';var b=c.querySelector('.tutorial-close');if(b){b.click();return 'clicked';}return 'no-close';})()`);
    } catch {
      /* 忽略 */
    }
    if (state !== "none") {
      log(`INFO tutorial welcome overlay: ${state}`);
      break;
    }
    await sleep(250);
  }
  await sleep(400);
  // 兜底：关闭可能残留的教程遮罩（中心弹层 / 聚光罩）
  try {
    await cdp.evaluate(`(function(){var c=document.querySelector('.tutorial-close');if(c)c.click();return true;})()`);
  } catch {
    /* ignore */
  }
  await sleep(200);
}

/** 切到创作页并进入布局编辑模式（建立自定义快照）。现有桥未暴露模式切换 API，故驱动 DOM。 */
async function enterLayoutEdit(cdp) {
  await cdp.evaluate(
    `(function(){var bs=document.querySelectorAll('.nav');for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf('创作生成')>=0){bs[i].click();return true;}}return false;})()`
  );
  // 等待 ComposerPanel 挂载 + 卡片宽度就绪，然后点击「调整布局」直到进入编辑态。
  // 注意：快照已存在时 .composer-modules.layout-grid 恒存在（网格渲染 ≠ 编辑态），不能以 grid 判定，
  // 必须等 .composer-editing + .layout-handle 就绪；编辑态已开但把手未渲染时只等待、不再点击（防误退出）。
  for (let i = 0; i < 30; i++) {
    const state = JSON.parse(
      await cdp.evaluate(`(function(){var c=document.querySelector('.composer');var t=document.querySelector('.layout-toggle');return JSON.stringify({composer:!!c,card:c?c.clientWidth:0,toggle:t?t.textContent:'',editing:!!document.querySelector('.composer-editing'),handles:document.querySelectorAll('.layout-handle').length});})()`)
    );
    if (state.editing && state.handles > 0) return true;
    if (!state.editing && state.composer && state.toggle && state.card > 0) {
      await cdp.evaluate(`(function(){var t=document.querySelector('.layout-toggle');if(t)t.click();return true;})()`);
    }
    await sleep(300);
  }
  return false;
}

/** 设置视口覆盖，并等待 ResizeObserver 回填 colWidth、布局稳定（连续两次读数一致）。 */
async function setViewport(cdp, width) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: VIEWPORT_H, deviceScaleFactor: 1, mobile: false });
  let previous = null;
  for (let i = 0; i < 30; i++) {
    await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
    let info = null;
    try {
      info = JSON.parse(
        await cdp.evaluate(`(function(){var g=document.querySelector('.composer-modules');var c=document.querySelector('.composer');return JSON.stringify({w:window.innerWidth,card:c?c.clientWidth:0,unit:g?getComputedStyle(g).getPropertyValue('--layout-col-unit'):null});})()`)
      );
    } catch {
      info = null;
    }
    if (previous && info && info.card > 0 && info.w === previous.w && info.card === previous.card && info.unit === previous.unit) return info;
    previous = info;
    await sleep(60);
  }
  return previous;
}

/** 读取当前视口下的布局几何（相对坐标 + 句柄 + 溢出 + 档位）。 */
async function readGeometry(cdp) {
  const raw = await cdp.evaluate(`(function(){
    function rectOf(el){var r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}
    var grid=document.querySelector('.composer-modules');
    var gcs=grid?getComputedStyle(grid):null;
    var card=document.querySelector('.composer');
    var modules=[];
    document.querySelectorAll('.composer-modules [data-layout-id]').forEach(function(el){
      var cs=getComputedStyle(el);
      var r=el.getBoundingClientRect();
      modules.push({id:el.getAttribute('data-layout-id'),display:cs.display,minHeight:cs.minHeight,inlineMinHeight:el.style.minHeight||'',compact:el.getAttribute('data-layout-compact')||null,narrow:el.getAttribute('data-layout-narrow')||null,rect:r.left!==undefined?{left:r.left,top:r.top,width:r.width,height:r.height}:null,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth});
    });
    var handles=[];
    document.querySelectorAll('.layout-handle').forEach(function(el){
      var lab=el.querySelector('.layout-handle-label');
      handles.push({label:lab?lab.textContent:null,rect:rectOf(el)});
    });
    var controls=document.querySelector('.controls');
    var app=document.querySelector('.app');
    var de=document.documentElement;
    return JSON.stringify({
      innerW:window.innerWidth, innerH:window.innerHeight,
      gridClass:grid?grid.className:null,
      gridTop:grid?grid.getBoundingClientRect().top:0,
      colUnit:gcs?(gcs.getPropertyValue('--layout-col-unit')||'').trim():'',
      rowUnit:gcs?(gcs.getPropertyValue('--layout-row-unit')||'').trim():'',
      cardWidth:card?card.clientWidth:0,
      editing:!!document.querySelector('.composer-editing'),
      doc:{scrollWidth:de.scrollWidth,clientWidth:de.clientWidth},
      app:app?{scrollWidth:app.scrollWidth,clientWidth:app.clientWidth}:null,
      controlsCols:controls?getComputedStyle(controls).gridTemplateColumns:null,
      controlsWidth:controls?controls.getBoundingClientRect().width:0,
      modules:modules,handles:handles
    });
  })()`);
  return JSON.parse(raw);
}

function parseSnapshot(raw) {
  if (!raw) return null;
  try {
    const store = JSON.parse(raw);
    if (!store || store.version !== 4 || !Array.isArray(store.presets)) return null;
    const preset = store.presets.find((item) => item.id === store.activePresetId) || store.presets[0];
    if (!preset || !preset.snapshot) return null;
    return { store, preset, snapshot: preset.snapshot };
  } catch {
    return null;
  }
}

/** 该模块在 generate 模式下的期望行坐标：共享模块读 shared，专属模块读 modes.generate；缺失按补位公式估算。 */
function placementOf(snapshot, def) {
  const shared = def.modes.length === 3;
  const placement = shared ? snapshot.shared && snapshot.shared[def.id] : snapshot.modes && snapshot.modes[MODE] && snapshot.modes[MODE][def.id];
  if (placement && typeof placement.h === "number" && typeof placement.y === "number") return placement;
  return { x: 0, y: 0, w: LAYOUT_COLS, h: Math.max(1, Math.ceil(def.minH / GRID_PX)) };
}

function buildExpectations(snapshot) {
  const expected = {};
  const baselineTop = {};
  for (const def of MODULES) {
    if (!def.modes.includes(MODE)) continue;
    const placement = placementOf(snapshot, def);
    expected[def.id] = placement.h * GRID_PX;
    baselineTop[def.id] = placement.y * GRID_PX;
  }
  return { expected, baselineTop };
}

function rectDiff(a, b) {
  return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
}

/** 一对矩形重叠：宽高交集均 > 1px 才算重叠（忽略边框/亚像素）。 */
function overlaps(a, b) {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 1 && h > 1;
}

function columnsOf(template) {
  if (!template || template === "none") return 0;
  return template.trim().split(/\s+/).filter(Boolean).length;
}

/** 读 .controls 当前档位（拖拽 / 回退路径共用）。 */
async function readControls(cdp) {
  const geo = await readGeometry(cdp);
  const controls = geo.modules.find((m) => m.id === "controls");
  return {
    width: controls ? controls.rect.width : 0,
    cols: columnsOf(geo.controlsCols),
    compact: controls ? controls.compact : null,
    narrow: controls ? controls.narrow : null,
    editing: geo.editing,
  };
}

/** 读 localStorage 中当前激活方案的快照（供拖动前后坐标对比；无则 null）。 */
async function readSnapshotValue(cdp) {
  const parsed = parseSnapshot(await cdp.evaluate(`window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`));
  return parsed ? parsed.snapshot : null;
}

/** 读某模块相对 .composer-modules 顶部的渲染 top（px）；模块缺失返回 null。 */
async function readModuleRelTop(cdp, id) {
  const value = await cdp.evaluate(
    `(function(){var grid=document.querySelector('.composer-modules');var el=document.querySelector('.composer-modules [data-layout-id=${JSON.stringify(id)}]');if(!grid||!el)return null;return el.getBoundingClientRect().top-grid.getBoundingClientRect().top;})()`
  );
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 读拖动中吸附落点预览 .layout-ghost 的内联 top（px；即 ghost.y × GRID_PX）；无预览返回 null。 */
async function readGhostTopPx(cdp) {
  const value = await cdp.evaluate(`(function(){var g=document.querySelector('.layout-ghost');if(!g)return null;var v=parseFloat(g.style.top);return isNaN(v)?null:v;})()`);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 推挤回流验收（真实 move 拖动）：
 *   A 落到 B 的落点上 → B 渲染 top 实时增大（live 预览）→ 松手后 A 快照 y == ghost 落点、B 快照 y 持久化
 *   且渲染 top 无跳变 → Ctrl+Z 单步撤销把 A/B 坐标还原。
 */
async function runPushReflow(cdp) {
  log("");
  log("--- PUSH REFLOW (move drag pushes overlapping module down) ---");

  // 固定视口并确保处于编辑态（已是则快速返回）。
  await setViewport(cdp, 1920);
  const editState = JSON.parse(
    await cdp.evaluate(`JSON.stringify({editing:!!document.querySelector('.composer-editing'),handles:document.querySelectorAll('.layout-handle').length})`)
  );
  if (!editState.editing || editState.handles === 0) {
    const entered = await enterLayoutEdit(cdp);
    if (!entered) {
      check("PUSH edit mode available", false, JSON.stringify(editState));
      return;
    }
  }

  const defA = MODULES.find((m) => m.id === PUSH_A);
  const defB = MODULES.find((m) => m.id === PUSH_B);
  const snapshot = await readSnapshotValue(cdp);
  const a0 = snapshot ? placementOf(snapshot, defA) : null;
  const b0 = snapshot ? placementOf(snapshot, defB) : null;
  const overlapX = !!(a0 && b0 && a0.x < b0.x + b0.w && b0.x < a0.x + a0.w);
  const pairOk = !!(a0 && b0 && overlapX && a0.y < b0.y);
  check(
    "PUSH A/B snapshot present, horizontally overlapping, A above B",
    pairOk,
    JSON.stringify({ A: PUSH_A, a0, B: PUSH_B, b0, overlapX })
  );
  if (!pairOk) return;

  // 目标落点行：A 与 B 纵向重叠 1..3 行（A 底边落在 B 内），因而 B 被推到 A 底边之下；A 只下移、x/w 不变。
  const overlapRows = Math.max(1, Math.min(3, b0.h));
  const targetAY = Math.max(0, b0.y - a0.h + overlapRows);
  const deltaRows = targetAY - a0.y;

  // A 的 handle 滚入视口中央（CDP Input 事件只命中所见元素）。
  const scrolled = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent===${JSON.stringify(PUSH_LABEL_A)}){hs[i].scrollIntoView({block:'center',inline:'nearest'});return true;}
    }
    return false;
  })()`);
  if (!scrolled) {
    check("PUSH A handle found (label)", false, JSON.stringify({ label: PUSH_LABEL_A }));
    return;
  }
  await sleep(400);

  const handleRaw = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent===${JSON.stringify(PUSH_LABEL_A)}){
        var r=hs[i].getBoundingClientRect();
        return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2,top:parseFloat(hs[i].style.top),visible:(r.top+r.height/2)>0&&(r.top+r.height/2)<window.innerHeight});
      }
    }
    return JSON.stringify({found:false});
  })()`);
  const handle = JSON.parse(handleRaw);
  if (!handle.found || !handle.visible) {
    check("PUSH A handle visible rect", false, handleRaw);
    return;
  }

  const bBefore = await readModuleRelTop(cdp, PUSH_B);
  const aBefore = await readModuleRelTop(cdp, PUSH_A);
  const fromX = handle.x;
  const fromY = handle.y;
  // 初次估算位移：目标行像素 − handle 当前行像素（handle.top == displayTops × GRID_PX，与 beginDrag 基准一致）。
  const estimatePx = targetAY * GRID_PX - handle.top;
  let pointerY = fromY;

  // 关闭滚动锚定：拖动引起内容重排时 Chromium 会做补偿式滚动，干扰「指针位移 → 行坐标」换算（仅运行时调整验证实例，不改应用源码）。
  await cdp.evaluate(`(function(){var a=document.querySelector('.app');if(a)a.style.overflowAnchor='none';return true;})()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: fromX, y: fromY, button: "left", buttons: 1, clickCount: 1 });
  const steps = 10;
  const firstTarget = fromY + estimatePx;
  for (let i = 1; i <= steps; i++) {
    pointerY = fromY + ((firstTarget - fromY) * i) / steps;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fromX, y: pointerY, button: "left", buttons: 1 });
    await sleep(16);
  }
  // 以「B 的实时渲染 top」为反馈闭环：一旦被推下（top 增大）即证 A 落点已与 B 重叠，立即停止。
  // （指针↔行换算受滚动补偿 / 实测高度影响，故不直接依赖 ghost 目标行，改观测被推模块。）
  let pushedMid = false;
  for (let i = 0; i < 48 && !pushedMid; i++) {
    const bNow = await readModuleRelTop(cdp, PUSH_B);
    if (typeof bNow === "number" && typeof bBefore === "number" && bNow > bBefore + 0.5) {
      pushedMid = true;
      break;
    }
    pointerY += 10;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fromX, y: pointerY, button: "left", buttons: 1 });
    await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
    await sleep(30);
  }
  // 指针仍按住：等待 React 提交推挤预览，再读「拖动中」几何。
  await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
  await sleep(80);
  const bMid = await readModuleRelTop(cdp, PUSH_B);
  const ghostTopPx = await readGhostTopPx(cdp);
  log(
    `[PUSH] mid-drag: pushed=${pushedMid}, A live top=${aBefore}->(ghost ${typeof ghostTopPx === "number" ? ghostTopPx : "n/a"}), B top ${bBefore}->${bMid}`
  );

  check(
    "PUSH mid-drag: target B rendered top increased (live push preview)",
    typeof bBefore === "number" && typeof bMid === "number" && bMid > bBefore + 0.5,
    JSON.stringify({ bBefore, bMid, delta: typeof bBefore === "number" && typeof bMid === "number" ? +(bMid - bBefore).toFixed(2) : null })
  );
  check(
    "PUSH mid-drag: ghost landing preview visible",
    typeof ghostTopPx === "number",
    JSON.stringify({ ghostTopPx, expectedAY: targetAY })
  );

  // 松手落地。
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: fromX, y: pointerY, button: "left", buttons: 0, clickCount: 1 });
  await cdp.evaluate(`(function(){var a=document.querySelector('.app');if(a)a.style.overflowAnchor='';return true;})()`);
  await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
  await sleep(300);

  const after = await readSnapshotValue(cdp);
  const a1 = after ? placementOf(after, defA) : null;
  const b1 = after ? placementOf(after, defB) : null;
  const bAfter = await readModuleRelTop(cdp, PUSH_B);
  const ghostAfter = await readGhostTopPx(cdp);
  const ghostY = typeof ghostTopPx === "number" ? ghostTopPx / GRID_PX : null;

  check(
    "PUSH drop: A snapshot y == ghost landing preview (preview == landing)",
    !!a1 && ghostY !== null && Math.abs(a1.y - ghostY) <= 0.01,
    JSON.stringify({ A: PUSH_A, a0y: a0.y, a1y: a1 ? a1.y : null, ghostY, targetAY, deltaRows })
  );
  check(
    "PUSH drop: B snapshot y persisted == its pushed rendered top",
    !!b1 && typeof bMid === "number" && Math.abs(b1.y * GRID_PX - bMid) <= 1,
    JSON.stringify({ B: PUSH_B, b0y: b0.y, b1y: b1 ? b1.y : null, pushedRenderedTopPx: bMid, b1yPx: b1 ? +(b1.y * GRID_PX).toFixed(2) : null })
  );
  check(
    "PUSH drop: B rendered top after release == mid-drag pushed top (no jump)",
    typeof bAfter === "number" && typeof bMid === "number" && Math.abs(bAfter - bMid) <= 1,
    JSON.stringify({ bMid, bAfter, delta: typeof bAfter === "number" && typeof bMid === "number" ? +(bAfter - bMid).toFixed(2) : null })
  );
  check("PUSH drop: ghost preview removed after release", ghostAfter === null, JSON.stringify({ ghostAfter }));

  // Ctrl+Z 单步撤销：一次撤销应把 A 与 B 的坐标都还原到拖动前。
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 });
  await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
  await sleep(300);
  const undone = await readSnapshotValue(cdp);
  const a2 = undone ? placementOf(undone, defA) : null;
  const b2 = undone ? placementOf(undone, defB) : null;
  check(
    "PUSH undo (Ctrl+Z): A and B snapshot coords restored in one step",
    !!a2 && !!b2 && Math.abs(a2.y - a0.y) <= 0.01 && Math.abs(b2.y - b0.y) <= 0.01,
    JSON.stringify({ a0y: a0.y, a2y: a2 ? a2.y : null, b0y: b0.y, b2y: b2 ? b2.y : null })
  );

  fs.writeFileSync(
    path.join(evidenceDir, "task-15-layout-push-reflow.json"),
    JSON.stringify(
      { A: PUSH_A, B: PUSH_B, a0, b0, targetAY, deltaRows, estimatePx: +estimatePx.toFixed(2), aBefore, bBefore, bMid, ghostTopPx, a1, b1, bAfter, a2, b2 },
      null,
      2
    )
  );
  log("EVIDENCE task-15-layout-push-reflow.json written");
  await cdp.screenshot(path.join(evidenceDir, "task-15-layout-push-reflow.png"));
}

/** 在 .layout-handle-resize.e 上真实拖拽（controls 模块）。返回是否找得到把手。 */
async function dragControlsResize(cdp, targetWidth) {
  // controls 模块位于画布下部，需先把它的缩放把手滚入 .app 视口（Input 事件只命中所见元素）。
  const scrolled = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent==='输出控制'){
        var e=hs[i].querySelector('.layout-handle-resize.e');
        if(!e) return false;
        e.scrollIntoView({block:'center',inline:'nearest'});
        return true;
      }
    }
    return false;
  })()`);
  if (!scrolled) return { ok: false, reason: "no controls resize handle" };
  await sleep(350);

  const handleRaw = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent==='输出控制'){
        var e=hs[i].querySelector('.layout-handle-resize.e');
        if(!e) return JSON.stringify({found:false});
        var r=e.getBoundingClientRect();
        var mr=hs[i].getBoundingClientRect();
        return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2,visible:(r.top+r.height/2)>0&&(r.top+r.height/2)<window.innerHeight,handleRight:mr.left+mr.width,moduleWidth:mr.width});
      }
    }
    return JSON.stringify({found:false});
  })()`);
  const handle = JSON.parse(handleRaw);
  if (!handle.found) return { ok: false, reason: "no controls resize handle" };

  const fromX = handle.x;
  const fromY = handle.y;
  const toX = fromX + (targetWidth - handle.moduleWidth);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: fromX, y: fromY, button: "left", buttons: 1, clickCount: 1 });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: fromY, button: "left", buttons: 1 });
    await sleep(16);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toX, y: fromY, button: "left", buttons: 0, clickCount: 1 });
  await sleep(120);
  await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
  await sleep(500);
  return { ok: true, fromX: +fromX.toFixed(2), fromY: +fromY.toFixed(2), toX: +toX.toFixed(2), handleVisible: handle.visible, moduleWidthBefore: handle.moduleWidth };
}

/** 读指定 label 模块当前 .layout-handle 的显示高度（px；-1 = 未找到）。 */
async function readModuleHandleHeight(cdp, label) {
  const value = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent===${JSON.stringify(label)}) return hs[i].getBoundingClientRect().height;
    }
    return -1;
  })()`);
  return typeof value === "number" ? value : -1;
}

/**
 * 在指定 label 模块的 .layout-handle-resize.s 上真实拖拽（垂直缩放：正 deltaY = 拉高、负 = 拉矮）。
 * 回归用途：修复前下限取实时实测高度（恒 ≥ 当前高度），拉矮会被永久钳住（只能拉高不能拉矮）。
 */
async function dragModuleResizeS(cdp, label, deltaY) {
  const scrolled = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent===${JSON.stringify(label)}){
        var e=hs[i].querySelector('.layout-handle-resize.s');
        if(!e) return false;
        e.scrollIntoView({block:'center',inline:'nearest'});
        return true;
      }
    }
    return false;
  })()`);
  if (!scrolled) return { ok: false, reason: "no s handle" };
  await sleep(350);

  const handleRaw = await cdp.evaluate(`(function(){
    var hs=document.querySelectorAll('.layout-handle');
    for(var i=0;i<hs.length;i++){
      var lab=hs[i].querySelector('.layout-handle-label');
      if(lab && lab.textContent===${JSON.stringify(label)}){
        var e=hs[i].querySelector('.layout-handle-resize.s');
        if(!e) return JSON.stringify({found:false});
        var r=e.getBoundingClientRect();
        return JSON.stringify({found:true,x:r.left+r.width/2,y:r.top+r.height/2,visible:(r.top+r.height/2)>0&&(r.top+r.height/2)<window.innerHeight});
      }
    }
    return JSON.stringify({found:false});
  })()`);
  const handle = JSON.parse(handleRaw);
  if (!handle.found) return { ok: false, reason: "no s handle rect" };

  const fromX = handle.x;
  const fromY = handle.y;
  const toY = fromY + deltaY;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: fromX, y: fromY, button: "left", buttons: 1, clickCount: 1 });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fromX, y, button: "left", buttons: 1 });
    await sleep(16);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: fromX, y: toY, button: "left", buttons: 0, clickCount: 1 });
  await sleep(120);
  await cdp.evaluate(`new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`);
  await sleep(500);
  return { ok: true, fromY: +fromY.toFixed(2), toY: +toY.toFixed(2), visible: handle.visible };
}

/**
 * 退路：写一个 controls 宽度低于阈值的 v4 快照到 localStorage 并 Page.reload。
 * 渲染进程启动前无法直接写 LevelDB，故连接后经 Runtime.evaluate 写，再重载读取。
 */
async function fallbackControlsWidth(cdp, targetWidth) {
  await cdp.evaluate(`(function(){
    var raw=window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var store=JSON.parse(raw);
    var active=store.presets.filter(function(p){return p.id===store.activePresetId;})[0]||store.presets[0];
    var snap=active.snapshot;
    var grid=document.querySelector('.composer-modules');
    var card=document.querySelector('.composer');
    var col=card.clientWidth/${LAYOUT_COLS};
    if(!(col>0))col=16;
    var minCols=Math.max(1,Math.ceil(${MODULES.find((m) => m.id === "controls").minW}/col));
    var w=Math.max(minCols,Math.round(${targetWidth}/col));
    w=Math.min(w,${LAYOUT_COLS});
    var c=snap.shared.controls||{x:0,y:0,w:${LAYOUT_COLS},h:3};
    c.w=w;
    c.x=Math.min(c.x,${LAYOUT_COLS}-w);
    snap.shared.controls=c;
    window.localStorage.setItem(${JSON.stringify(STORAGE_KEY)},JSON.stringify(store));
    return JSON.stringify({col:col,w:w,target:${targetWidth}});
  })()`);
  await cdp.send("Page.reload", {});
  await sleep(1500);
  await waitForRenderer(cdp);
  await setViewport(cdp, 1920);
  return true;
}

async function runMatrix(cdp, snapshot) {
  const { expected, baselineTop } = buildExpectations(snapshot);
  const samples = [];
  const tops = {};
  for (const id of STABLE_TOPS) tops[id] = [];

  log("");
  log(`snapshot rows: ${JSON.stringify(Object.fromEntries(Object.entries(expected).map(([id, px]) => [id, px / GRID_PX])))}`);

  for (const width of MATRIX) {
    log("");
    log(`--- VIEWPORT ${width} ---`);
    const stable = await setViewport(cdp, width);
    const geo = await readGeometry(cdp);

    const visible = geo.modules.filter((m) => m.display !== "none");
    const moduleOverflow = visible.filter((m) => m.scrollWidth > m.clientWidth + 1).map((m) => ({ id: m.id, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth }));
    const appOverflow = geo.app ? geo.app.scrollWidth > geo.app.clientWidth + 1 : false;
    const docOverflow = geo.doc.scrollWidth > geo.doc.clientWidth + 1;
    check(
      `W${width} no horizontal overflow (modules + .app + documentElement)`,
      moduleOverflow.length === 0 && !appOverflow && !docOverflow,
      JSON.stringify({
        cardWidth: geo.cardWidth,
        colUnit: geo.colUnit,
        innerW: geo.innerW,
        moduleOverflow,
        app: geo.app,
        doc: geo.doc,
      })
    );

    const minHeightBad = [];
    for (const m of visible) {
      const exp = expected[m.id];
      if (typeof exp !== "number") continue;
      const actual = parseFloat(m.minHeight);
      if (!Number.isFinite(actual) || Math.abs(actual - exp) > 0.5) minHeightBad.push({ id: m.id, expected: exp, actual: m.minHeight });
    }
    check(
      `W${width} module min-height == snapshot rows x 16`,
      minHeightBad.length === 0,
      JSON.stringify({ bad: minHeightBad, checked: visible.map((m) => `${m.id}:${m.minHeight}`) })
    );

    const handleBad = [];
    for (const m of visible) {
      let best = Infinity;
      let bestLabel = null;
      for (const h of geo.handles) {
        const diff = rectDiff(h.rect, m.rect);
        if (diff < best) {
          best = diff;
          bestLabel = h.label;
        }
      }
      if (!Number.isFinite(best) || best > 1) handleBad.push({ id: m.id, diff: best, nearestHandle: bestLabel });
    }
    check(
      `W${width} .layout-handle rect matches module rect <=1px`,
      geo.handles.length > 0 && handleBad.length === 0,
      JSON.stringify({ handleCount: geo.handles.length, bad: handleBad })
    );

    const overlapPairs = [];
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        if (overlaps(visible[i].rect, visible[j].rect)) overlapPairs.push(`${visible[i].id}~${visible[j].id}`);
      }
    }
    check(`W${width} no overlapping visible modules`, overlapPairs.length === 0, JSON.stringify({ overlapPairs }));

    // .controls 档位按「模块自身宽度」切换
    const controls = visible.find((m) => m.id === "controls");
    let controlsOk = false;
    let controlsRaw = "controls missing";
    if (controls) {
      const expectedCols = controls.rect.width < CONTROLS.narrow - 0.5 ? 1 : controls.rect.width < CONTROLS.compact - 0.5 ? 2 : 4;
      const actualCols = columnsOf(geo.controlsCols);
      controlsOk = actualCols === expectedCols;
      controlsRaw = JSON.stringify({ width: controls.rect.width, actualCols, expectedCols, compact: controls.compact, narrow: controls.narrow, template: geo.controlsCols });
    }
    check(`W${width} .controls grid columns follow module width`, controlsOk, controlsRaw);

    // 内容稳定模块：显示 top 不低于快照行基准（resolveVerticalLayout 只下推不上拉；推挤按实测
    // 高度行值累计，显示 top 允许为分数像素，故此处只断言「不被上拉」）。
    const topBad = [];
    for (const id of STABLE_TOPS) {
      const m = visible.find((item) => item.id === id);
      if (!m) {
        topBad.push(`${id}:missing`);
        continue;
      }
      const relTop = m.rect.top - geo.gridTop;
      tops[id].push({ width, relTop: +relTop.toFixed(2), col: parseFloat(geo.colUnit) || 0 });
      if (!Number.isFinite(relTop)) topBad.push(`${id}:notFinite`);
      if (relTop < baselineTop[id] - 0.5) topBad.push(`${id}:pulledUp(relTop=${relTop}, baseline=${baselineTop[id]})`);
    }
    check(`W${width} stable-module top is never pulled above its row baseline`, topBad.length === 0, JSON.stringify({ topBad, tops: STABLE_TOPS.map((id) => topology(id, tops)) }));

    samples.push({
      width,
      cardWidth: geo.cardWidth,
      colUnit: geo.colUnit,
      rowUnit: geo.rowUnit,
      modules: visible.map((m) => ({ id: m.id, minHeight: m.minHeight, top: +(m.rect.top - geo.gridTop).toFixed(2), left: +m.rect.left.toFixed(2), width: +m.rect.width.toFixed(2), height: +m.rect.height.toFixed(2), scrollWidth: m.scrollWidth, clientWidth: m.clientWidth })),
      controlsCols: geo.controlsCols,
      stableTops: STABLE_TOPS.map((id) => topology(id, tops)),
      doc: geo.doc,
      app: geo.app,
    });

    const shot = await cdp.screenshot(path.join(evidenceDir, `task-15-layout-w${width}.png`));
    log(`SCREENSHOT task-15-layout-w${width}.png bytes=${shot} stable=${JSON.stringify(stable)}`);
  }

  // 跨点反证：top 不随 colWidth 成比例缩小（v3 比例单位会把窄视口的 top 压到宽视口的 colWidth 比例）
  const proportionalBad = [];
  for (const id of STABLE_TOPS) {
    const series = tops[id];
    if (!series.length) continue;
    const ref = series.find((s) => s.width === 1920) || series[0];
    if (ref.relTop <= 0) continue;
    for (const point of series) {
      if (point.relTop < ref.relTop * 0.85 - 0.5) proportionalBad.push({ id, width: point.width, relTop: point.relTop, refTop: ref.relTop });
    }
  }
  check(
    "STABLE TOPS do not scale proportionally with colWidth (min top >= 0.85 x 1920 top)",
    proportionalBad.length === 0,
    JSON.stringify({ proportionalBad, series: STABLE_TOPS.map((id) => ({ id, points: tops[id] })) })
  );

  return samples;
}

function topology(id, tops) {
  const series = tops[id];
  return series.length ? series[series.length - 1] : null;
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  log("=== Todo 15 CDP layout-matrix verification ===");
  log(`repo: ${repoRoot}`);
  log(`node: ${process.version}`);

  if (!ensureBuild()) return;

  const electronPath = require("electron");
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imagotune-layout-"));
  log(`electron: ${electronPath}`);
  log(`userDataDir: ${userDataDir}`);

  child = spawn(electronPath, [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  let cdp = null;
  try {
    cdp = await connectCdp();
    const ready = await waitForRenderer(cdp);
    if (!ready) {
      check("RENDERER ready", false, "not ready within 15s");
      return;
    }
    await dismissTutorial(cdp);

    // 以 1920 作为快照测量基准：先固定视口，再进入编辑模式建立快照。
    await setViewport(cdp, 1920);
    const entered = await enterLayoutEdit(cdp);
    if (!entered) {
      check("EDIT enter custom-snapshot grid layout", false, "edit mode (.composer-editing + handles) not established within ~9s");
      return;
    }
    const storedRaw = await cdp.evaluate(`window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
    const parsed = parseSnapshot(storedRaw);
    if (!parsed) {
      check("SNAPSHOT v4 written to localStorage", false, String(storedRaw).slice(0, 400));
      return;
    }
    check("SNAPSHOT v4 written to localStorage (custom grid established)", true, JSON.stringify({ activePresetId: parsed.preset.id, sharedKeys: Object.keys(parsed.snapshot.shared || {}), modeKeys: Object.keys((parsed.snapshot.modes && parsed.snapshot.modes[MODE]) || {}) }));
    fs.writeFileSync(path.join(evidenceDir, "task-15-layout-snapshot.json"), JSON.stringify(parsed.snapshot, null, 2));

    const samples = await runMatrix(cdp, parsed.snapshot);

    // 步骤 e：记录 901/900 与 701/700 的卡片宽跳变（允许跳变，但不得溢出/重叠——已逐点断言）
    log("");
    log("--- WIDTH JUMPS ---");
    const byWidth = Object.fromEntries(samples.map((s) => [s.width, s]));
    const jump900 = (byWidth[900] ? byWidth[900].cardWidth : 0) - (byWidth[901] ? byWidth[901].cardWidth : 0);
    const jump700 = (byWidth[700] ? byWidth[700].cardWidth : 0) - (byWidth[701] ? byWidth[701].cardWidth : 0);
    log(`901 cardWidth=${byWidth[901] ? byWidth[901].cardWidth : "n/a"} -> 900 cardWidth=${byWidth[900] ? byWidth[900].cardWidth : "n/a"} delta=${jump900}`);
    log(`701 cardWidth=${byWidth[701] ? byWidth[701].cardWidth : "n/a"} -> 700 cardWidth=${byWidth[700] ? byWidth[700].cardWidth : "n/a"} delta=${jump700}`);
    check("WIDTH-JUMP 900 (aside collapses) widens main card vs 901", jump900 > 0, JSON.stringify({ jump900, card901: byWidth[901] ? byWidth[901].cardWidth : null, card900: byWidth[900] ? byWidth[900].cardWidth : null }));
    check("WIDTH-JUMP 700 recorded (no overflow/overlap enforced per-point)", true, JSON.stringify({ jump700, card701: byWidth[701] ? byWidth[701].cardWidth : null, card700: byWidth[700] ? byWidth[700].cardWidth : null }));

    // 步骤 d：controls 档位（真实拖拽 .layout-handle-resize.e；退路：写 v4 快照 + reload）
    log("");
    log("--- CONTROLS TIER (drag) ---");
    await setViewport(cdp, 1920);

    let compact = await readControls(cdp);
    const dragCompact = await dragControlsResize(cdp, 640);
    compact = await readControls(cdp);
    let compactMethod = "drag";
    let compactRaw = JSON.stringify({ after: compact, drag: dragCompact });
    if (!(dragCompact.ok && compact.cols === 2)) {
      compactMethod = "fallback";
      await fallbackControlsWidth(cdp, 640);
      compact = await readControls(cdp);
      compactRaw = JSON.stringify({ after: compact, fallback: true });
    }
    check(`CONTROLS compact tier (<680px -> 2 columns) via ${compactMethod}`, compact.cols === 2, compactRaw);
    await cdp.screenshot(path.join(evidenceDir, "task-15-layout-controls-compact.png"));

    let narrowMethod = "drag";
    let narrowRaw;
    const compactNow = await readControls(cdp);
    if (compactNow.editing) {
      await dragControlsResize(cdp, 500);
      let narrow = await readControls(cdp);
      narrowRaw = JSON.stringify({ after: narrow, drag: true });
      if (narrow.cols !== 1) {
        narrowMethod = "fallback";
        await fallbackControlsWidth(cdp, 500);
        narrow = await readControls(cdp);
        narrowRaw = JSON.stringify({ after: narrow, fallback: true });
      }
      check(`CONTROLS narrow tier (<560px -> 1 column) via ${narrowMethod}`, narrow.cols === 1, narrowRaw);
    } else {
      narrowMethod = "fallback";
      await fallbackControlsWidth(cdp, 500);
      const narrow = await readControls(cdp);
      check("CONTROLS narrow tier (<560px -> 1 column) via fallback", narrow.cols === 1, JSON.stringify({ after: narrow }));
    }
    await cdp.screenshot(path.join(evidenceDir, "task-15-layout-controls-narrow.png"));

    // 步骤 f：垂直缩放——先拉高再拉矮（回归：实测撑开值曾把「拉矮」永久钳住，只能拉高不能拉矮）
    log("");
    log("--- VERTICAL RESIZE (grow then shrink) ---");
    await setViewport(cdp, 1920);
    const vEditing = JSON.parse(
      await cdp.evaluate(`JSON.stringify({editing:!!document.querySelector('.composer-editing'),grid:!!document.querySelector('.composer-modules.layout-grid')})`)
    );
    if (!vEditing.editing || !vEditing.grid) {
      const reentered = await enterLayoutEdit(cdp);
      if (!reentered) {
        check("VERTICAL resize edit mode available", false, JSON.stringify(vEditing));
        return;
      }
    }
    const vLabel = "图反推";
    const vBefore = await readModuleHandleHeight(cdp, vLabel);
    const vGrow = await dragModuleResizeS(cdp, vLabel, 160);
    const vGrown = await readModuleHandleHeight(cdp, vLabel);
    const vShrink = await dragModuleResizeS(cdp, vLabel, -260);
    const vShrunk = await readModuleHandleHeight(cdp, vLabel);
    check(
      "VERTICAL grow: handle drag +160px increases height",
      vGrow.ok && vBefore > 0 && vGrown > vBefore + 80,
      JSON.stringify({ vBefore, vGrown, vGrow })
    );
    check(
      "VERTICAL shrink: after growing, handle drag -260px decreases height (regression: was clamped grow-only)",
      vShrink.ok && vShrunk < vGrown - 100,
      JSON.stringify({ vGrown, vShrunk, vShrink })
    );
    check(
      "VERTICAL shrink returns near original height",
      vBefore > 0 && Math.abs(vShrunk - vBefore) <= 40,
      JSON.stringify({ vBefore, vShrunk, delta: +(vShrunk - vBefore).toFixed(2) })
    );
    fs.writeFileSync(
      path.join(evidenceDir, "task-15-layout-vertical-resize.json"),
      JSON.stringify({ label: vLabel, vBefore, vGrown, vShrunk, vGrow, vShrink }, null, 2)
    );
    await cdp.screenshot(path.join(evidenceDir, "task-15-layout-vertical-resize.png"));

    // 步骤 g：纵向推挤回流（move 拖动推动重叠模块 + 单步撤销）
    await runPushReflow(cdp);

    // 证据落盘（矩阵 + 快照 + 跳变）
    fs.writeFileSync(
      path.join(evidenceDir, "task-15-layout-matrix.json"),
      JSON.stringify({ matrix: MATRIX, samples, jumps: { w901to900: jump900, w701to700: jump700 } }, null, 2)
    );
    log("EVIDENCE task-15-layout-matrix.json written");
  } finally {
    if (cdp) cdp.close();
    await cleanup();
  }
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
