const { getAIClient } = require('../screenshot/aiClient');
const { readPdf } = require('../utils/AIProvider');

class SummarizeSkill {
    async summarize(content, contentType = 'text', language = 'zh') {
        if (contentType === 'text') {
            return this.summarizeText(content, language);
        } else if (contentType === 'image') {
            return this.summarizeImage(content, language);
        } else if (contentType === 'pdf') {
            return this.summarizePdf(content, language);
        }
        return { error: `不支持的内容类型：${contentType}` };
    }

    async summarizeText(text, language = 'zh') {
        const prompt = language === 'en'
            ? `Please summarize the following content concisely.\n\nContent:\n${text.substring(0, 4000)}\n\nRequirements:\n1. Extract main points\n2. Explain key concepts\n3. Use clear academic language`
            : `请总结以下内容，提取核心要点。\n\n内容：\n${text.substring(0, 4000)}\n\n要求：\n1. 概括主要内容和核心贡献\n2. 解释关键技术概念\n3. 使用清晰、专业的学术语言`;

        try {
            const client = getAIClient('你是一个专业的科研助手，擅长阅读和总结学术论文。');
            return await client.ask(prompt, null, 0.5, 2000);
        } catch (e) {
            return `❌ 总结失败：${e.message}`;
        }
    }

    async summarizeImage(imagePath, language = 'zh') {
        const prompt = language === 'en'
            ? 'Please analyze this image and summarize its content in English.'
            : '请分析这张图片并用中文总结其内容。如果是图表、公式或技术内容，请详细解释。';

        try {
            const client = getAIClient('你是一个图像分析助手。');
            return await client.ask(prompt, imagePath, 0.5, 2000);
        } catch (e) {
            return `❌ 图片分析失败：${e.message}`;
        }
    }

    async summarizePdf(pdfPath, language = 'zh') {
        try {
            const result = await readPdf(pdfPath, 5);
            if (!result.success) {
                return `❌ PDF 读取失败：${result.error}`;
            }
            return await this.summarizeText(result.content, language);
        } catch (e) {
            return `❌ PDF 总结失败：${e.message}`;
        }
    }
}

module.exports = SummarizeSkill;