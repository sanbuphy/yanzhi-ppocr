/**
 * 截图编辑器窗口
 * 提供画笔、高亮、文字等编辑功能
 */

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { AIClient } = require('./aiClient');

const IMAGE_EXPLANATION_TIMEOUT_MS = 20000;
const AI_TIMEOUT_TEXT = 'AI请求超时';

class EditorWindow {
    constructor() {
        this.window = null;
        this.screenshotBuffer = null;
        this.selection = null;
        this.onClose = null;
        this.aiClient = new AIClient("你是一个图像分析和解读助手，专门对截图、图表、公式等进行详细解读。");
    }

    /**
     * 创建编辑器窗口
     * @param {Buffer} screenshot - 截图 buffer
     * @param {{x, y, width, height}} selection - 选区坐标
     */
    create(screenshot, selection, onClose = null) {
        this.screenshotBuffer = screenshot;
        this.selection = selection;
        this.onClose = onClose;

        const { width, height } = selection;
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

        // 编辑舞台四周留暗区，保持被编辑区域与背景区分
        const toolbarHeight = 64;
        const stagePadding = 28;
        const winHeight = Math.max(height + stagePadding * 2 + toolbarHeight, 500);
        const winWidth = Math.max(width + stagePadding * 2, 920);

        let winX = selection.x - stagePadding;
        let winY = selection.y - stagePadding;

        winX = Math.max(0, Math.min(winX, Math.max(0, screenW - winWidth)));
        winY = Math.max(0, Math.min(winY, Math.max(0, screenH - winHeight)));

        this.window = new BrowserWindow({
            width: winWidth,
            height: winHeight,
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
            if (typeof this.onClose === 'function') {
                this.onClose();
            }
            this.window = null;
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
        const saveChannel = 'editor:save-image';
        const aiChannel = 'editor:ai-explain';
        const explainSaveChannel = 'editor:explain-and-save';
        const finishChannel = 'editor:finish';
        const cancelChannel = 'editor:cancel';

        // 保证单实例窗口下重复打开时不会残留旧 handler
        ipcMain.removeHandler(saveChannel);
        ipcMain.removeHandler(aiChannel);
        ipcMain.removeHandler(explainSaveChannel);
        ipcMain.removeHandler(finishChannel);
        ipcMain.removeAllListeners(cancelChannel);

        // 保存图片到文件
        ipcMain.handle(saveChannel, async (event, base64) => {
            return await this.saveImage(base64);
        });

        // AI 解释图片
        ipcMain.handle(aiChannel, async (event, base64) => {
            return await this.aiExplain(base64);
        });

        // AI 解释并入库
        ipcMain.handle(explainSaveChannel, async (event, base64) => {
            const explanation = await this.aiExplain(base64);
            const explanationText = (explanation && typeof explanation === 'object')
                ? (explanation.finalAnswer || '')
                : (explanation || '');
            const result = await this.saveToKnowledgeBase(base64, explanationText);
            this.close();
            return { explanation, result };
        });

        // 完成编辑（复制到剪贴板）
        ipcMain.handle(finishChannel, async (event, base64) => {
            await this.copyToClipboard(base64);
            this.close();
            return true;
        });

        // 取消编辑
        ipcMain.on(cancelChannel, () => {
            this.close();
        });
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
        try {
            // 保存临时文件
            tempPath = await this.saveImage(base64 || `data:image/png;base64,${this.screenshotBuffer.toString('base64')}`);

            // 调用 AI
            const explainPromise = this.aiClient.askWithOcrAudit(
                "请对这张图片进行详细解读和分析。\n\n要求：\n1. 描述图片的主要内容和核心信息\n2. 如果包含公式、代码或图表，请解释其含义和作用\n3. 如果是技术内容，请提供易于理解的解释\n4. 总结该图片对学习/研究的价值",
                tempPath,
                0.5,
                2000
            );

            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => resolve(AI_TIMEOUT_TEXT), IMAGE_EXPLANATION_TIMEOUT_MS);
            });
            const explanation = await Promise.race([explainPromise, timeoutPromise]);

            if (explanation === AI_TIMEOUT_TEXT) {
                return AI_TIMEOUT_TEXT;
            }

            return explanation;
        } catch (error) {
            console.error('AI 解释失败:', error);
            throw error;
        } finally {
            if (tempPath && fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
    }

    /**
     * 保存图片到知识库（调用 Python 选择路径）
     * @param {string} base64
     * @param {string|null} explanation
     */
    async saveToKnowledgeBase(base64, explanation = null) {
        const imageBuffer = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempPath = path.join(tempDir, `screenshot_${Date.now()}.png`);
        fs.writeFileSync(tempPath, imageBuffer);

        try {
            return await this.callPythonClassifier(tempPath, explanation);
        } finally {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
    }

    /**
     * 调用 Python 分类器
     */
    async callPythonClassifier(imagePath, explanation) {
        const { spawn } = require('child_process');
        const toolsDir = path.join(__dirname, '../../tools');

        return new Promise((resolve, reject) => {
            const pythonCode = `
import sys
import json
sys.path.insert(0, r'${toolsDir.replace(/\\/g, '/')}')

try:
    from choose_to_save import ContentManager, InputType
    from PIL import Image

    manager = ContentManager()
    img = Image.open(r'${imagePath.replace(/\\/g, '/')}')

    description = ${explanation ? JSON.stringify(explanation) : 'None'}
    result = manager.save_content(InputType.IMAGE, img, description=description)

    print("RESULT:" + json.dumps({"success": True, "path": result} if result else {"success": False, "error": "保存失败"}))
except Exception as e:
    print("RESULT:" + json.dumps({"success": False, "error": str(e)}))
`;

            const proc = spawn('python', ['-c', pythonCode], {
                cwd: toolsDir,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUTF8: '1'
                }
            });

            let output = '';
            proc.stdout.on('data', (data) => {
                output += data.toString('utf-8');
            });

            proc.on('close', () => {
                const match = output.match(/RESULT:(.+)/);
                if (match) {
                    try {
                        resolve(JSON.parse(match[1]));
                    } catch (e) {
                        reject(new Error('解析 Python 结果失败'));
                    }
                } else {
                    reject(new Error('Python 脚本无输出'));
                }
            });

            proc.on('error', reject);
        });
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
        // 移除 IPC 处理
        if (this.window) {
            ipcMain.removeHandler('editor:save-image');
            ipcMain.removeHandler('editor:ai-explain');
            ipcMain.removeHandler('editor:explain-and-save');
            ipcMain.removeHandler('editor:finish');
            ipcMain.removeAllListeners('editor:cancel');

            this.window.close();
        }
    }
}

module.exports = EditorWindow;
