import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { LOCAL_AI_MODELS, LocalAIModelId, LocalAIModelManifest } from "./local-ai-models";

export type ModelDownloadState = "missing" | "partial" | "downloading" | "verifying" | "installed" | "error";
export type LocalAIModelStatus = {
  id: LocalAIModelId;
  name: string;
  version: string;
  size: number;
  downloaded: number;
  progress: number;
  state: ModelDownloadState;
  installed: boolean;
  license: string;
  sourceUrl: string;
  purpose: string;
  beta?: boolean;
  error?: string;
};
export type ModelProgress = LocalAIModelStatus & { message: string };

type ActiveDownload = { controller: AbortController; promise: Promise<LocalAIModelStatus> };
type ModelFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function sha256File(filePath: string) {
  const handle = await fs.open(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export class LocalAIModelManager {
  private readonly active = new Map<LocalAIModelId, ActiveDownload>();
  private readonly errors = new Map<LocalAIModelId, string>();

  constructor(
    readonly modelsDir: string,
    private readonly onProgress: (progress: ModelProgress) => void,
    private readonly models: readonly LocalAIModelManifest[] = LOCAL_AI_MODELS,
    private readonly fetcher: ModelFetcher = fetch,
  ) {}

  private model(id: LocalAIModelId) {
    return this.models.find((model) => model.id === id);
  }

  hasActiveDownloads() {
    return this.active.size > 0;
  }

  modelPath(id: LocalAIModelId) {
    const model = this.model(id);
    if (!model) throw new Error("未知的本地 AI 模型");
    return path.join(this.modelsDir, model.fileName);
  }

  partPath(id: LocalAIModelId) {
    return this.modelPath(id) + ".part";
  }

  verifiedPath(id: LocalAIModelId) {
    return this.modelPath(id) + ".verified.json";
  }

  private async isVerified(id: LocalAIModelId, fileSize: number) {
    if (!fileSize) return false;
    const model = this.model(id);
    const marker = await fs.readFile(this.verifiedPath(id), "utf8")
      .then((value) => JSON.parse(value) as { sha256?: string; version?: string; size?: number })
      .catch(() => null);
    return Boolean(model && marker?.sha256 === model.sha256 && marker.version === model.version && marker.size === fileSize);
  }

  private async writeVerifiedMarker(id: LocalAIModelId) {
    const model = this.model(id);
    if (!model) return;
    const size = await fs.stat(this.modelPath(id)).then((value) => value.size);
    await fs.writeFile(this.verifiedPath(id), JSON.stringify({
      modelId: id,
      version: model.version,
      sha256: model.sha256,
      size,
      verifiedAt: new Date().toISOString(),
    }, null, 2), "utf8");
  }

  async status(id: LocalAIModelId): Promise<LocalAIModelStatus> {
    const model = this.model(id);
    if (!model) throw new Error("未知的本地 AI 模型");
    const finalPath = this.modelPath(id);
    const partPath = this.partPath(id);
    const active = this.active.has(id);
    const finalSize = await fs.stat(finalPath).then((value) => value.size).catch(() => 0);
    const partSize = await fs.stat(partPath).then((value) => value.size).catch(() => 0);
    const installed = await this.isVerified(id, finalSize);
    const downloaded = installed ? finalSize : partSize;
    const state: ModelDownloadState = active ? "downloading" : installed ? "installed" : partSize ? "partial" : this.errors.has(id) ? "error" : "missing";
    return {
      id: model.id,
      name: model.name,
      version: model.version,
      size: model.size,
      downloaded,
      progress: model.size ? Math.min(100, Math.round(downloaded / model.size * 1000) / 10) : 0,
      state,
      installed,
      license: model.license,
      sourceUrl: model.sourceUrl,
      purpose: model.purpose,
      beta: model.beta,
      error: this.errors.get(id),
    };
  }

  async list() {
    await fs.mkdir(this.modelsDir, { recursive: true });
    return Promise.all(this.models.map((model) => this.status(model.id)));
  }

  private async emit(id: LocalAIModelId, message: string, state?: ModelDownloadState) {
    const status = await this.status(id);
    this.onProgress({ ...status, state: state || status.state, message });
  }

  async download(id: LocalAIModelId) {
    const existing = this.active.get(id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.runDownload(id, controller)
      .finally(() => this.active.delete(id))
      .then(() => this.status(id));
    this.active.set(id, { controller, promise });
    return promise;
  }

  pause(id: LocalAIModelId) {
    const active = this.active.get(id);
    if (!active) return false;
    active.controller.abort(new Error("下载已暂停"));
    return true;
  }

  async delete(id: LocalAIModelId) {
    this.pause(id);
    await Promise.all([
      fs.rm(this.modelPath(id), { force: true }),
      fs.rm(this.partPath(id), { force: true }),
      fs.rm(this.verifiedPath(id), { force: true }),
    ]);
    this.errors.delete(id);
  }

  private async runDownload(id: LocalAIModelId, controller: AbortController) {
    const model = this.model(id);
    if (!model) throw new Error("未知的本地 AI 模型");
    await fs.mkdir(this.modelsDir, { recursive: true });
    const finalPath = this.modelPath(id);
    const partPath = this.partPath(id);
    const finalStat = await fs.stat(finalPath).catch(() => null);
    if (finalStat?.size) {
      await this.emit(id, "正在校验已安装模型", "verifying");
      if (await sha256File(finalPath) === model.sha256) {
        await this.writeVerifiedMarker(id);
        return this.status(id);
      }
      await fs.rm(finalPath, { force: true });
      await fs.rm(this.verifiedPath(id), { force: true });
    }
    this.errors.delete(id);
    let lastError: Error | undefined;
    for (const url of model.urls) {
      try {
        await this.downloadFromUrl(model.id, url, partPath, controller.signal);
        await this.emit(id, "正在进行 SHA-256 完整性校验", "verifying");
        const digest = await sha256File(partPath);
        if (digest !== model.sha256) {
          await fs.rm(partPath, { force: true });
          throw new Error(`模型校验失败：期望 ${model.sha256.slice(0, 12)}，实际 ${digest.slice(0, 12)}`);
        }
        await fs.rm(finalPath, { force: true });
        await fs.rename(partPath, finalPath);
        await this.writeVerifiedMarker(id);
        await this.emit(id, "模型已安装，可离线使用", "installed");
        return this.status(id);
      } catch (error) {
        if (controller.signal.aborted) {
          await this.emit(id, "下载已暂停，可稍后继续", "partial");
          return this.status(id);
        }
        lastError = error as Error;
      }
    }
    const message = lastError?.message || "模型下载失败";
    this.errors.set(id, message);
    await this.emit(id, message, "error");
    throw lastError || new Error(message);
  }

  private async downloadFromUrl(id: LocalAIModelId, url: string, partPath: string, signal: AbortSignal) {
    let downloaded = await fs.stat(partPath).then((value) => value.size).catch(() => 0);
    const headers: HeadersInit = downloaded ? { Range: `bytes=${downloaded}-` } : {};
    const response = await this.fetcher(url, { headers, signal, redirect: "follow" });
    if (!response.ok) throw new Error(`下载服务器返回 HTTP ${response.status}`);
    if (!response.body) throw new Error("下载响应没有可读取的数据");
    if (downloaded && response.status !== 206) {
      await fs.rm(partPath, { force: true });
      downloaded = 0;
    }
    const handle = await fs.open(partPath, downloaded ? "a" : "w");
    const reader = response.body.getReader();
    let lastEmit = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) throw signal.reason;
        await handle.write(value);
        downloaded += value.byteLength;
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          await this.emit(id, "正在下载模型", "downloading");
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      await handle.close();
    }
  }
}
