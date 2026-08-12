const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { extractAll } = require("@electron/asar");

async function verifyArchiveModule(packageRoot, tempRoot) {
  const archiver = require(path.join(packageRoot, "node_modules", "archiver"));
  const outputPath = path.join(tempRoot, "package-verification.zip");

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 1 } });

    output.once("close", resolve);
    output.once("error", reject);
    archive.once("error", reject);
    archive.pipe(output);
    archive.append("AI Image Studio package verification", { name: "verification.txt" });
    void archive.finalize();
  });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error("ZIP runtime verification did not create a valid archive.");
  }
}

function verifyRendererAssets(packageRoot) {
  const rendererRoot = path.join(packageRoot, "dist-renderer");
  const htmlPath = path.join(rendererRoot, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const assetReferences = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]);

  if (assetReferences.length === 0) {
    throw new Error("Packaged renderer does not reference any JavaScript or stylesheet assets.");
  }
  for (const reference of assetReferences) {
    if (/^[a-z]+:/i.test(reference)) continue;
    const relativePath = decodeURIComponent(reference.replace(/^\.\//, ""));
    const assetPath = path.resolve(rendererRoot, relativePath);
    if (!assetPath.startsWith(rendererRoot + path.sep) || !fs.existsSync(assetPath)) {
      throw new Error(`Packaged renderer asset is missing or invalid: ${reference}`);
    }
  }

  const assetNames = fs.readdirSync(path.join(rendererRoot, "assets"));
  if (!assetNames.some((name) => name.startsWith("local-ai.worker-") && name.endsWith(".js"))) {
    throw new Error("Packaged local AI worker bundle is missing.");
  }
  if (!assetNames.some((name) => name.startsWith("ort-wasm-") && name.endsWith(".wasm"))) {
    throw new Error("Packaged ONNX Runtime WASM fallback is missing.");
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const asarPath = path.join(projectRoot, "dist", "win-unpacked", "resources", "app.asar");
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Packaged app archive was not found: ${asarPath}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-image-studio-package-"));
  try {
    const packageRoot = path.join(tempRoot, "app");
    extractAll(asarPath, packageRoot);

    const requiredRuntimeFiles = [
      path.join(packageRoot, "dist-electron", "main.js"),
      path.join(packageRoot, "dist-renderer", "index.html"),
      path.join(packageRoot, "node_modules", "archiver-utils", "index.js"),
      path.join(packageRoot, "node_modules", "zip-stream", "index.js"),
    ];
    for (const filePath of requiredRuntimeFiles) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required packaged runtime file is missing: ${filePath}`);
      }
    }

    verifyRendererAssets(packageRoot);
    await verifyArchiveModule(packageRoot, tempRoot);
    console.log("Packaged runtime verification passed: renderer, local AI Worker, ONNX WASM and ZIP runtime are complete.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
