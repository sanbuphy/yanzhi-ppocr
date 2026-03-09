const fs = require('fs');
const path = require('path');
const { getAIClient } = require('../screenshot/aiClient');

class ClassifySkill {
    constructor(configPath = null) {
        this.configPath = configPath || path.join(__dirname, '../../tools/folder_structure.json');
        this.folderConfig = this.loadConfig();
    }

    loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            return { folders: [] };
        }
        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.warn('⚠️ 文件夹配置加载失败:', e.message);
            return { folders: [] };
        }
    }

    getFoldersInfo() {
        if (!this.folderConfig.folders || !this.folderConfig.folders.length) {
            return '无可用文件夹';
        }
        return this.folderConfig.folders
            .map(f => `- ${f.name}: ${f.description || '无描述'}`)
            .join('\n');
    }

    async classify(content, contentType = 'text') {
        if (!this.folderConfig.folders || !this.folderConfig.folders.length) {
            return { error: '没有可用的文件夹配置' };
        }

        const foldersInfo = this.getFoldersInfo();
        const prompt = `请根据以下内容描述，从给定的文件夹中选择最合适的一个进行分类。

内容描述：
${content.substring(0, 1000)}

可用文件夹列表：
${foldersInfo}

请严格按照以下 JSON 格式返回：
{
    "folder_name": "文件夹名称",
    "reason": "选择理由",
    "confidence": 0.85
}`;

        try {
            const client = getAIClient('你是一个专业的科研知识管理助手，擅长根据内容主题进行归类。');
            const response = await client.ask(prompt, null, 0.3, 500);

            // 解析 JSON 结果
            let jsonStr = response.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
            }
            return JSON.parse(jsonStr);
        } catch (e) {
            return { error: '解析失败', raw: e.message };
        }
    }
}

module.exports = ClassifySkill;