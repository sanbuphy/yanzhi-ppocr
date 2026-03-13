/**
 * 截图编辑器窗口
 * 提供画笔、高亮、文字等编辑功能
 */

const { BrowserWindow, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { AIClient } = require('./aiClient');
const { getAgent } = require('../agent/index');

const IMAGE_EXPLANATION_TIMEOUT_MS = 60000; // 60 秒超时
const AI_TIMEOUT_TEXT = 'AI请求超时';
const DIAGNOSTIC_FORCE_DESTROY_ON_CLOSE = process.platform === 'win32';

class EditorWindow {
    constructor() {
        this.window = null;
        this.screenshotBuffer = null;
        this.selection = null;
        this.onClose = null;
        this.isClosing = false;
        this.cancelListener = null;
        this.tempImagePath = null; // 追踪临时图片路径
        this.currentAbortController = null; // 当前请求的 AbortController
        this.log = (...args) => console.log('[EditorWindow]', ...args);
        this.aiClient = new AIClient("你是一个图像分析和解读助手，专门对截图、图表、公式等进行详细解读。");
    }

    /**
     * 创建编辑器窗口
     * @param {Buffer} screenshot - 截图 buffer
     * @param {{x, y, width, height}} selection - 选区坐标
     */
    create(screenshot, selection, onClose = null) {
        this.log('create called', {
            selection,
            hasOnClose: typeof onClose === 'function'
        });
        this.screenshotBuffer = screenshot;
        this.selection = selection;
        this.onClose = onClose;

        const { width, height } = selection;
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

        // 编辑舞台四周留暗区，保持被编辑区域与背景区分
        const toolbarHeight = 64;
        const stagePadding = 28;
        const dragbarHeight = 34;
        
        // 计算最大可用空间（屏幕的 85%）
        const maxAvailableWidth = Math.floor(screenW * 0.85);
        const maxAvailableHeight = Math.floor(screenH * 0.85);
        
        // 计算窗口大小，确保图片能够完整显示（可能需要缩放）
        const maxImageWidth = maxAvailableWidth - stagePadding * 2;
        const maxImageHeight = maxAvailableHeight - stagePadding * 2 - toolbarHeight - dragbarHeight;
        
        // 计算缩放比例
        const scaleX = maxImageWidth / width;
        const scaleY = maxImageHeight / height;
        const scale = Math.min(1, scaleX, scaleY); // 不放大，只缩小
        
        const displayWidth = Math.ceil(width * scale);
        const displayHeight = Math.ceil(height * scale);
        
        const winHeight = Math.max(displayHeight + stagePadding * 2 + toolbarHeight + dragbarHeight, 500);
        const winWidth = Math.max(displayWidth + stagePadding * 2, 920);

        let winX = selection.x - stagePadding;
        let winY = selection.y - stagePadding;

        winX = Math.max(0, Math.min(winX, Math.max(0, screenW - winWidth)));
        winY = Math.max(0, Math.min(winY, Math.max(0, screenH - winHeight)));

        this.window = new BrowserWindow({
            width: Math.min(winWidth, screenW),
            height: Math.min(winHeight, screenH),
            x: winX,
            y: winY,
            frame: false,
            transparent: false,
            alwaysOnTop: true,
            skipTaskbar: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            closable: true,
            hasShadow: true,
            backgroundColor: '#121212',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        // 加载编辑器页面
        this.window.loadFile('src/screenshot/editor.html');

        // 窗口准备好后发送图片
        this.window.once('ready-to-show', () => {
            this.window.show();
            this.sendImageToRenderer();
        });

        this.window.on('closed', () => {
            this.log('window closed callback', {
                hadOnClose: typeof this.onClose === 'function'
            });
            this.cleanupIpcHandlers();
            this.isClosing = false;
            if (typeof this.onClose === 'function') {
                try {
                    this.onClose();
                } catch (error) {
                    console.error('编辑器关闭回调执行失败:', error);
                }
            }
            this.onClose = null;
            this.window = null;
        });

        this.window.webContents.on('render-process-gone', (event, details) => {
            this.log('webContents render-process-gone', details);
        });

        this.window.webContents.on('unresponsive', () => {
            this.log('webContents unresponsive');
        });

        this.window.webContents.on('destroyed', () => {
            this.log('webContents destroyed');
        });

        // 注册 IPC 处理
        this.registerIpcHandlers();

        return this.window;
    }

    /**
     * 将截图发送给渲染进程
     */
    async sendImageToRenderer() {
        if (!this.screenshotBuffer) return;

        // 将 buffer 转为 base64
        const base64 = this.screenshotBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        this.window.webContents.send('editor:image', dataUrl);
    }

    /**
     * 注册 IPC 处理
     */
    registerIpcHandlers() {
        this.log('registerIpcHandlers');
        const saveChannel = 'editor:save-image';
        const aiChannel = 'editor:ai-explain';
        const aiClassifyChannel = 'editor:ai-explain-and-classify';
        const saveToFolderChannel = 'editor:save-to-folder';
        const browseFolderChannel = 'editor:browse-folder';
        const finishChannel = 'editor:finish';
        const cancelChannel = 'editor:cancel';

        // 保证单实例窗口下重复打开时不会残留旧 handler
        ipcMain.removeHandler(saveChannel);
        ipcMain.removeHandler(aiChannel);
        ipcMain.removeHandler(aiClassifyChannel);
        ipcMain.removeHandler(saveToFolderChannel);
        ipcMain.removeHandler(browseFolderChannel);
        ipcMain.removeHandler(finishChannel);
        if (this.cancelListener) {
            ipcMain.removeListener(cancelChannel, this.cancelListener);
            this.cancelListener = null;
        }

        const isFromEditorWindow = (event) => {
            return !!(
                this.window &&
                !this.window.isDestroyed() &&
                this.window.webContents &&
                !this.window.webContents.isDestroyed() &&
                event.sender === this.window.webContents
            );
        };

        // 保存图片到临时文件
        ipcMain.handle(saveChannel, async (event, base64) => {
            if (!isFromEditorWindow(event)) return '';
            return await this.saveImage(base64);
        });

        // AI 解释图片（仅 OCR + AI，不含分类）
        ipcMain.handle(aiChannel, async (event, base64) => {
            if (!isFromEditorWindow(event)) return '';
            return await this.aiExplain(base64);
        });

        // AI 解释 + 智能分类
        ipcMain.handle(aiClassifyChannel, async (event, base64) => {
            if (!isFromEditorWindow(event)) return { ocrText: '', aiExplanation: '', classifyResult: null };
            return await this.aiExplainAndClassify(base64);
        });

        // 保存图片到指定文件夹
        ipcMain.handle(saveToFolderChannel, async (event, { base64, savePath, ocrText, aiExplanation }) => {
            if (!isFromEditorWindow(event)) return { success: false, error: '无效窗口请求' };
            return await this.saveToFolder(base64, savePath, ocrText, aiExplanation);
        });

        // 浏览选择文件夹
        ipcMain.handle(browseFolderChannel, async (event) => {
            if (!isFromEditorWindow(event)) return { canceled: true, filePaths: [] };
            return await dialog.showOpenDialog(this.window, {
                title: '选择保存位置',
                properties: ['openDirectory', 'createDirectory']
            });
        });

        // 仅复制到剪贴板
        ipcMain.handle('editor:copy', async (event, base64) => {
            if (!isFromEditorWindow(event)) return false;
            await this.copyToClipboard(base64);
            return true;
        });

        // 完成编辑（仅关闭，前端负责复制和保存流程）
        ipcMain.handle(finishChannel, async (event) => {
            if (!isFromEditorWindow(event)) return false;
            this.close();
            return true;
        });

        // 取消编辑
        this.cancelListener = (event) => {
            try {
                const senderMatch = isFromEditorWindow(event);
                this.log('editor:cancel received', {
                    senderMatch,
                    isClosing: this.isClosing,
                    hasWindow: !!this.window,
                    windowDestroyed: this.window ? this.window.isDestroyed() : null
                });
                if (!senderMatch) return;
                this.close();
            } catch (e) {
                console.error('取消操作出错:', e);
            }
        };
        ipcMain.on(cancelChannel, this.cancelListener);

        // 取消 AI 请求（不关闭窗口）
        const cancelAiChannel = 'editor:cancel-ai';
        ipcMain.removeHandler(cancelAiChannel);
        ipcMain.handle(cancelAiChannel, (event) => {
            if (!isFromEditorWindow(event)) return false;
            this.log('editor:cancel-ai received, aborting current AI request');
            if (this.currentAbortController) {
                this.currentAbortController.abort();
                this.currentAbortController = null;
                return true;
            }
            return false;
        });
    }

    cleanupIpcHandlers() {
        this.log('cleanupIpcHandlers');
        ipcMain.removeHandler('editor:save-image');
        ipcMain.removeHandler('editor:copy');
        ipcMain.removeHandler('editor:ai-explain');
        ipcMain.removeHandler('editor:ai-explain-and-classify');
        ipcMain.removeHandler('editor:save-to-folder');
        ipcMain.removeHandler('editor:browse-folder');
        ipcMain.removeHandler('editor:finish');
        ipcMain.removeHandler('editor:cancel-ai');
        if (this.cancelListener) {
            ipcMain.removeListener('editor:cancel', this.cancelListener);
            this.cancelListener = null;
        }
    }

    /**
     * 保存图片到临时文件
     * @param {string} base64 - 图片 base64
     * @returns {Promise<string>} 保存路径
     */
    async saveImage(base64) {
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const timestamp = Date.now();
        const filePath = path.join(tempDir, `screenshot_${timestamp}.png`);

        // 移除 data URL 前缀
        const base64Data = base64.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

        console.log(`截图已保存：${filePath}`);
        return filePath;
    }

    /**
     * AI 解释图片内容
     * @returns {Promise<object>} AI 解释（含 OCR 审查信息）
     */
    async aiExplain(base64) {
        let tempPath = null;
        // 取消之前的请求
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        try {
            // 保存临时文件
            tempPath = await this.saveImage(base64 || `data:image/png;base64,${this.screenshotBuffer.toString('base64')}`);

            // 调用 AI（带超时和取消支持）
            const explanation = await this.aiClient.askWithOcrAudit(
                "请对这张图片进行详细解读和分析。\n\n要求：\n1. 描述图片的主要内容和核心信息\n2. 如果包含公式、代码或图表，请解释其含义和作用\n3. 如果是技术内容，请提供易于理解的解释\n4. 总结该图片对学习/研究的价值",
                tempPath,
                0.5,
                2000,
                IMAGE_EXPLANATION_TIMEOUT_MS,
                signal
            );

            return explanation;
        } catch (error) {
            // 如果是取消错误，返回超时提示
            if (error.name === 'AbortError') {
                return AI_TIMEOUT_TEXT;
            }
            console.error('AI 解释失败:', error);
            throw error;
        } finally {
            this.currentAbortController = null;
            if (tempPath && fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
    }

    /**
     * AI 解释 + 智能分类
     * @param {string} base64 - 图片 base64
     * @returns {Promise<object>} { ocrText, aiExplanation, classifyResult }
     */
    async aiExplainAndClassify(base64) {
        let tempPath = null;
        // 取消之前的请求
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        try {
            // 1. 保存临时文件用于 AI 和分类
            tempPath = await this.saveImage(base64);
            // 保存临时文件路径用于后续清理
            this.tempImagePath = tempPath;

            // 2. 执行 OCR + AI 解读（带超时和取消支持）
            let explanation;
            try {
                explanation = await this.aiClient.askWithOcrAudit(
                    "请对这张图片进行详细解读和分析。\n\n要求：\n1. 描述图片的主要内容和核心信息\n2. 如果包含公式、代码或图表，请解释其含义和作用\n3. 如果是技术内容，请提供易于理解的解释\n4. 总结该图片对学习/研究的价值",
                    tempPath,
                    0.5,
                    2000,
                    IMAGE_EXPLANATION_TIMEOUT_MS,
                    signal
                );
            } catch (error) {
                // 如果是取消错误，返回超时提示
                if (error.name === 'AbortError') {
                    return { ocrText: '', aiExplanation: AI_TIMEOUT_TEXT, classifyResult: null };
                }
                throw error;
            }

            // 提取 OCR 文本和 AI 解释
            const ocrText = (explanation && typeof explanation === 'object')
                ? (explanation.ocrStructuredMarkdown || '')
                : '';
            const aiExplanation = (explanation && typeof explanation === 'object')
                ? (explanation.finalAnswer || '')
                : String(explanation || '');

            // 3. 调用 ClassifySkill 进行智能分类
            let classifyResult = null;
            try {
                const agent = getAgent();
                classifyResult = await agent.classify({
                    content: tempPath,
                    contentType: 'image'
                });
            } catch (classifyError) {
                console.error('智能分类失败:', classifyError);
                classifyResult = {
                    success: false,
                    error: classifyError.message || '分类失败'
                };
            }

            return { ocrText, aiExplanation, classifyResult };

        } catch (error) {
            console.error('AI 解释 + 分类失败:', error);
            throw error;
        } finally {
            this.currentAbortController = null;
            // 不删除临时文件，因为分类可能需要用它保存
            // 分类成功后会移动文件到目标位置
        }
    }

    /**
     * 保存图片到指定文件夹
     * @param {string} base64 - 图片 base64
     * @param {string} savePath - 目标保存路径
     * @param {string} ocrText - OCR 文本
     * @param {string} aiExplanation - AI 解释
     * @returns {Promise<object>} { success, path, error }
     */
    async saveToFolder(base64, savePath, ocrText, aiExplanation) {
        try {
            // 确保目标目录存在
            const targetDir = path.dirname(savePath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 保存图片
            const base64Data = base64.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(savePath, Buffer.from(base64Data, 'base64'));

            // 创建元数据文件
            const metaPath = savePath + '.meta.json';
            const metaData = {
                ocrText: ocrText || '',
                aiExplanation: aiExplanation || '',
                createdAt: new Date().toISOString()
            };
            fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), 'utf-8');

            console.log(`图片已保存: ${savePath}`);

            // 清理临时文件
            if (this.tempImagePath && fs.existsSync(this.tempImagePath)) {
                fs.unlinkSync(this.tempImagePath);
                console.log('临时图片已清理:', this.tempImagePath);
                this.tempImagePath = null;
            }

            return { success: true, path: savePath };
        } catch (error) {
            console.error('保存图片失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 复制图片到剪贴板（Windows）
     * @param {string} base64 - 图片 base64
     */
    async copyToClipboard(base64) {
        // 使用 Electron 的 clipboard API
        const { clipboard, nativeImage } = require('electron');
        const image = nativeImage.createFromDataURL(`data:image/png;base64,${base64.replace(/^data:image\/png;base64,/, '')}`);
        clipboard.writeImage(image);
        console.log('图片已复制到剪贴板');
    }

    /**
     * 关闭编辑器窗口
     */
    close() {
        this.log('close called', {
            isClosing: this.isClosing,
            hasWindow: !!this.window,
            windowDestroyed: this.window ? this.window.isDestroyed() : null
        });
        if (this.isClosing) return;
        this.isClosing = true;

        // 取消当前正在进行的 AI 请求
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }

        this.cleanupIpcHandlers();

        if (this.window && !this.window.isDestroyed()) {
            this.log('close dispatch', {
                strategy: DIAGNOSTIC_FORCE_DESTROY_ON_CLOSE ? 'destroy' : 'close'
            });

            setTimeout(() => {
                this.log('close heartbeat +200ms', {
                    hasWindow: !!this.window,
                    windowDestroyed: this.window ? this.window.isDestroyed() : null
                });
            }, 200);

            setTimeout(() => {
                this.log('close heartbeat +800ms', {
                    hasWindow: !!this.window,
                    windowDestroyed: this.window ? this.window.isDestroyed() : null
                });
            }, 800);

            if (DIAGNOSTIC_FORCE_DESTROY_ON_CLOSE) {
                this.window.destroy();
            } else {
                this.window.close();
            }
        } else {
            this.isClosing = false;
        }
    }
}

module.exports = EditorWindow;
