/**
 * PDF URL 输入对话框
 * 当无法自动检测浏览器时，请求用户提供网页 URL
 */

const { BrowserWindow, ipcMain, dialog } = require('electron');

class PdfUrlDialog {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.window = null;
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

        // 窗口关闭时清理
        this.window.on('closed', () => {
            this.window = null;
        });
    }

    /**
     * 关闭对话框
     */
    close() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.close();
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
        if (pdfManager) {
            pdfManager.handleUserUrl(url);
        }
    });

    ipcMain.on('pdf-url-dialog:cancel', () => {
        // 用户取消
    });
}

module.exports = { PdfUrlDialog, registerIpc };
