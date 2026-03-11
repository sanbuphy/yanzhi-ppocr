const fs = require('fs');
const path = require('path');

/**
 * 元数据管理器
 * 处理文献(PDF)与元数据(Sidecar JSON)的关联
 */
class MetadataManager {
    /**
     * 为文献创建元数据 Sidecar 文件
     * @param {string} pdfPath - PDF 文件的全路径
     * @param {Object} metadata - 元数据对象 (来自 Arxiv 等)
     */
    saveMetadata(pdfPath, metadata) {
        try {
            const metaPath = `${pdfPath}.meta.json`;
            const data = {
                ...metadata,
                linkedAt: new Date().toISOString(),
                localPath: pdfPath
            };
            fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[Metadata] 已保存元数据: ${metaPath}`);
            return true;
        } catch (err) {
            console.error(`[Metadata] 保存元数据失败: ${err.message}`);
            return false;
        }
    }

    /**
     * 读取并加载元数据
     * @param {string} pdfPath - PDF 文件的全路径
     * @returns {Object|null} 元数据对象
     */
    loadMetadata(pdfPath) {
        try {
            const metaPath = `${pdfPath}.meta.json`;
            if (fs.existsSync(metaPath)) {
                return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            }
        } catch (err) {
            console.warn(`[Metadata] 读取元数据失败: ${pdfPath}`, err.message);
        }
        return null;
    }

    /**
     * 根据 Arxiv ID 查找本地是否存在该文献
     * (这是一个简化方案，实际可能需要建立全局索引提升性能)
     * @param {string} arxivId - Arxiv ID
     * @param {string} workspacePath - 工作区路径
     * @returns {string|null} 找到的文件路径
     */
    findLocalByArxivId(arxivId, workspacePath) {
        // 由于扫描器已经生成了详细的 JSON，这里通常应该去查 [文件夹名].json
        // 但为了简单，我们可以递归搜索工作区目录下的 .meta.json
        return this._searchRecursive(workspacePath, arxivId);
    }

    _searchRecursive(dir, arxivId) {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                const found = this._searchRecursive(fullPath, arxivId);
                if (found) return found;
            } else if (item.name.endsWith('.meta.json')) {
                try {
                    const meta = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                    if (meta.arxivId === arxivId || meta.id === arxivId) {
                        return meta.localPath;
                    }
                } catch (e) {
                    // 忽略损坏的 JSON
                }
            }
        }
        return null;
    }
}

module.exports = new MetadataManager();
