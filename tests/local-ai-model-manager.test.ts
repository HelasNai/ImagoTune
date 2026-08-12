import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAIModelManager, sha256File } from "../electron/local-ai-model-manager";
import { LocalAIModelManifest } from "../electron/local-ai-models";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("local AI model integrity", () => {
  it("calculates the expected SHA-256 for downloaded model bytes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-studio-model-test-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "model.onnx.part");
    await fs.writeFile(file, "local-model-test");
    expect(await sha256File(file)).toBe("b96821baaaa90758adbd49e86acab3a39c3438b447fd2e8b822d463cddc9b2e6");
    await fs.appendFile(file, "corrupted");
    expect(await sha256File(file)).not.toBe("b96821baaaa90758adbd49e86acab3a39c3438b447fd2e8b822d463cddc9b2e6");
  });

  it("pauses, resumes with Range, verifies and atomically installs a model", async () => {
    const bytes = Buffer.alloc(512 * 1024, 73);
    const ranges: string[] = [];
    const server = http.createServer((request, response) => {
      const range = String(request.headers.range || "");
      ranges.push(range);
      const start = range ? Number(range.match(/bytes=(\d+)-/)?.[1] || 0) : 0;
      response.writeHead(start ? 206 : 200, {
        "Accept-Ranges": "bytes",
        "Content-Length": bytes.length - start,
        ...(start ? { "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}),
      });
      let offset = start;
      const timer = setInterval(() => {
        if (offset >= bytes.length) { clearInterval(timer); response.end(); return; }
        response.write(bytes.subarray(offset, Math.min(bytes.length, offset + 32 * 1024)));
        offset += 32 * 1024;
      }, 8);
      response.on("close", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器启动失败");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-studio-model-resume-"));
    temporaryDirectories.push(directory);
    const manifest: LocalAIModelManifest = {
      id: "realesrgan-x2",
      name: "Tiny test model",
      fileName: "tiny.onnx",
      version: "test-1",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      urls: [`http://127.0.0.1:${address.port}/tiny.onnx`],
      license: "Test",
      sourceUrl: "https://example.invalid",
      purpose: "upscale",
      input: "test",
    };
    let paused = false;
    const manager = new LocalAIModelManager(directory, (progress) => {
      if (!paused && progress.state === "downloading" && progress.downloaded > 0) {
        paused = true;
        manager.pause("realesrgan-x2");
      }
    }, [manifest]);
    try {
      const partial = await manager.download("realesrgan-x2");
      expect(partial.state).toBe("partial");
      expect(partial.downloaded).toBeGreaterThan(0);
      const installed = await manager.download("realesrgan-x2");
      expect(installed.installed).toBe(true);
      expect(ranges.some((value) => /^bytes=\d+-$/.test(value))).toBe(true);
      expect(await fs.readFile(manager.modelPath("realesrgan-x2"))).toEqual(bytes);
      expect(await fs.stat(manager.verifiedPath("realesrgan-x2"))).toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);

  it("rejects a corrupt completed file and downloads a verified replacement", async () => {
    const bytes = Buffer.from("verified model payload");
    const server = http.createServer((_request, response) => { response.end(bytes); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器启动失败");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-studio-model-corrupt-"));
    temporaryDirectories.push(directory);
    const manifest: LocalAIModelManifest = {
      id: "realesrgan-x2", name: "Tiny test model", fileName: "tiny.onnx", version: "test-1",
      size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      urls: [`http://127.0.0.1:${address.port}/tiny.onnx`], license: "Test",
      sourceUrl: "https://example.invalid", purpose: "upscale", input: "test",
    };
    const manager = new LocalAIModelManager(directory, () => undefined, [manifest]);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(manager.modelPath("realesrgan-x2"), "corrupt");
    try {
      const installed = await manager.download("realesrgan-x2");
      expect(installed.installed).toBe(true);
      expect(await fs.readFile(manager.modelPath("realesrgan-x2"))).toEqual(bytes);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
