const { searchArxiv } = require('../utils/AIProvider');

class RecommendSkill {
    constructor() {
        this.maxResults = 10;
    }

    async recommend(query, maxResults = 5) {
        return this.searchPapers(query, maxResults);
    }

    async searchPapers(query, maxResults = 5, sortBy = 'submittedDate', sortOrder = 'descending') {
        try {
            const result = await searchArxiv(query, maxResults);
            if (!result.success) {
                return [];
            }
            return result.papers || [];
        } catch (e) {
            console.error('搜索失败:', e.message);
            return [];
        }
    }

    async searchByLogic(keywords, logic = 'AND', maxResults = 5) {
        const query = keywords.map(kw => `all:${kw}`).join(` ${logic} `);
        return this.searchPapers(query, maxResults);
    }

    async getRecentPapers(category, days = 7, maxResults = 5) {
        // 计算日期范围
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startStr = startDate.toISOString().replace(/[-:T]/g, '').substring(0, 8) + '000000';

        const query = `cat:${category} AND submittedDate:[${startStr} TO *]`;
        return this.searchPapers(query, maxResults);
    }

    /**
     * 格式化论文列表为可读文本
     * @param {Array} papers - 论文列表
     * @param {string} format - 格式 'text' | 'markdown' | 'json'
     */
    formatPapers(papers, format = 'markdown') {
        if (!papers || papers.length === 0) {
            return '未找到相关论文';
        }

        if (format === 'json') {
            return JSON.stringify(papers, null, 2);
        }

        if (format === 'text') {
            return papers.map((p, i) => {
                let text = `${i + 1}. ${p.title}\n`;
                text += `   作者: ${p.authors ? p.authors.join(', ') : '未知'}\n`;
                text += `   发布: ${p.published || '未知'}\n`;
                text += `   PDF: ${p.pdfUrl || '无'}\n`;
                return text;
            }).join('\n');
        }

        // markdown 格式
        return papers.map((p, i) => {
            let md = `### ${i + 1}. ${p.title}\n`;
            md += `**作者**: ${p.authors ? p.authors.join(', ') : '未知'}\n`;
            md += `**发布**: ${p.published || '未知'}\n`;
            if (p.pdfUrl) {
                md += `**PDF**: [下载链接](${p.pdfUrl})\n`;
            }
            if (p.arxivId) {
                md += `**arXiv**: ${p.arxivId}\n`;
            }
            if (p.summary || p.abstract) {
                const summary = (p.summary || p.abstract).substring(0, 200);
                md += `\n> ${summary}${summary.length >= 200 ? '...' : ''}\n`;
            }
            return md;
        }).join('\n---\n\n');
    }
}

// arXiv 常用分类
const ARXIV_CATEGORIES = {
    'cs.AI': '人工智能',
    'cs.CL': '计算语言学',
    'cs.CV': '计算机视觉',
    'cs.LG': '机器学习',
    'cs.NE': '神经网络',
    'cs.IR': '信息检索',
    'cs.SE': '软件工程',
    'cs.DB': '数据库',
    'cs.DC': '分布式计算',
    'cs.CR': '密码学与安全',
    'physics.med-ph': '医学物理',
    'q-bio.GN': '基因组学',
    'q-bio.QM': '定量方法',
    'math.NA': '数值分析',
    'stat.ML': '统计机器学习'
};

module.exports = { RecommendSkill, ARXIV_CATEGORIES };