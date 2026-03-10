// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // Toast 通知
  toast: {
    show: (type, title, message) => ipcRenderer.send('toast:show', { type, title, message }),
  },

  // PDF URL 输入
  pdf: {
    onSaveUrl: (callback) => {
      ipcRenderer.on('pdf:request-url', (event) => callback());
    },
    saveUrl: (url) => ipcRenderer.invoke('pdf:save-url', url),
    onUrlProvided: (callback) => {
      ipcRenderer.on('pdf:url-provided', (event, url) => callback(url));
    }
  },

  // 文件夹操作
  folder: {
    open: () => ipcRenderer.invoke('folder:open'),
    read: (folderPath) => ipcRenderer.invoke('folder:read', folderPath),
    create: (folderName, basePath) => ipcRenderer.invoke('folder:create', folderName, basePath),
    watch: (folderPath) => ipcRenderer.invoke('folder:watch', folderPath),
    unwatch: () => ipcRenderer.invoke('folder:unwatch'),
    onUpdate: (callback) => {
      ipcRenderer.on('folder:updated', (event, data) => callback(data));
    },
    removeUpdateListener: () => {
      ipcRenderer.removeAllListeners('folder:updated');
    },
  },

  // 工作区生命周期
  workspace: {
    setActive: (folderPath) => ipcRenderer.invoke('workspace:setActive', folderPath),
    clearActive: () => ipcRenderer.invoke('workspace:clearActive'),
    getActive: () => ipcRenderer.invoke('workspace:getActive'),
    getStats: () => ipcRenderer.invoke('workspace:getStats'),
    getCategoryDetail: (categoryName) => ipcRenderer.invoke('workspace:getCategoryDetail', categoryName),
    onWorkspaceUpdated: (callback) => {
      ipcRenderer.on('workspace:updated', (event, data) => callback(data));
    },
  },
  
  // 文件操作
  file: {
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    readPdf: (filePath) => ipcRenderer.invoke('file:readPdf', filePath),
  },
  
  // AI 问答
  ai: {
    ask: (question, fileContent, fileName) => ipcRenderer.invoke('ai:ask', question, fileContent, fileName),
  },
  
  // Arxiv 文献搜索
  arxiv: {
    search: (query, maxResults) => ipcRenderer.invoke('arxiv:search', query, maxResults),
    download: (pdfUrl, title) => ipcRenderer.invoke('arxiv:download', pdfUrl, title),
    saveToFolder: (pdfPath, description) => ipcRenderer.invoke('arxiv:saveToFolder', pdfPath, description),
  },
  
  // 定时推荐
  schedule: {
    save: (scheduleData) => ipcRenderer.invoke('schedule:save', scheduleData),
    load: () => ipcRenderer.invoke('schedule:load'),
    delete: (id) => ipcRenderer.invoke('schedule:delete', id),
    onNotification: (callback) => {
      ipcRenderer.on('schedule:notification', (event, data) => callback(data));
    },
  },

  // Agent 智能处理
  agent: {
    process: (instruction, context) => ipcRenderer.invoke('agent:process', instruction, context),
  }
});