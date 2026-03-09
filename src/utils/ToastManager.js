/**
 * Toast 通知管理器
 * 在右下角显示非阻塞提示消息
 */

class ToastManager {
    constructor(container = null) {
        this.container = container || document.body;
        this.toasts = [];
        this.persistentToast = null;
        this.maxToasts = 5; // 最多同时显示 5 个 toast
    }

    /**
     * 显示 Toast 通知
     * @param {string} type - 消息类型 (info/success/warning/error/busy/persistent)
     * @param {string} title - 标题
     * @param {string} message - 消息内容
     * @param {number} duration - 显示时长（毫秒），persistent 时忽略
     */
    show(type, title, message, duration = 3000) {
        // 如果是 persistent，先关闭之前的
        if (type === 'persistent' || type === 'close_persistent') {
            this.closePersistent();
            if (type === 'close_persistent') {
                return;
            }
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // 图标
        const icons = {
            'info': 'ℹ️',
            'success': '✔️',
            'warning': '⚠️',
            'error': '❌',
            'busy': '⏳',
            'persistent': '⏳'
        };
        const icon = icons[type] || 'ℹ️';

        // 背景色
        const bgColors = {
            'info': '#1976d2',
            'success': '#388e3c',
            'warning': '#f57c00',
            'error': '#d32f2f',
            'busy': '#f57c00',
            'persistent': '#1976d4'
        };
        const bgColor = bgColors[type] || '#333';

        toast.style.cssText = `
            position: fixed;
            right: 20px;
            background: ${bgColor};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 300px;
            max-width: 400px;
            margin-bottom: 10px;
            animation: slideIn 0.3s ease;
            cursor: pointer;
        `;

        toast.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 20px; line-height: 1;">${icon}</span>
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px;">${title}</div>
                    <div style="font-size: 13px; line-height: 1.4; opacity: 0.9;">${message.replace(/\n/g, '<br>')}</div>
                </div>
            </div>
        `;

        // 添加到容器
        this.container.appendChild(toast);

        // 计算位置（堆叠显示）
        this._updatePositions();

        // 如果不是 persistent，设置自动关闭
        if (type !== 'persistent') {
            const toastId = Date.now();
            toast.dataset.id = toastId;

            setTimeout(() => {
                this.close(toastId);
            }, duration);

            // 点击关闭
            toast.addEventListener('click', () => {
                this.close(toastId);
            });

            this.toasts.push({ id: toastId, element: toast });
        } else {
            this.persistentToast = toast;
        }

        // 添加动画样式
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        return toast;
    }

    /**
     * 关闭指定 toast
     * @param {number} toastId
     */
    close(toastId) {
        const index = this.toasts.findIndex(t => t.id === toastId);
        if (index === -1) return;

        const toast = this.toasts[index].element;
        toast.style.animation = 'slideOut 0.3s ease';

        setTimeout(() => {
            toast.remove();
        }, 300);

        this.toasts.splice(index, 1);

        // 更新其他 toast 位置
        setTimeout(() => {
            this._updatePositions();
        }, 300);
    }

    /**
     * 关闭 persistent toast
     */
    closePersistent() {
        if (this.persistentToast) {
            this.persistentToast.remove();
            this.persistentToast = null;
            this._updatePositions();
        }
    }

    /**
     * 更新所有 toast 的位置
     */
    _updatePositions() {
        let offset = 0;
        const bottomMargin = 60;

        // persistent toast 在最底部
        if (this.persistentToast) {
            this.persistentToast.style.bottom = `${bottomMargin}px`;
            offset += 110; // toast 高度 + 间距
        }

        // 其他 toast 依次向上堆叠
        this.toasts.forEach((toast, index) => {
            toast.element.style.bottom = `${bottomMargin + offset}px`;
            offset += 100;
        });
    }

    /**
     * 便捷方法
     */
    info(title, message, duration = 3000) {
        this.show('info', title, message, duration);
    }

    success(title, message, duration = 3000) {
        this.show('success', title, message, duration);
    }

    warning(title, message, duration = 3000) {
        this.show('warning', title, message, duration);
    }

    error(title, message, duration = 5000) {
        this.show('error', title, message, duration);
    }

    busy(title, message) {
        this.show('busy', title, message, 2000);
    }

    persistent(title, message) {
        this.show('persistent', title, message);
    }
}

// 全局实例（用于渲染进程）
window.toastManager = null;

// 初始化（如果在渲染进程）
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.toastManager = new ToastManager();

    // 监听主进程的 toast 事件
    const { ipcRenderer } = require ? require('electron') : null;
    if (ipcRenderer) {
        ipcRenderer.on('toast:show', (event, { type, title, message }) => {
            window.toastManager.show(type, title, message);
        });
    }
}

module.exports = ToastManager;
