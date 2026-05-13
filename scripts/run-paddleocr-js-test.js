const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const { PaddleOcrJsClient, registerPaddleOcrProtocolScheme } = require('../src/screenshot/PaddleOcrJsClient');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
registerPaddleOcrProtocolScheme();

const TEST_DIR = path.join(__dirname, '..', 'temp', 'paddleocr-js-test');
const TEST_IMAGE = path.join(TEST_DIR, 'ppocr-test.png');

function log(stage, extra = {}) {
    console.log(`[paddleocr-js-test] ${stage} ${JSON.stringify(extra)}`);
}

function ensureTestImage() {
    log('ensure-test-image-start', { path: TEST_IMAGE });
    if (!fs.existsSync(TEST_IMAGE)) {
        throw new Error(`缺少测试图片，请先准备: ${TEST_IMAGE}`);
    }
    log('ensure-test-image-finished', {
        path: TEST_IMAGE,
        bytes: fs.statSync(TEST_IMAGE).size
    });
}

async function runTest() {
    log('app-ready', {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: process.platform,
        arch: process.arch
    });
    ensureTestImage();
    const client = new PaddleOcrJsClient({
        backend: process.env.PADDLEOCR_BACKEND || 'wasm',
        timeoutMs: Number(process.env.PADDLEOCR_TEST_TIMEOUT_MS || 180000),
        debug: true,
        logger: (stage, payload) => log(`client:${stage}`, payload)
    });

    try {
        log('recognize-start', { image: TEST_IMAGE });
        return await client.recognize(TEST_IMAGE, {
            timeoutMs: Number(process.env.PADDLEOCR_TEST_TIMEOUT_MS || 180000)
        });
    } finally {
        client.dispose();
        log('client-disposed');
    }
}

app.whenReady()
    .then(runTest)
    .then((payload) => {
        const lines = payload.debug && Array.isArray(payload.debug.lines) ? payload.debug.lines : [];
        log('recognize-finished', { lineCount: lines.length });
        console.log(JSON.stringify({
            ok: true,
            markdown: payload.markdown,
            texts: lines.map((line) => line.text),
            scores: lines.map((line) => line.score),
            metrics: payload.debug ? payload.debug.metrics : null,
            runtime: payload.debug ? payload.debug.runtime : null
        }, null, 2));
        app.quit();
    })
    .catch((error) => {
        log('failed', { error: error && error.stack ? error.stack : String(error) });
        console.error(error && error.stack ? error.stack : String(error));
        app.exit(1);
    });
