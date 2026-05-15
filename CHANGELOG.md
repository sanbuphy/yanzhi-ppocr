# Changelog

## v1.0.5 - 2026-05-14

### Release Type

Patch release for Linux DEB/RPM binary name resolution.

### Highlights

- Set Electron Packager `executableName` to `yanzhi-research-assistant`.
- Fixes Linux makers looking for the ASCII package binary inside the packaged app directory.

## v1.0.4 - 2026-05-14

### Release Type

Patch release for Linux native package generation.

### Highlights

- Added a real application PNG icon for Electron Forge packager and Linux DEB/RPM makers.
- Added Linux desktop categories for package metadata.

## v1.0.3 - 2026-05-14

### Release Type

Patch release for multi-platform native installer packaging.

### Highlights

- Added Linux DEB/RPM maker metadata required by Electron Forge.
- Keeps release outputs as native installers: DMG, EXE, DEB, and RPM.

## v1.0.2 - 2026-05-14

### Release Type

Multi-platform native installer release for the local PaddleOCR.js OCR workflow.

### Highlights

- Expanded GitHub Actions release builds from macOS arm64 only to macOS arm64, macOS x64, Windows x64, and Linux x64.
- Switched release assets from packaged app zip archives to native installer artifacts where Forge supports them.
- Added macOS DMG generation through Electron Forge.
- Normalized release asset names to ASCII names for stable downloads across GitHub Actions and browsers.

### Release Assets

- macOS arm64: `.dmg`
- macOS x64: `.dmg`
- Windows x64: `.exe`
- Linux x64: `.deb` and `.rpm`

## v1.0.1 - 2026-05-14

### Release Type

Production release for the local PaddleOCR.js OCR workflow and automated GitHub Release packaging.

### Highlights

- Added automatic Release publishing on `v*` tag pushes through GitHub Actions.
- Added macOS arm64 precompiled release package generation.
- Included local PaddleOCR.js browser inference assets in the release build.
- Included PP-OCRv5 mobile detection and recognition model cache in the packaged app.
- Verified required OCR runtime assets in CI before packaging.
- Hardened CI model download with IPv4 requests, retry handling, size validation, and GitHub Actions cache.
- Versioned the PP-OCRv5 model tar files required by CI release packaging to avoid external model-source outages during release builds.

### OCR Runtime

- OCR SDK: `@paddleocr/paddleocr-js@0.3.2`
- OCR model family: `PP-OCRv5`
- Detection model: `PP-OCRv5_mobile_det`
- Recognition model: `PP-OCRv5_mobile_rec`
- Default language: `ch`
- Runtime backend: `auto`; release verification uses `wasm`
- Model execution: local Electron BrowserWindow with a `ppocrjs://local` protocol

### User-Facing Changes

- Screenshot editor provides independent `OCR识别` and `AI解读` actions.
- OCR result panel displays model provider, model names, runtime backend, elapsed time, detected boxes, and recognized lines.
- OCR result panel supports copying recognized content.
- OCR result panel supports sending recognized text directly into the main AI input box.

### Build Verification

The release workflow runs the following checks before creating a GitHub Release asset:

- `npm ci`
- `npm run build:paddleocr-js`
- `npm run download:paddleocr-js-models`
- Validate PaddleOCR.js bundle, ORT wasm, and PP-OCRv5 model files
- `electron-forge make --platform darwin --arch arm64`

### Release Asset

- Platform: macOS arm64
- Format: Electron Forge zip
- Expected artifact name: `研知科研助手-darwin-arm64-1.0.1.zip`

### Notes

- The app is not notarized in this release. macOS may require opening it through Finder security confirmation on first launch.
- The OCR pipeline is local and does not call cloud OCR services. AI interpretation still depends on configured AI API credentials.

## v1.0.0 - 2026-05-14

Initial tagged release for the PaddleOCR.js local OCR integration. This tag was created before the release workflow was added, so use `v1.0.1` or later for automatically generated GitHub Release assets.
