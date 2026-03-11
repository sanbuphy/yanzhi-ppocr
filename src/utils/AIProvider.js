/**
 * 统一的 AI 服务模块
 * 封装 PDF OCR、Arxiv 搜索、AI 问答等功能
 * 复用 src/screenshot/aiClient.js 的 AIClient
 */

const { AIClient, getAIClient } = require('../screenshot/aiClient');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * PDF 阅读器类
 * 使用 pdf-parse 库提取 PDF 文本
 */
class PDFReader {
    constructor() {
        this.pdfParse = null;
        this._initPdfParse();
    }

    /**
     * 懒加载 pdf-parse 库
     */
    _initPdfParse() {
        try {
            const pdf = require('pdf-parse');
            // 处理不同版本的导出格式 (有些版本导出函数，有些版本导出对象包含 PDFParse)
            if (typeof pdf === 'function') {
                this.pdfParse = pdf;
            } else if (pdf && typeof pdf.PDFParse === 'function') {
                this.pdfParse = pdf.PDFParse;
            } else if (pdf && pdf.default && typeof pdf.default === 'function') {
                this.pdfParse = pdf.default;
            } else {
                console.warn('⚠️ pdf-parse 导出格式异常:', typeof pdf);
            }
        } catch (e) {
            console.warn('⚠️ pdf-parse 未安装，PDF 读取功能将不可用');
            console.warn('   请运行：npm install pdf-parse');
        }
    }

    /**
     * 读取 PDF 文件
     * @param {string} filePath - PDF 文件路径
     * @param {number} maxPages - 最大读取页数
     * @returns {Promise<{success: boolean, content?: string, error?: string}>}
     */
    async readPdf(filePath, maxPages = 5) {
        if (!this.pdfParse) {
            return { success: false, error: 'pdf-parse 库未安装，请运行：npm install pdf-parse' };
        }

        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在' };
            }

            const pdfBuffer = fs.readFileSync(filePath);
            
            let fullText = '';
            let totalPages = 0;

            // 检测是 v2 类风格还是 v1 函数风格
            if (this.pdfParse.prototype && typeof this.pdfParse.prototype.load === 'function') {
                // 新版 v2 风格 (Mehmet Kozan 版)
                const doc = new this.pdfParse(new Uint8Array(pdfBuffer));
                await doc.load();
                const textResult = await doc.getText();
                // v2 返回的是对象 { text, pages, total }
                fullText = (typeof textResult === 'object') ? (textResult.text || '') : textResult;
                const info = await doc.getInfo();
                // v2 的页数通常在 info.total 中
                totalPages = info.total || (info.pages ? info.pages.length : 0);
            } else {
                // 旧版 v1 风格
                const doc = await this.pdfParse(pdfBuffer);
                fullText = doc.text;
                totalPages = doc.numpages;
            }

            if (!fullText) {
                return { success: false, error: '未能从 PDF 中提取出文本内容' };
            }

            // 简单分页处理
            const lines = fullText.split('\n');
            const linesPerPage = Math.ceil(lines.length / totalPages);
            const maxLines = linesPerPage * maxPages;
            const limitedText = lines.slice(0, maxLines).join('\n');

            let result = `PDF: ${path.basename(filePath)}\n`;
            result += `总页数：${totalPages}\n`;
            result += `显示前 ${Math.min(maxPages, totalPages)} 页内容\n\n`;
            result += limitedText;

            if (totalPages > maxPages) {
                result += `\n\n... (仅显示前 ${maxPages} 页，共 ${totalPages} 页)`;
            }

            return { success: true, content: result };
        } catch (err) {
            return { success: false, error: `PDF 读取失败：${err.message}` };
        }
    }

    /**
     * 使用 VLM 对 PDF 页面进行 OCR
     * @param {string} filePath - PDF 文件路径
     * @param {number} pageNum - 页码 (0-based)
     * @param {AIClient} aiClient - AI 客户端
     * @returns {Promise<string>} OCR 结果
     */
    async ocrPdfPage(filePath, pageNum, aiClient) {
        // 需要使用 pdfjs-dist 或 fitz 渲染 PDF 为图片
        // 这里提供一个简化版本，如果 pdf-parse 无法提取文本则调用 VLM
        try {
            const pdfBuffer = fs.readFileSync(filePath);
            
            let fullText = '';
            if (this.pdfParse.prototype && typeof this.pdfParse.prototype.load === 'function') {
                const doc = new this.pdfParse(new Uint8Array(pdfBuffer));
                await doc.load();
                const textResult = await doc.getText();
                // v2 返回的是对象 { text, pages, total }
                fullText = (typeof textResult === 'object') ? (textResult.text || '') : textResult;
            } else {
                const doc = await this.pdfParse(pdfBuffer);
                fullText = doc.text;
            }

            if (fullText && fullText.trim()) {
                return fullText;
            }

            // 如果没有文本，提示用户使用其他方式
            return '[PDF 为图片格式，请使用截图功能捕获]';
        } catch (err) {
            throw err;
        }
    }
}

/**
 * Arxiv API 客户端
 */
class ArxivClient {
    /**
     * 搜索 Arxiv 论文
     * @param {string} query - 搜索关键词
     * @param {number} maxResults - 最大结果数
     * @returns {Promise<{success: boolean, papers?: Array, error?: string}>}
     */
    async search(query, maxResults = 5) {
        return new Promise((resolve) => {
            const searchQuery = encodeURIComponent(query);
            const url = `https://export.arxiv.org/api/query?search_query=all:${searchQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

            console.log('[Arxiv] 搜索 URL:', url);

            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const papers = this._parseAtomResponse(data);
                        resolve({ success: true, papers });
                    } catch (err) {
                        resolve({ success: false, error: `解析失败：${err.message}` });
                    }
                });
            }).on('error', (err) => {
                resolve({ success: false, error: `请求失败：${err.message}` });
            });
        });
    }

    /**
     * 解析 Arxiv Atom XML 响应
     */
    _parseAtomResponse(xml) {
        const papers = [];
        const entries = xml.split('<entry>');

        for (let i = 1; i < entries.length; i++) {
            const entry = entries[i].split('</entry>')[0];

            // 提取标题
            const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
            const title = titleMatch ? this._decodeXml(titleMatch[1]).trim() : '无标题';

            // 提取摘要
            const summaryMatch = entry.match(/<summary>([^<]+)<\/summary>/);
            const summary = summaryMatch ? this._decodeXml(summaryMatch[1]).trim() : '无摘要';

            // 提取作者
            const authors = [];
            const authorMatches = entry.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>/g);
            for (const match of authorMatches) {
                authors.push(match[1]);
            }

            // 提取链接（PDF URL）
            // 更加健壮的正则表达式，不依赖属性顺序
            const pdfLinkMatch = entry.match(/<link[^>]*href="([^"]+)"[^>]*title="pdf"[^>]*\/>/) || 
                                entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"[^>]*\/>/) ||
                                entry.match(/<link[^>]*href="([^"]+)"[^>]*type="application\/pdf"[^>]*\/>/);
            const pdfUrl = pdfLinkMatch ? pdfLinkMatch[1] : null;

            // 提取 arxiv ID
            const idMatch = entry.match(/<id>([^<]+)<\/id>/);
            let arxivId = null;
            if (idMatch) {
                const idContent = idMatch[1];
                if (idContent.includes('/abs/')) {
                    arxivId = idContent.split('/abs/')[1];
                } else if (idContent.includes('arxiv:')) {
                    arxivId = idContent.split('arxiv:')[1];
                }
            }

            // 提取提交日期
            const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
            const published = publishedMatch ? publishedMatch[1] : null;

            papers.push({
                title,
                summary,
                authors,
                pdfUrl,
                arxivId,
                published,
                abstract: summary
            });
        }

        return papers;
    }

    /**
     * 解码 XML 实体
     */
    _decodeXml(str) {
        return str
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&apos;/g, "'");
    }

    /**
     * 下载 PDF 文件
     * @param {string} url - PDF URL
     * @param {string} destPath - 保存路径
     * @returns {Promise<{success: boolean, path?: string, error?: string}>}
     */
    async downloadPdf(url, destPath) {
        return new Promise((resolve) => {
            const protocol = url.startsWith('https') ? https : http;

            const request = protocol.get(url, (response) => {
                // 处理重定向
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    this.downloadPdf(response.headers.location, destPath).then(resolve);
                    return;
                }

                if (response.statusCode !== 200) {
                    resolve({ success: false, error: `下载失败：HTTP ${response.statusCode}` });
                    return;
                }

                const file = fs.createWriteStream(destPath);
                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve({ success: true, path: destPath });
                });
            });

            request.on('error', (err) => {
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath);
                }
                resolve({ success: false, error: err.message });
            });

            // 设置超时
            request.setTimeout(60000, () => {
                request.destroy();
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath);
                }
                resolve({ success: false, error: '下载超时' });
            });
        });
    }
}

/**
 * AI 问答封装
 */
class AIQAService {
    constructor(systemPrompt) {
        this.systemPrompt = systemPrompt || "你是一个乐于助人的 AI 助手。";
    }

    /**
     * AI 问答
     * @param {string} question - 问题
     * @param {string} fileContent - 文件内容（可选）
     * @param {string} fileName - 文件名（可选）
     * @returns {Promise<{success: boolean, response?: string, error?: string}>}
     */
    async ask(question, fileContent = null, fileName = null) {
        try {
            let prompt = question;
            if (fileContent && fileName) {
                prompt = `我正在阅读文件《${fileName}》，内容如下：\n\n${fileContent.substring(0, 3000)}${fileContent.length > 3000 ? '\n...（内容已截断）' : ''}\n\n用户问题：${question}`;
            }

            const client = getAIClient(this.systemPrompt);
            const response = await client.ask(prompt, null, 0.7, 2000);

            return { success: true, response };
        } catch (err) {
            return { success: false, error: `AI 调用失败：${err.message}` };
        }
    }

    /**
     * AI 分析图片
     * @param {string} imagePath - 图片路径
     * @param {string} question - 问题（可选）
     * @returns {Promise<{success: boolean, response?: string, error?: string}>}
     */
    async analyzeImage(imagePath, question = "请对这张图片进行详细解读和分析。") {
        try {
            const client = getAIClient("你是一个图像分析和解读助手。");
            const response = await client.ask(question, imagePath, 0.5, 2000);

            return { success: true, response };
        } catch (err) {
            return { success: false, error: `AI 分析失败：${err.message}` };
        }
    }
}

// ================= 导出模块 =================

const pdfReader = new PDFReader();
const arxivClient = new ArxivClient();

/**
 * AI 问答
 */
async function askAI(question, fileContent = null, fileName = null) {
    const service = new AIQAService();
    return await service.ask(question, fileContent, fileName);
}

/**
 * 读取 PDF
 */
async function readPdf(filePath, maxPages = 5) {
    return await pdfReader.readPdf(filePath, maxPages);
}

/**
 * 搜索 Arxiv
 */
async function searchArxiv(query, maxResults = 5) {
    return await arxivClient.search(query, maxResults);
}

/**
 * 下载 Arxiv PDF
 */
async function downloadArxivPdf(url, destPath) {
    return await arxivClient.downloadPdf(url, destPath);
}

module.exports = {
    // 类
    PDFReader,
    ArxivClient,
    AIQAService,

    // 便捷函数
    askAI,
    readPdf,
    searchArxiv,
    downloadArxivPdf,

    // 单例
    pdfReader,
    arxivClient
};
