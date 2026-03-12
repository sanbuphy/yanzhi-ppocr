/**
 * 网页转 PDF 模块
 * 使用 Puppeteer 连接浏览器 CDP 保存 PDF
 * 无需 Python 依赖
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { getAgent } = require('../agent/index');

// Windows 平台使用 destroy() 避免触发 window-all-closed 事件
const FORCE_DESTROY_ON_CLOSE = process.platform === 'win32';

class WebToPdf {
    constructor(mainWindow, hotkeyManager = null) {
        this.mainWindow = mainWindow;
        this.hotkeyManager = hotkeyManager;
        this.isProcessing = false;
        this.toolsDir = path.join(__dirname, '../../tools');
        this.confirmDialog = null;
        this.tempPdfPath = null; // 追踪临时 PDF 路径

        // 延迟加载 puppeteer-core
        this.puppeteer = null;
    }

    /**
     * 获取 temp 目录路径
     */
    getTempDir() {
        const tempDir = path.join(this.toolsDir, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        return tempDir;
    }

    /**
     * 清理临时 PDF 文件
     */
    _cleanupTempPdf(pdfPath) {
        try {
            if (pdfPath && fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
                console.log('[PDF] 已清理临时文件:', pdfPath);
            }
        } catch (e) {
            console.error('[PDF] 清理临时文件失败:', e);
        }
    }

    /**
     * 获取 Puppeteer 实例（延迟加载）
     */
    getPuppeteer() {
        if (!this.puppeteer) {
            this.puppeteer = require('puppeteer-core');
        }
        return this.puppeteer;
    }

    /**
     * 检测 9222 端口是否可访问
     * @returns {Promise<boolean>}
     */
    async checkDebugPort() {
        return new Promise((resolve) => {
            const req = http.get('http://localhost:9222/json', { timeout: 3000 }, (res) => {
                if (res.statusCode === 200) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    /**
     * 获取当前活跃页面信息
     * @returns {Promise<object|null>}
     */
    async getActivePageInfo() {
        return new Promise((resolve) => {
            http.get('http://localhost:9222/json', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const targets = JSON.parse(data);
                        // 找到第一个有效的页面（排除 devtools 页面）
                        const page = targets.find(t =>
                            t.type === 'page' &&
                            t.url &&
                            !t.url.startsWith('devtools://') &&
                            !t.url.startsWith('chrome://') &&
                            t.url !== 'about:blank'
                        );
                        resolve(page || null);
                    } catch (e) {
                        console.error('[PDF] 解析页面信息失败:', e);
                        resolve(null);
                    }
                });
            }).on('error', (err) => {
                console.error('[PDF] 获取页面信息失败:', err);
                resolve(null);
            });
        });
    }

    /**
     * 尝试自动启动 Edge（调试模式）
     * @returns {Promise<boolean>}
     */
    async launchEdgeDebug() {
        const edgePaths = [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
            process.env.PROGRAMFILES + '\\Microsoft\\Edge\\Application\\msedge.exe'
        ];

        // 找到 Edge 路径
        let edgePath = null;
        for (const p of edgePaths) {
            try {
                if (fs.existsSync(p)) {
                    edgePath = p;
                    break;
                }
            } catch (e) {
                // 忽略
            }
        }

        if (!edgePath) {
            console.log('[PDF] 未找到 Edge 浏览器安装路径');
            return false;
        }

        // 先关闭所有 Edge 进程
        try {
            spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' });
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
            // 忽略
        }

        // 以调试模式启动 Edge
        return new Promise((resolve) => {
            const proc = spawn(edgePath, [
                '--remote-debugging-port=9222',
                '--no-first-run',
                '--no-default-browser-check'
            ], {
                detached: true,
                stdio: 'ignore'
            });

            proc.unref();

            // 等待端口就绪
            setTimeout(async () => {
                const available = await this.checkDebugPort();
                resolve(available);
            }, 3000);
        });
    }

    /**
     * 智能滚动页面，加载懒加载图片
     * @param {Page} page Puppeteer 页面对象
     */
    async smartScroll(page) {
        try {
            // 先滚动到顶部
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });

            let prevHeight = -1;
            let attempts = 0;
            const maxAttempts = 100;

            while (attempts < maxAttempts) {
                // 向下滚动
                await page.evaluate(() => {
                    window.scrollBy(0, 2000);
                });

                // 等待加载
                await new Promise(r => setTimeout(r, 50));

                // 检查是否到底
                const currentHeight = await page.evaluate(() =>
                    window.scrollY + window.innerHeight
                );
                const totalHeight = await page.evaluate(() =>
                    document.body.scrollHeight
                );

                if (currentHeight >= totalHeight || currentHeight === prevHeight) {
                    break;
                }
                prevHeight = currentHeight;
                attempts++;
            }

            // 滚动回顶部
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });

            // 等待最后渲染
            await new Promise(r => setTimeout(r, 500));
        } catch (error) {
            console.error('[PDF] 滚动加载失败:', error);
        }
    }

    /**
     * 使用 Puppeteer 保存 PDF
     * @returns {Promise<object>}
     */
    async saveWithPuppeteer() {
        const puppeteer = this.getPuppeteer();

        try {
            // 1. 获取当前活跃页面信息
            const activeInfo = await this.getActivePageInfo();
            console.log('[PDF] 活跃页面:', activeInfo?.url);

            // 2. 连接浏览器
            const browser = await puppeteer.connect({
                browserURL: 'http://localhost:9222',
                defaultViewport: null
            });

            console.log('[PDF] 已连接浏览器');

            // 3. 找到匹配的页面
            const pages = await browser.pages();
            let targetPage = null;

            if (activeInfo && activeInfo.url) {
                // 尝试找到匹配的页面
                for (const page of pages) {
                    const url = page.url();
                    if (url === activeInfo.url || url.includes(activeInfo.url)) {
                        targetPage = page;
                        break;
                    }
                }
            }

            // 如果没找到匹配的，用第一个有效页面
            if (!targetPage) {
                targetPage = pages.find(p => {
                    const url = p.url();
                    return url && !url.startsWith('devtools://') && url !== 'about:blank';
                });
            }

            if (!targetPage) {
                browser.disconnect();
                return { success: false, error: '未找到有效页面' };
            }

            console.log('[PDF] 目标页面:', targetPage.url());

            // 4. 滚动加载图片
            await this.smartScroll(targetPage);

            // 5. 生成文件名
            const title = await targetPage.title();
            const safeTitle = (title || 'webpage')
                .replace(/[\\/*?:"<>|]/g, '')
                .substring(0, 50);

            // 保存到 temp 目录
            const tempDir = this.getTempDir();

            const timestamp = Date.now();
            const filename = `${safeTitle}_${timestamp}.pdf`;
            const outputPath = path.join(tempDir, filename);

            console.log('[PDF] 保存路径:', outputPath);

            // 6. 保存 PDF (横向 A2，无边距，更适合网页阅读)
            await targetPage.pdf({
                path: outputPath,
                format: 'A2',
                landscape: true,
                printBackground: true,
                scale: 0.7,
                margin: {
                    top: '0mm',
                    bottom: '0mm',
                    left: '0mm',
                    right: '0mm'
                }
            });

            // 7. 断开连接（不关闭浏览器）
            browser.disconnect();

            // 存储临时文件路径用于后续清理
            this.tempPdfPath = outputPath;

            console.log('[PDF] PDF 保存成功:', outputPath);
            return { success: true, path: outputPath, title: title || '网页' };

        } catch (error) {
            console.error('[PDF] Puppeteer 保存失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 显示确认对话框
     * @param {string} pdfPath PDF 文件路径
     * @param {string} title 页面标题
     */
    async showConfirmDialog(pdfPath, title) {
        // 关闭之前的对话框
        if (this.confirmDialog && !this.confirmDialog.isDestroyed()) {
            if (FORCE_DESTROY_ON_CLOSE) {
                this.confirmDialog.destroy();
            } else {
                this.confirmDialog.close();
            }
        }

        // 执行智能分类
        let classifyResult = null;
        try {
            const agent = getAgent();
            classifyResult = await agent.classify({
                content: pdfPath,
                contentType: 'pdf'
            });
        } catch (e) {
            console.error('[PDF] 智能分类失败:', e);
            classifyResult = {
                success: false,
                error: e.message || '分类失败'
            };
        }

        this.confirmDialog = new BrowserWindow({
            width: 520,
            height: 380,
            parent: this.mainWindow,
            modal: true,
            frame: false,
            resizable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        this.confirmDialog.loadFile('src/pdf/pdf-confirm-dialog.html');
        this.confirmDialog.center();

        // 发送数据到对话框
        this.confirmDialog.webContents.on('did-finish-load', () => {
            this.confirmDialog.webContents.send('dialog:data', {
                path: pdfPath,
                title: title,
                classifyResult: classifyResult
            });
        });

        // 监听对话框事件
        const confirmHandler = (event) => {
            try {
                if (this.confirmDialog && !this.confirmDialog.isDestroyed()) {
                    if (FORCE_DESTROY_ON_CLOSE) {
                        this.confirmDialog.destroy();
                    } else {
                        this.confirmDialog.close();
                    }
                }
            } catch (e) {
                console.error('[PDF] 确认操作出错:', e);
            }
        };

        const saveHandler = async (event, { sourcePath, targetPath }) => {
            try {
                // 确保目标目录存在
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // 移动或复制文件
                if (sourcePath !== targetPath) {
                    fs.copyFileSync(sourcePath, targetPath);
                    // 删除原文件（移动）
                    fs.unlinkSync(sourcePath);
                }

                // 清理临时文件追踪
                this.tempPdfPath = null;

                // 通知保存成功
                this.confirmDialog?.webContents.send('dialog:save-result', {
                    success: true,
                    path: targetPath
                });
            } catch (e) {
                console.error('[PDF] 保存失败:', e);
                this.confirmDialog?.webContents.send('dialog:save-result', {
                    success: false,
                    error: e.message
                });
            }
        };

        const openFolderHandler = (event, filePath) => {
            try {
                // 打开文件夹并选中文件
                shell.showItemInFolder(filePath);
                if (this.confirmDialog && !this.confirmDialog.isDestroyed()) {
                    if (FORCE_DESTROY_ON_CLOSE) {
                        this.confirmDialog.destroy();
                    } else {
                        this.confirmDialog.close();
                    }
                }
            } catch (e) {
                console.error('[PDF] 打开文件夹出错:', e);
            }
        };

        const cancelHandler = (event) => {
            try {
                // 清理临时文件
                this._cleanupTempPdf(this.tempPdfPath);
                this.tempPdfPath = null;

                if (this.confirmDialog && !this.confirmDialog.isDestroyed()) {
                    if (FORCE_DESTROY_ON_CLOSE) {
                        this.confirmDialog.destroy();
                    } else {
                        this.confirmDialog.close();
                    }
                }
            } catch (e) {
                console.error('[PDF] 取消操作出错:', e);
            }
        };

        const browseFolderHandler = async (event) => {
            try {
                const result = await dialog.showOpenDialog(this.confirmDialog, {
                    title: '选择保存位置',
                    properties: ['openDirectory', 'createDirectory']
                });
                if (result && result.filePaths && result.filePaths.length > 0) {
                    this.confirmDialog?.webContents.send('dialog:browse-result', {
                        selectedPath: result.filePaths[0]
                    });
                }
            } catch (e) {
                console.error('[PDF] 浏览文件夹出错:', e);
            }
        };

        ipcMain.once('pdf-confirm:confirm', confirmHandler);
        ipcMain.once('pdf-confirm:save', saveHandler);
        ipcMain.once('pdf-confirm:open-folder', openFolderHandler);
        ipcMain.once('pdf-confirm:cancel', cancelHandler);
        ipcMain.once('pdf-confirm:browse-folder', browseFolderHandler);

        this.confirmDialog.on('closed', () => {
            ipcMain.removeListener('pdf-confirm:confirm', confirmHandler);
            ipcMain.removeListener('pdf-confirm:save', saveHandler);
            ipcMain.removeListener('pdf-confirm:open-folder', openFolderHandler);
            ipcMain.removeListener('pdf-confirm:cancel', cancelHandler);
            ipcMain.removeListener('pdf-confirm:browse-folder', browseFolderHandler);
            this.confirmDialog = null;
        });
    }

    /**
     * 使用 Electron 保存网页为 PDF（备用方案）
     * @param {string} url 网页 URL
     * @returns {Promise<object>}
     */
    async saveWithElectron(url) {
        return new Promise((resolve) => {
            const tempWindow = new BrowserWindow({
                width: 1400,
                height: 900,
                show: false,
                webPreferences: {
                    nodeIntegration: false
                }
            });

            // 设置超时
            const timeout = setTimeout(() => {
                tempWindow.destroy();
                resolve({ success: false, error: '加载超时' });
            }, 30000);

            tempWindow.loadURL(url);

            tempWindow.webContents.on('did-finish-load', async () => {
                try {
                    // 生成文件名
                    const title = tempWindow.webContents.getTitle();
                    const safeTitle = (title || 'webpage')
                        .replace(/[\\/*?:"<>|]/g, '')
                        .substring(0, 50);
                    const timestamp = Date.now();
                    const filename = `${safeTitle}_${timestamp}.pdf`;

                    // 保存到 temp 目录
                    const tempDir = this.getTempDir();

                    const outputPath = path.join(tempDir, filename);

                    // 保存为 PDF
                    await tempWindow.webContents.printToPDF({
                        pageSize: 'A4',
                        printBackground: true,
                        margins: {
                            top: 0,
                            bottom: 0,
                            left: 0,
                            right: 0
                        }
                    }).then(data => {
                        fs.writeFileSync(outputPath, data);
                    });

                    clearTimeout(timeout);
                    tempWindow.destroy();

                    // 存储临时文件路径用于后续清理
                    this.tempPdfPath = outputPath;

                    console.log('[PDF] Electron 保存成功:', outputPath);
                    resolve({ success: true, path: outputPath, title: title || '网页' });
                } catch (error) {
                    clearTimeout(timeout);
                    tempWindow.destroy();
                    resolve({ success: false, error: error.message });
                }
            });

            tempWindow.webContents.on('did-fail-load', (event, code, desc) => {
                clearTimeout(timeout);
                tempWindow.destroy();
                resolve({ success: false, error: `加载失败：${desc}` });
            });
        });
    }

    /**
     * 主流程：保存网页为 PDF
     */
    async savePage() {
        if (this.isProcessing) {
            this.sendToast('busy', '请稍候', '正在保存 PDF，请稍后再试');
            return;
        }

        this.isProcessing = true;
        this.sendToast('persistent', 'PDF 保存', '正在处理网页转 PDF...');

        try {
            // 步骤 1: 检测 9222 端口
            console.log('[PDF] 检测 9222 端口...');
            const portAvailable = await this.checkDebugPort();

            if (portAvailable) {
                // 步骤 2A: 端口可用，使用 Puppeteer 保存
                console.log('[PDF] 9222 端口可用，使用 Puppeteer 保存...');
                this.sendToast('info', 'PDF 保存', '检测到浏览器，正在保存网页...');

                const result = await this.saveWithPuppeteer();

                if (result.success) {
                    this.sendToast('close_persistent', null, null);
                    await this.showConfirmDialog(result.path, result.title);
                } else {
                    this.sendToast('error', '保存失败', result.error || '保存失败');
                }
            } else {
                // 步骤 2B: 端口不可用，尝试自动启动 Edge
                console.log('[PDF] 9222 端口不可用，尝试启动 Edge...');
                this.sendToast('info', 'PDF 保存', '正在启动浏览器...');

                const edgeStarted = await this.launchEdgeDebug();

                if (edgeStarted) {
                    console.log('[PDF] Edge 启动成功，使用 Puppeteer 保存...');
                    const result = await this.saveWithPuppeteer();

                    if (result.success) {
                        this.sendToast('close_persistent', null, null);
                        await this.showConfirmDialog(result.path, result.title);
                    } else {
                        this.sendToast('error', '保存失败', result.error || '保存失败');
                    }
                } else {
                    // 步骤 3: 启动失败，提示用户提供 URL
                    console.log('[PDF] Edge 启动失败，请求用户提供 URL');
                    this.sendToast('close_persistent', null, null);
                    this.requestUserUrl();
                    return; // 不重置 isProcessing，等待用户输入
                }
            }
        } catch (error) {
            console.error('[PDF] 保存失败:', error);
            this.sendToast('error', 'PDF 保存失败', error.message);
        } finally {
            this.isProcessing = false;
            this.sendToast('close_persistent', null, null);
        }
    }

    /**
     * 请求用户提供 URL
     */
    requestUserUrl() {
        // 显示 URL 输入对话框
        const dialog = new BrowserWindow({
            width: 500,
            height: 320,
            parent: this.mainWindow,
            modal: true,
            frame: true,
            resizable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        dialog.loadFile('src/pdf/pdf-url-dialog.html');
        dialog.center();
        dialog.show();

        // 监听用户提交
        const submitHandler = (event, url) => {
            if (FORCE_DESTROY_ON_CLOSE) {
                dialog.destroy();
            } else {
                dialog.close();
            }
            this.handleUserUrl(url);
        };

        const cancelHandler = () => {
            if (FORCE_DESTROY_ON_CLOSE) {
                dialog.destroy();
            } else {
                dialog.close();
            }
            this.handleUserUrl('');
        };

        ipcMain.once('pdf-url-dialog:submit', submitHandler);
        ipcMain.once('pdf-url-dialog:cancel', cancelHandler);

        dialog.on('closed', () => {
            ipcMain.removeListener('pdf-url-dialog:submit', submitHandler);
            ipcMain.removeListener('pdf-url-dialog:cancel', cancelHandler);
            if (!this.isProcessing) {
                this.sendToast('close_persistent', null, null);
            }
        });
    }

    /**
     * 处理用户提供的 URL
     * @param {string} url
     */
    async handleUserUrl(url) {
        if (!url) {
            this.isProcessing = false;
            this.sendToast('close_persistent', null, null);
            return;
        }

        this.sendToast('persistent', 'PDF 保存', '正在保存网页为 PDF...');

        try {
            // 确保 URL 格式正确
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }

            const result = await this.saveWithElectron(url);

            if (result.success) {
                this.sendToast('close_persistent', null, null);
                await this.showConfirmDialog(result.path, result.title);
            } else {
                this.sendToast('error', '保存失败', result.error || '保存失败');
            }
        } catch (error) {
            console.error('[PDF] 用户 URL 保存失败:', error);
            this.sendToast('error', 'PDF 保存失败', error.message);
        } finally {
            this.isProcessing = false;
            this.sendToast('close_persistent', null, null);
        }
    }

    /**
     * 发送 Toast 通知
     */
    sendToast(type, title, message) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('toast:show', { type, title, message });
        }
    }

    /**
     * 注册全局快捷键 Ctrl+Shift+P
     */
    registerShortcut() {
        if (this.hotkeyManager) {
            const success = this.hotkeyManager.register('Ctrl+Shift+P', () => {
                this.savePage();
            }, '网页转 PDF');
            if (!success) {
                console.error('[PDF] 快捷键注册失败');
            }
        } else {
            const { globalShortcut } = require('electron');
            const registered = globalShortcut.register('Ctrl+Shift+P', () => {
                this.savePage();
            });
            if (registered) {
                console.log('[PDF] 快捷键已注册：Ctrl+Shift+P');
            } else {
                console.error('[PDF] 快捷键注册失败');
            }
        }
    }
}

module.exports = WebToPdf;