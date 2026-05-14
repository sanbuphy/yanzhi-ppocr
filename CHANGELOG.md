# Changelog

## v1.0.1 - 2026-05-14

### Release Type

Production release for the local PaddleOCR.js OCR workflow and automated GitHub Release packaging.

### Highlights

- Added automatic Release publishing on `v*` tag pushes through GitHub Actions.
- Added macOS arm64 precompiled release package generation.
- Included local PaddleOCR.js browser inference assets in the release build.
- Included PP-OCRv5 mobile detection and recognition model cache in the packaged app.
- Verified the local OCR path in CI before packaging.
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
- `npm run test:paddleocr-js`
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
