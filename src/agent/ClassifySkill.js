const fs = require('fs');
const path = require('path');
const { getAIClient } = require('../screenshot/aiClient');

/**
 * 文件分类技能
 * 智能分类 PDF、文本、图片等文件类型
 * 根据当前工作区的文件夹结构返回合适的保存路径
 */
class ClassifySkill {
    constructor(workspaceScanner = null) {
        this.workspaceScanner = workspaceScanner;
        this.maxTextLength = 1000;
        this.maxPdfPages = 3;
    }

    /**
     * 设置工作区扫描器
     * @param {Object} scanner - 工作区扫描器实例
     */
    setWorkspaceScanner(scanner) {
        this.workspaceScanner = scanner;
    }

    /**
     * 获取当前工作区
     * @returns {Object|null} 工作区对象
     */
    _getCurrentWorkspace() {
        return this.workspaceScanner?.currentWorkspace || null;
    }

    /**
     * 加载文件夹配置
     * @param {string} dataDir - 工作区数据目录
     * @returns {Object} 文件夹配置
     */
    _loadFolderConfig(dataDir) {
        const structurePath = path.join(dataDir, 'folder_structure.json');

        if (!fs.existsSync(structurePath)) {
            return { folders: [] };
        }

        try {
            const content = fs.readFileSync(structurePath, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.warn('⚠️ 文件夹配置加载失败:', e.message);
            return { folders: [] };
        }
    }

    /**
     * 检测文件类型
     * @param {string} fileName - 文件名或路径
     * @param {string} contentType - 内容类型 'text' | 'image' | 'pdf' | 'auto'
     * @returns {string} 文件类型 'text' | 'image' | 'pdf' | 'other'
     */
    _detectFileType(fileName, contentType) {
        if (contentType && contentType !== 'auto') {
            return contentType;
        }

        const ext = path.extname(fileName || '').toLowerCase();

        // 图片类型
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
            return 'image';
        }

        // PDF 类型
        if (ext === '.pdf') {
            return 'pdf';
        }

        // 文本类型
        if (['.md', '.txt', '.json', '.js', '.ts', '.py', '.html', '.css'].includes(ext)) {
            return 'text';
        }

        // 默认作为文本处理
        return 'text';
    }

    /**
     * 提取文件内容
     * @param {string} content - 文本内容或文件路径
     * @param {string} fileType - 文件类型
     * @returns {Promise<string>} 提取的内容
     */
    async _extractContent(content, fileType) {
        switch (fileType) {
            case 'text':
                // 文本内容直接返回（限制长度）
                if (content.length > this.maxTextLength) {
                    return content.substring(0, this.maxTextLength) + '...';
                }
                return content;

            case 'image':
                // 图片使用 OCR 提取内容
                return await this._extractImageContent(content);

            case 'pdf':
                // PDF 提取前几页内容
                return await this._extractPdfContent(content);

            default:
                return content.substring(0, this.maxTextLength);
        }
    }

    /**
     * 从图片中提取内容（OCR）
     * @param {string} imagePath - 图片路径
     * @returns {Promise<string>} OCR 提取的内容
     */
    async _extractImageContent(imagePath) {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(imagePath)) {
                throw new Error(`图片文件不存在: ${imagePath}`);
            }

            // 使用 AIClient 的 OCR 能力
            const client = getAIClient('你是一个专业的 OCR 助手，请准确识别图片中的文字内容。');

            // 使用 askWithOcrAudit 获取完整的 OCR 结果
            const result = await client.askWithOcrAudit('请识别图片中的所有文字内容。', imagePath, 0.1, 800);

            if (result.usedOcr && result.ocrStructuredMarkdown) {
                // 使用 OCR 提取的结构化内容
                const extractedContent = result.ocrStructuredMarkdown.substring(0, this.maxTextLength);
                return extractedContent;
            } else if (result.finalAnswer) {
                // VLM 直接回答
                return result.finalAnswer.substring(0, this.maxTextLength);
            }

            throw new Error('OCR 提取失败');
        } catch (e) {
            console.error('❌ 图片 OCR 失败:', e.message);
            throw new Error(`图片内容提取失败: ${e.message}`);
        }
    }

    /**
     * 从 PDF 中提取内容（前几页）
     * @param {string} pdfPath - PDF 文件路径
     * @returns {Promise<string>} 提取的内容
     */
    async _extractPdfContent(pdfPath) {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(pdfPath)) {
                throw new Error(`PDF 文件不存在: ${pdfPath}`);
            }

            // 使用 AIProvider 的 readPdf 功能
            const { readPdf } = require('../utils/AIProvider');
            const result = await readPdf(pdfPath, this.maxPdfPages);

            if (result.success && result.content) {
                // 限制内容长度
                if (result.content.length > this.maxTextLength) {
                    return result.content.substring(0, this.maxTextLength) + '...';
                }
                return result.content;
            }

            throw new Error(result.error || 'PDF 读取失败');
        } catch (e) {
            console.error('❌ PDF 提取失败:', e.message);
            throw new Error(`PDF 内容提取失败: ${e.message}`);
        }
    }

    /**
     * 判断是否为博客内容
     * @param {string} fileName - 文件名
     * @param {string} content - 内容
     * @returns {Promise<boolean>} 是否为博客
     */
    async _isBlogContent(fileName, content) {
        // 文件名关键词
        const blogKeywords = ['blog', '博客', '随笔', '笔记', 'note', 'diary', 'journal'];
        const lowerFileName = (fileName || '').toLowerCase();

        // 检查文件名
        if (blogKeywords.some(kw => lowerFileName.includes(kw))) {
            return true;
        }

        // 通过 AI 分析内容是否为博客风格
        try {
            const client = getAIClient('你是一个内容分类助手，擅长判断文本类型。');
            const prompt = `请判断以下内容是否属于博客/随笔类型的文章。

内容摘要：
${content.substring(0, 500)}

回答 "是" 或 "否"，只需回答一个字。`;

            const response = await client.ask(prompt, null, 0.1, 10);
            return response.trim() === '是';
        } catch (e) {
            console.warn('⚠️ 博客判断失败:', e.message);
            return false;
        }
    }

    /**
     * 格式化文件夹信息供 AI 选择
     * @param {Array} folders - 文件夹列表
     * @returns {string} 格式化后的文件夹信息
     */
    _formatFoldersInfo(folders) {
        if (!folders || !folders.length) {
            return '无可用文件夹';
        }

        return folders
            .map((f, i) => `${i + 1}. ${f.name}${f.description ? ` (${f.description})` : ''}`)
            .join('\n');
    }

    /**
     * 调用 AI 选择目标文件夹
     * @param {string} content - 内容描述
     * @param {string} foldersInfo - 文件夹信息
     * @returns {Promise<Object>} 选择结果
     */
    async _selectFolder(content, foldersInfo) {
        const prompt = `请根据以下内容描述，从给定的文件夹中选择最合适的一个进行分类。

内容描述：
${content}

可选文件夹列表：
${foldersInfo}

请严格按照以下 JSON 格式返回，不要包含任何其他文字：
{
    "folder_name": "文件夹名称",
    "reason": "选择理由（简短说明为什么选择这个文件夹）",
    "confidence": 0.85
}`;

        try {
            const client = getAIClient('你是一个专业的科研知识管理助手，擅长根据内容主题进行归类。');
            const response = await client.ask(prompt, null, 0.3, 500);

            // 解析 JSON 结果
            let jsonStr = response.trim();

            // 移除可能的 markdown 代码块标记
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
            }

            return JSON.parse(jsonStr);
        } catch (e) {
            console.error('❌ AI 选择失败:', e.message);
            return { folder_name: null, reason: 'AI 解析失败', confidence: 0 };
        }
    }

    /**
     * 构建保存路径
     * @param {string} targetFolder - 目标文件夹路径
     * @param {string} fileType - 文件类型
     * @param {boolean} isBlog - 是否为博客
     * @param {string} fileName - 原始文件名
     * @returns {string} 完整保存路径
     */
    _buildSavePath(targetFolder, fileType, isBlog, fileName) {
        // 图片类型：保存到目标文件夹下的 "images" 子文件夹
        if (fileType === 'image') {
            const imageFolder = path.join(targetFolder, 'images');
            const baseName = fileName ? path.basename(fileName) : `image_${Date.now()}.png`;
            return {
                targetFolder: imageFolder,
                savePath: path.join(imageFolder, baseName)
            };
        }

        // 博客类型：保存到目标文件夹下的 "博客" 子文件夹
        if (isBlog) {
            const blogFolder = path.join(targetFolder, '博客');
            const baseName = fileName ? path.basename(fileName, path.extname(fileName)) + '.md' : `note_${Date.now()}.md`;
            return {
                targetFolder: blogFolder,
                savePath: path.join(blogFolder, baseName)
            };
        }

        // PDF 类型：保存到目标文件夹下的 "文章" 子文件夹
        if (fileType === 'pdf') {
            const articleFolder = path.join(targetFolder, '文章');
            const baseName = fileName ? path.basename(fileName) : `document_${Date.now()}.pdf`;
            return {
                targetFolder: articleFolder,
                savePath: path.join(articleFolder, baseName)
            };
        }

        // 文本类型：保存到当前文件夹根目录，文件名为 {FolderName}.md
        if (fileType === 'text') {
            const folderName = path.basename(targetFolder);
            const baseName = fileName ? path.basename(fileName, path.extname(fileName)) + '.md' : `${folderName}.md`;
            return {
                targetFolder: targetFolder,
                savePath: path.join(targetFolder, baseName)
            };
        }

        // 其他类型
        return {
            targetFolder: targetFolder,
            savePath: path.join(targetFolder, fileName || 'unknown')
        };
    }

    /**
     * 分类内容并返回保存路径
     * @param {Object} options - 分类选项
     * @param {string} options.content - 文本内容或文件路径
     * @param {string} options.contentType - 内容类型 'text' | 'image' | 'pdf' | 'auto'
     * @param {string} options.fileName - 可选，文件名（用于博客判断和保存命名）
     * @returns {Promise<Object>} 分类结果
     */
    async classify(options) {
        const { content, contentType = 'auto', fileName } = options;

        // 验证输入
        if (!content) {
            return {
                success: false,
                error: '缺少内容参数'
            };
        }

        // 获取当前工作区
        const workspace = this._getCurrentWorkspace();
        if (!workspace) {
            return {
                success: false,
                error: '未激活工作区，请先选择工作区文件夹'
            };
        }

        // 加载文件夹配置
        const folderConfig = this._loadFolderConfig(workspace.dataDir);
        if (!folderConfig.folders || folderConfig.folders.length === 0) {
            return {
                success: false,
                error: '当前工作区没有可用的文件夹配置'
            };
        }

        // 检测文件类型
        const fileType = this._detectFileType(fileName || content, contentType);

        try {
            // 提取内容
            let extractedContent;
            if (fileType === 'text' && !fs.existsSync(content)) {
                // 纯文本内容，直接使用
                extractedContent = content.substring(0, this.maxTextLength);
            } else if (fs.existsSync(content)) {
                // 文件路径，提取内容
                extractedContent = await this._extractContent(content, fileType);
            } else {
                // 可能是图片路径但文件不存在，尝试 OCR
                extractedContent = await this._extractContent(content, fileType);
            }

            // 判断是否为博客内容
            let isBlog = false;
            if (fileType === 'text') {
                isBlog = await this._isBlogContent(fileName, extractedContent);
            }

            // 格式化文件夹信息
            const foldersInfo = this._formatFoldersInfo(folderConfig.folders);

            // 调用 AI 选择目标文件夹
            const selection = await this._selectFolder(extractedContent, foldersInfo);

            // 查找匹配的文件夹
            const matchedFolder = folderConfig.folders.find(f => f.name === selection.folder_name);

            // 如果没找到匹配，自动归属到“其他”文件夹
            const targetFolderName = matchedFolder
                ? selection.folder_name
                : '其他';

            let targetFolder = matchedFolder?.path;
            
            // 如果未找到匹配的文件夹路径，则构建“其他”文件夹路径
            if (!targetFolder) {
                targetFolder = path.join(workspace.workspacePath, targetFolderName);
                // 确保“其他”文件夹存在
                if (!fs.existsSync(targetFolder)) {
                    try {
                        fs.mkdirSync(targetFolder, { recursive: true });
                        
                        // 同时创建子文件夹
                        const subFolders = ['images', '博客', '文章'];
                        subFolders.forEach(sub => {
                            const subPath = path.join(targetFolder, sub);
                            if (!fs.existsSync(subPath)) {
                                fs.mkdirSync(subPath, { recursive: true });
                            }
                        });
                    } catch (e) {
                        console.warn(`自动创建文件夹失败: ${targetFolder}`, e);
                    }
                }
            }

            // 构建保存路径
            const pathInfo = this._buildSavePath(targetFolder, fileType, isBlog, fileName);

            return {
                success: true,
                fileType: fileType,
                targetFolder: pathInfo.targetFolder,
                savePath: pathInfo.savePath,
                reason: selection.reason || `根据内容判断该文件属于 ${targetFolderName} 分类`,
                confidence: selection.confidence || 0.5,
                isBlog: isBlog,
                folderName: targetFolderName
            };

        } catch (e) {
            console.error('❌ 分类失败:', e.message);
            return {
                success: false,
                error: e.message,
                fileType: fileType
            };
        }
    }

    /**
     * 兼容旧接口的 classify 方法
     * @param {string} content - 内容或文件路径
     * @param {string} contentType - 内容类型
     * @returns {Promise<Object>} 分类结果
     */
    async classifyLegacy(content, contentType = 'text') {
        return this.classify({
            content: content,
            contentType: contentType
        });
    }
}

module.exports = ClassifySkill;