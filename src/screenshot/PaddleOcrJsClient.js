const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 60000;
const OCR_REQUEST_CHANNEL = 'paddleocr-js:recognize';
const OCR_READY_CHANNEL = 'paddleocr-js:ready';
const OCR_LOG_CHANNEL = 'paddleocr-js:log';
const OCR_PROTOCOL = 'ppocrjs';
const OCR_PROTOCOL_HOST = 'local';
const OCR_PROTOCOL_ORIGIN = `${OCR_PROTOCOL}://${OCR_PROTOCOL_HOST}`;
const DEFAULT_DET_MODEL_NAME = 'PP-OCRv5_mobile_det';
const DEFAULT_REC_MODEL_NAME = 'PP-OCRv5_mobile_rec';

function registerPaddleOcrProtocolScheme() {
    if (app.isReady()) {
        return;
    }
    try {
        protocol.registerSchemesAsPrivileged([{
            scheme: OCR_PROTOCOL,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true
            }
        }]);
    } catch (error) {
        // Electron only allows privileged scheme registration once and before app ready.
    }
}

try {
    if (!app.isReady()) {
        registerPaddleOcrProtocolScheme();
    }
} catch (error) {
}

let protocolHandlerInstalled = false;
let protocolResourceConfig = null;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm'
};

function createProtocolTextResponse(text, status = 200, contentType = 'text/plain; charset=utf-8') {
    return new Response(Buffer.from(String(text), 'utf8'), {
        status,
        headers: {
            'content-type': contentType,
            'access-control-allow-origin': '*',
            'cache-control': 'no-store'
        }
    });
}

function createProtocolFileResponse(filePath) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return createProtocolTextResponse('Not found', 404);
    }

    const ext = path.extname(filePath).toLowerCase();
    return new Response(fs.readFileSync(filePath), {
        status: 200,
        headers: {
            'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store'
        }
    });
}

function resolveInside(rootDir, relativePath) {
    const normalizedRoot = path.resolve(rootDir);
    const resolvedPath = path.resolve(normalizedRoot, decodeURIComponent(relativePath).replace(/^\/+/, ''));
    if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(normalizedRoot + path.sep)) {
        return null;
    }
    return resolvedPath;
}

function serveProtocolRequest(request) {
    try {
        const requestUrl = new URL(request.url);
        if (protocolResourceConfig && protocolResourceConfig.log) {
            protocolResourceConfig.log('protocol-request', { url: request.url, pathname: requestUrl.pathname });
        }
        if (requestUrl.hostname !== OCR_PROTOCOL_HOST || !protocolResourceConfig) {
            return createProtocolTextResponse('Not found', 404);
        }

        if (requestUrl.pathname === '/worker.html') {
            return createProtocolTextResponse(protocolResourceConfig.workerHtml, 200, 'text/html; charset=utf-8');
        }

        if (requestUrl.pathname.startsWith('/assets/')) {
            const resolvedPath = resolveInside(protocolResourceConfig.bundleDir, requestUrl.pathname.slice('/assets/'.length));
            if (!resolvedPath) {
                return createProtocolTextResponse('Forbidden', 403);
            }
            return createProtocolFileResponse(resolvedPath);
        }

        if (requestUrl.pathname.startsWith('/models/')) {
            const resolvedPath = resolveInside(protocolResourceConfig.modelDir, requestUrl.pathname.slice('/models/'.length));
            if (!resolvedPath) {
                return createProtocolTextResponse('Forbidden', 403);
            }
            return createProtocolFileResponse(resolvedPath);
        }

        return createProtocolTextResponse('Not found', 404);
    } catch (error) {
        if (protocolResourceConfig && protocolResourceConfig.log) {
            protocolResourceConfig.log('protocol-error', {
                url: request && request.url,
                error: error && error.stack ? error.stack : String(error)
            });
        }
        return createProtocolTextResponse(error && error.message ? error.message : String(error), 500);
    }
}

class PaddleOcrJsClient {
    constructor(options = {}) {
        this.lang = options.lang || process.env.PADDLEOCR_LANG || 'ch';
        this.ocrVersion = options.ocrVersion || process.env.PADDLEOCR_VERSION || 'PP-OCRv5';
        this.backend = options.backend || process.env.PADDLEOCR_BACKEND || 'auto';
        this.timeoutMs = Number(options.timeoutMs || process.env.PADDLEOCR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
        this.bundleDir = options.bundleDir || path.join(__dirname, 'vendor', 'paddleocr-js');
        this.modelDir = options.modelDir || process.env.PADDLEOCR_MODEL_DIR || path.join(__dirname, 'vendor', 'paddleocr-js-models');
        this.textDetectionModelName = options.textDetectionModelName || process.env.PADDLEOCR_DET_MODEL_NAME || DEFAULT_DET_MODEL_NAME;
        this.textRecognitionModelName = options.textRecognitionModelName || process.env.PADDLEOCR_REC_MODEL_NAME || DEFAULT_REC_MODEL_NAME;
        this.textDetectionModelFile = options.textDetectionModelFile || process.env.PADDLEOCR_DET_MODEL_FILE || `${this.textDetectionModelName}_onnx.tar`;
        this.textRecognitionModelFile = options.textRecognitionModelFile || process.env.PADDLEOCR_REC_MODEL_FILE || `${this.textRecognitionModelName}_onnx.tar`;
        this.preloadPath = options.preloadPath || path.join(__dirname, 'paddle-ocr-preload.js');
        this.serverUrl = '';
        this.loadPromise = null;
        this.window = null;
        this.readyPromise = null;
        this.requestId = 0;
        this.debug = options.debug === true || process.env.PADDLEOCR_DEBUG === '1';
        this.logger = typeof options.logger === 'function' ? options.logger : null;
        this.logListener = null;
    }

    _log(stage, extra = {}) {
        if (!this.debug && !this.logger) {
            return;
        }
        const payload = {
            stage,
            ...extra
        };
        if (this.logger) {
            this.logger(stage, payload);
            return;
        }
        console.log(`[PaddleOCR.js] ${stage}`, payload);
    }

    _assertBundleExists() {
        const bundlePath = path.join(this.bundleDir, 'paddleocr-js.bundle.js');
        if (!fs.existsSync(bundlePath)) {
            throw new Error('缺少 PaddleOCR.js 浏览器 bundle，请先运行 npm run build:paddleocr-js');
        }
    }

    _modelAssetPaths() {
        return [
            {
                role: 'TextDetection',
                fileName: this.textDetectionModelFile,
                filePath: path.join(this.modelDir, this.textDetectionModelFile)
            },
            {
                role: 'TextRecognition',
                fileName: this.textRecognitionModelFile,
                filePath: path.join(this.modelDir, this.textRecognitionModelFile)
            }
        ];
    }

    _assertModelAssetsExist() {
        for (const asset of this._modelAssetPaths()) {
            if (!fs.existsSync(asset.filePath) || !fs.statSync(asset.filePath).isFile()) {
                throw new Error(`缺少 PaddleOCR.js ${asset.role} 本地模型: ${asset.filePath}。请先运行 npm run download:paddleocr-js-models`);
            }
        }
    }

    _loadBundleSource() {
        const bundlePath = path.join(this.bundleDir, 'paddleocr-js.bundle.js');
        return fs.readFileSync(bundlePath, 'utf8');
    }

    _buildWorkerHtml(serverUrl) {
        const assetBaseUrl = `${serverUrl}`;
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PaddleOCR.js Worker</title>
</head>
<body>
<script>
    window.__PADDLEOCR_ASSET_BASE_URL__ = ${JSON.stringify(assetBaseUrl)};
</script>
<script>
    const bridge = window.paddleOcrBridge;

    let ocrPromise = null;
    let ocrOptions = null;

    function log(stage, extra = {}) {
        if (bridge && typeof bridge.log === 'function') {
            bridge.log({
                stage,
                ...extra
            });
        }
    }

    function getPaddleOCR() {
        const sdk = window.PaddleOCRBundle || {};
        if (!sdk.PaddleOCR) {
            throw new Error('PaddleOCR.js SDK 加载失败');
        }
        return sdk.PaddleOCR;
    }

    async function loadPaddleOCR(options = {}) {
        const PaddleOCR = getPaddleOCR();
        const assetBaseUrl = options.assetBaseUrl || window.__PADDLEOCR_ASSET_BASE_URL__ || window.location.origin;
        const modelBaseUrl = options.modelBaseUrl || \`\${assetBaseUrl}/models\`;
        const textDetectionModelName = options.textDetectionModelName || 'PP-OCRv5_mobile_det';
        const textRecognitionModelName = options.textRecognitionModelName || 'PP-OCRv5_mobile_rec';
        const textDetectionModelUrl = buildAssetUrl(modelBaseUrl, options.textDetectionModelFile || \`\${textDetectionModelName}_onnx.tar\`);
        const textRecognitionModelUrl = buildAssetUrl(modelBaseUrl, options.textRecognitionModelFile || \`\${textRecognitionModelName}_onnx.tar\`);
        log('paddleocr-create-start', {
            lang: options.lang || 'ch',
            ocrVersion: options.ocrVersion || 'PP-OCRv5',
            backend: options.backend || 'auto',
            wasmPaths: \`\${assetBaseUrl}/assets/\`,
            textDetectionModelUrl,
            textRecognitionModelUrl
        });
        const ocr = await PaddleOCR.create({
            lang: options.lang || 'ch',
            ocrVersion: options.ocrVersion || 'PP-OCRv5',
            textDetectionModelName,
            textDetectionModelAsset: {
                url: textDetectionModelUrl
            },
            textRecognitionModelName,
            textRecognitionModelAsset: {
                url: textRecognitionModelUrl
            },
            ortOptions: {
                backend: options.backend || 'auto',
                wasmPaths: \`\${assetBaseUrl}/assets/\`
            }
        });
        log('paddleocr-create-finished');
        return ocr;
    }

    async function getOcr(options = {}) {
        const signature = JSON.stringify({
            lang: options.lang || 'ch',
            ocrVersion: options.ocrVersion || 'PP-OCRv5',
            backend: options.backend || 'auto',
            assetBaseUrl: options.assetBaseUrl || window.__PADDLEOCR_ASSET_BASE_URL__ || window.location.origin
        });
        if (ocrOptions !== signature) {
            ocrOptions = signature;
            ocrPromise = null;
        }
        if (!ocrPromise) {
            ocrPromise = loadPaddleOCR(options);
        }
        return ocrPromise;
    }

    function bytesToBlob(bytes, mimeType) {
        const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return new Blob([view], { type: mimeType || 'image/png' });
    }

    function buildAssetUrl(baseUrl, fileName) {
        const encodedPath = String(fileName)
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        return \`\${String(baseUrl).replace(/\\/+$/, '')}/\${encodedPath}\`;
    }

    function sendError(channel, error) {
        bridge.sendReply(channel, {
            ok: false,
            error: error && error.stack ? error.stack : String(error)
        });
    }

    async function notifyReady() {
        try {
            log('page-ready', {
                href: window.location.href,
                origin: window.location.origin,
                assetBaseUrl: window.__PADDLEOCR_ASSET_BASE_URL__ || ''
            });
            getPaddleOCR();
            bridge.sendReady({ ok: true });
        } catch (error) {
            sendError('paddleocr-js:ready', error);
        }
    }

    bridge.onRecognize(async (payload) => {
        const replyChannel = payload && payload.replyChannel;
        try {
            log('recognize-received', {
                requestId: payload && payload.requestId,
                mimeType: payload && payload.mimeType,
                byteLength: payload && payload.bytes ? payload.bytes.length : null
            });
            const ocr = await getOcr(payload.options || {});
            const imageBlob = bytesToBlob(payload.bytes, payload.mimeType);
            log('predict-start', {
                requestId: payload && payload.requestId,
                blobSize: imageBlob.size,
                blobType: imageBlob.type
            });
            const [result] = await ocr.predict(imageBlob);
            log('predict-finished', {
                requestId: payload && payload.requestId,
                itemCount: result && Array.isArray(result.items) ? result.items.length : 0,
                metrics: result ? result.metrics : null,
                runtime: result ? result.runtime : null
            });
            bridge.sendReply(replyChannel, {
                ok: true,
                items: result && Array.isArray(result.items) ? result.items : [],
                metrics: result ? result.metrics : null,
                runtime: result ? result.runtime : null
            });
        } catch (error) {
            sendError(replyChannel, error);
        }
    });

    window.__PADDLEOCR_NOTIFY_READY__ = notifyReady;
    if (window.PaddleOCRBundle) {
        notifyReady();
    } else {
        log('waiting-for-injected-bundle');
    }
</script>
</body>
</html>`;
    }

    _detectImageMimeType(imagePath, imageBuffer) {
        const ext = path.extname(imagePath || '').toLowerCase();
        if (ext === '.png') return 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
        if (ext === '.webp') return 'image/webp';

        if (imageBuffer && imageBuffer.length >= 12) {
            if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4e && imageBuffer[3] === 0x47) {
                return 'image/png';
            }
            if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) {
                return 'image/jpeg';
            }
            const riff = imageBuffer.slice(0, 4).toString('ascii');
            const webp = imageBuffer.slice(8, 12).toString('ascii');
            if (riff === 'RIFF' && webp === 'WEBP') {
                return 'image/webp';
            }
        }

        return 'image/png';
    }

    _ensureProtocol() {
        this._assertBundleExists();
        this._assertModelAssetsExist();
        if (this.serverUrl) {
            return this.serverUrl;
        }

        const origin = OCR_PROTOCOL_ORIGIN;
        protocolResourceConfig = {
            bundleDir: this.bundleDir,
            modelDir: this.modelDir,
            workerHtml: this._buildWorkerHtml(origin),
            log: (stage, payload) => this._log(stage, payload)
        };

        if (!protocolHandlerInstalled) {
            protocol.handle(OCR_PROTOCOL, (request) => serveProtocolRequest(request));
            protocolHandlerInstalled = true;
        }

        this.serverUrl = origin;
        this._log('protocol-ready', { origin });
        return this.serverUrl;
    }

    _createWindow() {
        if (this.window && !this.window.isDestroyed()) {
            return this.window;
        }

        this.window = new BrowserWindow({
            show: false,
            width: 640,
            height: 480,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: this.preloadPath,
                sandbox: false
            }
        });

        this.window.webContents.on('did-start-loading', () => {
            this._log('webcontents-start-loading');
        });
        this.window.webContents.on('did-finish-load', () => {
            this._log('webcontents-finish-load', {
                url: this.window.webContents.getURL()
            });
        });
        this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            this._log('webcontents-fail-load', {
                errorCode,
                errorDescription,
                validatedURL,
                isMainFrame
            });
        });
        this.window.on('closed', () => {
            this.window = null;
            this.readyPromise = null;
            this.loadPromise = null;
        });

        this.window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            this._log('renderer-console', { level, message, line, sourceId });
        });
        this._ensureLogListener(this.window);
        this._log('window-created', {
            preloadPath: this.preloadPath,
            bundleDir: this.bundleDir
        });

        return this.window;
    }

    _ensureLogListener(workerWindow) {
        if (this.logListener) {
            return;
        }
        this.logListener = (event, payload) => {
            if (!workerWindow.webContents || event.sender !== workerWindow.webContents) {
                return;
            }
            this._log(payload && payload.stage ? payload.stage : 'renderer-log', payload || {});
        };
        ipcMain.on(OCR_LOG_CHANNEL, this.logListener);
    }

    async _loadWorkerWindow(workerWindow) {
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = Promise.resolve()
            .then(() => {
                this._ensureProtocol();
                const workerUrl = `${OCR_PROTOCOL_ORIGIN}/worker.html`;
                this._log('worker-load-start', {
                    workerUrl,
                    mode: 'protocol'
                });
                return workerWindow.loadURL(workerUrl);
            })
            .then(async () => {
                const bundleSource = this._loadBundleSource();
                this._log('worker-bundle-inject-start', {
                    bytes: Buffer.byteLength(bundleSource)
                });
                await workerWindow.webContents.executeJavaScript(bundleSource);
                this._log('worker-bundle-inject-finished');
                await workerWindow.webContents.executeJavaScript('window.__PADDLEOCR_NOTIFY_READY__ && window.__PADDLEOCR_NOTIFY_READY__();');
            })
            .then(() => {
                this._log('worker-load-finished');
            });
        return this.loadPromise;
    }

    async _ensureReady() {
        this._ensureProtocol();
        const workerWindow = this._createWindow();
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`PaddleOCR.js 初始化超时（${this.timeoutMs}ms）`));
            }, this.timeoutMs);

            const cleanup = () => {
                clearTimeout(timer);
                ipcMain.removeListener(OCR_READY_CHANNEL, onReady);
                if (!workerWindow.isDestroyed()) {
                    workerWindow.webContents.removeListener('render-process-gone', onGone);
                }
            };

            const onReady = (event, payload) => {
                if (!workerWindow.webContents || event.sender !== workerWindow.webContents) {
                    return;
                }
                cleanup();
                if (payload && payload.ok) {
                    this._log('worker-ready', payload);
                    resolve(payload);
                } else {
                    reject(new Error((payload && payload.error) || 'PaddleOCR.js 初始化失败'));
                }
            };

            const onGone = (_event, details) => {
                cleanup();
                this._log('render-process-gone', details || {});
                reject(new Error(`PaddleOCR.js 渲染进程退出：${details.reason || 'unknown'}`));
            };

            this._log('worker-ready-wait-start');
            ipcMain.on(OCR_READY_CHANNEL, onReady);
            workerWindow.webContents.once('render-process-gone', onGone);
            this._loadWorkerWindow(workerWindow).catch((error) => {
                cleanup();
                reject(error);
            });
        });

        return this.readyPromise;
    }

    async recognize(imagePath, { signal = null, timeoutMs = null } = {}) {
        if (!imagePath) {
            throw new Error('缺少图片路径');
        }
        if (!fs.existsSync(imagePath)) {
            throw new Error(`图片文件不存在: ${imagePath}`);
        }

        const workerWindow = this._createWindow();
        await this._ensureReady();

        const imageBuffer = fs.readFileSync(imagePath);
        const mimeType = this._detectImageMimeType(imagePath, imageBuffer);
        const requestId = ++this.requestId;
        const effectiveTimeoutMs = Number(timeoutMs || this.timeoutMs || DEFAULT_TIMEOUT_MS);
        this._log('recognize-request', {
            imagePath,
            mimeType,
            bytes: imageBuffer.length,
            requestId,
            timeoutMs: effectiveTimeoutMs
        });

        return new Promise((resolve, reject) => {
            let finished = false;
            const replyChannel = `${OCR_REQUEST_CHANNEL}:${requestId}`;

            const cleanup = () => {
                clearTimeout(timer);
                ipcMain.removeListener(replyChannel, onReply);
                if (signal) {
                    signal.removeEventListener('abort', onAbort);
                }
            };

            const done = (fn, value) => {
                if (finished) return;
                finished = true;
                cleanup();
                fn(value);
            };

            const onAbort = () => {
                const error = new Error('请求已取消');
                error.name = 'AbortError';
                done(reject, error);
            };

            const timer = setTimeout(() => {
                done(reject, new Error(`PaddleOCR.js 识别超时（${effectiveTimeoutMs}ms）`));
            }, effectiveTimeoutMs);

            const onReply = (event, payload) => {
                if (!workerWindow.webContents || event.sender !== workerWindow.webContents) {
                    return;
                }
                if (!payload || !payload.ok) {
                    this._log('recognize-error', { requestId, error: payload && payload.error });
                    done(reject, new Error((payload && payload.error) || 'PaddleOCR.js 识别失败'));
                    return;
                }

                const lines = Array.isArray(payload.items)
                    ? payload.items
                        .map((item) => ({
                            text: String(item.text || '').trim(),
                            score: typeof item.score === 'number' ? item.score : null,
                            poly: item.poly || null
                        }))
                        .filter((item) => item.text)
                    : [];
                const markdown = lines.map((item) => item.text).join('\n').trim();

                done(resolve, {
                    markdown,
                    debug: {
                        provider: 'paddleocr-js',
                        lang: this.lang,
                        ocrVersion: this.ocrVersion,
                        backend: this.backend,
                        rawOutput: markdown,
                        lines,
                        metrics: payload.metrics || null,
                        runtime: payload.runtime || null
                    }
                });
                this._log('recognize-success', {
                    requestId,
                    lineCount: lines.length,
                    metrics: payload.metrics || null,
                    runtime: payload.runtime || null
                });
            };

            if (signal) {
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }

            ipcMain.on(replyChannel, onReply);
            workerWindow.webContents.send(OCR_REQUEST_CHANNEL, {
                requestId,
                replyChannel,
                bytes: imageBuffer,
                mimeType,
                options: {
                    lang: this.lang,
                    ocrVersion: this.ocrVersion,
                    backend: this.backend,
                    assetBaseUrl: this.serverUrl,
                    modelBaseUrl: `${this.serverUrl}/models`,
                    textDetectionModelName: this.textDetectionModelName,
                    textDetectionModelFile: this.textDetectionModelFile,
                    textRecognitionModelName: this.textRecognitionModelName,
                    textRecognitionModelFile: this.textRecognitionModelFile
                }
            });
        });
    }

    dispose() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.destroy();
        }
        this.window = null;
        this.readyPromise = null;
        this.loadPromise = null;

        this.serverUrl = '';
        if (this.logListener) {
            ipcMain.removeListener(OCR_LOG_CHANNEL, this.logListener);
        }
        this.logListener = null;
    }
}

module.exports = {
    PaddleOcrJsClient,
    registerPaddleOcrProtocolScheme
};
