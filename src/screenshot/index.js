/**
 * 截图管理器
 * 整合截图选区、编辑、AI 解释、保存等功能
 */

const { globalShortcut, ipcMain, clipboard, nativeImage } = require('electron');
const ScreenshotWindow = require('./ScreenshotWindow');
const EditorWindow = require('./EditorWindow');
const { AIClient } = require('./aiClient');
const path = require('path');
const fs = require('fs');

class ScreenshotManager {
    constructor(mainWindow, hotkeyManager = null) {
        this.mainWindow = mainWindow;
        this.hotkeyManager = hotkeyManager;
        this.screenshotWindow = null;
        this.editorWindow = null;
        this.isProcessing = false;
        this.contentManager = null; // 用于保存截图到知识库
        this.log = (...args) => console.log('[ScreenshotManager]', ...args);

        this.registerIpcHandlers();
    }

    /**
     * 注册全局快捷键 Ctrl+Q
     */
    registerShortcut() {
        if (this.hotkeyManager) {
            const success = this.hotkeyManager.register('Ctrl+Q', () => {
                if (!this.isProcessing) {
                    this.startCapture();
                }
            }, '截图');
            if (!success) {
                console.error('❌ 截图快捷键注册失败');
            }
        } else {
            const { globalShortcut } = require('electron');
            const registered = globalShortcut.register('Ctrl+Q', () => {
                if (!this.isProcessing) {
                    this.startCapture();
                }
            });
            if (registered) {
                console.log('✅ 截图快捷键已注册：Ctrl+Q');
            } else {
                console.error('❌ 截图快捷键注册失败');
            }
        }
    }

    /**
     * 开始截图流程
     */
    async startCapture() {
        this.log('startCapture begin', { isProcessing: this.isProcessing });
        if (this.isProcessing) {
            this.sendToast('busy', '请稍候', '正在处理截图，请稍后再试');
            return;
        }

        this.isProcessing = true;
        this.sendToast('persistent', '截图中', '正在工作中，请稍等...');

        try {
            // 1. 显示截图选区窗口
            this.screenshotWindow = new ScreenshotWindow();
            const selection = await this.screenshotWindow.startCapture();
            this.log('startCapture selection', { selection });

            if (!selection) {
                // 用户取消
                this.log('startCapture canceled by user');
                this.isProcessing = false;
                this.sendToast('close_persistent', null, null);
                return;
            }

            console.log('选区:', selection);

            // 2. 捕获选区截图
            const screenshot = await this.captureSelection(selection);

            // 3. 显示编辑器
            this.editorWindow = new EditorWindow();
            this.editorWindow.create(screenshot, selection, () => {
                this.log('editor onClose callback', { isProcessingBeforeReset: this.isProcessing });
                this.isProcessing = false;
                this.sendToast('close_persistent', null, null);
            });

        } catch (error) {
            this.log('startCapture error', { message: error.message, stack: error.stack });
            console.error('截图失败:', error);
            this.sendToast('error', '截图失败', error.message);
            this.isProcessing = false;
            this.sendToast('close_persistent', null, null);
        }
    }

    /**
     * 捕获选区截图
     * @param {{x, y, width, height}} selection
     * @returns {Promise<Buffer>}
     */
    async captureSelection(selection) {
        const { desktopCapturer, screen } = require('electron');

        const centerPoint = {
            x: selection.x + Math.floor(selection.width / 2),
            y: selection.y + Math.floor(selection.height / 2)
        };
        const targetDisplay = screen.getDisplayNearestPoint(centerPoint);
        const displayBounds = targetDisplay.bounds;
        const scale = targetDisplay.scaleFactor || 1;

        // 用目标屏幕物理像素作为缩略图尺寸，减少 DPI 偏差
        const expectedThumbnailSize = {
            width: Math.max(1, Math.round(displayBounds.width * scale)),
            height: Math.max(1, Math.round(displayBounds.height * scale))
        };

        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: expectedThumbnailSize
        });

        if (sources.length === 0) {
            throw new Error('无法获取屏幕截图');
        }

        const source = sources.find((item) => String(item.display_id) === String(targetDisplay.id)) || sources[0];
        const thumbnail = source.thumbnail;
        const thumbSize = thumbnail.getSize();

        // 绝对坐标 -> 目标屏幕相对坐标（DIP）
        const relDipX = selection.x - displayBounds.x;
        const relDipY = selection.y - displayBounds.y;

        // DIP -> 物理像素（基于屏幕缩放）
        const expectedPxW = Math.max(1, Math.round(displayBounds.width * scale));
        const expectedPxH = Math.max(1, Math.round(displayBounds.height * scale));
        const rawPxX = Math.round(relDipX * scale);
        const rawPxY = Math.round(relDipY * scale);
        const rawPxW = Math.round(selection.width * scale);
        const rawPxH = Math.round(selection.height * scale);

        // 防止 thumbnail 实际尺寸与期望不一致，按比例映射
        const ratioX = thumbSize.width / expectedPxW;
        const ratioY = thumbSize.height / expectedPxH;

        const mappedX = Math.round(rawPxX * ratioX);
        const mappedY = Math.round(rawPxY * ratioY);
        const mappedW = Math.round(rawPxW * ratioX);
        const mappedH = Math.round(rawPxH * ratioY);

        const cropX = Math.max(0, Math.min(mappedX, Math.max(0, thumbSize.width - 1)));
        const cropY = Math.max(0, Math.min(mappedY, Math.max(0, thumbSize.height - 1)));
        const cropW = Math.max(1, Math.min(mappedW, thumbSize.width - cropX));
        const cropH = Math.max(1, Math.min(mappedH, thumbSize.height - cropY));

        console.log('[Screenshot] capture map', {
            selection,
            display: { id: targetDisplay.id, bounds: displayBounds, scale },
            thumbnail: thumbSize,
            crop: { x: cropX, y: cropY, width: cropW, height: cropH }
        });

        const cropped = thumbnail.crop({
            x: cropX,
            y: cropY,
            width: cropW,
            height: cropH
        });

        return cropped.toPNG();
    }

    /**
     * 保存截图到知识库
     * @param {Buffer} screenshot
     * @param {string} explanation AI 解释（可选）
     */
    async saveToKnowledgeBase(screenshot, explanation = null) {
        try {
            // 保存临时文件
            const tempDir = path.join(__dirname, '../../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempPath = path.join(tempDir, `screenshot_${Date.now()}.png`);
            fs.writeFileSync(tempPath, screenshot);

            // 调用 Python 的 choose_to_save.py 进行分类保存
            const result = await this.callPythonClassifier(tempPath, explanation);

            // 清理临时文件
            fs.unlinkSync(tempPath);

            return result;
        } catch (error) {
            console.error('保存到知识库失败:', error);
            throw error;
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

            proc.on('close', (code) => {
                const match = output.match(/RESULT:(.+)/);
                if (match) {
                    try {
                        const result = JSON.parse(match[1]);
                        resolve(result);
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
     * 注册 IPC 处理
     */
    registerIpcHandlers() {
        // 截图确认
        ipcMain.on('screenshot:confirm', (event, selection) => {
            if (this.screenshotWindow) {
                this.screenshotWindow.finishCapture(selection);
            }
        });

        // 截图取消
        ipcMain.on('screenshot:cancel', () => {
            if (this.screenshotWindow) {
                this.screenshotWindow.close();
                this.isProcessing = false;
                this.sendToast('close_persistent', null, null);
            }
        });

        // 从编辑器保存
        ipcMain.handle('screenshot:save', async (event, base64, explanation) => {
            try {
                const imageBuffer = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
                const result = await this.saveToKnowledgeBase(imageBuffer, explanation);

                if (result.success) {
                    this.sendToast('info', '保存成功', `截图已保存到:\n${result.path}`);
                } else {
                    this.sendToast('warning', '保存失败', result.error || '请检查文件夹配置');
                }

                this.isProcessing = false;
                this.sendToast('close_persistent', null, null);
                return result;
            } catch (error) {
                this.sendToast('error', '保存失败', error.message);
                this.isProcessing = false;
                this.sendToast('close_persistent', null, null);
                throw error;
            }
        });
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
     * 销毁管理器
     */
    destroy() {
        globalShortcut.unregister('Ctrl+Q');
        if (this.screenshotWindow) {
            this.screenshotWindow.close();
        }
        if (this.editorWindow) {
            this.editorWindow.close();
        }
    }
}

module.exports = ScreenshotManager;
