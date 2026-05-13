/**
 * 截图选区窗口
 * 全屏半透明覆盖层，用户可绘制矩形选区
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

// Windows 平台使用 destroy() 避免触发 window-all-closed 事件
const FORCE_DESTROY_ON_CLOSE = process.platform === 'win32';

class ScreenshotWindow {
    constructor() {
        this.window = null;
        this.captureCallback = null;
        this.hasShown = false;
        this.log = (...args) => console.log('[ScreenshotWindow]', ...args);
    }

    /**
     * 创建截图选区窗口
     */
    create() {
        const displays = screen.getAllDisplays();
        const unionBounds = displays.reduce((bounds, display) => {
            const right = display.bounds.x + display.bounds.width;
            const bottom = display.bounds.y + display.bounds.height;
            return {
                x: Math.min(bounds.x, display.bounds.x),
                y: Math.min(bounds.y, display.bounds.y),
                right: Math.max(bounds.right, right),
                bottom: Math.max(bounds.bottom, bottom)
            };
        }, {
            x: displays[0].bounds.x,
            y: displays[0].bounds.y,
            right: displays[0].bounds.x + displays[0].bounds.width,
            bottom: displays[0].bounds.y + displays[0].bounds.height
        });

        const x = unionBounds.x;
        const y = unionBounds.y;
        const width = unionBounds.right - unionBounds.x;
        const height = unionBounds.bottom - unionBounds.y;

        this.log('create overlay', {
            x,
            y,
            width,
            height,
            displays: displays.map((display) => ({
                id: display.id,
                bounds: display.bounds,
                scaleFactor: display.scaleFactor
            }))
        });

        this.window = new BrowserWindow({
            width,
            height,
            x,
            y,
            show: false,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            focusable: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            closable: true,
            hasShadow: false,
            paintWhenInitiallyHidden: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        // 加载截图页面
        this.window.loadFile(path.join(__dirname, 'screenshot.html')).catch((error) => {
            this.log('loadFile failed', { message: error.message, stack: error.stack });
            if (this.captureCallback) {
                this.captureCallback(null);
                this.captureCallback = null;
            }
        });

        // 设置窗口层级
        this.window.setAlwaysOnTop(true, 'screen-saver');
        this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        const showCaptureWindow = (reason) => {
            if (!this.window || this.window.isDestroyed() || this.hasShown) return;
            this.hasShown = true;
            this.log('show overlay', { reason });
            this.window.show();
            this.window.setAlwaysOnTop(true, 'screen-saver');
            this.window.moveTop();
            setTimeout(() => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.focus();
                }
            }, 50);
        };

        this.window.once('ready-to-show', () => {
            showCaptureWindow('ready-to-show');
        });

        this.window.webContents.once('did-finish-load', () => {
            setTimeout(() => showCaptureWindow('did-finish-load-fallback'), 100);
        });

        this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            this.log('did-fail-load', { errorCode, errorDescription, validatedURL });
        });

        // 阻止关闭窗口（用 ESC 取消）
        this.window.on('closed', () => {
            if (this.captureCallback) {
                this.captureCallback(null); // 用户取消
                this.captureCallback = null;
            }
            this.window = null;
            this.hasShown = false;
        });

        return this.window;
    }

    /**
     * 开始截图，返回选区坐标
     * @returns {Promise<{x, y, width, height}>|null} 选区坐标，取消则返回 null
     */
    async startCapture() {
        return new Promise((resolve) => {
            this.captureCallback = (result) => {
                resolve(result);
            };

            this.create();

            // 设置超时，防止窗口加载失败
            setTimeout(() => {
                if (this.captureCallback && (!this.window || this.window.isDestroyed())) {
                    console.error('[Screenshot] 窗口加载超时');
                    this.captureCallback(null);
                    this.captureCallback = null;
                }
            }, 5000);
        });
    }

    /**
     * 关闭截图窗口
     */
    close() {
        if (this.window && !this.window.isDestroyed()) {
            if (FORCE_DESTROY_ON_CLOSE) {
                this.window.destroy();
            } else {
                this.window.close();
            }
            this.window = null;
        }
    }

    /**
     * 发送选区结果
     * @param {{x, y, width, height}} selection 选区坐标
     */
    sendSelection(selection) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('screenshot:selection', selection);
        }
    }

    /**
     * 完成截图（用户确认选区）
     * @param {{x, y, width, height}} selection 选区坐标
     */
    finishCapture(selection) {
        if (this.captureCallback) {
            const callback = this.captureCallback;
            this.captureCallback = null;
            this.log('finishCapture', { selection });
            if (this.window && !this.window.isDestroyed()) {
                this.window.hide();
            }
            setTimeout(() => {
                this.close();
                callback(selection);
            }, 60);
        }
    }
}

module.exports = ScreenshotWindow;
