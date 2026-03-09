/**
 * 文字捕获模块
 * 获取当前活动窗口的选中文字或窗口标题文字
 */

const { clipboard, globalShortcut, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const SummarizeSkill = require('../agent/SummarizeSkill');
const WindowsKeyboard = require('./WindowsKeyboard');

const TEXT_EXPLANATION_TIMEOUT_MS = 10000;
const AI_TIMEOUT_TEXT = 'AI请求超时';

class TextCapture {
    constructor(mainWindow, hotkeyManager = null) {
        this.mainWindow = mainWindow;
        this.hotkeyManager = hotkeyManager;
        this.isProcessing = false;
        this.toolsDir = path.join(__dirname, '../../tools');
        this.confirmWindow = null;
        this.summarizeSkill = new SummarizeSkill();
        this.windowsKeyboard = new WindowsKeyboard();
    }

    /**
     * 显示文本确认浮窗并等待用户动作
     * @param {string} text
    * @returns {Promise<{action: 'copy_text'|'copy_explanation'|'auto_save'|'cancel', text: string, explanation: string}>}
     */
    async showTextConfirmWindow(text) {
        if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
            this.confirmWindow.focus();
            return { action: 'cancel', text: '' };
        }

        return new Promise((resolve) => {
            const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            const submitChannel = `textcapture:confirm-submit:${nonce}`;
            const cancelChannel = `textcapture:confirm-cancel:${nonce}`;
            const explanationChannel = `textcapture:confirm-explanation:${nonce}`;
            let settled = false;
            let explanationText = '';

            const finish = (action, finalText = '') => {
                if (settled) return;
                settled = true;
                ipcMain.removeListener(submitChannel, onSubmit);
                ipcMain.removeListener(cancelChannel, onCancel);
                resolve({
                    action,
                    text: String(finalText || ''),
                    explanation: String(explanationText || '')
                });
            };

            const onSubmit = (event, payload) => {
                const actionMap = {
                    copy_text: 'copy_text',
                    copy_explanation: 'copy_explanation',
                    auto_save: 'auto_save'
                };
                const action = actionMap[payload?.action] || 'cancel';
                const finalText = String(payload?.originalText || '').trim();
                const latestExplanation = String(payload?.explanationText || '').trim();
                if (latestExplanation) {
                    explanationText = latestExplanation;
                }
                finish(action, finalText);
                if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
                    this.confirmWindow.close();
                }
            };

            const onCancel = () => {
                finish('cancel', '');
                if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
                    this.confirmWindow.close();
                }
            };

            ipcMain.on(submitChannel, onSubmit);
            ipcMain.on(cancelChannel, onCancel);

            this.confirmWindow = new BrowserWindow({
                width: 560,
                height: 500,
                minWidth: 560,
                minHeight: 500,
                ...(this.mainWindow && !this.mainWindow.isDestroyed() ? { parent: this.mainWindow } : {}),
                modal: false,
                frame: false,
                resizable: true,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                skipTaskbar: true,
                alwaysOnTop: true,
                show: false,
                backgroundColor: '#11151a',
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            this.confirmWindow.loadFile(path.join(__dirname, '../textcapture/confirm-dialog.html'));
            let initialized = false;
            const initWindowFlow = () => {
                if (initialized) {
                    return;
                }
                initialized = true;
                if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
                    this.confirmWindow.center();
                    this.confirmWindow.show();
                    this.confirmWindow.focus();
                    this.sendConfirmWindowMessage('textcapture:confirm-data', {
                        originalText: text,
                        explanationText: '正在生成 AI 解释，请稍候...',
                        submitChannel,
                        cancelChannel,
                        explanationChannel
                    });

                    this.generateExplanation(text)
                        .then((aiText) => {
                            if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
                                explanationText = aiText;
                                this.sendConfirmWindowMessage(explanationChannel, {
                                    explanationText: aiText
                                });
                            }
                        })
                        .catch((err) => {
                            const fallback = `AI 解释生成失败: ${err.message || '未知错误'}`;
                            if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
                                explanationText = fallback;
                                this.sendConfirmWindowMessage(explanationChannel, {
                                    explanationText: fallback
                                });
                            }
                        });
                }
            };

            this.confirmWindow.once('ready-to-show', initWindowFlow);
            this.confirmWindow.webContents.once('did-finish-load', initWindowFlow);

            this.confirmWindow.on('closed', () => {
                this.confirmWindow = null;
                finish('cancel', '');
            });
        });
    }

    /**
     * 安全地向确认窗发送消息，避免窗口关闭竞态导致的异常
     * @param {string} channel
     * @param {any} payload
     */
    sendConfirmWindowMessage(channel, payload) {
        try {
            if (!this.confirmWindow || this.confirmWindow.isDestroyed()) {
                return;
            }
            const wc = this.confirmWindow.webContents;
            if (!wc || wc.isDestroyed()) {
                return;
            }
            wc.send(channel, payload);
        } catch (error) {
            console.warn('确认窗口消息发送失败:', error.message || error);
        }
    }

    /**
     * 生成 AI 解释文本
     * @param {string} text
     * @returns {Promise<string>}
     */
    async generateExplanation(text) {
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve(AI_TIMEOUT_TEXT), TEXT_EXPLANATION_TIMEOUT_MS);
        });
        const summarizePromise = this.summarizeSkill.summarizeText(text, 'zh');
        const explanation = String(await Promise.race([summarizePromise, timeoutPromise]) || '').trim();
        if (explanation === AI_TIMEOUT_TEXT) {
            return AI_TIMEOUT_TEXT;
        }
        if (!explanation) {
            throw new Error('未返回解释内容');
        }
        if (explanation.startsWith('❌')) {
            throw new Error(explanation.replace(/^❌\s*/, ''));
        }
        return explanation;
    }

    /**
     * 获取剪贴板中的文本（用户需先手动复制）
     * @returns {string|null}
     */
    getClipboardText() {
        try {
            const text = clipboard.readText();
            return text && text.trim() ? text.trim() : null;
        } catch (e) {
            console.error('读取剪贴板失败:', e);
            return null;
        }
    }

    /**
     * 严格模式：先模拟 Ctrl+C 复制，失败即中止
     * @returns {Promise<{success:boolean,error?:string}>}
     */
    async simulateCopyShortcut() {
        if (process.platform !== 'win32') {
            return { success: false, error: '当前平台不支持 Win32 复制注入' };
        }

        const result = this.windowsKeyboard.sendCtrlC();
        return result;
    }

    /**
     * 判断捕获内容是否明显是应用运行日志
     * @param {string} text
     * @returns {boolean}
     */
    isLikelyRuntimeLogText(text) {
        const value = String(text || '');
        if (!value) {
            return false;
        }

        const lines = value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            return false;
        }

        const patterns = [
            /^\[FileWatch\]/,
            /^捕获到文本，长度:/,
            /^✅\s*研知 Agent 已初始化/,
            /^可用技能:/,
            /^✅\s*使用\s+SiliconFlow:/,
            /^\(node:\d+\)/,
            /^UnhandledPromiseRejectionWarning/
        ];

        let matched = 0;
        for (const line of lines) {
            if (patterns.some((regex) => regex.test(line))) {
                matched += 1;
            }
        }

        return matched >= 2;
    }

    /**
     * 模拟 Ctrl+C 获取选中文本（需要先聚焦到目标窗口）
     * 注意：这种方法有局限性，因为 Electron 应用无法直接控制其他窗口
     */
    async getSelectedText() {
        // 这种方法在 Electron 中有限制，因为无法直接发送键盘事件到其他应用
        // 推荐使用 Python 方案作为备选
        return await this.getSelectedTextWithPython();
    }

    /**
     * 使用 Python 获取选中文本（作为备选方案）
     * @returns {Promise<string|null>}
     */
    async getSelectedTextWithPython() {
        return new Promise((resolve) => {
            const pythonCode = `
import sys
import ctypes
import time

# 使用 Windows API 获取剪贴板内容
try:
    ctypes.windll.user32.OpenClipboard(0)
    if ctypes.windll.user32.IsClipboardFormatAvailable(1):  # CF_TEXT
        h_mem = ctypes.windll.user32.GetClipboardData(1)
        ctypes.windll.kernel32.GlobalLock(h_mem)
        text = ctypes.c_char_p(h_mem).value.decode('gbk', errors='ignore')
        ctypes.windll.kernel32.GlobalUnlock(h_mem)
        print(f"RESULT:{{'success': True, 'text': {repr(text)}}}")
    else:
        # 尝试 Unicode 格式
        if ctypes.windll.user32.IsClipboardFormatAvailable(13):  # CF_UNICODETEXT
            h_mem = ctypes.windll.user32.GetClipboardData(13)
            ctypes.windll.kernel32.GlobalLock(h_mem)
            text = ctypes.c_wchar_p(h_mem).value
            ctypes.windll.kernel32.GlobalUnlock(h_mem)
            print(f"RESULT:{{'success': True, 'text': {repr(text)}}}")
        else:
            print("RESULT:{'success': False, 'error': '剪贴板无文本'}")
    ctypes.windll.user32.CloseClipboard()
except Exception as e:
    print(f"RESULT:{{'success': False, 'error': {repr(str(e))}}}")
`;

            const proc = spawn('python', ['-c', pythonCode], {
                cwd: this.toolsDir,
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
                        if (result.success && result.text) {
                            resolve(result.text.trim());
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });

            proc.on('error', () => {
                resolve(null);
            });
        });
    }

    /**
     * 保存文本到知识库（调用 Python choose_to_save.py）
     * @param {string} text
     * @param {string} description
     * @returns {Promise<object>}
     */
    async saveToKnowledgeBase(text, description = '') {
        return new Promise((resolve) => {
            const pythonCode = `
import sys
import json
sys.path.insert(0, r'${this.toolsDir.replace(/\\/g, '/')}')

try:
    from choose_to_save import ContentManager, InputType
    manager = ContentManager()
    result = manager.save_content(InputType.TEXT, None, description=${description ? JSON.stringify(description) : 'None'}, text_content=${JSON.stringify(text)})
    print("RESULT:" + json.dumps({"success": True, "path": result} if result else {"success": False, "error": "保存失败"}))
except Exception as e:
    print("RESULT:" + json.dumps({"success": False, "error": str(e)}))
`;

            const proc = spawn('python', ['-c', pythonCode], {
                cwd: this.toolsDir,
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
                        resolve(JSON.parse(match[1]));
                    } catch (e) {
                        resolve({ success: false, error: '解析失败' });
                    }
                } else {
                    resolve({ success: false, error: '无输出' });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * 主流程：捕获并保存文本
     */
    async captureAndSave() {
        if (this.isProcessing) {
            this.sendToast('busy', '请稍候', '正在处理，请稍后再试');
            return;
        }

        this.isProcessing = true;
        this.sendToast('persistent', '文字捕获', '正在复制选中文本...');

        try {
            // 先向当前活动窗口发送 Ctrl+C
            const copyResult = await this.simulateCopyShortcut();
            if (!copyResult.success) {
                this.sendToast('error', '自动复制失败', copyResult.error || '无法发送 Ctrl+C');
                return;
            }

            // 等待系统剪贴板稳定
            await new Promise(resolve => setTimeout(resolve, 160));

            this.sendToast('persistent', '文字捕获', '正在读取剪贴板...');

            // 获取剪贴板文本
            const text = this.getClipboardText();

            if (!text) {
                this.sendToast('warning', '未检测到文本', '请先选中文本后按 Ctrl+B');
                this.isProcessing = false;
                this.sendToast('close_persistent', null, null);
                return;
            }

            if (this.isLikelyRuntimeLogText(text)) {
                this.sendToast('warning', '剪贴板内容异常', '检测到当前剪贴板是运行日志，请先复制目标文本后再按 Ctrl+B');
                return;
            }

            console.log('捕获到文本，长度:', text.length);

            const confirmResult = await this.showTextConfirmWindow(text);
            const action = confirmResult?.action || 'cancel';
            const finalText = String(confirmResult?.text || '').trim();
            const explanationText = String(confirmResult?.explanation || '').trim();

            if (action === 'cancel') {
                return;
            }

            if (action === 'copy_text') {
                if (!finalText) {
                    this.sendToast('warning', '内容为空', '原始文本为空，无法复制');
                    return;
                }
                clipboard.writeText(finalText);
                this.sendToast('success', '复制成功', '文字已复制到剪贴板');
                return;
            }

            if (action === 'copy_explanation') {
                if (!explanationText || explanationText.startsWith('正在生成 AI 解释')) {
                    this.sendToast('warning', '解释未就绪', 'AI 解释尚未生成完成，请稍后重试');
                    return;
                }
                clipboard.writeText(explanationText);
                this.sendToast('success', '复制成功', 'AI 解释已复制到剪贴板');
                return;
            }

            const saveBody = [
                '原始文本:',
                finalText,
                '',
                'AI 解释:',
                explanationText || 'AI 解释生成失败或为空'
            ].join('\n');

            const result = await this.saveToKnowledgeBase(saveBody, '用户选中的文字（原文+解释）');
            if (result.success) {
                this.sendToast('success', '保存成功', `内容已自动保存到:\n${result.path}`);
            } else {
                this.sendToast('error', '保存失败', result.error || '请检查配置');
            }

        } catch (error) {
            console.error('文字捕获失败:', error);
            this.sendToast('error', '文字捕获失败', error.message);
        } finally {
            this.isProcessing = false;
            this.sendToast('close_persistent', null, null);
        }
    }

    /**
     * 显示提示 Toast（教用户如何使用）
     */
    showUsageTip() {
        this.sendToast('info', '文字保存使用说明', '1. 选中要保存的文字\n2. 直接按 Ctrl+B\n\n程序会自动复制并弹出确认窗口');
    }

    /**
     * 注册全局快捷键 Ctrl+B
     */
    registerShortcut() {
        if (this.hotkeyManager) {
            const success = this.hotkeyManager.register('Ctrl+B', () => {
                if (!this.isProcessing) {
                    this.captureAndSave().catch((err) => {
                        console.error('Ctrl+B 执行失败:', err);
                    });
                }
            }, '保存选中文字');
            if (!success) {
                console.error('❌ 文字捕获快捷键注册失败');
            } else {
                console.log('✅ 文字捕获快捷键已注册：Ctrl+B');
            }
        } else {
            const { globalShortcut } = require('electron');
            const registered = globalShortcut.register('Ctrl+B', () => {
                if (!this.isProcessing) {
                    this.captureAndSave().catch((err) => {
                        console.error('Ctrl+B 执行失败:', err);
                    });
                }
            });
            if (registered) {
                console.log('✅ 文字捕获快捷键已注册：Ctrl+B');
            } else {
                console.error('❌ 文字捕获快捷键注册失败');
            }
        }
    }

    /**
     * 发送 Toast 通知
     */
    sendToast(type, title, message) {
        try {
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                return;
            }
            const wc = this.mainWindow.webContents;
            if (!wc || wc.isDestroyed()) {
                return;
            }
            wc.send('toast:show', { type, title, message });
        } catch (error) {
            console.warn('Toast 发送失败:', error.message || error);
        }
    }

    /**
     * 销毁管理器
     */
    destroy() {
        if (this.confirmWindow && !this.confirmWindow.isDestroyed()) {
            this.confirmWindow.close();
        }
        if (this.hotkeyManager) {
            this.hotkeyManager.unregister('Ctrl+B');
        } else {
            globalShortcut.unregister('Ctrl+B');
        }
    }
}

module.exports = TextCapture;
