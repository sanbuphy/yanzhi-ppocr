const path = require('path');

let koffi = null;

try {
    // Delay-load native dependency so app can still run with graceful fallback.
    // eslint-disable-next-line global-require
    koffi = require('koffi');
} catch (error) {
    koffi = null;
}

class WindowsKeyboard {
    constructor() {
        this.available = false;
        this.keybdEvent = null;

        if (process.platform !== 'win32' || !koffi) {
            return;
        }

        try {
            const user32 = koffi.load('user32.dll');
            // void keybd_event(BYTE bVk, BYTE bScan, DWORD dwFlags, ULONG_PTR dwExtraInfo);
            this.keybdEvent = user32.func('void keybd_event(uint8, uint8, uint32, uintptr_t)');
            this.available = true;
        } catch (error) {
            this.available = false;
            this.keybdEvent = null;
        }
    }

    isAvailable() {
        return this.available && typeof this.keybdEvent === 'function';
    }

    sendCtrlC() {
        if (!this.isAvailable()) {
            return { success: false, error: 'Win32 键盘注入不可用（koffi 未加载或平台不支持）' };
        }

        const VK_CONTROL = 0x11;
        const VK_C = 0x43;
        const KEYEVENTF_KEYUP = 0x0002;

        try {
            this.keybdEvent(VK_CONTROL, 0, 0, 0);
            this.keybdEvent(VK_C, 0, 0, 0);
            this.keybdEvent(VK_C, 0, KEYEVENTF_KEYUP, 0);
            this.keybdEvent(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message || String(error) };
        }
    }
}

module.exports = WindowsKeyboard;
