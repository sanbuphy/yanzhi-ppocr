/**
 * PDF URL 输入对话框
 * 当无法自动检测浏览器时，请求用户提供网页 URL
 */

const { BrowserWindow, ipcMain, dialog } = require('electron');

// Windows 平台使用 destroy() 避免触发 window-all-closed 事件
const FORCE_DESTROY_ON_CLOSE = process.platform === 'win32';

class PdfUrlDialog {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.window = null;
        this.submitListener = null;
        this.cancelListener = null;
    }

    /**
     * 显示 URL 输入对话框
     */
    show() {
        if (this.window) {
            this.window.focus();
            return;
        }

        this.window = new BrowserWindow({
            width: 500,
            height: 300,
            parent: this.mainWindow,
            modal: true,
            frame: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        this.window.loadFile('src/pdf/pdf-url-dialog.html');
        this.window.center();
        this.window.show();

        this.registerWindowIpc();

        // 窗口关闭时清理
        this.window.on('closed', () => {
            this.cleanupWindowIpc();
            this.window = null;
        });
    }

    registerWindowIpc() {
        this.cleanupWindowIpc();

        this.submitListener = (event, url) => {
            if (!this.window || this.window.isDestroyed()) return;
            if (!this.window.webContents || this.window.webContents.isDestroyed()) return;
            if (event.sender !== this.window.webContents) return;
            this.sendUrl(String(url || '').trim());
        };

        this.cancelListener = (event) => {
            if (!this.window || this.window.isDestroyed()) return;
            if (!this.window.webContents || this.window.webContents.isDestroyed()) return;
            if (event.sender !== this.window.webContents) return;
            this.close();
        };

        ipcMain.on('pdf-url-dialog:submit', this.submitListener);
        ipcMain.on('pdf-url-dialog:cancel', this.cancelListener);
    }

    cleanupWindowIpc() {
        if (this.submitListener) {
            ipcMain.removeListener('pdf-url-dialog:submit', this.submitListener);
            this.submitListener = null;
        }
        if (this.cancelListener) {
            ipcMain.removeListener('pdf-url-dialog:cancel', this.cancelListener);
            this.cancelListener = null;
        }
    }

    /**
     * 关闭对话框
     */
    close() {
        if (this.window && !this.window.isDestroyed()) {
            this.cleanupWindowIpc();
            if (FORCE_DESTROY_ON_CLOSE) {
                this.window.destroy();
            } else {
                this.window.close();
            }
        }
    }

    /**
     * 发送 URL 到主进程
     * @param {string} url
     */
    sendUrl(url) {
        this.close();

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('pdf:url-provided', url);
        }
    }
}

// 注册 IPC 处理
function registerIpc(pdfManager) {
    ipcMain.on('pdf-url-dialog:submit', (event, url) => {
        if (pdfManager && url) {
            pdfManager.handleUserUrl(url);
        }
    });

    ipcMain.on('pdf-url-dialog:cancel', () => {
        if (pdfManager) {
            pdfManager.handleUserUrl('');
        }
    });
}

module.exports = { PdfUrlDialog, registerIpc };
