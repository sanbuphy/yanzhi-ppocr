/**
 * AI 客户端模块
 * 用于调用 OpenAI API（支持多模态 VLM）
 * 复用现有 token.env 配置
 */

const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

// 超时配置常量
const DEFAULT_TIMEOUT_MS = 30000; // 单次 API 调用 30 秒超时
const OCR_SINGLE_ATTEMPT_TIMEOUT_MS = 25000; // OCR 单次尝试 25 秒超时

class AIClient {
    constructor(systemPrompt = "你是一个乐于助人的 AI 助手。") {
        this.systemPrompt = systemPrompt;
        this.client = null;
        this.modelName = null;
        this.isVLM = false;
        this.siliconToken = null;
        this.ocrModelCandidates = ['PaddlePaddle/PaddleOCR-VL-1.5'];
        this.abortController = null; // 用于取消请求
        this._initClient();
    }

    /**
     * 取消当前请求
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    /**
     * 创建新的 AbortController（用于新请求）
     * @returns {AbortController}
     */
    _getOrCreateAbortController(signal) {
        // 如果外部提供了 signal，直接使用
        if (signal) return { controller: null, signal };
        // 否则创建内部 controller
        this.abortController = new AbortController();
        return { controller: this.abortController, signal: this.abortController.signal };
    }

    /**
     * 加载 token.env 文件
     */
    _loadEnvFile() {
        const envPath = path.join(__dirname, '../../data/token.env');
        if (!fs.existsSync(envPath)) {
            console.warn('⚠️ token.env 文件不存在');
            return;
        }

        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            // 支持 PowerShell 格式：$env:VAR_NAME = "value"
            const PowerShellMatch = trimmed.match(/^\$env:(\w+)\s*=\s*["']?([^"']+)["']?/);
            if (PowerShellMatch) {
                const [, key, value] = PowerShellMatch;
                process.env[key] = value.trim();
                continue;
            }

            // 支持标准格式：VAR_NAME=value
            const standardMatch = trimmed.match(/^(\w+)\s*=\s*["']?([^"']+)["']?/);
            if (standardMatch) {
                const [, key, value] = standardMatch;
                process.env[key] = value.trim();
            }
        }
    }

    /**
     * 初始化 AI 客户端
     * 优先级：GitHub Models (GPT-4o) > SiliconFlow (Qwen)
     */
    _initClient() {
        this._loadEnvFile();

        const configuredOcrModels = String(process.env.OCR_MODEL_CANDIDATES || process.env.OCR_MODEL_NAME || '').trim();
        if (configuredOcrModels) {
            this.ocrModelCandidates = configuredOcrModels
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean);
        }
        if (this.ocrModelCandidates.length === 0) {
            this.ocrModelCandidates = ['PaddlePaddle/PaddleOCR-VL-1.5'];
        }

        const githubToken = process.env.GITHUB_TOKEN;
        const siliconToken = process.env.SILICONFLOW_API_KEY;
        this.siliconToken = siliconToken || null;

        if (githubToken) {
            // 使用 GitHub Models (GPT-4o 支持视觉)
            this.client = new OpenAI({
                baseURL: 'https://models.github.ai/inference',
                apiKey: githubToken
            });
            this.modelName = 'openai/gpt-4o';
            this.isVLM = true;
            console.log(`✅ 使用 GitHub Models: ${this.modelName}`);
        } else if (siliconToken) {
            // 使用 SiliconFlow (Qwen2.5-7B-Instruct 免费模型)
            this.client = new OpenAI({
                baseURL: 'https://api.siliconflow.cn/v1',
                apiKey: siliconToken
            });
            this.modelName = 'Qwen/Qwen2.5-7B-Instruct';
            this.isVLM = false;
            console.log(`✅ 使用 SiliconFlow: ${this.modelName}`);
        } else {
            throw new Error('请设置环境变量：GITHUB_TOKEN 或 SILICONFLOW_API_KEY');
        }
    }

    /**
     * 将图片转换为 base64
     * @param {string} imagePath - 图片文件路径
     * @returns {string} data URL
     */
    _imageToBase64(imagePath) {
        return this._imageToDataUrl(imagePath).dataUrl;
    }

    _detectImageMimeType(imagePath, imageBuffer) {
        const ext = path.extname(imagePath || '').toLowerCase();
        if (ext === '.png') return 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';

        if (imageBuffer && imageBuffer.length >= 12) {
            const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4e && imageBuffer[3] === 0x47;
            if (isPng) return 'image/png';

            const isJpeg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8;
            if (isJpeg) return 'image/jpeg';

            const isGif = imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46;
            if (isGif) return 'image/gif';

            const riff = imageBuffer.slice(0, 4).toString('ascii');
            const webp = imageBuffer.slice(8, 12).toString('ascii');
            if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
        }

        return 'image/png';
    }

    _imageToDataUrl(imagePath) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');
        const mimeType = this._detectImageMimeType(imagePath, imageBuffer);
        return {
            dataUrl: `data:${mimeType};base64,${base64}`,
            mimeType
        };
    }

    _buildDeepSeekOcrMarkdownPrompt(strictMode = false) {
        void strictMode;
        return '描述图片内容';
    }

    _looksLikeDegenerateRepetition(rawText) {
        const text = String(rawText || '').trim();
        if (!text) {
            return false;
        }

        const repeatedListMarkerCount = (text.match(/(?:^|\s)1\./g) || []).length;
        if (repeatedListMarkerCount >= 25) {
            return true;
        }

        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length >= 8) {
            const lineCounts = new Map();
            for (const line of lines) {
                lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
            }
            for (const count of lineCounts.values()) {
                if (count >= 6) {
                    return true;
                }
            }
        }

        const normalized = text.replace(/\s+/g, ' ').trim();
        const sample = normalized.slice(0, 80);
        if (sample && normalized.length > 240) {
            const sampleCount = normalized.split(sample).length - 1;
            if (sampleCount >= 3) {
                return true;
            }
        }

        return false;
    }

    _normalizeOcrMarkdown(rawText) {
        const text = String(rawText || '').trim();
        if (!text) {
            return '';
        }

        // Strip markdown code fences if model returned them unexpectedly.
        if (text.startsWith('```')) {
            return text.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '').trim();
        }

        return text;
    }

    _isValidOcrMarkdown(markdownText) {
        const text = this._normalizeOcrMarkdown(markdownText);
        if (!text || text.length < 8) {
            return false;
        }

        // Reject obvious broken payloads like a single brace.
        if (/^[{}\]\[]+$/.test(text)) {
            return false;
        }

        if (this._looksLikeDegenerateRepetition(text)) {
            return false;
        }

        return true;
    }

    _buildResponseDebug(response, rawContent) {
        return {
            requestId: response?.id || '',
            model: response?.model || '',
            created: response?.created || null,
            finishReason: response?.choices?.[0]?.finish_reason || '',
            messageContentType: Array.isArray(response?.choices?.[0]?.message?.content)
                ? 'array'
                : typeof response?.choices?.[0]?.message?.content,
            usage: {
                promptTokens: response?.usage?.prompt_tokens ?? null,
                completionTokens: response?.usage?.completion_tokens ?? null,
                totalTokens: response?.usage?.total_tokens ?? null
            },
            rawMessage: response?.choices?.[0]?.message || null,
            rawOutput: String(rawContent || '')
        };
    }

    _extractAssistantContent(messageContent) {
        if (typeof messageContent === 'string') {
            return messageContent;
        }
        if (Array.isArray(messageContent)) {
            const parts = messageContent.map((part) => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (typeof part.text === 'string') return part.text;
                if (typeof part.output_text === 'string') return part.output_text;
                if (typeof part.content === 'string') return part.content;
                return '';
            }).filter(Boolean);
            return parts.join('\n').trim();
        }
        if (messageContent && typeof messageContent === 'object') {
            if (typeof messageContent.text === 'string') {
                return messageContent.text;
            }
            if (typeof messageContent.output_text === 'string') {
                return messageContent.output_text;
            }
        }
        return '';
    }

    async _requestDeepSeekOcrMarkdown(imagePath, strictMode = false, ocrModelName = 'PaddlePaddle/PaddleOCR-VL-1.5', timeoutMs = OCR_SINGLE_ATTEMPT_TIMEOUT_MS, signal = null) {
        if (!this.siliconToken) {
            throw new Error('未配置 SILICONFLOW_API_KEY，无法调用 DeepSeek-OCR');
        }

        const ocrClient = new OpenAI({
            baseURL: 'https://api.siliconflow.cn/v1',
            apiKey: this.siliconToken,
            timeout: timeoutMs
        });

        const imageData = this._imageToDataUrl(imagePath);
        const dataUrl = imageData.dataUrl;
        const prompt = this._buildDeepSeekOcrMarkdownPrompt(strictMode);

        const requestOptions = {
            model: ocrModelName,
            messages: [
                {
                    role: 'user',
                    content: [
                        // Align with proven Python call shape: image first, then text instruction.
                        { type: 'image_url', image_url: { url: dataUrl } },
                        { type: 'text', text: prompt }
                    ]
                }
            ],
            temperature: 0.1,
            top_p: 0.7,
            frequency_penalty: 0.6,
            max_tokens: strictMode ? 700 : 900
        };

        // 添加 signal 支持（如果提供）
        if (signal) {
            requestOptions.signal = signal;
        }

        const response = await ocrClient.chat.completions.create(requestOptions);

        const rawOutput = this._extractAssistantContent(response?.choices?.[0]?.message?.content);
        return {
            markdown: this._normalizeOcrMarkdown(rawOutput),
            debug: {
                provider: 'siliconflow',
                model: ocrModelName,
                messageShapeVersion: 'image-first-user-only-v1',
                mimeTypeUsed: imageData.mimeType,
                strictMode,
                ...this._buildResponseDebug(response, rawOutput)
            }
        };
    }

    /**
     * 使用 DeepSeek-OCR 生成整图结构化 Markdown 描述（含 OCR 文本）
     * @param {string} imagePath
     * @param {AbortSignal} signal - 可选的取消信号
     * @param {number} maxTotalTimeMs - 总超时时间
     * @returns {Promise<{markdown: string, debug: object}>}
     */
    async _describeImageWithDeepSeekOCR(imagePath, signal = null, maxTotalTimeMs = null) {
        const ocrDebug = {
            ocrAttempted: true,
            ocrSucceeded: false,
            ocrFallbackUsed: false,
            ocrFailureReason: '',
            attempts: [],
            candidateModels: this.ocrModelCandidates
        };

        // 计算总超时时间（如果没有提供，则根据候选模型数量计算）
        const maxTotalTime = maxTotalTimeMs || (OCR_SINGLE_ATTEMPT_TIMEOUT_MS * this.ocrModelCandidates.length * 2);
        const startTime = Date.now();

        let lastError = null;
        let attempt = 0;
        for (const modelName of this.ocrModelCandidates) {
            for (const strictMode of [false, true]) {
                // 检查是否已取消
                if (signal && signal.aborted) {
                    const abortError = new Error('请求已取消');
                    abortError.name = 'AbortError';
                    abortError.ocrDebug = ocrDebug;
                    throw abortError;
                }

                // 检查是否总超时
                if (Date.now() - startTime > maxTotalTime) {
                    const timeoutError = new Error('OCR 总超时');
                    timeoutError.ocrDebug = ocrDebug;
                    throw timeoutError;
                }

                attempt += 1;
                try {
                    const attemptResult = await this._requestDeepSeekOcrMarkdown(imagePath, strictMode, modelName, OCR_SINGLE_ATTEMPT_TIMEOUT_MS, signal);
                    const valid = this._isValidOcrMarkdown(attemptResult.markdown);
                    ocrDebug.attempts.push({
                        attempt,
                        strictMode,
                        valid,
                        ...attemptResult.debug
                    });

                    if (valid) {
                        ocrDebug.ocrSucceeded = true;
                        return {
                            markdown: attemptResult.markdown,
                            debug: ocrDebug
                        };
                    }

                    if (!strictMode) {
                        console.warn(`⚠️ OCR 模型 ${modelName} 首次输出无效，正在严格模式重试...`);
                    }
                } catch (error) {
                    // 如果是取消错误，直接抛出
                    if (error.name === 'AbortError') {
                        throw error;
                    }

                    lastError = error;
                    ocrDebug.attempts.push({
                        attempt,
                        strictMode,
                        valid: false,
                        requestId: '',
                        model: modelName,
                        created: null,
                        finishReason: '',
                        usage: {
                            promptTokens: null,
                            completionTokens: null,
                            totalTokens: null
                        },
                        rawOutput: '',
                        error: error.message || String(error)
                    });
                    if (!strictMode) {
                        console.warn(`⚠️ OCR 模型 ${modelName} 首次请求失败，正在严格模式重试: ${error.message || String(error)}`);
                    }
                }
            }
        }

        ocrDebug.ocrFallbackUsed = true;
        ocrDebug.ocrFailureReason = lastError
            ? `OCR 模型请求失败：${lastError.message || String(lastError)}`
            : `OCR 模型返回内容格式无效（候选模型: ${this.ocrModelCandidates.join(', ')}）`;
        const error = new Error(ocrDebug.ocrFailureReason);
        error.ocrDebug = ocrDebug;
        throw error;
    }

    /**
     * 向 AI 发送请求
     * @param {string} text - 文本输入
     * @param {string} imagePath - 图片路径（可选）
     * @param {number} temperature - 生成温度
     * @param {number} maxTokens - 最大 token 数
     * @returns {Promise<string>} AI 回复
     */
    async ask(text, imagePath = null, temperature = 0.7, maxTokens = 2000) {
        const audit = await this.askWithOcrAudit(text, imagePath, temperature, maxTokens);
        return audit.finalAnswer;
    }

    /**
     * 向 AI 发送请求并返回可审查的 OCR 结构化信息
     * @param {string} text - 文本输入
     * @param {string} imagePath - 图片路径（可选）
     * @param {number} temperature - 生成温度
     * @param {number} maxTokens - 最大 token 数
     * @param {number} timeoutMs - 超时时间（毫秒）
     * @param {AbortSignal} signal - 取消信号
    * @returns {Promise<{finalAnswer: string, ocrStructuredMarkdown: string, usedOcr: boolean, model: string, isVLM: boolean, ocrDebug: object, finalAnswerDebug: object}>}
     */
    async askWithOcrAudit(text, imagePath = null, temperature = 0.7, maxTokens = 2000, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null) {
        if (!text && !imagePath) {
            throw new Error('text 和 imagePath 至少需要一个');
        }

        // 检查是否已取消
        if (signal && signal.aborted) {
            const abortError = new Error('请求已取消');
            abortError.name = 'AbortError';
            throw abortError;
        }

        // 构建消息内容
        let content = [];
        let ocrStructuredMarkdown = '';
        let usedOcr = false;
        let ocrDebug = {
            ocrAttempted: false,
            ocrSucceeded: false,
            ocrFallbackUsed: false,
            ocrFailureReason: '',
            attempts: []
        };

        if (text) {
            content.push({ type: 'text', text });
        }

        if (imagePath && this.isVLM) {
            // 如果支持 VLM 且有图片，添加图片
            try {
                const dataUrl = this._imageToBase64(imagePath);
                content.push({
                    type: 'image_url',
                    image_url: { url: dataUrl }
                });
            } catch (e) {
                console.warn(`⚠️ 图片处理失败：${e.message}`);
            }
        } else if (imagePath && !this.isVLM) {
            // 非 VLM 模型：调用 DeepSeek-OCR 生成整图结构化描述，再拼到提示词
            ocrDebug.ocrAttempted = true;
            try {
                // 计算剩余时间用于 OCR
                const ocrMaxTime = timeoutMs ? Math.min(timeoutMs * 0.6, 45000) : 45000;
                const ocrPayload = await this._describeImageWithDeepSeekOCR(imagePath, signal, ocrMaxTime);
                ocrDebug = ocrPayload.debug || ocrDebug;
                const ocrDescription = ocrPayload.markdown || '';
                if (ocrDescription) {
                    ocrStructuredMarkdown = ocrDescription;
                    usedOcr = true;
                    const ocrPrompt = `\n\n${ocrDescription}`;
                    if (content.length > 0 && content[0].type === 'text') {
                        content[0].text = (content[0].text || '') + ocrPrompt;
                    } else {
                        content.push({ type: 'text', text: ocrPrompt });
                    }
                }
            } catch (e) {
                // 如果是取消错误，直接抛出
                if (e.name === 'AbortError') {
                    throw e;
                }
                const fallbackDebug = e && e.ocrDebug ? e.ocrDebug : ocrDebug;
                ocrDebug = {
                    ...fallbackDebug,
                    ocrAttempted: true,
                    ocrSucceeded: false,
                    ocrFallbackUsed: true,
                    ocrFailureReason: fallbackDebug.ocrFailureReason || e.message || '未知 OCR 错误'
                };
                console.warn(`⚠️ OCR 回退失败：${e.message}`);
            }
        }

        // 简化：如果只有文本，直接使用字符串
        const userContent = content.length === 1 && content[0].type === 'text'
            ? content[0].text
            : content;

        try {
            const requestOptions = {
                model: this.modelName,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature,
                max_tokens: maxTokens,
                timeout: timeoutMs
            };

            // 添加 signal 支持（如果提供）
            if (signal) {
                requestOptions.signal = signal;
            }

            const response = await this.client.chat.completions.create(requestOptions);

            const finalRawOutput = response?.choices?.[0]?.message?.content || '';

            return {
                finalAnswer: finalRawOutput,
                ocrStructuredMarkdown,
                usedOcr,
                model: this.modelName,
                isVLM: this.isVLM,
                ocrDebug,
                finalAnswerDebug: {
                    provider: this.isVLM ? 'github-models' : 'siliconflow',
                    ...this._buildResponseDebug(response, finalRawOutput)
                }
            };
        } catch (e) {
            // 如果是取消错误，直接抛出
            if (e.name === 'AbortError') {
                throw e;
            }
            throw new Error(`AI 请求失败：${e.message}`);
        }
    }

    /**
     * 流式请求（支持打字机效果）
     * @param {string} text - 文本输入
     * @param {string} imagePath - 图片路径（可选）
     * @param {function} onChunk - 收到每个文本块时的回调
     * @param {number} timeoutMs - 超时时间（毫秒）
     * @param {AbortSignal} signal - 取消信号
     * @returns {Promise<string>} 完整回复
     */
    async askStream(text, imagePath = null, onChunk, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null) {
        if (!text && !imagePath) {
            throw new Error('text 和 imagePath 至少需要一个');
        }

        // 检查是否已取消
        if (signal && signal.aborted) {
            const abortError = new Error('请求已取消');
            abortError.name = 'AbortError';
            throw abortError;
        }

        let content = [];
        if (text) {
            content.push({ type: 'text', text });
        }

        if (imagePath && this.isVLM) {
            try {
                const dataUrl = this._imageToBase64(imagePath);
                content.push({
                    type: 'image_url',
                    image_url: { url: dataUrl }
                });
            } catch (e) {
                console.warn(`⚠️ 图片处理失败：${e.message}`);
            }
        } else if (imagePath && !this.isVLM) {
            try {
                // 计算剩余时间用于 OCR
                const ocrMaxTime = timeoutMs ? Math.min(timeoutMs * 0.6, 45000) : 45000;
                const ocrPayload = await this._describeImageWithDeepSeekOCR(imagePath, signal, ocrMaxTime);
                const ocrDescription = ocrPayload.markdown || '';
                if (ocrDescription) {
                    const ocrPrompt = `\n\n${ocrDescription}`;
                    if (content.length > 0 && content[0].type === 'text') {
                        content[0].text = (content[0].text || '') + ocrPrompt;
                    } else {
                        content.push({ type: 'text', text: ocrPrompt });
                    }
                }
            } catch (e) {
                // 如果是取消错误，直接抛出
                if (e.name === 'AbortError') {
                    throw e;
                }
                console.warn(`⚠️ OCR 回退失败：${e.message}`);
            }
        }

        const userContent = content.length === 1 && content[0].type === 'text'
            ? content[0].text
            : content;

        try {
            const requestOptions = {
                model: this.modelName,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature: 0.7,
                max_tokens: 2000,
                stream: true,
                timeout: timeoutMs
            };

            // 添加 signal 支持（如果提供）
            if (signal) {
                requestOptions.signal = signal;
            }

            const stream = await this.client.chat.completions.create(requestOptions);

            let fullResponse = '';
            for await (const chunk of stream) {
                // 检查是否已取消
                if (signal && signal.aborted) {
                    const abortError = new Error('请求已取消');
                    abortError.name = 'AbortError';
                    throw abortError;
                }
                const delta = chunk.choices[0]?.delta?.content || '';
                if (delta) {
                    fullResponse += delta;
                    if (onChunk) {
                        onChunk(delta);
                    }
                }
            }
            return fullResponse;
        } catch (e) {
            // 如果是取消错误，直接抛出
            if (e.name === 'AbortError') {
                throw e;
            }
            throw new Error(`AI 流式请求失败：${e.message}`);
        }
    }
}

// 便捷函数
let defaultClient = null;

function getAIClient(systemPrompt) {
    if (!defaultClient || (systemPrompt && defaultClient.systemPrompt !== systemPrompt)) {
        defaultClient = new AIClient(systemPrompt);
    }
    return defaultClient;
}

async function askAI(text, imagePath = null, systemPrompt, temperature = 0.7, maxTokens = 2000) {
    const client = getAIClient(systemPrompt);
    return await client.ask(text, imagePath, temperature, maxTokens);
}

module.exports = {
    AIClient,
    getAIClient,
    askAI
};
