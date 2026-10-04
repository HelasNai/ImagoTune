/*
 * 生产模式 UI 截图工具（零依赖 CDP）。
 *
 * 运行方式：
 *   node tools/capture-ui.cjs [选项]
 *     --pages <列表>   逗号分隔的页面 id（默认：全部 7 个，按页面表顺序）
 *     --width <N>      渲染视口宽度覆盖（px，Emulation）
 *     --height <N>     渲染视口高度覆盖（px，Emulation）
 *     --out <目录>      输出目录（默认 .sisyphus/evidence/ui-capture，相对仓库根解析；绝对路径原样使用）
 *     --port <N>       CDP 调试端口（默认 9222）
 *     --help, -h       打印用法并退出 0
 *
 * 前置条件：
 *   - 已执行 `npm.cmd run build`（生产模式加载 dist-renderer）
 *   - 目标端口未被其他 CDP 实例占用（脚本会先探测，占用则直接报错退出）
 *
 * 实现约定：
 *   - 仅使用 Node >= 22 内置模块：child_process / fs / path / fetch / WebSocket。
 *   - 不依赖 puppeteer / playwright / ws 等任何第三方自动化库。
 *   - 通过 `--remote-debugging-port` 连接真实渲染进程；翻页只驱动现有 DOM
 *     （点击 `button.nav`），截图走 `Page.captureScreenshot`，绝不触碰 ipcRenderer。
 *   - 每次截图以捕获时刻的 `window.innerWidth/innerHeight` 命名，尺寸真实可核。
 *   - 清理只杀本脚本 spawn 的子进程树（taskkill /T /PID），绝不波及其他 electron.exe。
 *
 * 退出码：全部截图成功 = 0；参数错误 / 端口占用 / 任一页面失败 = 1。
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(".sisyphus", "evidence", "ui-capture");
const DEFAULT_PORT = 9222;

// 页面表：id → 侧栏/顶栏导航按钮文本。除 settings 外全部为 `button.nav`，按文本包含匹配点击；
// v3.15 起 settings 改由 `[data-mode]` 选择器定位（侧栏底部图标按钮 .sidebar-settings 无文本）。
const PAGES = [
  { id: "generate", nav: "创作生成" },
  { id: "edit", nav: "图片编辑" },
  { id: "outpaint", nav: "智能扩图" },
  { id: "gallery", nav: "项目图库" },
  { id: "local-ai", nav: "本地工具箱" },
  { id: "settings", selector: '[data-mode="settings"]' },
  { id: "queue", nav: "任务队列" },
];

let child = null;
let wsRef = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  console.log(String(line));
}

function usage() {
  return [
    "用法: node tools/capture-ui.cjs [选项]",
    "",
    "选项:",
    "  --pages <列表>   逗号分隔的页面 id（默认: " + PAGES.map((p) => p.id).join(",") + "）",
    "  --width <N>      渲染视口宽度覆盖（px，Emulation）",
    "  --height <N>     渲染视口高度覆盖（px，Emulation）",
    "  --out <目录>      输出目录（默认: " + DEFAULT_OUT + "）",
    "  --port <N>       CDP 调试端口（默认: " + DEFAULT_PORT + "）",
    "  --help, -h       打印本用法并退出",
    "",
    "有效页面 id: " + PAGES.map((p) => p.id).join(", "),
  ].join("\n");
}

/** 解析 CLI 参数；未知选项 / 缺值 / 非法页面 id 抛错（由 main 统一转退出码 1）。 */
function parseArgs(argv) {
  const opts = { pages: null, width: null, height: null, out: null, port: DEFAULT_PORT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const needValue = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`选项 ${arg} 缺少取值`);
      return value;
    };
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--pages") {
      opts.pages = needValue();
    } else if (arg === "--width") {
      opts.width = needValue();
    } else if (arg === "--height") {
      opts.height = needValue();
    } else if (arg === "--out") {
      opts.out = needValue();
    } else if (arg === "--port") {
      opts.port = needValue();
    } else {
      throw new Error(`未知选项: ${arg}`);
    }
  }

  if (opts.help) return opts;

  opts.port = parsePositiveInt(opts.port, "--port");
  if (opts.width !== null) opts.width = parsePositiveInt(opts.width, "--width");
  if (opts.height !== null) opts.height = parsePositiveInt(opts.height, "--height");

  const validIds = PAGES.map((p) => p.id);
  if (opts.pages === null) {
    opts.pages = validIds.slice();
  } else {
    const requested = opts.pages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = requested.filter((id) => validIds.indexOf(id) < 0);
    if (invalid.length > 0) {
      throw new Error(`无效页面 id: ${invalid.join(", ")}；有效页面 id: ${validIds.join(", ")}`);
    }
    if (requested.length === 0) throw new Error("--pages 为空；有效页面 id: " + validIds.join(", "));
    // 按页面表顺序输出，去重。
    opts.pages = validIds.filter((id) => requested.indexOf(id) >= 0);
  }

  // 输出目录：绝对路径原样使用，相对路径相对仓库根解析。
  const outArg = opts.out === null ? DEFAULT_OUT : opts.out;
  opts.out = path.isAbsolute(outArg) ? outArg : path.resolve(repoRoot, outArg);

  return opts;
}

function parsePositiveInt(raw, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} 需要正整数，收到: ${raw}`);
  return n;
}

/** 探测调试端口是否已被占用：能拿到任何 /json/version 响应即视为占用。 */
async function isPortOccupied(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok || res.status > 0;
  } catch {
    return false;
  }
}

async function waitForPageTarget(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
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

async function connectCdp(port) {
  const target = await waitForPageTarget(port);
  if (!target) throw new Error(`20s 内未在端口 ${port} 上找到 type=page 的 CDP target`);

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
  for (let i = 0; i < 60; i++) {
    try {
      const raw = await cdp.evaluate(
        `JSON.stringify({bridge: !!(window.imageStudio && window.imageStudio.windowControls), nav: document.querySelectorAll("button.nav").length})`
      );
      const state = JSON.parse(raw);
      if (state.bridge && state.nav > 0) {
        log(`renderer 就绪（约 ${i * 250}ms）: ${raw}`);
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
 * 跳过首次启动的教程询问弹窗：生产产物 origin 的 localStorage 无教程记录，
 * fixed 遮罩会盖住截图。仅作用于本脚本启动的实例。
 */
async function dismissTutorial(cdp) {
  for (let i = 0; i < 16; i++) {
    let state = "none";
    try {
      state = await cdp.evaluate(
        `(function(){var c=document.querySelector('.tutorial-welcome-card');if(!c)return 'none';var b=c.querySelector('.tutorial-close');if(b){b.click();return 'clicked';}return 'no-close';})()`
      );
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
    await cdp.evaluate(
      `(function(){var c=document.querySelector('.tutorial-close');if(c)c.click();return true;})()`
    );
  } catch {
    /* ignore */
  }
  await sleep(200);
}

/** 按选择器或导航文本点击导航入口，返回 "clicked" / "not-found"。 */
async function clickNav(cdp, def) {
  if (def.selector) {
    return cdp.evaluate(
      `(function(){var b=document.querySelector(${JSON.stringify(def.selector)});if(!b)return "not-found";b.click();return "clicked";})()`
    );
  }
  return cdp.evaluate(
    `(function(){var b=[...document.querySelectorAll("button.nav")].find(function(x){return (x.textContent||"").indexOf(${JSON.stringify(
      def.nav
    )})>=0;});if(!b)return "not-found";b.click();return "clicked";})()`
  );
}

/** 读取当前 innerWidth/innerHeight。 */
async function readViewport(cdp) {
  return JSON.parse(
    await cdp.evaluate(`JSON.stringify({w: window.innerWidth, h: window.innerHeight})`)
  );
}

/**
 * 应用视口覆盖：缺失维度回退到当前 innerWidth/innerHeight；
 * 等待双 rAF + 连续两次读数一致确认 resize 稳定（简化自 verify-layout 的 setViewport）。
 */
async function applyViewport(cdp, width, height) {
  const current = await readViewport(cdp);
  const targetW = width !== null ? width : current.w;
  const targetH = height !== null ? height : current.h;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: targetW,
    height: targetH,
    deviceScaleFactor: 1,
    mobile: false,
  });
  log(`viewport: ${current.w}x${current.h} -> ${targetW}x${targetH}`);

  let previous = null;
  for (let i = 0; i < 30; i++) {
    await cdp.evaluate(
      `new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){res(1);});});})`
    );
    let info = null;
    try {
      info = await readViewport(cdp);
    } catch {
      info = null;
    }
    if (previous && info && info.w === previous.w && info.h === previous.h) return info;
    previous = info;
    await sleep(60);
  }
  return previous || (await readViewport(cdp));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    // 参数错误：打印原因 + 用法后以退出码 1 结束。
    log(`ERROR: ${(error && error.message) || error}`);
    log(usage());
    return 1;
  }
  if (opts.help) {
    log(usage());
    return 0;
  }

  log("=== UI 截图（生产模式 CDP）===");
  log(`repo: ${repoRoot}`);
  log(`node: ${process.version}`);
  log(`pages: ${opts.pages.join(", ")}`);
  log(`out: ${opts.out}`);
  log(`port: ${opts.port}`);
  if (opts.width !== null || opts.height !== null) {
    log(`viewport override: ${opts.width !== null ? opts.width : "auto"}x${opts.height !== null ? opts.height : "auto"}`);
  }

  // 1) 启动前端口探测：占用则硬报错，避免误连他人在跑的 CDP 实例。
  if (await isPortOccupied(opts.port)) {
    log(`ERROR: 端口 ${opts.port} 已被占用（可能存在另一个调试实例）。请关闭该实例或改用 --port 指定其他端口。`);
    return 1;
  }

  fs.mkdirSync(opts.out, { recursive: true });

  // 2) 启动生产模式 Electron。
  const electronPath = require(path.join(repoRoot, "node_modules", "electron"));
  log(`electron: ${electronPath}`);
  child = spawn(electronPath, [".", `--remote-debugging-port=${opts.port}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  let cdp = null;
  const results = [];
  try {
    cdp = await connectCdp(opts.port);
    const ready = await waitForRenderer(cdp);
    if (!ready) throw new Error("渲染层 15s 内未就绪");

    await dismissTutorial(cdp);

    if (opts.width !== null || opts.height !== null) {
      await applyViewport(cdp, opts.width, opts.height);
    }

    for (const pageId of opts.pages) {
      const def = PAGES.find((p) => p.id === pageId);
      try {
        const navResult = await clickNav(cdp, def);
        if (navResult !== "clicked") throw new Error(`导航按钮未找到: ${def.nav || def.selector}`);
        // View Transitions 页面切换（约 350ms），固定等待确保动画结束。
        await sleep(900);
        const vp = await readViewport(cdp);
        const filename = `${pageId}-${vp.w}x${vp.h}.png`;
        const bytes = await cdp.screenshot(path.join(opts.out, filename));
        log(`SHOT ${filename} (${bytes} bytes)`);
        results.push({ pageId, ok: true, filename });
      } catch (error) {
        const message = (error && error.message) || String(error);
        log(`FAIL ${pageId}: ${message}`);
        results.push({ pageId, ok: false, error: message });
      }
    }
  } finally {
    if (cdp) cdp.close();
    if (child) {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    }
    log("cleanup done");
  }

  const okCount = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).map((r) => r.pageId);
  log(`SUMMARY: ${okCount}/${results.length} 成功${failed.length ? `，失败: ${failed.join(", ")}` : ""}`);
  log(`OUT: ${opts.out}`);
  return failed.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((error) => {
    log(`ERROR: ${(error && error.stack) || error}`);
    // 参数解析等前置失败不涉及子进程，但仍走统一退出码。
    process.exit(1);
  });
