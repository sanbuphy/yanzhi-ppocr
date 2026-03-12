const { app, BrowserWindow, ipcMain, dialog, Notification, globalShortcut, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const metadataManager = require('./utils/MetadataManager');

// 引入原生 AI 服务模块
const { askAI, readPdf, searchArxiv, downloadArxivPdf } = require('./utils/AIProvider');

// 引入 Agent 智能处理模块
const { processInstruction, getAgent, initAgent } = require('./agent');

// 解决 Windows 控制台中文乱码问题
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001');
  } catch (e) {
    // 忽略错误
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ================= 全局变量 =================
let mainWindow = null;
let folderWatcher = null;  // 文件夹监听器
let watchedFolderPath = null;  // 当前监听的文件夹路径
let watchDebounceTimer = null;  // 防抖定时器
let scheduleCheckInterval = null;  // 定时检查器
let lastCheckedMinute = -1;  // 上次检查的分钟，避免重复触发

// 新增模块
let screenshotManager = null;  // 截图管理器（Electron 原生）
let webToPdfManager = null;    // 网页转 PDF 管理器
let hotkeyManager = null;      // 统一快捷键管理器
let textCaptureManager = null; // 文字捕获管理器
let workspaceScanner = null;   // 工作区扫描器
const WORKSPACE_SCAN_INTERVAL_MS = 120000;

function resolveMainLogFile() {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    return {
      dir: logDir,
      file: path.join(logDir, 'main-process.log')
    };
  } catch (error) {
    const fallbackDir = path.join(__dirname, '..', 'temp', 'logs');
    return {
      dir: fallbackDir,
      file: path.join(fallbackDir, 'main-process.log')
    };
  }
}

function createMainLogger() {
  const safeStringify = (value) => {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  };

  const write = (level, message, extra) => {
    const target = resolveMainLogFile();
    const line = [
      new Date().toISOString(),
      level,
      message,
      extra !== undefined ? safeStringify(extra) : ''
    ].join(' | ') + os.EOL;

    try {
      if (!fs.existsSync(target.dir)) {
        fs.mkdirSync(target.dir, { recursive: true });
      }
      fs.appendFileSync(target.file, line, 'utf8');
    } catch (error) {
      console.error('[MAIN][LOGGER] 写入日志失败:', error.message);
    }

    if (extra !== undefined) {
      console.log('[MAIN]', level, message, extra);
    } else {
      console.log('[MAIN]', level, message);
    }
  };

  return {
    info: (message, extra) => write('INFO', message, extra),
    warn: (message, extra) => write('WARN', message, extra),
    error: (message, extra) => write('ERROR', message, extra),
    filePath: () => resolveMainLogFile().file,
  };
}

const mainLog = createMainLogger();
mainLog.info('process-start', {
  pid: process.pid,
  platform: process.platform,
  argv: process.argv,
});

// ================= 工具函数 =================


const createWindow = () => {
  const isDevRuntime = !app.isPackaged || process.env.NODE_ENV === 'development';
  const startupPage = isDevRuntime
    ? path.join(__dirname, 'main', 'main.html')
    : path.join(__dirname, 'index.html');

  if (isDevRuntime) {
    console.log('[Startup] Development mode detected, bypassing login page.');
    mainLog.info('startup-mode', { mode: 'development', startupPage });
  } else {
    mainLog.info('startup-mode', { mode: 'production', startupPage });
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Choose startup page by runtime mode.
  mainLog.info('createWindow', { width: 1400, height: 900, startupPage });
  mainWindow.loadFile(startupPage);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainLog.warn('mainWindow-closed');
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  mainLog.info('app-whenReady', { logFile: mainLog.filePath() });
  createWindow();

  // 初始化快捷键管理器
  const { initHotkeyManager } = require('./utils/HotkeyManager');
  hotkeyManager = initHotkeyManager(mainWindow);

  // 初始化截图管理器（Electron 原生实现）
  const ScreenshotManager = require('./screenshot');
  screenshotManager = new ScreenshotManager(mainWindow, hotkeyManager);
  screenshotManager.registerShortcut();
  console.log('✅ 截图管理器已初始化');

  // 初始化网页转 PDF 管理器
  const WebToPdf = require('./pdf/WebToPdf');
  webToPdfManager = new WebToPdf(mainWindow, hotkeyManager);
  webToPdfManager.registerShortcut();
  console.log('✅ 网页转 PDF 管理器已初始化');

  // 初始化文字捕获管理器
  const TextCapture = require('./utils/TextCapture');
  textCaptureManager = new TextCapture(mainWindow, hotkeyManager);
  textCaptureManager.registerShortcut();
  console.log('✅ 文字捕获管理器已初始化');

  // 注册 Ctrl+B 保存选中文字（已实现）
  // 由 TextCapture 模块处理

  // 启动定时推荐检查器
  startScheduleChecker();

  // 初始化工作区扫描器
  const WorkspaceScanner = require('./workspace/WorkspaceScanner');
  const dataDir = path.join(__dirname, '..', 'data');
  workspaceScanner = new WorkspaceScanner(dataDir);
  console.log('✅ 工作区扫描器已初始化（等待激活工作区）');

  // 初始化 Agent（传入工作区扫描器）
  initAgent(workspaceScanner);
  console.log('✅ Agent 已连接工作区扫描器');

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    mainLog.info('app-activate', { windowCount: BrowserWindow.getAllWindows().length });
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// 修复：只有主窗口确实被销毁时才退出，防止编辑器窗口关闭意外触发应用退出
app.on('window-all-closed', () => {
  const allWindows = BrowserWindow.getAllWindows();
  const mainWindowExists = mainWindow && !mainWindow.isDestroyed();

  mainLog.warn('window-all-closed', {
    mainWindowExists: !!mainWindowExists,
    windowCount: allWindows.length,
    urls: allWindows.map((win) => {
      try {
        return win.webContents.getURL();
      } catch (error) {
        return 'unknown';
      }
    }),
  });

  if (process.platform !== 'darwin') {
    // 只有在主窗口确实被销毁时才退出
    if (!mainWindowExists) {
      mainLog.warn('app-quit-called-by-window-all-closed');
      app.quit();
    }
  }
});

// 应用退出时清理资源
app.on('will-quit', () => {
  mainLog.warn('will-quit');
  if (workspaceScanner) {
    workspaceScanner.stop();
  }
  if (screenshotManager) {
    screenshotManager.destroy();
  }
  if (textCaptureManager) {
    textCaptureManager.destroy();
  }
  if (hotkeyManager) {
    hotkeyManager.unregisterAll();
  }
});

app.on('before-quit', (event) => {
  mainLog.warn('before-quit', { defaultPrevented: event.defaultPrevented });
  if (workspaceScanner) {
    workspaceScanner.stop();
  }
  if (screenshotManager) {
    screenshotManager.destroy();
  }
  if (textCaptureManager) {
    textCaptureManager.destroy();
  }
  if (hotkeyManager) {
    hotkeyManager.unregisterAll();
  }
});

app.on('quit', (event, exitCode) => {
  mainLog.warn('quit', { exitCode });
});

app.on('render-process-gone', (event, webContents, details) => {
  mainLog.error('render-process-gone', {
    reason: details && details.reason,
    exitCode: details && details.exitCode,
    url: (() => {
      try {
        return webContents.getURL();
      } catch (error) {
        return 'unknown';
      }
    })(),
  });
});

app.on('child-process-gone', (event, details) => {
  mainLog.error('child-process-gone', details);
});

// 处理进程信号（Ctrl+C 等）
process.on('SIGINT', () => {
  mainLog.warn('signal', { signal: 'SIGINT' });
  console.log('\n收到 SIGINT 信号，正在清理...');
  app.quit();
});

process.on('SIGTERM', () => {
  mainLog.warn('signal', { signal: 'SIGTERM' });
  console.log('收到 SIGTERM 信号，正在清理...');
  app.quit();
});

process.on('uncaughtException', (error) => {
  mainLog.error('uncaughtException', {
    message: error && error.message,
    stack: error && error.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  mainLog.error('unhandledRejection', reason);
});

// ================= Toast 通知 IPC =================
ipcMain.on('toast:show', (event, { type, title, message }) => {
  // 在主窗口显示 Toast 通知
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toast:show', { type, title, message });
  }
});

// ================= PDF 用户输入 URL IPC =================
ipcMain.handle('pdf:save-url', async (event, url) => {
  if (webToPdfManager) {
    await webToPdfManager.handleUserUrl(url);
  }
});

// ================= 文件夹操作 IPC =================

// 激活工作区（同一路径复用已有 workspaceId）
ipcMain.handle('workspace:setActive', async (event, folderPath) => {
  try {
    if (!workspaceScanner) {
      return { success: false, error: '工作区扫描器未初始化' };
    }

    workspaceScanner.stop();
    const activated = workspaceScanner.setActiveWorkspace(folderPath);

    // 立即扫描一次，再进入定时扫描
    await workspaceScanner.scan();
    workspaceScanner.start(WORKSPACE_SCAN_INTERVAL_MS);

    // 通知所有窗口工作区已更新
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('workspace:updated', {
          workspaceId: activated.workspaceId,
          workspacePath: activated.normalizedPath,
          action: 'activated'
        });
      }
    });

    return {
      success: true,
      workspaceId: activated.workspaceId,
      workspaceDataDir: activated.workspaceDataDir,
      normalizedPath: activated.normalizedPath,
    };
  } catch (err) {
    console.error('[Workspace] 激活失败:', err);
    return { success: false, error: err.message };
  }
});

// 清空当前工作区
ipcMain.handle('workspace:clearActive', async () => {
  if (workspaceScanner) {
    workspaceScanner.clearActiveWorkspace();
  }

  return { success: true };
});

// 获取当前工作区状态
ipcMain.handle('workspace:getActive', async () => {
  const active = workspaceScanner?.currentWorkspace || null;

  return {
    success: true,
    active: active
      ? {
          workspaceId: active.workspaceId,
          workspacePath: active.workspacePath,
          normalizedPath: active.normalizedPath,
          workspaceDataDir: active.dataDir,
        }
      : null,
  };
});

// 获取工作区统计数据
ipcMain.handle('workspace:getStats', async () => {
  try {
    if (!workspaceScanner?.currentWorkspace) {
      return { success: false, error: '未激活工作区' };
    }

    const summaryFile = workspaceScanner.summaryFile;
    const structureFile = workspaceScanner.structureFile;

    if (!fs.existsSync(summaryFile)) {
      return { success: false, error: '统计文件不存在' };
    }

    const summaryData = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    const structureData = fs.existsSync(structureFile) 
      ? JSON.parse(fs.readFileSync(structureFile, 'utf-8'))
      : { folders: [] };

    // 合并 folders 数据：从 structureData 获取描述，从 summaryData 获取文件数量
    const mergedFolders = (structureData.folders || []).map(folder => {
      const summaryFolder = (summaryData.folders || []).find(f => f.name === folder.name);
      return {
        ...folder,
        fileCount: summaryFolder?.fileCount || 0,
        totalSize: summaryFolder?.totalSize || 0
      };
    });

    return {
      success: true,
      stats: {
        totalFiles: summaryData.totalFiles || 0,
        folderCount: summaryData.folderCount || 0,
        mdFileCount: summaryData.mdFileCount || 0,
        pdfFileCount: summaryData.pdfFileCount || 0,
        imageCount: summaryData.imageCount || 0,
        // 本月新增统计
        monthlyNewFiles: summaryData.monthlyNewFiles || 0,
        monthlyNewNotes: summaryData.monthlyNewNotes || 0,
        monthlyNewImages: summaryData.monthlyNewImages || 0,
        // 最近文件列表
        recentFiles: summaryData.recentFiles || [],
        recentMonthFiles: summaryData.recentMonthFiles || [],
        folders: mergedFolders
      }
    };
  } catch (err) {
    console.error('[Workspace] 获取统计数据失败:', err);
    return { success: false, error: err.message };
  }
});

// 获取分类详情（文件夹下的文件列表）
ipcMain.handle('workspace:getCategoryDetail', async (event, categoryName) => {
  try {
    if (!workspaceScanner?.currentWorkspace) {
      return { success: false, error: '未激活工作区' };
    }

    let detailFile;
    if (categoryName.endsWith('.json')) {
      detailFile = path.join(workspaceScanner.currentWorkspace.dataDir, categoryName);
    } else {
      detailFile = path.join(workspaceScanner.currentWorkspace.dataDir, `${categoryName}.json`);
    }
    
    if (!fs.existsSync(detailFile)) {
      return { success: false, error: '分类详情文件不存在' };
    }

    const detailData = JSON.parse(fs.readFileSync(detailFile, 'utf-8'));
    
    return {
      success: true,
      category: categoryName,
      folderPath: detailData.path || '',  // 返回文件夹完整路径
      files: detailData.allFiles || [],
      totalCount: detailData.totalFileCount || 0
    };
  } catch (err) {
    console.error('[Workspace] 获取分类详情失败:', err);
    return { success: false, error: err.message };
  }
});

// 打开文件夹选择对话框
ipcMain.handle('folder:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择文件夹'
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '用户取消' };
  }
  
  const folderPath = result.filePaths[0];
  return { success: true, path: folderPath };
});

// 读取文件夹内容
ipcMain.handle('folder:read', async (event, folderPath) => {
  try {
    const items = fs.readdirSync(folderPath, { withFileTypes: true });
    const result = items
      .filter(item => !item.name.toLowerCase().endsWith('.meta.json'))
      .map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'folder' : 'file',
        path: path.join(folderPath, item.name),
        fileType: item.isFile() ? getFileType(item.name) : null
      }));
    return { success: true, items: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 监听文件夹变化
ipcMain.handle('folder:watch', async (event, folderPath) => {
  try {
    // 先停止之前的监听
    if (folderWatcher) {
      folderWatcher.close();
      folderWatcher = null;
    }
    
    watchedFolderPath = folderPath;
    
    // 使用 fs.watch 监听文件夹（递归监听）
    folderWatcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
      console.log(`[FileWatch] ${eventType}: ${filename}`);
      
      // 防抖处理，避免频繁触发
      if (watchDebounceTimer) {
        clearTimeout(watchDebounceTimer);
      }
      
      watchDebounceTimer = setTimeout(() => {
        // 通知渲染进程文件夹有变化
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('folder:updated', {
            eventType,
            filename,
            folderPath: watchedFolderPath
          });
        }
      }, 500);  // 500ms 防抖
    });
    
    folderWatcher.on('error', (err) => {
      console.error('[FileWatch] 监听错误:', err);
    });
    
    console.log('[FileWatch] 开始监听:', folderPath);
    return { success: true, message: '开始监听' };
    
  } catch (err) {
    console.error('[FileWatch] 启动监听失败:', err);
    return { success: false, error: err.message };
  }
});

// 停止监听文件夹
ipcMain.handle('folder:unwatch', async () => {
  if (folderWatcher) {
    folderWatcher.close();
    folderWatcher = null;
    watchedFolderPath = null;
    console.log('[FileWatch] 停止监听');
  }
  return { success: true };
});

// 获取文件类型
function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
    return 'image';
  } else if (ext === 'pdf') {
    return 'pdf';
  } else if (['md', 'txt'].includes(ext)) {
    return 'markdown';
  }
  return 'file';
}

// 创建子文件夹（调用 Python choose_to_save）
ipcMain.handle('folder:create', async (event, folderName, basePath) => {
  return new Promise((resolve) => {
    const toolsDir = path.join(__dirname, '..', 'tools');
    
    // 转义文件夹名和路径中的特殊字符
    const safeFolderName = folderName.replace(/'/g, "\\'").replace(/"/g, '\\"');
    const safeBasePath = basePath.replace(/\\/g, '/').replace(/'/g, "\\'");
    
    // 使用 Python 调用 create_folder 方法
    const pythonCode = `
import sys
import json
sys.path.insert(0, r'${toolsDir.replace(/\\/g, '/')}')

try:
    from choose_to_save import ContentManager
    manager = ContentManager()
    result = manager.create_folder('${safeFolderName}', r'${safeBasePath}')
    
    if result:
        # 获取刚创建的文件夹的描述
        description = ""
        for folder in manager.folder_config.get("folders", []):
            if folder["name"] == '${safeFolderName}':
                description = folder.get("description", "")
                break
        
        output = {"success": True, "path": result, "description": description}
        print("RESULT_JSON:" + json.dumps(output, ensure_ascii=False))
    else:
        print("RESULT_JSON:" + json.dumps({"success": False, "error": "创建失败"}))
except Exception as e:
    print("RESULT_JSON:" + json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;
    
    console.log('[CreateFolder] 开始创建文件夹:', folderName, '在', basePath);
    
    const proc = spawn('python', ['-c', pythonCode], {
      cwd: toolsDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    
    let stdout = '';
    let stderr = '';
    
    // 设置超时（30秒，因为需要 AI 生成描述）
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: '操作超时' });
    }, 30000);
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
      console.log(`[CreateFolder] ${data.toString('utf-8').trim()}`);
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
      console.error(`[CreateFolder Error] ${data.toString('utf-8').trim()}`);
    });
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      
      // 解析 JSON 结果
      if (stdout.includes('RESULT_JSON:')) {
        try {
          const jsonStr = stdout.split('RESULT_JSON:')[1].split('\n')[0].trim();
          const result = JSON.parse(jsonStr);
          resolve(result);
        } catch (e) {
          console.error('[CreateFolder] JSON 解析失败:', e);
          resolve({ success: false, error: '结果解析失败: ' + e.message });
        }
      } else {
        resolve({ success: false, error: stderr || stdout || '未知错误' });
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[CreateFolder] 进程错误:', err);
      resolve({ success: false, error: err.message });
    });
  });
});

// 读取文件内容
ipcMain.handle('file:read', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (['.md', '.txt', '.json', '.js', '.py', '.css', '.html'].includes(ext)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content, type: 'text' };
    } else {
      return { success: true, path: filePath, type: 'binary' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 读取 PDF 文件内容（使用 pdf-parse 库）
ipcMain.handle('file:readPdf', async (event, filePath) => {
  console.log('[PDF] 开始读取 PDF:', filePath);

  try {
    const result = await readPdf(filePath, 5);

    if (result.success) {
      console.log('[PDF] 读取成功，内容长度:', result.content.length);
      return { success: true, content: result.content };
    } else {
      console.error('[PDF] 读取失败:', result.error);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error('[PDF] 读取错误:', err);
    return { success: false, error: err.message };
  }
});

// 删除文件
ipcMain.handle('file:delete', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    fs.unlinkSync(filePath);
    console.log('[File] 已删除文件:', filePath);
    return { success: true };
  } catch (err) {
    console.error('[File] 删除文件失败:', err);
    return { success: false, error: err.message };
  }
});

// 复制文件到剪贴板（真正复制文件，可以粘贴到其他地方）
ipcMain.handle('file:copy', async (event, filePath) => {
  try {
    const { clipboard, nativeImage } = require('electron');
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    
    // 对于图片文件，复制图片内容
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
      const image = nativeImage.createFromPath(filePath);
      clipboard.writeImage(image);
      console.log('[File] 已复制图片到剪贴板:', filePath);
    } else {
      // 对于其他文件，写入文件路径（macOS 可以通过 file:// URL 复制文件）
      // 使用 NSPasteboard 的方式复制文件
      clipboard.writeBuffer('public.file-url', Buffer.from(`file://${filePath}`));
      console.log('[File] 已复制文件到剪贴板:', filePath);
    }
    
    return { success: true, fileName: fileName };
  } catch (err) {
    console.error('[File] 复制文件失败:', err);
    return { success: false, error: err.message };
  }
});

// AI 问答（使用原生 JS 实现）
ipcMain.handle('ai:ask', async (event, question, fileContent, fileName) => {
  console.log('[AI] 开始回答问题:', question);

  try {
    const result = await askAI(question, fileContent, fileName);

    if (result.success) {
      console.log('[AI] 回答完成');
      return { success: true, response: result.response };
    } else {
      console.error('[AI] 回答失败:', result.error);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error('[AI] 错误:', err);
    return { success: false, error: err.message };
  }
});


// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// ================= Arxiv 搜索与下载 IPC =================

// 搜索 Arxiv 论文
ipcMain.handle('arxiv:search', async (event, query, maxResults = 5) => {
  console.log('[Arxiv] 搜索:', query);

  try {
    const result = await searchArxiv(query, maxResults);

    if (result.success) {
      console.log('[Arxiv] 找到', result.papers.length, '篇论文');
      return { success: true, papers: result.papers };
    } else {
      console.error('[Arxiv] 搜索失败:', result.error);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error('[Arxiv] 错误:', err);
    return { success: false, error: err.message };
  }
});

// 下载 PDF 到临时文件夹
ipcMain.handle('arxiv:download', async (event, pdfUrl, title) => {
  return new Promise(async (resolve) => {
    const toolsDir = path.join(__dirname, '..', 'tools');
    const pdfsDir = path.join(toolsDir, 'pdfs');
    
    // 确保 pdfs 文件夹存在
    if (!fs.existsSync(pdfsDir)) {
      fs.mkdirSync(pdfsDir, { recursive: true });
    }
    
    // 清理文件名
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    const filename = `${safeTitle}.pdf`;
    const filePath = path.join(pdfsDir, filename);
    
    console.log('[Arxiv] 下载 PDF:', pdfUrl);
    console.log('[Arxiv] 保存到:', filePath);
    
    try {
      // 使用 https 模块下载
      const https = require('https');
      const http = require('http');
      
      const downloadFile = (url, dest) => {
        return new Promise((res, rej) => {
          const protocol = url.startsWith('https') ? https : http;
          const file = fs.createWriteStream(dest);
          
          const request = protocol.get(url, (response) => {
            // 处理重定向
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              file.close();
              fs.unlinkSync(dest);
              downloadFile(response.headers.location, dest).then(res).catch(rej);
              return;
            }
            
            if (response.statusCode !== 200) {
              file.close();
              fs.unlinkSync(dest);
              rej(new Error(`下载失败: HTTP ${response.statusCode}`));
              return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
              file.close();
              res();
            });
          });
          
          request.on('error', (err) => {
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            rej(err);
          });
          
          // 设置超时
          request.setTimeout(60000, () => {
            request.destroy();
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            rej(new Error('下载超时'));
          });
        });
      };
      
      await downloadFile(pdfUrl, filePath);
      
      console.log('[Arxiv] 下载完成:', filePath);
      resolve({ success: true, path: filePath, filename });
      
    } catch (err) {
      console.error('[Arxiv] 下载失败:', err);
      resolve({ success: false, error: err.message });
    }
  });
});

// 将 PDF 保存到合适的文件夹（调用 choose_to_save）
ipcMain.handle('arxiv:saveToFolder', async (event, pdfPath, description) => {
  return new Promise(async (resolve) => {
    const toolsDir = path.join(__dirname, '..', 'tools');
    const safePdfPath = pdfPath.replace(/\\/g, '/');
    
    const workspacePath = workspaceScanner && workspaceScanner.currentWorkspace ? workspaceScanner.currentWorkspace.workspacePath : '';
    const safeWorkspacePath = workspacePath.replace(/\\/g, '/');
    
    // AI 智能分类逻辑
    let finalSubFolder = '文章';
    try {
        if (workspaceScanner && workspaceScanner.structureFile && fs.existsSync(workspaceScanner.structureFile)) {
            const structure = JSON.parse(fs.readFileSync(workspaceScanner.structureFile, 'utf-8'));
            const folders = structure.folders
                .filter(f => f.name !== '文章') // 排除掉顶层多余的“文章”文件夹
                .map(f => ({ name: f.name, desc: f.description }));
            
            if (folders.length > 0) {
                const meta = JSON.parse(description);
                const aiClient = require('./screenshot/aiClient').getAIClient('你是一个科研文献分类助手。');
                const prompt = `
请根据以下论文元数据，从可选目录列表中选择一个最合适的目录。
可选目录列表：
${folders.map((f, i) => `${i + 1}. ${f.name} (${f.desc})`).join('\n')}

论文信息：
标题：${meta.title}
摘要：${meta.abstract.substring(0, 500)}

只需返回目录名称，不要任何其他文字。如果没有合适的，返回“其他”。
`;
                const matchedCategory = await aiClient.ask(prompt, null, 0.3, 50);
                const cleanedCategory = matchedCategory.trim().replace(/[".]/g, '');
                
                // 检查是否在列表中
                const finalCategory = folders.find(f => f.name === cleanedCategory) ? cleanedCategory : '其他';
                finalSubFolder = path.join(finalCategory, '文章');
                console.log(`[SavePDF] AI 分类结果: ${finalCategory} -> 存储路径: ${finalSubFolder}`);
            }
        }
    } catch (e) {
        console.error('[SavePDF] AI 分类失败:', e.message);
        finalSubFolder = '文章'; // 降级处理
    }

    const safeFinalSubFolder = finalSubFolder.replace(/\\/g, '/');
    const metaObj = JSON.parse(description);
    const sanitizedTitle = metaObj.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
    const safeDescription = description.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');

    const pythonCode = `
import sys
import json
sys.path.insert(0, r'${toolsDir.replace(/\\/g, '/')}')

try:
    from choose_to_save import ContentManager, InputType
    manager = ContentManager()
    
    # 串联：使用当前工作区作为保存的基础目录
    result_path = manager.save_content(
        InputType.PDF,
        r'${safePdfPath}',
        description="""${safeDescription}""",
        sub_folder=r'${safeFinalSubFolder}',
        base_path=r'${safeWorkspacePath}',
        filename=r'${sanitizedTitle.replace(/'/g, "\\'")}'
    )
    
    if result_path:
        print('SAVE_RESULT:' + json.dumps({"success": True, "path": result_path}, ensure_ascii=False))
    else:
        print('SAVE_RESULT:' + json.dumps({"success": False, "error": "保存失败"}))
except Exception as e:
    print('SAVE_RESULT:' + json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;
    
    console.log('[SavePDF] 保存到合适文件夹:', pdfPath);
    
    const proc = spawn('python', ['-c', pythonCode], {
      cwd: toolsDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    
    let stdout = '';
    let stderr = '';
    
    // 设置超时（30秒）
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: '操作超时' });
    }, 30000);
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
      console.log(`[SavePDF] ${data.toString('utf-8').trim()}`);
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      
      if (stdout.includes('SAVE_RESULT:')) {
        try {
          const jsonStr = stdout.split('SAVE_RESULT:')[1].trim();
          const result = JSON.parse(jsonStr);
          
          if (result.success && result.path) {
              // 文件物理保存成功后，同步保存元数据 Sidecar
              try {
                  const meta = JSON.parse(description); // description 在前端已经组装成了 JSON 字符串
                  metadataManager.saveMetadata(result.path, meta);
              } catch (e) {
                  // 如果不是 JSON，尝试作为普通文本保存（兜底）
                  metadataManager.saveMetadata(result.path, { rawDescription: description });
              }
          }
          
          resolve(result);
        } catch (e) {
          resolve({ success: false, error: '结果解析失败' });
        }
      } else {
        resolve({ success: false, error: stderr || '保存失败' });
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });
  });
});

// ================= 定时推荐功能 =================

const SCHEDULE_FILE = path.join(__dirname, '..', 'tools', 'scheduled_searches.json');

// 加载定时任务配置
function loadScheduleConfig() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Schedule] 加载配置失败:', err);
  }
  return { schedules: [] };
}

// 保存定时任务配置
function saveScheduleConfig(config) {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Schedule] 保存配置失败:', err);
    return false;
  }
}

// 检查是否应该触发定时任务
function checkScheduledTasks() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay(); // 0 = Sunday
  
  // 避免同一分钟内重复触发
  const currentMinuteKey = currentHour * 60 + currentMinute;
  if (currentMinuteKey === lastCheckedMinute) {
    return;
  }
  lastCheckedMinute = currentMinuteKey;
  
  const config = loadScheduleConfig();
  
  for (const schedule of config.schedules) {
    if (!schedule.enabled) continue;
    
    const [scheduleHour, scheduleMinute] = schedule.time.split(':').map(Number);
    
    // 检查时间是否匹配
    if (currentHour !== scheduleHour || currentMinute !== scheduleMinute) {
      continue;
    }
    
    // 检查重复规则
    let shouldTrigger = false;
    switch (schedule.repeat) {
      case 'daily':
        shouldTrigger = true;
        break;
      case 'weekdays':
        shouldTrigger = currentDay >= 1 && currentDay <= 5;
        break;
      case 'weekly':
        shouldTrigger = currentDay === 1; // 每周一
        break;
    }
    
    if (shouldTrigger) {
      console.log('[Schedule] 触发定时搜索:', schedule.keyword);
      triggerScheduledSearch(schedule);
    }
  }
}

// 执行定时搜索并发送通知
async function triggerScheduledSearch(schedule) {
  try {
    // 使用原生 JS 调用 Arxiv 搜索
    const result = await searchArxiv(schedule.keyword, 3);

    if (result.success && result.papers.length > 0) {
      const papers = result.papers;

      // 发送系统通知
      const notification = new Notification({
        title: `📚 定时推荐：${schedule.keyword}`,
        body: `找到 ${papers.length} 篇新论文\n${papers[0].title.substring(0, 50)}...`,
        icon: path.join(__dirname, '..', 'img', 'robot.png'),
      });

      notification.on('click', () => {
        // 点击通知时聚焦窗口并跳转到推荐页面
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('schedule:notification', {
            keyword: schedule.keyword,
            papers: papers
          });
        }
      });

      notification.show();

      // 同时发送到渲染进程显示应用内通知
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('schedule:notification', {
          keyword: schedule.keyword,
          papers: papers,
          showInApp: true
        });
      }
    }
  } catch (err) {
    console.error('[Schedule] 定时搜索失败:', err);
  }
}

// 启动定时检查
function startScheduleChecker() {
  if (scheduleCheckInterval) {
    clearInterval(scheduleCheckInterval);
  }
  
  // 每30秒检查一次
  scheduleCheckInterval = setInterval(checkScheduledTasks, 30000);
  console.log('[Schedule] 定时检查器已启动');
}

// 保存定时任务
ipcMain.handle('schedule:save', async (event, scheduleData) => {
  try {
    const config = loadScheduleConfig();
    
    // 生成唯一ID
    scheduleData.id = Date.now().toString();
    scheduleData.createdAt = new Date().toISOString();
    
    config.schedules.push(scheduleData);
    
    if (saveScheduleConfig(config)) {
      console.log('[Schedule] 保存成功:', scheduleData);
      return { success: true, schedule: scheduleData };
    } else {
      return { success: false, error: '保存失败' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 加载定时任务
ipcMain.handle('schedule:load', async () => {
  try {
    const config = loadScheduleConfig();
    return { success: true, schedules: config.schedules };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 删除定时任务
ipcMain.handle('schedule:delete', async (event, id) => {
  try {
    const config = loadScheduleConfig();
    config.schedules = config.schedules.filter(s => s.id !== id);

    if (saveScheduleConfig(config)) {
      return { success: true };
    } else {
      return { success: false, error: '删除失败' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ================= Agent 智能处理 IPC =================

// 检查文献是否已在库
ipcMain.handle('arxiv:checkPresence', async (event, arxivId) => {
    try {
        if (!workspaceScanner?.currentWorkspace) {
            return { exists: false };
        }
        const found = metadataManager.findLocalByArxivId(arxivId, workspaceScanner.currentWorkspace.workspacePath);
        return { exists: !!found, path: found };
    } catch (err) {
        return { exists: false, error: err.message };
    }
});

// Agent 智能处理 IPC
ipcMain.handle('agent:process', async (event, instruction, context = {}) => {
  console.log('[Agent] 处理指令:', instruction);
  try {
    const result = await processInstruction(instruction, context);
    return { success: true, ...result };
  } catch (err) {
    console.error('[Agent] 处理失败:', err);
    return { success: false, error: err.message };
  }
});

// 在默认浏览器中打开外部链接
ipcMain.handle('shell:openExternal', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('[Shell] 打开链接失败:', err);
    return { success: false, error: err.message };
  }
});