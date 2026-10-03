/*
 * build-fonts.mjs — 一次性字体子集生成器（手动运行，不挂入 npm run build）。
 *
 * 运行：`node tools/build-fonts.mjs`（或 `npm run build:fonts`）。
 *
 * 目的：把 DM Sans 与 Noto Sans SC 的 400/500/600/700 四个字重，
 * 子集化为 `src/assets/fonts/{dm-sans,noto-sans-sc}-{400,500,600,700}.woff2`
 * 共 8 个文件，提交入库，使运行时完全离线、且 `npm run build` 不需要网络或字体工具。
 *
 * 字符集（对两款字体统一使用）：
 *   1. ASCII 可打印区 0x20–0x7E（西文与半角标点）。
 *   2. CJK 常用标点：U+3000–U+303F（CJK 符号与标点）与 U+FF01–U+FF5E（全角 ASCII 形态）。
 *   3. 扫描 `src/` 全部文本源码得到的 CJK 字符（含扩展 A、基本区、兼容区）。
 *   4. GB2312 一级字表（区位 16–55，字节 0xB0A1–0xD7F9，共 3755 字）——
 *      由码表遍历 + `TextDecoder("gb18030")` 算法生成，不依赖任何外部字表文件。
 *
 * 源字体（URL 均在此文档化；本环境 raw.githubusercontent.com 被墙，实际走 jsDelivr 镜像）：
 *   - Noto Sans SC：Google Fonts 官方仓库的可变字体 NotoSansSC[wght].ttf
 *       首选 https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
 *       镜像 https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
 *       子集时用 variationAxes 把 wght 轴实例化到目标字重（单文件出四份）。
 *   - DM Sans：@fontsource/dm-sans 的静态拉丁 woff2（源自 Google Fonts 官方 DM Sans，
 *       与 @fontsource 包内资源等价；官方 Google Fonts 仓库的 DM Sans 现为可变字体，
 *       静态字重通常由 fontsource 打包）：
 *       https://cdn.jsdelivr.net/npm/@fontsource/dm-sans@5.3.0/files/dm-sans-latin-{weight}-normal.woff2
 *       （等价于 `npm i -D @fontsource/dm-sans` 后从 node_modules/@fontsource/dm-sans/files 读取）
 *     也可改为下载可变字体 DMSans[opsz,wght].ttf 后实例化，但静态字重体积更小、行为更确定。
 *
 * 下载的原始字体缓存于 `tools/fonts-src/`（体积大、**不提交**，已加入 .gitignore）；
 * 若缓存存在则直接复用，脚本可在离线状态重复生成（只要字体源已缓存）。
 *
 * 体积预算（plan T6）：Noto Sans SC 四字重合计 ≤ 4MB；DM Sans 合计 ≤ 0.5MB。
 * 超预算时脚本以退出码 1 退出，并给出收窄字符集 / 降为 400+700 的提示。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const subsetFont = require("subset-font");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");
const cacheDir = path.join(repoRoot, "tools", "fonts-src");
const outDir = path.join(repoRoot, "src", "assets", "fonts");

const WEIGHTS = [400, 500, 600, 700];
const BUDGETS = {
  "noto-sans-sc": 4 * 1024 * 1024,
  "dm-sans": 0.5 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// 字符集
// ---------------------------------------------------------------------------

function asciiChars() {
  let out = "";
  for (let cp = 0x20; cp <= 0x7e; cp++) out += String.fromCodePoint(cp);
  return out;
}

function cjkPunctuationChars() {
  let out = "";
  for (let cp = 0x3000; cp <= 0x303f; cp++) out += String.fromCodePoint(cp);
  for (let cp = 0xff01; cp <= 0xff5e; cp++) out += String.fromCodePoint(cp);
  return out;
}

/** GB2312 一级字表：区位 16–55（字节 0xB0A1–0xD7F9），用 gb18030 解码算法生成。 */
function gb2312Level1Chars() {
  const decoder = new TextDecoder("gb18030");
  let out = "";
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    const loMax = hi === 0xd7 ? 0xf9 : 0xfe;
    for (let lo = 0xa1; lo <= loMax; lo++) {
      const ch = decoder.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== "\uFFFD") out += ch;
    }
  }
  return out;
}

const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;

function walkFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "assets" || entry.name === "node_modules") continue;
      walkFiles(full, acc);
    } else if (/\.(ts|tsx|css|html|json|md|txt)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** 扫描 src/ 全部文本源码，收集其中的 CJK 字符。 */
function scanSourceCjkChars() {
  const found = new Set();
  for (const file of walkFiles(srcDir, [])) {
    const text = fs.readFileSync(file, "utf8");
    const matches = text.match(CJK_RE);
    if (matches) for (const ch of matches) found.add(ch);
  }
  return found;
}

function buildCharset() {
  const set = new Set();
  for (const ch of asciiChars()) set.add(ch);
  for (const ch of cjkPunctuationChars()) set.add(ch);
  const srcCjk = scanSourceCjkChars();
  for (const ch of srcCjk) set.add(ch);
  const gb = gb2312Level1Chars();
  for (const ch of gb) set.add(ch);

  // 去重后按码点排序，保证生成结果稳定（相同输入 → 相同输出）。
  const chars = [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  return {
    text: chars.join(""),
    asciiCount: asciiChars().length,
    punctCount: cjkPunctuationChars().length,
    srcCjkCount: srcCjk.size,
    gb2312Count: gb.length,
    total: chars.length,
  };
}

// ---------------------------------------------------------------------------
// 源字体下载 / 缓存
// ---------------------------------------------------------------------------

async function ensureSource(fileName, urls) {
  const cachePath = path.join(cacheDir, fileName);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return { path: cachePath, from: "cache" };
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("empty body");
      fs.writeFileSync(cachePath, buf);
      return { path: cachePath, from: url };
    } catch (error) {
      lastError = error;
      console.warn(`  ! source download failed (${url}): ${error.message}`);
    }
  }
  throw new Error(`no source available for ${fileName}: ${lastError && lastError.message}`);
}

const NOTO_SOURCE = {
  fileName: "NotoSansSC-VF.ttf",
  urls: [
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
    "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
  ],
};

function dmSansSource(weight) {
  return {
    fileName: `DMSans-${weight}-normal.woff2`,
    urls: [
      `https://cdn.jsdelivr.net/npm/@fontsource/dm-sans@5.3.0/files/dm-sans-latin-${weight}-normal.woff2`,
    ],
  };
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

async function generate(family, weight, source, text, variable) {
  const buffer = fs.readFileSync(source.path);
  const options = { targetFormat: "woff2" };
  if (variable) options.variationAxes = { wght: weight };
  const out = await subsetFont(buffer, text, options);
  if (out.length < 4 || out.slice(0, 4).toString("latin1") !== "wOF2") {
    throw new Error(`${family}-${weight}: output is not a WOFF2 file`);
  }
  const outPath = path.join(outDir, `${family}-${weight}.woff2`);
  fs.writeFileSync(outPath, out);
  return { outPath, size: out.length };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const charset = buildCharset();
  console.log("=== build-fonts ===");
  console.log(`repo:      ${repoRoot}`);
  console.log(`charset:   ASCII ${charset.asciiCount} + CJK标点 ${charset.punctCount}` +
    ` + 源码CJK ${charset.srcCjkCount} + GB2312一级 ${charset.gb2312Count}` +
    ` => 去重后 ${charset.total} 字符`);

  const results = [];

  // Noto Sans SC：可变字体 → 按 wght 轴实例化到四个字重
  const notoSource = await ensureSource(NOTO_SOURCE.fileName, NOTO_SOURCE.urls);
  console.log(`Noto 源:   ${path.basename(notoSource.path)} (${notoSource.from})`);
  for (const weight of WEIGHTS) {
    const r = await generate("noto-sans-sc", weight, notoSource, charset.text, true);
    results.push({ family: "noto-sans-sc", weight, ...r });
  }

  // DM Sans：逐字重静态拉丁源
  for (const weight of WEIGHTS) {
    const def = dmSansSource(weight);
    const src = await ensureSource(def.fileName, def.urls);
    const r = await generate("dm-sans", weight, src, charset.text, false);
    results.push({ family: "dm-sans", weight, ...r });
  }

  console.log("\n--- 生成结果 ---");
  const totals = { "noto-sans-sc": 0, "dm-sans": 0 };
  for (const r of results) {
    totals[r.family] += r.size;
    const kb = (r.size / 1024).toFixed(1);
    console.log(`  ${path.relative(repoRoot, r.outPath).replace(/\\/g, "/")}  ${kb} KB  (${r.size} B)`);
  }

  console.log("\n--- 体积预算 ---");
  let overBudget = false;
  for (const [family, total] of Object.entries(totals)) {
    const mb = (total / 1024 / 1024).toFixed(3);
    const budgetMb = (BUDGETS[family] / 1024 / 1024).toFixed(2);
    const ok = total <= BUDGETS[family];
    if (!ok) overBudget = true;
    console.log(`  ${ok ? "OK  " : "OVER"} ${family}: ${mb} MB / 预算 ${budgetMb} MB`);
  }
  if (overBudget) {
    console.error(
      "\n体积超标：请收窄字符集（如去掉未使用的全角标点）或按 plan 降为 400/700 两个字重，" +
        "并在 evidence 记录决策。"
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nDONE: 8 个 woff2 已生成，体积在预算内。");
}

main().catch((error) => {
  console.error("build-fonts failed:", error);
  process.exit(1);
});
