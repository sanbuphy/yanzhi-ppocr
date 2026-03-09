const fs = require('fs');
const path = require('path');

class ScheduleSkill {
    constructor(configPath = null) {
        this.configPath = configPath || path.join(__dirname, '../../tools/scheduled_searches.json');
        this.schedules = this.loadSchedules();
    }

    loadSchedules() {
        if (!fs.existsSync(this.configPath)) {
            return [];
        }
        try {
            const data = fs.readFileSync(this.configPath, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed.schedules || [];
        } catch (e) {
            console.warn('⚠️ 定时任务配置加载失败:', e.message);
            return [];
        }
    }

    saveSchedules() {
        try {
            // 确保目录存在
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify({ schedules: this.schedules }, null, 2), 'utf-8');
            return true;
        } catch (e) {
            console.error('保存失败:', e);
            return false;
        }
    }

    addSchedule(keyword, time, repeat = 'daily', enabled = true) {
        // 验证时间格式
        const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
        if (!timeMatch) {
            return { success: false, error: '时间格式错误，应为 HH:MM' };
        }

        const validRepeats = ['daily', 'weekdays', 'weekly'];
        if (!validRepeats.includes(repeat)) {
            repeat = 'daily';
        }

        const schedule = {
            id: Date.now().toString(),
            keyword,
            time,
            repeat,
            enabled,
            createdAt: new Date().toISOString()
        };

        this.schedules.push(schedule);
        if (this.saveSchedules()) {
            return { success: true, schedule };
        }
        this.schedules.pop();
        return { success: false, error: '保存失败' };
    }

    removeSchedule(scheduleId) {
        const originalLength = this.schedules.length;
        this.schedules = this.schedules.filter(s => s.id !== scheduleId);
        if (this.schedules.length < originalLength) {
            this.saveSchedules();
            return true;
        }
        return false;
    }

    updateSchedule(scheduleId, updates) {
        const schedule = this.schedules.find(s => s.id === scheduleId);
        if (!schedule) {
            return { success: false, error: '任务不存在' };
        }

        // 验证时间格式
        if (updates.time) {
            const timeMatch = updates.time.match(/^(\d{1,2}):(\d{2})$/);
            if (!timeMatch) {
                return { success: false, error: '时间格式错误，应为 HH:MM' };
            }
        }

        // 验证 repeat
        if (updates.repeat) {
            const validRepeats = ['daily', 'weekdays', 'weekly'];
            if (!validRepeats.includes(updates.repeat)) {
                return { success: false, error: '无效的重复类型' };
            }
        }

        Object.assign(schedule, updates, { updatedAt: new Date().toISOString() });
        this.saveSchedules();
        return { success: true, schedule };
    }

    toggleSchedule(scheduleId) {
        const schedule = this.schedules.find(s => s.id === scheduleId);
        if (!schedule) {
            return { success: false, error: '任务不存在' };
        }
        schedule.enabled = !schedule.enabled;
        this.saveSchedules();
        return { success: true, enabled: schedule.enabled };
    }

    listSchedules(onlyEnabled = false) {
        if (onlyEnabled) {
            return this.schedules.filter(s => s.enabled);
        }
        return this.schedules;
    }

    getSchedule(scheduleId) {
        return this.schedules.find(s => s.id === scheduleId);
    }

    /**
     * 检查并返回当前时间需要触发的任务
     * @returns {Array} 需要触发的任务列表
     */
    checkAndTrigger() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentDay = now.getDay(); // 0 = Sunday

        return this.schedules.filter(schedule => {
            if (!schedule.enabled) return false;

            const [scheduleHour, scheduleMinute] = schedule.time.split(':').map(Number);
            if (currentHour !== scheduleHour || currentMinute !== scheduleMinute) {
                return false;
            }

            const repeat = schedule.repeat || 'daily';
            if (repeat === 'daily') return true;
            if (repeat === 'weekdays') return currentDay >= 1 && currentDay <= 5;
            if (repeat === 'weekly') return currentDay === 1;
            return false;
        });
    }

    /**
     * 格式化任务列表为可读文本
     */
    formatSchedules(schedules = null) {
        const list = schedules || this.schedules;
        if (!list || list.length === 0) {
            return '暂无定时任务';
        }

        const repeatLabels = {
            'daily': '每天',
            'weekdays': '工作日',
            'weekly': '每周一'
        };

        return list.map((s, i) => {
            const status = s.enabled ? '✅' : '❌';
            const repeat = repeatLabels[s.repeat] || s.repeat;
            return `${status} [${s.id}] ${s.time} ${repeat} - "${s.keyword}"`;
        }).join('\n');
    }
}

module.exports = ScheduleSkill;