const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

const projectRoot = path.join(__dirname, '..');
const sdkEntry = path.join(projectRoot, 'node_modules', '@paddleocr', 'paddleocr-js', 'dist', 'index.mjs');
const outputDir = path.join(projectRoot, 'src', 'screenshot', 'vendor', 'paddleocr-js');
const assetPublicPath = 'ppocrjs://local/assets/';
const ortDistDir = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist');
const ortSidecars = [
    'ort-wasm-simd-threaded.jsep.mjs'
];

const config = {
    mode: 'production',
    target: 'web',
    entry: sdkEntry,
    output: {
        path: outputDir,
        filename: 'paddleocr-js.bundle.js',
        chunkFilename: '[name].js',
        assetModuleFilename: '[name][ext]',
        library: {
            name: 'PaddleOCRBundle',
            type: 'window'
        },
        publicPath: assetPublicPath,
        clean: true
    },
    experiments: {
        asyncWebAssembly: true
    },
    module: {
        parser: {
            javascript: {
                dynamicImportMode: 'eager'
            }
        }
    },
    resolve: {
        fallback: {
            crypto: false,
            fs: false,
            path: false
        }
    },
    devtool: false,
    optimization: {
        minimize: false
    },
    performance: {
        hints: false
    }
};

webpack(config, (error, stats) => {
    if (error) {
        console.error(error.stack || error);
        process.exit(1);
    }

    const info = stats.toJson({
        all: false,
        assets: true,
        errors: true,
        warnings: true
    });

    if (info.warnings && info.warnings.length > 0) {
        for (const warning of info.warnings) {
            console.warn(warning.message || warning);
        }
    }

    if (info.errors && info.errors.length > 0) {
        for (const buildError of info.errors) {
            console.error(buildError.message || buildError);
        }
        process.exit(1);
    }

    for (const fileName of ortSidecars) {
        const source = path.join(ortDistDir, fileName);
        const destination = path.join(outputDir, fileName);
        fs.copyFileSync(source, destination);
    }

    for (const asset of info.assets || []) {
        if (!asset.name || typeof asset.size !== 'number') {
            continue;
        }
        console.log(`${asset.name} ${(asset.size / 1024 / 1024).toFixed(2)} MiB`);
    }
    for (const fileName of ortSidecars) {
        const size = fs.statSync(path.join(outputDir, fileName)).size;
        console.log(`${fileName} ${(size / 1024 / 1024).toFixed(2)} MiB`);
    }
});
