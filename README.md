# 研知科研助手 (Yanzhi Research Assistant)

研知科研助手是一款专为科研人员打造的智能化工具，旨在通过 AI 技术简化文献管理、笔记整理及知识体系构建流程，全面提升科研效率。

合作者：
- @Mnnnn- [Mnnnn](https://github.com/liulx25xx)
- @17825470707yx-sketch- [17825470707yx-sketch](https://github.com/17825470707yx-sketch)
- @soulll1- [soulll1](https://github.com/soulll1)
- @ZC_N- [ZC_N](https://github.com/Anachronism-N)



## 🚀 核心功能

| 功能模块 | 核心优势 |
| :--- | :--- |
| **网页信息精准获取** | 结合图片截取、网页保存与文本复制，灵活处理可见内容，支持图表与公式捕获。 |
| **文献/笔记自动整理** | AI 深度主导，利用多模态大模型自动完成繁琐的笔记整理工作，最大化减少人工干预。 |
| **定制化笔记模板** | 内置可视化模板构建器，协助用户快速建立标准化的科研笔记结构。（本功能尚未开发完毕） |
| **知识体系高效构建** | 采用多层文件夹设计，父文件夹作为宏观路径，子文件夹实现微观关联，满足复合型科研需求。 |

## 🛠️ 环境准备

在开始使用前，请确保您的系统已安装以下环境：
- **Node.js & npm**: 用于运行 Electron 客户端。
- **主要的 npm 依赖包**:
  - `electron`: 桌面应用程序框架。
  - `openai`: 用于与大模型（如 Qwen, DeepSeek）交互。
  - `puppeteer-core`: 用于驱动浏览器生成 PDF 或抓取网页内容。
  - `pdf-parse`: 纯 JavaScript 实现的 PDF 文档解析工具。
  - `koffi`: 高性能的 Node.js C / C++ 外部函数接口（FFI）。
  - `tesseract.js`: 用于本地进行简单的 OCR 识别。

## 📦 快速开始

1. **克隆仓库**：
   ```bash
   git clone https://github.com/ddddfrank/yanzhi.git
   cd yanzhi
   ```

2. **安装依赖**：
   ```bash
   npm install
   ```

3. **启动程序**：
   ```bash
   npm start
   ```

## ⚙️ 详细配置

### 1. API 配置
本软件默认使用硅基流动（SiliconCloud）提供的 **DeepSeek OCR + Qwen2.5 7B** 模型。
- 前往 [硅基流动官网](https://cloud.siliconflow.cn/) 注册并申请 API Key。
- 将申请到的 Key 填入 [data/token.env](data/token.env) 文件中（把txt后缀改为env）。

### 2. 浏览器配置 (Edge)
程序需要通过远程调试端口操作浏览器以生成 PDF 或抓取内容。
- 右键点击 Edge 浏览器的桌面快捷方式，选择“属性”。
- 在“目标”栏的末尾添加 `--remote-debugging-port=9222`（注意前面有空格）。
  ```

### 3. 文件结构配置
在新环境下运行时，请按照以下步骤初始化：
- 清空 [data\workspacesdata](data\workspaces) 目录下的旧配置。
- 在软件界面中选择目标文件夹后，使用“新建文件夹”功能建立您的科研目录。

---
感谢使用研知科研助手！如有问题请查阅 [配置方法.md](配置方法.md) 或提交 Issue。

## 📊 工作区数据格式说明

程序会在 `data/workspaces/[workspace_hash]/` 目录下生成 JSON 文件以维护工作区信息：

### 1. `folder_structure.json`
记录工作区的目录结构及 AI 生成的描述。
```json
{
  "folders": [
    { "name": "文件夹名", "path": "绝对路径", "description": "AI 生成的简短描述" }
  ],
  "lastUpdated": "最后更新时间"
}
```

### 2. `summary.json`
记录工作区的整体统计信息。
```json
{
  "totalFiles": 100,
  "folderCount": 10,
  "mdFileCount": 20,
  "pdfFileCount": 30,
  "imageCount": 50,
  "recentFiles": [ /* 最近 5 个变动的文件列表 */ ]
}
```

### 3. `[文件夹名].json`
记录特定子文件夹下的详细文件列表和递归统计。
```json
{
  "folderName": "transformer",
  "path": "D:/path/to/transformer",
  "totalFileCount": 5,
  "files": [
    { "name": "paper.pdf", "type": "file", "format": "pdf", "size": 1024 }
  ],
  "children": [ /* 子文件夹树状结构 */ ]
}
```
