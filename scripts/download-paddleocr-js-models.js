const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const projectRoot = path.join(__dirname, '..');
const outputDir = process.env.PADDLEOCR_MODEL_DIR || path.join(projectRoot, 'src', 'screenshot', 'vendor', 'paddleocr-js-models');

const MODELS = [
    {
        name: process.env.PADDLEOCR_DET_MODEL_NAME || 'PP-OCRv5_mobile_det',
        fileName: process.env.PADDLEOCR_DET_MODEL_FILE || 'PP-OCRv5_mobile_det_onnx.tar',
        url: process.env.PADDLEOCR_DET_MODEL_URL || 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx.tar',
        minBytes: 4 * 1024 * 1024
    },
    {
        name: process.env.PADDLEOCR_REC_MODEL_NAME || 'PP-OCRv5_mobile_rec',
        fileName: process.env.PADDLEOCR_REC_MODEL_FILE || 'PP-OCRv5_mobile_rec_onnx.tar',
        url: process.env.PADDLEOCR_REC_MODEL_URL || 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx.tar',
        minBytes: 15 * 1024 * 1024
    }
];

const retries = Number(process.env.PADDLEOCR_DOWNLOAD_RETRIES || 4);
const timeoutMs = Number(process.env.PADDLEOCR_DOWNLOAD_TIMEOUT_MS || 180000);

function clientForUrl(url) {
    return url.startsWith('https:') ? https : http;
}

function requestOptions(url) {
    const parsedUrl = new URL(url);
    return {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        family: 4,
        headers: {
            'user-agent': 'yanzhi-paddleocr-js-model-cache/1.0'
        }
    };
}

function validateModelFile(filePath, model) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${model.name}: model file was not created: ${filePath}`);
    }
    const size = fs.statSync(filePath).size;
    if (size < model.minBytes) {
        throw new Error(`${model.name}: downloaded file is too small: ${size} bytes`);
    }
    return size;
}

function downloadFile(url, destination, redirectsRemaining = 5) {
    return new Promise((resolve, reject) => {
        const request = clientForUrl(url).get(requestOptions(url), (response) => {
            const statusCode = response.statusCode || 0;
            const redirect = response.headers.location;
            if (statusCode >= 300 && statusCode < 400 && redirect) {
                response.resume();
                if (redirectsRemaining <= 0) {
                    reject(new Error(`Too many redirects while downloading ${url}`));
                    return;
                }
                const nextUrl = new URL(redirect, url).toString();
                downloadFile(nextUrl, destination, redirectsRemaining - 1).then(resolve, reject);
                return;
            }

            if (statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download ${url}: HTTP ${statusCode}`));
                return;
            }

            const tempPath = `${destination}.download`;
            const file = fs.createWriteStream(tempPath);
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    try {
                        fs.renameSync(tempPath, destination);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            file.on('error', (error) => {
                file.close(() => {
                    try {
                        fs.unlinkSync(tempPath);
                    } catch (_) {
                    }
                    reject(error);
                });
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Timed out downloading ${url}`));
        });
        request.on('error', reject);
    });
}

async function downloadWithRetry(model, destination) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            console.log(`${model.name}: downloading ${model.url} (attempt ${attempt}/${retries})`);
            await downloadFile(model.url, destination);
            const size = validateModelFile(destination, model);
            console.log(`${model.name}: saved ${destination} ${(size / 1024 / 1024).toFixed(2)} MiB`);
            return;
        } catch (error) {
            lastError = error;
            try {
                fs.unlinkSync(destination);
            } catch (_) {
            }
            try {
                fs.unlinkSync(`${destination}.download`);
            } catch (_) {
            }
            console.warn(`${model.name}: download attempt ${attempt} failed: ${error && error.message ? error.message : String(error)}`);
            if (attempt < retries) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
            }
        }
    }
    throw lastError;
}

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });

    for (const model of MODELS) {
        const destination = path.join(outputDir, model.fileName);
        if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
            const size = validateModelFile(destination, model);
            console.log(`${model.name}: already cached ${destination} ${(size / 1024 / 1024).toFixed(2)} MiB`);
            continue;
        }

        await downloadWithRetry(model, destination);
    }
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});
