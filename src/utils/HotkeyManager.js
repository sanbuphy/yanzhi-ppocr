/**
 * 全局快捷键管理器
 * 注册和管理所有全局快捷键
 */

const { globalShortcut } = require('electron');

class HotkeyManager {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.registered = new Map();
    }

    /**
     * 注册快捷键
     * @param {string} accelerator - 快捷键组合
     * @param {Function} callback - 回调函数
     * @param {string} description - 描述
     */
    register(accelerator, callback, description = '') {
        try {
            const success = globalShortcut.register(accelerator, callback);
            if (success) {
                this.registered.set(accelerator, { callback, description });
                console.log(`✅ 快捷键已注册：${accelerator} - ${description}`);
                return true;
            } else {
                console.error(`❌ 快捷键注册失败：${accelerator}`);
                return false;
            }
        } catch (error) {
            console.error(`❌ 快捷键注册错误：${accelerator}`, error);
            return false;
        }
    }

    /**
     * 注销快捷键
     * @param {string} accelerator
     */
    unregister(accelerator) {
        globalShortcut.unregister(accelerator);
        this.registered.delete(accelerator);
        console.log(`🚫 已注销快捷键：${accelerator}`);
    }

    /**
     * 注销所有快捷键
     */
    unregisterAll() {
        for (const [accelerator] of this.registered) {
            this.unregister(accelerator);
        }
        console.log('🚫 已注销所有快捷键');
    }

    /**
     * 检查快捷键是否已注册
     * @param {string} accelerator
     */
    isRegistered(accelerator) {
        return this.registered.has(accelerator);
    }

    /**
     * 获取所有已注册的快捷键
     */
    getRegistered() {
        return Array.from(this.registered.entries()).map(([key, value]) => ({
            accelerator: key,
            description: value.description
        }));
    }
}

// 创建全局实例
let hotkeyManager = null;

/**
 * 初始化快捷键管理器
 * @param {BrowserWindow} mainWindow
 * @returns {HotkeyManager}
 */
function initHotkeyManager(mainWindow) {
    if (!hotkeyManager) {
        hotkeyManager = new HotkeyManager(mainWindow);
    }
    return hotkeyManager;
}

/**
 * 获取快捷键管理器实例
 */
function getHotkeyManager() {
    return hotkeyManager;
}

module.exports = {
    HotkeyManager,
    initHotkeyManager,
    getHotkeyManager
};
