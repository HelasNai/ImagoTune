# ImagoTune

**English** | [简体中文](README.md)

> This English edition is translated from the Chinese README. The Chinese version is authoritative and may be updated first.

A Windows desktop AI image creation workbench: connect to any OpenAI-compatible service for text-to-image, image editing, and intelligent outpaint, plus a built-in toolbox for fully local upscaling, background removal, and face restore.

Current version **v2.0.0-beta.1** · [Changelog](CHANGELOG.md) · [Download](https://github.com/HelasNai/ImagoTune/releases/latest)

## Key features

- **Text-to-image and image-to-image**: common aspect ratios, 1K / 2K / 4K quality tiers, and safe custom sizes.
- **Prompt tools**: positive and negative prompts, templates, a local prompt assistant, optional online AI enhancement, and reverse prompt (Chinese and English prompts that you can copy, replace, or append to the composer).
- **Image editing and intelligent outpaint**: a visual mask brush, up to 3 reference images, four-way expansion with a target resolution, and common landscape/portrait conversions.
- **Multi-provider management**: save multiple OpenAI-compatible platforms at once and assign models to three roles (image generation / reverse prompt / prompt enhance); 12 built-in platform presets (Tencent Hunyuan, Zhipu AI, Volcano Ark, Alibaba Cloud Bailian, SiliconFlow, xAI, OpenRouter, plus five international-site presets). Providers still referenced by a queued task cannot be deleted.
- **Persistent task queue**: only one request is sent at a time; failed tasks are retried manually by the user to avoid duplicate billing; the provider and model used are recorded when a task is queued, so when the original provider is unavailable the task fails explicitly instead of switching automatically.
- **Project gallery**: projects and inbox, favorites, tags, search, lazy-loaded thumbnails, batch move / delete, ZIP export, and comparison of up to 4 images; copy images / prompts / full parameters and export a social-platform canvas.
- **Layout editing**: the Create, Edit image, and Outpaint pages support custom module position, size, and hiding, along with layout share codes, undo / redo, and drag-to-push reflow.
- **Updates and interface**: stable / beta dual update channels with an auto-update toggle; a bilingual Chinese/English interface with instant switching; the installer supports Simplified Chinese and English.
- Global tooltips; unified progress feedback for generation, enhancement, reverse prompt, export, queue, and local AI; the sidebar project tree expands to preview recent images, the top-bar queue chip shows running progress, and history can be cleared in one click.

## Installation

Regular users don't need Node.js; download the Windows installer from GitHub Releases:

**https://github.com/HelasNai/ImagoTune/releases/latest**

- The installer lets you choose the install directory and creates desktop and Start menu shortcuts.
- Upgrading from v1.x: settings, API keys, gallery, templates, queue, save directory, and update preferences migrate automatically; the new installer automatically detects, uninstalls, and takes over an older installation (v1.0-v1.5.1, formerly named AI Image Studio) while keeping user data. Queued tasks left over from the old version must be retried manually (intentional, to avoid duplicate billing).
- The installer is not code-signed, so Windows SmartScreen may show a warning; verify the release repository and file names before continuing.

## Quick start

On first launch, go to "Settings" to add a platform: either pick a platform preset directly (just paste the key) or set a custom name and API Base URL (for example, `https://api.example.com/v1`).

After saving, first annotate on the provider which models can serve image generation, reverse prompt, and prompt enhance in "Model role configuration" (use "Refresh models" to pull the platform's model list, or add a custom model manually), then assign a provider and model to each of the three roles in "Model assignment". You can add multiple providers and let different roles use different platforms; the composer footer offers a quick switch for the current image-generation model.

The app supports OpenAI-compatible endpoints that match the current call format:

| Purpose | Endpoint |
| --- | --- |
| Text-to-image | `POST /images/generations` |
| Image editing and outpaint | `POST /images/edits` |
| Prompt enhance, reverse prompt | `POST /chat/completions` |
| Test connection | `GET /models` |

"Test connection" uses `/models`; even if a platform can generate images but doesn't implement that endpoint, the connection test may still fail. Providers vary in their support for `quality`, sizes, streaming responses, image editing, and multimodal messages, so rely on the platform's documentation and actual responses.

On first launch you're also asked whether to start the 2-3 minute tutorial (explanations only; it doesn't touch your data or spend any API quota), and you can reopen it anytime from "About & help" on the Settings page.

## Local toolbox

Upscaling, background removal, and face restore run entirely on this machine; they don't read API keys and never upload the images being processed to any service.

| Tool | Purpose | Output and limits |
| --- | --- | --- |
| Upscale | Restore texture and edges for generated images, illustrations, and product shots | Native 2×/4× PNG; longest edge 8192 px, total pixels up to 70 million |
| Background removal | Remove the background for people, products, and visual assets | Transparent PNG; keeps the original RGB and only replaces alpha, with adjustable 0-8 px feathering |
| Face restore Beta | Fix blurry or slightly distorted faces | Up to 10 faces; profiles, occlusions, or very small faces may stop processing |
| One-click enhance | Face restore → 2× upscale → background removal | Saves only the final result; stops if any step fails |

Inference prefers WebGPU and automatically falls back to WASM/CPU when it's unavailable or out of video memory; "instant output" is only a target for small images on WebGPU-capable devices and doesn't guarantee the same performance on every device and resolution. Models are downloaded on demand the first time and verified with SHA-256; once installed, inference works offline. Local results are archived as new images; the original is never overwritten.

Model sources and licenses:

- [Real-ESRGAN ONNX](https://huggingface.co/SceneWorks/real-esrgan-onnx): BSD-3-Clause, pinned 2×/4× ONNX files and checksums.
- [ISNet General Use (rembg distribution)](https://github.com/danielgatis/rembg): rembg is MIT; the model source and usage restrictions follow the corresponding release notes.
- [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet): MIT.
- [GFPGAN](https://github.com/TencentARC/GFPGAN): upstream is Apache-2.0; the app uses a third-party ONNX conversion, so this feature is marked Beta and shows the exact source on the model manager page.

Model downloads require a network connection and may use hundreds of MB of disk space. The app doesn't include CodeFormer.

## Data and privacy

- **API keys**: written by the Electron main process to the Windows Credential Manager, never to source code, project files, or the renderer, and the interface never displays saved keys. Metadata such as provider names, addresses, and model annotations is stored locally in `userData/model-config.json` (without keys).
- **Local data**: images, projects, templates, queue, thumbnails, and indexes are all stored on this machine; only when you actively run generation, editing, online prompt enhancement, or reverse prompt is the relevant content sent to the currently configured service.
- **Gallery location**: the "Gallery" subdirectory under the manual save directory (the legacy directory is kept while it exists; a new install uses the system "Pictures" folder\ImagoTune), containing original PNGs, a versioned `index.json`, a `.thumbs` thumbnail cache, and recipe metadata; upgrading never moves or re-encodes old images.
- **Model location**: by default `userData/models` under Electron, separate from the install directory and the gallery; the model manager page lets you change the location, open the folder, and restore the default.

## Development and build

Requires Windows 10 or later and Node.js 22.12+. For WebGPU inference, a recent GPU and driver that support DirectX 12 are recommended; when they aren't available, WASM/CPU is used automatically.

```powershell
npm.cmd install
npm.cmd run dev
```

Full checks and the Windows installer build:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run package:win
```

The production installer pins the exact dependency tree in `package-lock.json`, so use `npm.cmd ci` for the first install. Frontend dependencies such as React and ONNX Runtime Web are bundled into the renderer output by Vite; the installer contains only the Electron runtime, the app build output, and the minimal runtime dependencies the main process needs. Source code, tests, and development tools don't go into the installer.

Project structure:

```text
electron/    Electron main process, IPC, gallery, queue, error classification, and PNG metadata
src/         React creation UI, gallery, mask brush, outpaint, and prompt tools
tests/       Vitest pure-logic tests
tools/       Packaging hooks, asar integrity check, and CDP acceptance scripts
```

For the release and auto-update process (Beta channel, Release asset list), see [docs/guides/release.md](docs/guides/release.md).

## License

Copyright (C) 2026 HelasNai. ImagoTune is released under the [GNU Affero General Public License v3.0 only](LICENSE) (SPDX: `AGPL-3.0-only`): you may run, study, modify, and sell distributions of this project; when you distribute the original or a modified version (including by providing a service to users over a network), you must retain the license and copyright notices under AGPL-3.0 and provide the corresponding source code to recipients. Third-party dependencies, models, and assets remain under their respective licenses. The complete terms are governed by [LICENSE](LICENSE).
