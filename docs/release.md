# 编译与发版说明

本文档记录研知科研助手的本地编译、预编译产物生成和 GitHub Release 自动发布流程。

## 1. 发布目标

当前发版目标是生成可直接下载使用的多端原生安装/运行包，并确保包内包含本地 OCR 所需的 PaddleOCR.js runtime、ORT wasm 和 PP-OCRv5 模型。

发布产物包含：

- macOS arm64 / x64：DMG
- Windows x64：Squirrel Windows installer EXE
- Linux x64：DEB 与 RPM
- `@paddleocr/paddleocr-js` browser bundle
- `ort-wasm-simd-threaded.jsep.wasm`
- `PP-OCRv5_mobile_det_onnx.tar`
- `PP-OCRv5_mobile_rec_onnx.tar`

为保证 GitHub Actions 发版稳定性，PP-OCRv5 的两个模型 tar 文件作为 release-critical artifacts 纳入版本控制；PaddleOCR.js bundle 和 ORT wasm 仍在 CI 中由 npm 依赖生成。

## 2. 本地编译

### 环境要求

- Node.js 22
- npm 10+
- macOS arm64 / x64、Windows x64 或 Linux x64；本地完整验证建议优先使用 macOS arm64。

### 安装依赖

```bash
npm ci
```

### 生成 PaddleOCR.js 浏览器推理资产

```bash
npm run build:paddleocr-js
```

该命令会把 PaddleOCR.js SDK 和 ONNX Runtime Web 相关文件预编译到：

```text
src/screenshot/vendor/paddleocr-js
```

核心文件包括：

- `paddleocr-js.bundle.js`
- `ort.bundle.min.mjs`
- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`
- `worker-entry-*.js`

### 下载本地 OCR 模型

```bash
npm run download:paddleocr-js-models
```

该命令会缓存官方 PP-OCRv5 模型到：

```text
src/screenshot/vendor/paddleocr-js-models
```

核心模型包括：

- `PP-OCRv5_mobile_det_onnx.tar`
- `PP-OCRv5_mobile_rec_onnx.tar`

### 验证本地 OCR

```bash
npm run test:paddleocr-js
```

验证通过时会输出：

- `ok: true`
- OCR 识别文本
- 逐行置信度
- 检测/识别/总耗时
- 实际运行后端，例如 `wasm`

## 3. 本地生成预编译包

```bash
node node_modules/@electron-forge/cli/dist/electron-forge.js make --platform darwin --arch arm64
```

macOS 生成的 DMG 通常位于：

```text
out/make/dmg/darwin/arm64/*.dmg
```

如果本地使用 `npm run make` 遇到 `node_modules/.bin/electron-forge` 权限问题，可以直接使用上面的 Node 入口。

## 4. 自动发版

仓库使用 GitHub Actions 自动发版。workflow 文件：

```text
.github/workflows/release.yml
```

触发方式：

- push 任意 `v*` tag，例如 `v1.0.4`
- 在 GitHub Actions 页面手动运行 Release workflow，并输入 tag

自动发版会执行：

1. checkout 对应 tag
2. 安装依赖
3. 生成 PaddleOCR.js browser assets
4. 恢复或写入 PP-OCRv5 模型缓存
5. 校验 PaddleOCR.js bundle、ORT wasm 和 PP-OCRv5 模型文件
6. 并行打 macOS arm64、macOS x64、Windows x64、Linux x64 原生产物
7. 创建或更新 GitHub Release
8. 上传 `.dmg`、`.exe`、`.deb`、`.rpm` 产物

模型 tar 已随仓库 checkout；模型下载脚本仍会做文件大小校验。如果模型文件不存在，脚本会强制使用 IPv4 并带重试、超时逻辑从官方源下载。GitHub Actions 同时缓存 `src/screenshot/vendor/paddleocr-js-models`，用于降低外部模型源网络波动对发版的影响。

完整端到端 OCR 验证依赖 Electron 图形运行环境，建议在本地 macOS 发版前执行：

```bash
npm run test:paddleocr-js
```

## 5. 标准发版步骤

### 更新版本号

更新：

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

同步 lockfile：

```bash
npm install --package-lock-only
```

### 提交发版说明

```bash
git add package.json package-lock.json CHANGELOG.md docs/release.md README.md .github/workflows/release.yml
git commit -m "chore: prepare v1.0.4 release"
git push origin master
```

### 创建并推送 tag

```bash
git tag -a v1.0.4 -m "Release v1.0.4"
git push origin v1.0.4
```

tag 推送后，GitHub Actions 会自动创建 Release 并上传预编译包。

## 6. 发布核查清单

- GitHub Actions 的 Release workflow 成功完成
- Release 页面存在对应 tag
- Release assets 中存在 macOS arm64/x64 DMG、Windows x64 EXE、Linux x64 DEB/RPM
- Release 文件名包含正确平台、架构和版本号
- Release notes 包含主要功能、OCR runtime、验证命令和限制说明
- 本地运行时文件不应进入提交，例如 `data/workspaces/index.json`

## 7. 当前限制

- 当前包未做 Apple notarization。
- OCR 识别完全本地运行；AI 解读仍需要用户配置 AI API Key。
