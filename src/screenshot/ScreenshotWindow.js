/**
 * 截图选区窗口
 * 全屏半透明覆盖层，用户可绘制矩形选区
 */

const { BrowserWindow, screen } = require('electron');

class ScreenshotWindow {
    constructor() {
        this.window = null;
        this.captureCallback = null;
    }

    /**
     * 创建截图选区窗口
     */
    create() {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { x, y, width, height } = primaryDisplay.bounds;

        this.window = new BrowserWindow({
            width,
            height,
            x,
            y,
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
        this.window.loadFile('src/screenshot/screenshot.html');

        // 设置窗口层级
        this.window.setAlwaysOnTop(true, 'screen-saver');
        this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        // 阻止关闭窗口（用 ESC 取消）
        this.window.on('closed', () => {
            if (this.captureCallback) {
                this.captureCallback(null); // 用户取消
                this.captureCallback = null;
            }
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

            // 等待窗口加载完成
            this.window.once('ready-to-show', () => {
                // 直接显示全局遮罩并聚焦，用户可立即开始框选
                this.window.show();
                setTimeout(() => {
                    if (this.window && !this.window.isDestroyed()) {
                        this.window.focus();
                    }
                }, 50);
            });

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
            this.window.close();
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
