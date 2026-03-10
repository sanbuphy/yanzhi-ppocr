// File tree data structure
let fileTreeData = [];

// Current opened folder path
let currentFolderPath = null;

// Current selected file
let currentFile = null;

// 附件列表
let attachedFiles = [];

// 是否正在刷新
let isRefreshing = false;

// 是否正在懒加载（避免触发文件监听刷新）
let isLazyLoading = false;

// 外部拖拽/上传支持的格式白名单
const SUPPORTED_UPLOAD_EXTENSIONS = ['pdf', 'txt', 'md', 'jpg', 'jpeg', 'png', 'gif', 'webp'];

function isSupportedUploadExtension(ext) {
  return SUPPORTED_UPLOAD_EXTENSIONS.includes(String(ext || '').toLowerCase());
}

function getUnsupportedExtensionList(files) {
  const unsupported = new Set();
  files.forEach((file) => {
    const ext = getFileExtension(file.name);
    if (!isSupportedUploadExtension(ext)) {
      unsupported.add(ext || '(无扩展名)');
    }
  });
  return Array.from(unsupported);
}

function getSupportedFiles(files) {
  return files.filter((file) => isSupportedUploadExtension(getFileExtension(file.name)));
}

// ================= 文件夹状态持久化 =================

// 保存文件夹状态到 sessionStorage
function saveFolderState() {
  if (currentFolderPath) {
    const state = {
      folderPath: currentFolderPath,
      expandedPaths: Array.from(getExpandedPaths(fileTreeData)),
      timestamp: Date.now()
    };
    sessionStorage.setItem('folderState', JSON.stringify(state));
    console.log('保存文件夹状态:', state.folderPath);
  }
}

// 从 sessionStorage 恢复文件夹状态
async function restoreFolderState() {
  try {
    const stateStr = sessionStorage.getItem('folderState');
    if (!stateStr) return false;
    
    const state = JSON.parse(stateStr);
    
    // 检查状态是否过期（24小时）
    if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem('folderState');
      return false;
    }
    
    console.log('恢复文件夹状态:', state.folderPath);
    
    // 恢复文件夹路径
    currentFolderPath = state.folderPath;

    // 读取文件夹内容
    const readResult = await window.electronAPI.folder.read(currentFolderPath);
    if (!readResult.success) {
      console.warn('恢复文件夹失败:', readResult.error);
      sessionStorage.removeItem('folderState');
      return false;
    }

    // 激活工作区（同一路径复用已有 workspaceId）
    if (window.electronAPI.workspace?.setActive) {
      const workspaceResult = await window.electronAPI.workspace.setActive(currentFolderPath);
      if (!workspaceResult?.success) {
        console.warn('恢复状态时激活工作区失败:', workspaceResult?.error || '未知错误');
      }
    }
    
    // 转换为树形数据
    fileTreeData = convertToTreeData(readResult.items, currentFolderPath);
    
    // 恢复展开状态
    if (state.expandedPaths && state.expandedPaths.length > 0) {
      const expandedSet = new Set(state.expandedPaths);
      isLazyLoading = true;
      try {
        await loadExpandedFolders(fileTreeData, expandedSet);
      } finally {
        setTimeout(() => {
          isLazyLoading = false;
        }, 600);
      }
    }
    
    renderFileTree();
    
    // 启动文件监听
    await startFolderWatch(currentFolderPath);
    
    return true;
  } catch (error) {
    console.error('恢复文件夹状态失败:', error);
    sessionStorage.removeItem('folderState');
    return false;
  }
}

// ================= 自定义对话框 =================

// 显示提示框（替代 alert）
function showAlert(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-content">${message}</div>
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-primary" id="alertOkBtn">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('alertOkBtn').onclick = () => {
      overlay.remove();
      resolve();
    };
  });
}

// 显示确认框（替代 confirm）
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-content">${message}</div>
        <div class="dialog-buttons">
          <button class="dialog-btn" id="confirmCancelBtn">取消</button>
          <button class="dialog-btn dialog-btn-primary" id="confirmOkBtn">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('confirmOkBtn').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    document.getElementById('confirmCancelBtn').onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

// 显示输入框（替代 prompt）
function showPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-content">${message}</div>
        <input type="text" class="dialog-input" id="promptInput" value="${defaultValue}" placeholder="请输入...">
        <div class="dialog-buttons">
          <button class="dialog-btn" id="promptCancelBtn">取消</button>
          <button class="dialog-btn dialog-btn-primary" id="promptOkBtn">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const input = document.getElementById('promptInput');
    input.focus();
    input.select();
    
    // 回车确认
    input.onkeypress = (e) => {
      if (e.key === 'Enter') {
        overlay.remove();
        resolve(input.value);
      }
    };
    
    document.getElementById('promptOkBtn').onclick = () => {
      overlay.remove();
      resolve(input.value);
    };
    document.getElementById('promptCancelBtn').onclick = () => {
      overlay.remove();
      resolve(null);
    };
  });
}

// 打开文件夹并读取内容
async function openFolder() {
  try {
    const openResult = await window.electronAPI.folder.open();
    if (!openResult || !openResult.success) {
      console.log('用户取消了文件夹选择');
      return; // 用户取消选择
    }

    const folderPath = openResult.path;
    console.log('用户选择的文件夹路径:', folderPath);

    currentFolderPath = folderPath;
    console.log('设置当前文件夹路径为:', currentFolderPath);

    // 清空中间展示区域
    const displayArea = document.getElementById('displayArea');
    if (displayArea) {
      displayArea.innerHTML = `
        <div class="empty-state">
          <img src="../../img/Folder.png" alt="Folder" class="empty-icon" />
          <p>选择一个文件内容进行查看</p>
        </div>
      `;
    }

    // 清空右侧对话区域
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.innerHTML = '';
    }

    // 读取文件夹内容
    const readResult = await window.electronAPI.folder.read(folderPath);
    if (!readResult.success) {
      console.error('读取文件夹失败:', readResult.error);
      await showAlert(`无法读取文件夹: ${readResult.error || '未知错误'}\n请确保文件夹存在且有访问权限。`);
      return;
    }

    console.log('文件夹内容读取成功，项目数量:', readResult.items.length);

    // 激活工作区（同一路径复用已有 workspaceId）
    if (window.electronAPI.workspace?.setActive) {
      console.log('开始激活工作区...');
      const workspaceResult = await window.electronAPI.workspace.setActive(folderPath);
      console.log('工作区激活结果:', workspaceResult);

      if (!workspaceResult?.success) {
        console.warn('激活工作区失败:', workspaceResult?.error || '未知错误');
        await showAlert('工作区激活失败，但文件夹已打开。您可以在知识体系管理页面查看统计信息。');
      } else {
        console.log('工作区激活成功，ID:', workspaceResult.workspaceId);
      }
    } else {
      console.warn('工作区API不可用');
    }

    // 将文件系统内容转换为 fileTreeData 格式
    fileTreeData = convertToTreeData(readResult.items, folderPath);
    renderFileTree();

    // 保存文件夹状态
    saveFolderState();

    // 启动文件监听
    await startFolderWatch(folderPath);

    console.log('文件夹打开流程完成');
  } catch (error) {
    console.error('打开文件夹失败:', error);
    await showAlert('打开文件夹失败: ' + error.message);
  }
}

// 启动文件夹监听
async function startFolderWatch(folderPath) {
  try {
    // 停止之前的监听
    await window.electronAPI.folder.unwatch();
    
    // 移除之前的事件监听器
    window.electronAPI.folder.removeUpdateListener();
    
    // 启动新的监听
    const result = await window.electronAPI.folder.watch(folderPath);
    if (result.success) {
      console.log('文件监听已启动');
      updateFolderStatus('watching', folderPath);
      
      // 注册文件变化回调
      window.electronAPI.folder.onUpdate(async (data) => {
        // 如果正在懒加载，跳过刷新
        if (isLazyLoading) {
          console.log('懒加载期间，跳过文件监听刷新');
          return;
        }
        console.log('检测到文件变化:', data);
        await refreshFileTree(true);  // 自动刷新
      });
    }
  } catch (error) {
    console.error('启动文件监听失败:', error);
    updateFolderStatus('error', folderPath);
  }
}

// 更新文件夹状态显示
function updateFolderStatus(status, folderPath) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  
  if (!statusDot || !statusText) return;
  
  statusDot.className = 'status-dot';
  
  switch (status) {
    case 'watching':
      statusDot.classList.add('watching');
      const folderName = folderPath.split(/[/\\]/).pop();
      statusText.textContent = `监听中: ${folderName}`;
      break;
    case 'refreshing':
      statusDot.classList.add('refreshing');
      statusText.textContent = '正在刷新...';
      break;
    case 'error':
      statusDot.classList.add('error');
      statusText.textContent = '监听失败';
      break;
    default:
      statusText.textContent = '未打开文件夹';
  }
}

// 刷新文件树
async function refreshFileTree(isAuto = false) {
  if (!currentFolderPath || isRefreshing) return;
  
  isRefreshing = true;
  
  const refreshBtn = document.getElementById('refreshBtn');
  const refreshIcon = document.getElementById('refreshIcon');
  
  // 添加旋转动画
  if (refreshIcon) {
    refreshIcon.classList.add('spinning');
  }
  if (refreshBtn) {
    refreshBtn.disabled = true;
  }
  
  // 更新状态
  updateFolderStatus('refreshing', currentFolderPath);
  
  try {
    // 保存当前展开状态
    const expandedPaths = getExpandedPaths(fileTreeData);
    
    // 重新读取文件夹内容
    const readResult = await window.electronAPI.folder.read(currentFolderPath);
    if (readResult.success) {
      fileTreeData = convertToTreeData(readResult.items, currentFolderPath);
      
      // 异步加载已展开文件夹的子内容
      if (expandedPaths.size > 0) {
        isLazyLoading = true;  // 防止触发文件监听刷新
        try {
          await loadExpandedFolders(fileTreeData, expandedPaths);
        } finally {
          setTimeout(() => {
            isLazyLoading = false;
          }, 600);
        }
      }
      
      renderFileTree();
      console.log(isAuto ? '自动刷新完成' : '手动刷新完成');
      
      // 保存文件夹状态
      saveFolderState();
    }
    
    // 恢复状态
    updateFolderStatus('watching', currentFolderPath);
    
  } catch (error) {
    console.error('刷新失败:', error);
    updateFolderStatus('error', currentFolderPath);
  } finally {
    isRefreshing = false;
    
    // 移除旋转动画
    if (refreshIcon) {
      refreshIcon.classList.remove('spinning');
    }
    if (refreshBtn) {
      refreshBtn.disabled = false;
    }
  }
}

// 获取当前展开的文件夹路径
function getExpandedPaths(items, paths = new Set()) {
  for (const item of items) {
    if (item.type === 'folder' && item.expanded) {
      paths.add(item.path);
      if (item.children && item.children.length > 0) {
        getExpandedPaths(item.children, paths);
      }
    }
  }
  return paths;
}

// 恢复展开状态（递归处理所有层级）
function restoreExpandedPaths(items, expandedPaths) {
  for (const item of items) {
    if (item.type === 'folder') {
      if (expandedPaths.has(item.path)) {
        item.expanded = true;
      }
      // 递归处理子文件夹
      if (item.children && item.children.length > 0) {
        restoreExpandedPaths(item.children, expandedPaths);
      }
    }
  }
}

// 异步加载已展开文件夹的子内容
async function loadExpandedFolders(items, expandedPaths) {
  for (const item of items) {
    if (item.type === 'folder' && expandedPaths.has(item.path)) {
      item.expanded = true;
      // 加载子文件夹内容
      try {
        const readResult = await window.electronAPI.folder.read(item.path);
        if (readResult.success) {
          item.children = convertToTreeData(readResult.items, item.path);
          // 递归加载子文件夹中已展开的内容
          await loadExpandedFolders(item.children, expandedPaths);
        }
      } catch (error) {
        console.error('加载展开文件夹内容失败:', error);
      }
    }
  }
}

// 将文件系统内容转换为树形数据结构
function convertToTreeData(items, basePath) {
  if (!items || !Array.isArray(items)) {
    console.warn('convertToTreeData: items 不是数组', items);
    return [];
  }
  
  return items.map(item => {
    const fullPath = item.path || `${basePath}/${item.name}`;
    
    if (item.type === 'folder') {
      return {
        name: item.name,
        type: 'folder',
        path: fullPath,
        expanded: false,
        children: [] // 子文件夹内容将在展开时懒加载
      };
    } else {
      return {
        name: item.name,
        type: 'file',
        path: fullPath,
        fileType: item.fileType || getFileType(item.name)
      };
    }
  });
}

// 创建子文件夹（使用 choose_to_save 的方法）
async function createSubFolder() {
  console.log('createSubFolder 被调用, currentFolderPath =', currentFolderPath);
  
  // 如果没有打开文件夹，先让用户选择一个
  if (!currentFolderPath) {
    const confirmOpen = await showConfirm('请先选择一个文件夹作为父目录。<br>点击"确定"选择文件夹。');
    if (!confirmOpen) return;
    
    await openFolder();
    if (!currentFolderPath) {
      return; // 用户取消了选择
    }
  }
  
  // 弹出输入框让用户输入文件夹名称
  const folderName = await showPrompt('请输入新建文件夹的名称（将用于研究主题）：<br><br>例如：Transformer、强化学习、图神经网络');
  console.log('用户输入的文件夹名称:', folderName);
  
  if (!folderName || folderName.trim() === '') {
    console.log('用户取消或输入为空');
    return; // 用户取消或输入为空
  }
  
  // 显示加载提示
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'createFolderLoading';
  loadingDiv.className = 'dialog-overlay';
  loadingDiv.innerHTML = '<div class="dialog-box"><div class="dialog-content">🤖 AI 正在生成文件夹描述，请稍候...</div></div>';
  document.body.appendChild(loadingDiv);
  
  try {
    // 调用后端创建文件夹
    console.log('开始创建文件夹:', folderName, '在', currentFolderPath);
    const result = await window.electronAPI.folder.create(folderName.trim(), currentFolderPath);
    console.log('创建结果:', result);
    
    // 移除加载提示
    loadingDiv.remove();
    
    if (result.success) {
      console.log('文件夹创建成功:', result.path);

      // 重新激活工作区以更新统计数据
      if (window.electronAPI.workspace?.setActive) {
        console.log('重新激活工作区以更新统计...');
        const workspaceResult = await window.electronAPI.workspace.setActive(currentFolderPath);
        console.log('工作区重新激活结果:', workspaceResult);

        if (!workspaceResult?.success) {
          console.warn('重新激活工作区失败:', workspaceResult?.error || '未知错误');
        } else {
          console.log('工作区重新激活成功');
        }
      }

      // 重新读取文件夹内容以刷新列表
      const readResult = await window.electronAPI.folder.read(currentFolderPath);
      if (readResult.success) {
        fileTreeData = convertToTreeData(readResult.items, currentFolderPath);
        renderFileTree();
        // 保存文件夹状态
        saveFolderState();
      }

      await showAlert(`文件夹 "${folderName}" 创建成功！<br><br>📝 描述: ${result.description || '无'}`);
    } else {
      await showAlert('创建文件夹失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    // 移除加载提示
    const loading = document.getElementById('createFolderLoading');
    if (loading) loading.remove();
    
    console.error('创建子文件夹失败:', error);
    await showAlert('创建子文件夹失败: ' + error.message);
  }
}
let chatHistory = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // 先尝试恢复文件夹状态
  const restored = await restoreFolderState();
  if (!restored) {
    renderFileTree();
  }

  setupEventListeners();
  loadChatHistory();
  initCollapseButtons();
});

// ================= 侧板折叠功能 =================

// 初始化折叠按钮
function initCollapseButtons() {
  const leftCollapseBtn = document.getElementById('leftCollapseBtn');
  const rightCollapseBtn = document.getElementById('rightCollapseBtn');
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');
  const appContainer = document.querySelector('.app-container');

  function syncContainerCollapseState() {
    if (!appContainer || !leftPanel || !rightPanel) return;

    const leftCollapsed = leftPanel.classList.contains('collapsed');
    const rightCollapsed = rightPanel.classList.contains('collapsed');

    appContainer.classList.remove('left-collapsed', 'right-collapsed', 'both-collapsed');
    if (leftCollapsed && rightCollapsed) {
      appContainer.classList.add('both-collapsed');
    } else if (leftCollapsed) {
      appContainer.classList.add('left-collapsed');
    } else if (rightCollapsed) {
      appContainer.classList.add('right-collapsed');
    }

    leftCollapseBtn?.classList.toggle('collapsed', leftCollapsed);
    rightCollapseBtn?.classList.toggle('collapsed', rightCollapsed);
  }

  // 恢复折叠状态
  function restoreCollapseState() {
    const leftCollapsed = localStorage.getItem('leftPanelCollapsed') === 'true';
    const rightCollapsed = localStorage.getItem('rightPanelCollapsed') === 'true';

    if (!leftPanel || !rightPanel) return;
    leftPanel.classList.toggle('collapsed', leftCollapsed);
    rightPanel.classList.toggle('collapsed', rightCollapsed);
    syncContainerCollapseState();
  }

  // 左侧板折叠
  leftCollapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!leftPanel) return;
    leftPanel.classList.toggle('collapsed');
    syncContainerCollapseState();
    localStorage.setItem('leftPanelCollapsed', leftPanel.classList.contains('collapsed'));
  });

  // 右侧板折叠
  rightCollapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!rightPanel) return;
    rightPanel.classList.toggle('collapsed');
    syncContainerCollapseState();
    localStorage.setItem('rightPanelCollapsed', rightPanel.classList.contains('collapsed'));
  });

  // 页面加载时恢复状态
  restoreCollapseState();
}

// Render file tree
function renderFileTree() {
  const fileTree = document.getElementById('fileTree');
  fileTree.innerHTML = '';
  
  fileTreeData.forEach(item => {
    const element = createTreeItem(item);
    fileTree.appendChild(element);
  });
}

// Create tree item element
function createTreeItem(item, level = 0) {
  const container = document.createElement('div');
  
  if (item.type === 'folder') {
    const folderItem = document.createElement('div');
    folderItem.className = 'folder-item';
    folderItem.style.paddingLeft = `${20 + level * 20}px`;
    
    const arrow = document.createElement('img');
    arrow.src = '../../img/unfold.png';
    arrow.className = 'folder-arrow';
    if (item.expanded) arrow.classList.add('expanded');
    arrow.style.filter = 'brightness(0) invert(1)';
    
    const icon = document.createElement('img');
    icon.src = '../../img/Folder.png';
    icon.className = 'folder-icon';
    
    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = item.name;
    
    folderItem.appendChild(arrow);
    folderItem.appendChild(icon);
    folderItem.appendChild(name);
    
    folderItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      item.expanded = !item.expanded;
      
      // 懒加载子文件夹内容
      if (item.expanded && item.path && (!item.children || item.children.length === 0)) {
        try {
          // 设置懒加载标志，避免触发文件监听刷新
          isLazyLoading = true;
          const readResult = await window.electronAPI.folder.read(item.path);
          if (readResult.success) {
            item.children = convertToTreeData(readResult.items, item.path);
          }
        } catch (error) {
          console.error('读取文件夹内容失败:', error);
        } finally {
          // 延迟重置标志，确保文件监听事件已处理
          setTimeout(() => {
            isLazyLoading = false;
          }, 600);
        }
      }
      
      renderFileTree();
      
      // 保存展开状态
      saveFolderState();
    });
    
    container.appendChild(folderItem);
    
    if (item.children && item.children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'folder-children';
      if (item.expanded) childrenContainer.classList.add('expanded');
      
      item.children.forEach(child => {
        const childElement = createTreeItem(child, level + 1);
        childrenContainer.appendChild(childElement);
      });
      
      container.appendChild(childrenContainer);
    }
  } else {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.style.paddingLeft = `${20 + level * 20}px`;
    
    const icon = document.createElement('img');
    if (item.fileType === 'image') {
      icon.src = '../../img/picture.png';
    } else if (item.fileType === 'pdf') {
      icon.src = '../../img/file.png';
    } else {
      icon.src = '../../img/file.png';
    }
    icon.className = 'file-icon';
    
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.name;
    
    fileItem.appendChild(icon);
    fileItem.appendChild(name);
    
    fileItem.addEventListener('click', () => {
      // Update active state
      document.querySelectorAll('.file-item').forEach(fi => {
        fi.classList.remove('active');
      });
      fileItem.classList.add('active');
      selectFile(item);
    });
    
    container.appendChild(fileItem);
  }
  
  return container;
}

// Select file and display
async function selectFile(file) {
  currentFile = file;

  // 添加到附件列表
  addAttachment(file);

  // 隐藏模板视图和编辑视图
  hideTemplateView();
  hideTemplateEditor();
  
  // Display file in middle panel
  const displayArea = document.getElementById('displayArea');
  displayArea.style.display = 'flex';
  displayArea.innerHTML = '<div class="loading">加载中...</div>';
  
  try {
    if (file.fileType === 'image') {
      const img = document.createElement('img');
      // 使用本地文件路径
      if (file.path) {
        img.src = 'file:///' + file.path.replace(/\\/g, '/');
      } else {
        img.src = file.url || 'https://via.placeholder.com/800x600/333333/ffffff?text=' + encodeURIComponent(file.name);
      }
      img.className = 'file-preview';
      displayArea.innerHTML = '';
      displayArea.appendChild(img);
    } else if (file.fileType === 'pdf') {
      // 创建 PDF 查看器容器
      const pdfContainer = document.createElement('div');
      pdfContainer.className = 'pdf-viewer-container';

      // 使用 embed 标签显示 PDF，添加更多参数隐藏工具栏和侧边栏
      const embed = document.createElement('embed');
      if (file.path) {
        embed.src = 'file:///' + file.path.replace(/\\/g, '/') + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';
      } else {
        embed.src = (file.url || 'https://via.placeholder.com/800x600/333333/ffffff?text=' + encodeURIComponent(file.name)) + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';
      }
      embed.className = 'pdf-embed';
      embed.type = 'application/pdf';

      pdfContainer.appendChild(embed);
      displayArea.innerHTML = '';
      displayArea.appendChild(pdfContainer);
    } else {
      // 读取文本文件内容
      let content = file.content || '文件内容预览';
      
      if (file.path) {
        const result = await window.electronAPI.file.read(file.path);
        if (result.success) {
          content = result.content;
        } else {
          content = '无法读取文件: ' + (result.error || '未知错误');
        }
      }
      
      const div = document.createElement('div');
      div.className = 'file-preview';
      
      // 对 Markdown 文件进行渲染
      if (file.fileType === 'markdown') {
        const renderedContent = renderMarkdown(content);
        div.innerHTML = `<div class="markdown-content">${renderedContent}</div>`;
      } else {
        div.innerHTML = `<pre style="color: #ffffff; white-space: pre-wrap; padding: 20px;">${escapeHtml(content)}</pre>`;
      }
      
      displayArea.innerHTML = '';
      displayArea.appendChild(div);
    }
  } catch (error) {
    console.error('读取文件失败:', error);
    displayArea.innerHTML = `<div class="error" style="color: #ff6b6b; padding: 20px;">读取文件失败: ${error.message}</div>`;
  }
  
  // 不再自动添加 AI 消息，等待用户主动提问
}

// HTML 转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ================= 附件管理功能 =================

// 获取文件扩展名
function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

// 获取文件图标
function getFileIcon(ext) {
  const iconMap = {
    'pdf': '📄',
    'md': '📝',
    'markdown': '📝',
    'txt': '📄',
    'js': '📜',
    'ts': '📜',
    'py': '🐍',
    'java': '☕',
    'html': '🌐',
    'css': '🎨',
    'json': '📋',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'gif': '🖼️',
    'webp': '🖼️'
  };
  return iconMap[ext] || '📄';
}

// 判断文件类型
function getFileType(ext) {
  const pdfExts = ['pdf'];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
  const markdownExts = ['md', 'markdown'];
  const codeExts = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'xml'];

  if (pdfExts.includes(ext)) return 'pdf';
  if (imageExts.includes(ext)) return 'image';
  if (markdownExts.includes(ext)) return 'markdown';
  if (codeExts.includes(ext)) return 'code';
  return 'file';
}

// 添加附件
function addAttachment(file) {
  // 检查是否已存在（通过路径或名称）
  if (attachedFiles.some(f => (f.path && f.path === file.path) || f.name === file.name)) {
    console.log('附件已存在:', file.name);
    return false;
  }

  attachedFiles.push(file);
  renderAttachmentList();
  console.log('添加附件:', file.name, '当前附件数:', attachedFiles.length);
  return true;
}

// 移除附件
function removeAttachment(index) {
  attachedFiles.splice(index, 1);
  renderAttachmentList();
  console.log('移除附件，当前附件数:', attachedFiles.length);
}

// 清空附件
function clearAttachments() {
  attachedFiles = [];
  renderAttachmentList();
}

// 渲染附件列表
function renderAttachmentList() {
  const container = document.getElementById('attachmentList');
  if (!container) return;

  if (attachedFiles.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = attachedFiles.map((file, index) => {
    const ext = getFileExtension(file.name);
    const icon = getFileIcon(ext);
    return `
      <div class="attachment-item" title="${file.name}">
        <span class="attachment-icon">${icon}</span>
        <span class="attachment-name">${file.name}</span>
        <span class="attachment-remove" onclick="removeAttachment(${index})">×</span>
      </div>
    `;
  }).join('');
}

// Markdown 渲染函数
function renderMarkdown(markdown) {
  if (!markdown) return '';
  
  let html = markdown;
  
  // 先处理代码块，避免代码块内的内容被其他规则处理
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const id = `CODE_BLOCK_${codeBlocks.length}`;
    codeBlocks.push({ id, code: code.trim() });
    return id;
  });
  
  // 处理行内代码
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (match, code) => {
    const id = `INLINE_CODE_${inlineCodes.length}`;
    inlineCodes.push({ id, code });
    return id;
  });
  
  // 转义HTML特殊字符
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // 恢复行内代码
  inlineCodes.forEach(({ id, code }) => {
    html = html.replace(id, `<code>${code}</code>`);
  });
  
  // 恢复代码块
  codeBlocks.forEach(({ id, code }) => {
    html = html.replace(id, `<pre><code>${code}</code></pre>`);
  });
  
  // 标题 (# ## ### #### ##### ######)
  html = html.replace(/^###### (.*$)/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.*$)/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.*$)/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
  
  // 粗体 (**text** 或 __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // 斜体 (*text* 或 _text_)
  // 注意：需要避免匹配代码中的星号，所以先处理代码，再处理斜体
  html = html.replace(/\*([^*\n]+?)\*/g, (match, text) => {
    // 如果包含代码标记，跳过
    if (match.includes('CODE_BLOCK') || match.includes('INLINE_CODE')) {
      return match;
    }
    return '<em>' + text + '</em>';
  });
  html = html.replace(/_([^_\n]+?)_/g, (match, text) => {
    if (match.includes('CODE_BLOCK') || match.includes('INLINE_CODE')) {
      return match;
    }
    return '<em>' + text + '</em>';
  });
  
  // 删除线 (~~text~~)
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  
  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // 水平线 (--- 或 ***)
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');
  
  // 引用 (> text)
  const quoteLines = html.split('\n');
  let inBlockquote = false;
  let processedLines = [];
  
  quoteLines.forEach(line => {
    if (line.trim().startsWith('&gt; ')) {
      if (!inBlockquote) {
        processedLines.push('<blockquote>');
        inBlockquote = true;
      }
      processedLines.push(line.replace(/^&gt; /, ''));
    } else {
      if (inBlockquote) {
        processedLines.push('</blockquote>');
        inBlockquote = false;
      }
      processedLines.push(line);
    }
  });
  if (inBlockquote) {
    processedLines.push('</blockquote>');
  }
  html = processedLines.join('\n');
  
  // 处理列表和段落 - 按行处理
  const listLines = html.split('\n');
  let result = [];
  let listItems = [];
  let currentListType = null; // 'ul' or 'ol'
  
  const flushList = () => {
    if (listItems.length > 0 && currentListType) {
      result.push(`<${currentListType}>${listItems.join('')}</${currentListType}>`);
      listItems = [];
      currentListType = null;
    }
  };
  
  listLines.forEach((line) => {
    const trimmed = line.trim();
    
    // 有序列表
    const olMatch = trimmed.match(/^(\d+)\. (.+)$/);
    if (olMatch) {
      if (currentListType !== 'ol') {
        flushList();
        currentListType = 'ol';
      }
      listItems.push(`<li>${olMatch[2]}</li>`);
      return;
    }
    
    // 无序列表
    const ulMatch = trimmed.match(/^[\*\-\+] (.+)$/);
    if (ulMatch) {
      if (currentListType !== 'ul') {
        flushList();
        currentListType = 'ul';
      }
      listItems.push(`<li>${ulMatch[1]}</li>`);
      return;
    }
    
    // 非列表项，先刷新列表
    flushList();
    
    // 处理其他内容
    if (!trimmed) {
      result.push('');
    } else if (trimmed.match(/^<(h[1-6]|pre|blockquote|hr|ul|ol|p)/)) {
      // 已经是HTML标签
      result.push(trimmed);
    } else {
      // 普通段落
      result.push(`<p>${trimmed}</p>`);
    }
  });
  
  // 处理最后的列表
  flushList();
  
  html = result.join('\n');
  
  // 清理多余的标签和空行
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]|ul|ol|pre|blockquote|hr)/g, '$1');
  html = html.replace(/(<\/h[1-6]|<\/ul>|<\/ol>|<\/pre>|<\/blockquote>|<\/hr>)<\/p>/g, '$1');
  html = html.replace(/\n{3,}/g, '\n\n');
  
  return html;
}

// Setup event listeners
function setupEventListeners() {
  console.log('setupEventListeners 开始执行');
  
  // 打开文件夹按钮（原"上传"按钮）
  const uploadBtn = document.getElementById('uploadBtn');
  console.log('uploadBtn:', uploadBtn);
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      console.log('打开按钮被点击');
      await openFolder();
    });
  }
  
  // 新建按钮和下拉菜单
  const newFolderBtn = document.getElementById('newFolderBtn');
  const newDropdown = document.getElementById('newDropdown');
  const newFolderOption = document.getElementById('newFolderOption');
  const newNoteOption = document.getElementById('newNoteOption');
  const newTemplateOption = document.getElementById('newTemplateOption');
  const newCustomTemplateOption = document.getElementById('newCustomTemplateOption');
  
  if (newFolderBtn && newDropdown) {
    // 更新下拉菜单位置的函数
    const updateDropdownPosition = () => {
      const rect = newFolderBtn.getBoundingClientRect();
      newDropdown.style.left = rect.left + 'px';
      newDropdown.style.top = (rect.bottom + 5) + 'px';
      newDropdown.style.width = rect.width + 'px';
    };
    
    // 点击新建按钮显示/隐藏下拉菜单
    newFolderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isShowing = newDropdown.classList.contains('show');
      if (!isShowing) {
        updateDropdownPosition();
      }
      newDropdown.classList.toggle('show');
    });
    
    // 窗口大小改变时更新位置
    window.addEventListener('resize', () => {
      if (newDropdown.classList.contains('show')) {
        updateDropdownPosition();
      }
    });
    
    // 处理二级菜单的显示位置
    if (newNoteOption) {
      const submenu = newNoteOption.querySelector('.submenu');
      if (submenu) {
        // 更新二级菜单位置的函数
        const updateSubmenuPosition = () => {
          const rect = newNoteOption.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          
          // 计算二级菜单的位置，紧贴主菜单（无间隙）
          let left = rect.right;
          let top = rect.top;
          
          // 如果右侧空间不够，显示在左侧
          if (left + 180 > viewportWidth) {
            left = rect.left - 180; // 180px宽度，无间距
          }
          
          submenu.style.left = left + 'px';
          submenu.style.top = top + 'px';
        };
        
        // 鼠标进入主菜单项时更新位置
        newNoteOption.addEventListener('mouseenter', updateSubmenuPosition);
        
        // 鼠标进入二级菜单时也更新位置（防止位置偏移）
        submenu.addEventListener('mouseenter', updateSubmenuPosition);
        
        // 窗口大小改变时更新位置
        window.addEventListener('resize', () => {
          if (submenu.style.display !== 'none') {
            updateSubmenuPosition();
          }
        });
      }
    }
    
    // 点击新建文件夹选项
    if (newFolderOption) {
      newFolderOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        newDropdown.classList.remove('show');
        await createSubFolder();
      });
    }
    
    // 点击选择模板选项
    if (newTemplateOption) {
      newTemplateOption.addEventListener('click', (e) => {
        e.stopPropagation();
        newDropdown.classList.remove('show');
        showTemplateView();
      });
    }
    
    // 点击新建自定义模板选项
    if (newCustomTemplateOption) {
      newCustomTemplateOption.addEventListener('click', (e) => {
        e.stopPropagation();
        newDropdown.classList.remove('show');
        showTemplateEditor();
      });
    }
    
    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!newFolderBtn.contains(e.target) && !newDropdown.contains(e.target)) {
        newDropdown.classList.remove('show');
      }
    });
  } else {
    console.error('找不到新建按钮或下拉菜单元素！');
  }
  
  // 模板编辑界面按钮
  const editorCancelBtn = document.getElementById('editorCancelBtn');
  const editorSaveBtn = document.getElementById('editorSaveBtn');
  
  if (editorCancelBtn) {
    editorCancelBtn.addEventListener('click', () => {
      hideTemplateEditor();
    });
  }
  
  if (editorSaveBtn) {
    editorSaveBtn.addEventListener('click', async () => {
      await saveTemplateFromEditor();
    });
  }
  
  // 刷新按钮
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      console.log('刷新按钮被点击');
      await refreshFileTree(false);  // 手动刷新
    });
  }
  
  // Search input
  document.getElementById('searchInput').addEventListener('input', (e) => {
    filterFileTree(e.target.value);
  });
  
  // Send button
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  
  // Chat input enter key
  document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  
  // File drop zone - 全局拖拽支持
  const dropZone = document.getElementById('fileDropZone');
  const rightPanel = document.querySelector('.right-panel');
  const middlePanel = document.querySelector('.middle-panel');

  // 创建拖拽遮罩层
  let dragOverlay = null;
  const createDragOverlay = () => {
    if (!dragOverlay) {
      dragOverlay = document.createElement('div');
      dragOverlay.className = 'drag-overlay';
      dragOverlay.innerHTML = `
        <div class="drag-overlay-content">
          <svg class="drag-overlay-icon" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div class="drag-overlay-text">释放文件以添加</div>
          <div class="drag-overlay-hint">支持 PDF、图片、文本等格式</div>
        </div>
      `;
      document.body.appendChild(dragOverlay);
    }
    return dragOverlay;
  };

  // 全局拖拽事件 - 防止浏览器默认行为
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    // 检查是否是文件拖拽
    if (e.dataTransfer.types.includes('Files')) {
      const overlay = createDragOverlay();
      overlay.style.display = 'flex';
      rightPanel?.classList.add('drag-over');
      middlePanel?.classList.add('drag-over');
    }
  });

  document.addEventListener('dragleave', (e) => {
    // 只有当离开文档时才隐藏遮罩
    if (e.relatedTarget === null || !document.body.contains(e.relatedTarget)) {
      if (dragOverlay) {
        dragOverlay.style.display = 'none';
      }
      rightPanel?.classList.remove('drag-over');
      middlePanel?.classList.remove('drag-over');
      dropZone.classList.remove('drag-over');
    }
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();

    // 隐藏遮罩
    if (dragOverlay) {
      dragOverlay.style.display = 'none';
    }
    rightPanel?.classList.remove('drag-over');
    middlePanel?.classList.remove('drag-over');
    dropZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      const unsupportedExts = getUnsupportedExtensionList(files);
      const supportedFiles = getSupportedFiles(files);

      if (unsupportedExts.length > 0) {
        showAlert(`不支持的文件格式：${unsupportedExts.map(ext => `.${ext}`).join(', ')}<br><br>支持格式：${SUPPORTED_UPLOAD_EXTENSIONS.map(ext => `.${ext}`).join(', ')}`);
      }

      if (supportedFiles.length === 0) {
        return;
      }

      // 仅处理支持的文件
      supportedFiles.forEach(file => {
        const ext = getFileExtension(file.name);
        const fileObj = {
          name: file.name,
          path: null,
          file: file,
          url: URL.createObjectURL(file),
          fileType: getFileType(ext)
        };
        addAttachment(fileObj);
      });

      // 显示第一个支持的文件
      const firstFile = supportedFiles[0];
      displayFile(firstFile, getFileExtension(firstFile.name));
    }
  });

  // 保留原有的 dropZone 事件（用于点击上传）
  dropZone.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.txt,.md,.jpg,.jpeg,.png,.gif,.webp';
    fileInput.multiple = true;
    fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        const unsupportedExts = getUnsupportedExtensionList(files);
        const supportedFiles = getSupportedFiles(files);

        if (unsupportedExts.length > 0) {
          showAlert(`不支持的文件格式：${unsupportedExts.map(ext => `.${ext}`).join(', ')}<br><br>支持格式：${SUPPORTED_UPLOAD_EXTENSIONS.map(ext => `.${ext}`).join(', ')}`);
        }

        if (supportedFiles.length === 0) {
          return;
        }

        supportedFiles.forEach(file => {
          const ext = getFileExtension(file.name);
          const fileObj = {
            name: file.name,
            path: null,
            file: file,
            url: URL.createObjectURL(file),
            fileType: getFileType(ext)
          };
          addAttachment(fileObj);
        });

        // 显示第一个支持的文件
        const firstFile = supportedFiles[0];
        displayFile(firstFile, getFileExtension(firstFile.name));
      }
    };
    fileInput.click();
  });
  
  // Template button
  document.getElementById('templateBtn').addEventListener('click', () => {
    alert('笔记模板功能开发中...');
  });

  // Navigation icons - 页面跳转
  // 用户头像 - 跳转到首页
  const navUserIcon = document.getElementById('navUser');
  if (navUserIcon) {
    // 加载用户头像
    const avatarImg = navUserIcon.querySelector('img');
    const savedAvatar = localStorage.getItem('profilePicture');
    if (savedAvatar && avatarImg) {
      avatarImg.src = savedAvatar;
    }
    // 点击跳转到首页
    navUserIcon.addEventListener('click', () => {
      window.location.href = '../index.html';
    });
  }
  
  // 主界面（AI智能解释）- 当前页面，不需要跳转
  document.getElementById('navMain')?.addEventListener('click', () => {
    // 当前页面，不需要跳转
    console.log('已在主界面');
  });
  
  // 文献推荐页面
  document.getElementById('navRecommend')?.addEventListener('click', () => {
    window.location.href = '../recommend/recommend.html';
  });
  
  // 知识管理页面
  document.getElementById('navManage')?.addEventListener('click', () => {
    window.location.href = '../manage/manage.html';
  });
}

// Handle file upload
function handleFileUpload(files) {
  Array.from(files).forEach(file => {
    const fileItem = {
      name: file.name,
      type: 'file',
      fileType: getFileType(file.name),
      file: file,
      url: URL.createObjectURL(file)
    };

    // Add to first folder or create new folder
    if (fileTreeData.length > 0 && fileTreeData[0].type === 'folder') {
      if (!fileTreeData[0].children) {
        fileTreeData[0].children = [];
      }
      fileTreeData[0].children.push(fileItem);
      fileTreeData[0].expanded = true;
    } else {
      fileTreeData.unshift({
        name: '新建文件夹',
        type: 'folder',
        expanded: true,
        children: [fileItem]
      });
    }
  });

  renderFileTree();
}

// ================= 文件卡片功能 =================

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// 根据文件类型获取图标
function getFileIcon(ext) {
  const iconMap = {
    'pdf': '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
    'doc': '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
    'docx': '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
    'txt': '<svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'md': '<svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'jpg': '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    'jpeg': '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    'png': '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    'gif': '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    'webp': '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    'py': '<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'js': '<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'ts': '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'java': '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'cpp': '<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'c': '<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'html': '<svg viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    'css': '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    'json': '<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    'zip': '<svg viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="10" y1="15" x2="10" y2="9"></line><line x1="8" y1="12" x2="12" y2="12"></line></svg>',
    'mp3': '<svg viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><circle cx="12" cy="15" r="3"></circle></svg>',
    'mp4': '<svg viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
    'default': '<svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
  };

  return iconMap[ext] || iconMap['default'];
}

// 创建文件卡片
function createFileCard(file, ext) {
  const card = document.createElement('div');
  card.className = 'file-card';

  const icon = getFileIcon(ext);

  card.innerHTML = `
    <div class="file-card-icon">${icon}</div>
    <div class="file-card-info">
      <div class="file-card-name">${file.name}</div>
      <div class="file-card-meta">${formatFileSize(file.size)} · ${ext.toUpperCase()}</div>
    </div>
    <button class="file-card-action" title="发送到 AI">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    </button>
  `;

  // 点击卡片显示文件内容
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.file-card-action')) {
      displayFile(file, ext);
    }
  });

  // 点击发送按钮发送文件到 AI
  card.querySelector('.file-card-action').addEventListener('click', () => {
    displayFile(file, ext);
    document.getElementById('chatInput').focus();
  });

  return card;
}

// 添加文件卡片消息
function addFileCardMessage(cardElement) {
  const chatMessages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user file-message';
  messageDiv.appendChild(cardElement);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示文件内容
async function displayFile(file, ext) {
  const displayArea = document.getElementById('displayArea');
  displayArea.style.display = 'flex';
  displayArea.innerHTML = '<div class="loading">加载中...</div>';

  const fileExt = String(ext || getFileExtension(file.name)).toLowerCase();
  // 仅对外部拖入/上传文件做强格式校验；文件树内部文件沿用原逻辑。
  if (!file.path && !isSupportedUploadExtension(fileExt)) {
    await showAlert(`不支持的文件格式：.${fileExt || '(无扩展名)'}<br><br>支持格式：${SUPPORTED_UPLOAD_EXTENSIONS.map(item => `.${item}`).join(', ')}`);
    displayArea.innerHTML = '<div class="error" style="color: #ff6b6b; padding: 20px;">不支持的文件格式</div>';
    return;
  }

  const fileType = getFileType(file.name);
  const fileObj = {
    name: file.name,
    path: file.path || null,
    file: file,
    url: file.path ? null : URL.createObjectURL(file),
    fileType: fileType
  };

  try {
    if (fileType === 'image') {
      const img = document.createElement('img');
      img.src = fileObj.url;
      img.className = 'file-preview';
      displayArea.innerHTML = '';
      displayArea.appendChild(img);
    } else if (fileType === 'pdf') {
      // 创建 PDF 查看器容器
      const pdfContainer = document.createElement('div');
      pdfContainer.className = 'pdf-viewer-container';

      const embed = document.createElement('embed');
      embed.src = fileObj.url + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';
      embed.className = 'pdf-embed';
      embed.type = 'application/pdf';

      pdfContainer.appendChild(embed);
      displayArea.innerHTML = '';
      displayArea.appendChild(pdfContainer);
    } else {
      // 文本文件直接读取内容
      const content = await file.text();
      const div = document.createElement('div');
      div.className = 'file-preview';

      if (fileType === 'markdown') {
        const renderedContent = renderMarkdown(content);
        div.innerHTML = `<div class="markdown-content">${renderedContent}</div>`;
      } else {
        div.innerHTML = `<pre style="color: #ffffff; white-space: pre-wrap; padding: 20px;">${escapeHtml(content)}</pre>`;
      }

      displayArea.innerHTML = '';
      displayArea.appendChild(div);
    }
  } catch (error) {
    console.error('读取文件失败:', error);
    displayArea.innerHTML = `<div class="error" style="color: #ff6b6b; padding: 20px;">读取文件失败：${error.message}</div>`;
  }
}

// Get file type from extension
function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    return 'image';
  } else if (ext === 'pdf') {
    return 'pdf';
  } else if (['md', 'txt'].includes(ext)) {
    return 'markdown';
  }
  return 'file';
}

// Filter file tree
function filterFileTree(query) {
  // Simple search implementation
  const items = document.querySelectorAll('.folder-item, .file-item');
  items.forEach(item => {
    const name = item.querySelector('.folder-name, .file-name').textContent.toLowerCase();
    if (name.includes(query.toLowerCase())) {
      item.style.display = '';
    } else {
      item.style.display = query ? 'none' : '';
    }
  });
}

// Send message
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Add user message
  addUserMessage(message);
  input.value = '';
  
  // 显示加载状态
  const loadingMessage = {
    type: 'ai',
    text: '🤔 正在思考中...',
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    isLoading: true
  };
  renderMessage(loadingMessage);
  
  // 调用真正的 AI
  await callAI(message);
}

// 调用 AI API
async function callAI(userQuery) {
  try {
    // 1. 先尝试通过 Agent 处理（智能意图识别）
    const agentResult = await window.electronAPI.agent.process(userQuery, {
      content: currentFile ? currentFile.path : null,
      contentType: currentFile?.fileType || 'text'
    });

    if (agentResult.success && agentResult.skill) {
      removeLoadingMessage();
      addAIMessage(formatAgentResult(agentResult));
      return;
    }

    // 2. 未识别到技能，走普通 AI 问答
    // 读取所有附件内容
    let allFileContent = '';
    let fileNames = [];

    // 首先检查附件列表
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        const content = await readFileContent(file);
        if (content) {
          allFileContent += `\n\n--- ${file.name} ---\n${content}`;
          fileNames.push(file.name);
        }
      }
    } else if (currentFile) {
      // 如果没有附件但有当前文件，读取当前文件
      const content = await readFileContent(currentFile);
      if (content) {
        allFileContent = content;
        fileNames.push(currentFile.name);
      }
    }

    // 调用 AI API
    const result = await window.electronAPI.ai.ask(
      userQuery,
      allFileContent || null,
      fileNames.join(', ') || null
    );

    // 移除加载消息
    removeLoadingMessage();

    if (result.success) {
      addAIMessage(result.response);
      // 发送成功后清空附件
      clearAttachments();
    } else {
      addAIMessage(`❌ AI 请求失败: ${result.error || '未知错误'}`);
    }

  } catch (error) {
    console.error('AI 调用失败:', error);
    removeLoadingMessage();
    addAIMessage(`❌ AI 调用出错: ${error.message}`);
  }
}

// 读取文件内容
async function readFileContent(file) {
  try {
    // 如果有 file 对象（拖拽上传的文件）
    if (file.file && file.file instanceof File) {
      if (file.fileType === 'pdf') {
        // PDF 文件需要通过后端处理
        if (file.path) {
          const result = await window.electronAPI.file.readPdf(file.path);
          if (result.success) {
            return result.content;
          }
        }
        // 没有路径的话，无法读取 PDF 内容
        console.warn('PDF 文件没有本地路径，无法读取内容');
        return null;
      }
      // 其他文件类型直接读取文本
      return await file.file.text();
    }

    // 如果有本地路径（从文件树选择的文件）
    if (file.path) {
      if (file.fileType === 'pdf') {
        const result = await window.electronAPI.file.readPdf(file.path);
        if (result.success) {
          return result.content;
        }
      } else {
        const result = await window.electronAPI.file.read(file.path);
        if (result.success) {
          return result.content;
        }
      }
    }

    return null;
  } catch (e) {
    console.warn('读取文件内容失败:', file.name, e);
    return null;
  }
}

// 格式化 Agent 处理结果
function formatAgentResult(result) {
  if (!result.success) {
    return `❌ 处理失败: ${result.error || '未知错误'}`;
  }

  const { skill, result: data } = result;

  switch (skill) {
    case 'recommend':
      const papers = data || [];
      if (papers.length === 0) return '未找到相关论文';
      let msg = `📚 找到 ${papers.length} 篇相关论文：\n\n`;
      papers.forEach((p, i) => {
        msg += `**${i + 1}. ${p.title}**\n`;
        msg += `   作者: ${p.authors?.slice(0, 3).join(', ') || '未知'}\n`;
        if (p.pdfUrl) msg += `   [PDF](${p.pdfUrl})\n`;
        msg += '\n';
      });
      return msg;

    case 'summarize':
      return `📝 **内容总结**\n\n${data}`;

    case 'classify':
      return `📁 **分类结果**\n\n${JSON.stringify(data, null, 2)}`;

    case 'schedule':
      return `⏰ **定时任务已创建**\n\n关键词: ${data.keyword}\n时间: ${data.time}\n重复: ${data.repeat}`;

    default:
      return JSON.stringify(data, null, 2);
  }
}

// 移除加载中的消息
function removeLoadingMessage() {
  const chatMessages = document.getElementById('chatMessages');
  const loadingMsg = chatMessages.querySelector('.message.ai:last-child');
  if (loadingMsg && loadingMsg.textContent.includes('正在思考中')) {
    loadingMsg.remove();
  }
}

// Add user message
function addUserMessage(text) {
  const message = {
      type: 'user',
      text: text,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };
  
  chatHistory.push(message);
  renderMessage(message);
  saveChatHistory();
}

// Add AI message
function addAIMessage(text) {
  const message = {
      type: 'ai',
      text: text,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };
  
  chatHistory.push(message);
  renderMessage(message);
  saveChatHistory();
}

// Render message
function renderMessage(message) {
  const chatMessages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.type}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  const avatarImg = document.createElement('img');
  avatarImg.src = message.type === 'user' ? '../../img/user.png' : '../../img/robot.png';
  avatar.appendChild(avatarImg);
  
  const content = document.createElement('div');
  content.className = 'message-content';
  
  // Convert text to HTML with line breaks and formatting
  let html = message.text.replace(/\n/g, '<br>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(\d+)\.\s/g, '<strong>$1.</strong> ');
  content.innerHTML = html;
  
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = message.time;
  content.appendChild(time);
  
  if (message.type === 'ai') {
    const feedback = document.createElement('div');
    feedback.className = 'message-feedback';
    feedback.innerHTML = '<button class="feedback-btn">👍</button><button class="feedback-btn">👎</button>';
    content.appendChild(feedback);
  }
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Save chat history
function saveChatHistory() {
  localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
}

// Load chat history
function loadChatHistory() {
  const saved = localStorage.getItem('chatHistory');
  if (saved) {
    chatHistory = JSON.parse(saved);
    chatHistory.forEach(message => {
      renderMessage(message);
    });
  }
}

// ================= 模板管理功能 =================

// 默认模板数据
let templates = [
  {
    id: 1,
    name: '概念解释模板',
    description: '用于记录概念解释',
    color: 'green',
    content: '# 概念解释\n\n## 概念名称\n\n## 定义\n\n## 核心要点\n\n## 应用场景\n\n## 相关概念\n'
  },
  {
    id: 2,
    name: '论文总结模板',
    description: '用于总结论文',
    color: 'blue',
    content: '# 论文总结\n\n## 论文标题\n\n## 作者信息\n\n## 核心观点\n\n## 研究方法\n\n## 主要结论\n\n## 个人思考\n'
  },
  {
    id: 3,
    name: '代码分析模板',
    description: '用于分析代码片段',
    color: 'purple',
    content: '# 代码分析\n\n## 代码功能\n\n## 代码结构\n\n## 关键算法\n\n## 优化建议\n\n## 相关知识点\n'
  },
  {
    id: 4,
    name: '实验记录模板',
    description: '用于记录实验过程',
    color: 'orange',
    content: '# 实验记录\n\n## 实验目的\n\n## 实验环境\n\n## 实验步骤\n\n## 实验结果\n\n## 问题分析\n\n## 改进方向\n'
  }
];

// 显示模板选择界面
function showTemplateView() {
  const displayArea = document.getElementById('displayArea');
  const templateView = document.getElementById('templateView');
  
  if (displayArea && templateView) {
    displayArea.style.display = 'none';
    templateView.style.display = 'flex';
    renderTemplates();
  }
}

// 隐藏模板选择界面
function hideTemplateView() {
  const displayArea = document.getElementById('displayArea');
  const templateView = document.getElementById('templateView');
  
  if (displayArea && templateView) {
    displayArea.style.display = 'flex';
    templateView.style.display = 'none';
  }
}

// 渲染模板列表
function renderTemplates() {
  const templateGrid = document.getElementById('templateGrid');
  if (!templateGrid) return;
  
  // 从localStorage加载模板
  const savedTemplates = localStorage.getItem('templates');
  if (savedTemplates) {
    templates = JSON.parse(savedTemplates);
  }
  
  templateGrid.innerHTML = '';
  
  templates.forEach(template => {
    const card = document.createElement('div');
    card.className = `template-card ${template.color}`;
    
    card.innerHTML = `
      <div class="template-card-title">${template.name}</div>
      <div class="template-card-desc">${template.description}</div>
      <div class="template-card-actions">
        <button class="template-card-btn use" data-id="${template.id}">使用</button>
        <button class="template-card-btn edit" data-id="${template.id}">编辑</button>
      </div>
    `;
    
    // 使用模板
    card.querySelector('.use').addEventListener('click', (e) => {
      e.stopPropagation();
      useTemplate(template);
    });
    
    // 编辑模板
    card.querySelector('.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      editTemplate(template);
    });
    
    templateGrid.appendChild(card);
  });
  
  // 新建模板按钮
  const newTemplateBtn = document.getElementById('newTemplateBtn');
  if (newTemplateBtn) {
    newTemplateBtn.onclick = () => createCustomTemplate();
  }
}

// 使用模板
async function useTemplate(template) {
  if (!currentFolderPath) {
    await showAlert('请先打开一个文件夹');
    return;
  }
  
  const fileName = await showPrompt('请输入笔记文件名：<br><br>例如：深度学习基础笔记');
  if (!fileName || fileName.trim() === '') {
    return;
  }
  
  const filePath = `${currentFolderPath}/${fileName.trim()}.md`;
  
  try {
    const result = await window.electronAPI.file.write(filePath, template.content);
    if (result.success) {
      await showAlert('笔记创建成功！');
      await refreshFileTree(false);
      hideTemplateView();
    } else {
      await showAlert('创建失败：' + (result.error || '未知错误'));
    }
  } catch (error) {
    console.error('创建笔记失败:', error);
    await showAlert('创建失败：' + error.message);
  }
}

// 编辑模板
async function editTemplate(template) {
  showTemplateEditor(template);
}

// 显示模板编辑界面
function showTemplateEditor(template = null) {
  const displayArea = document.getElementById('displayArea');
  const templateView = document.getElementById('templateView');
  const templateEditorView = document.getElementById('templateEditorView');
  const editorTitle = document.getElementById('editorTitle');
  const templateTitleInput = document.getElementById('templateTitleInput');
  const templateContentInput = document.getElementById('templateContentInput');
  const editorDate = document.getElementById('editorDate');
  
  if (displayArea && templateEditorView) {
    displayArea.style.display = 'none';
    if (templateView) templateView.style.display = 'none';
    templateEditorView.style.display = 'flex';
    
    // 设置当前编辑的模板（用于编辑模式）
    templateEditorView.dataset.templateId = template ? template.id : '';
    
    if (template) {
      // 编辑模式
      editorTitle.textContent = '编辑自定义模板';
      templateTitleInput.value = template.name;
      templateContentInput.value = template.content;
    } else {
      // 新建模式
      editorTitle.textContent = '新建自定义模板';
      templateTitleInput.value = '';
      templateContentInput.value = '# 标题\n\n## 正文内容\n\n';
    }
    
    // 更新日期
    const now = new Date();
    editorDate.textContent = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  }
}

// 隐藏模板编辑界面
function hideTemplateEditor() {
  const displayArea = document.getElementById('displayArea');
  const templateEditorView = document.getElementById('templateEditorView');
  
  if (displayArea && templateEditorView) {
    templateEditorView.style.display = 'none';
    displayArea.style.display = 'flex';
  }
}

// 从编辑界面保存模板
async function saveTemplateFromEditor() {
  const templateEditorView = document.getElementById('templateEditorView');
  const templateTitleInput = document.getElementById('templateTitleInput');
  const templateContentInput = document.getElementById('templateContentInput');
  
  if (!templateTitleInput || !templateContentInput) {
    return;
  }
  
  const title = templateTitleInput.value.trim();
  const content = templateContentInput.value.trim();
  
  if (!title) {
    await showAlert('请输入模板标题');
    return;
  }
  
  if (!content) {
    await showAlert('请输入模板内容');
    return;
  }
  
  const templateId = templateEditorView.dataset.templateId;
  
  // 从localStorage加载模板
  const savedTemplates = localStorage.getItem('templates');
  if (savedTemplates) {
    templates = JSON.parse(savedTemplates);
  }
  
  if (templateId) {
    // 编辑模式：更新现有模板
    const template = templates.find(t => t.id == templateId);
    if (template) {
      template.name = title;
      template.content = content;
    }
  } else {
    // 新建模式：创建新模板
    const newTemplate = {
      id: Date.now(),
      name: title,
      description: '自定义模板',
      color: 'green',
      content: content
    };
    templates.push(newTemplate);
  }
  
  localStorage.setItem('templates', JSON.stringify(templates));
  
  // 如果模板视图是打开的，更新它
  const templateView = document.getElementById('templateView');
  if (templateView && templateView.style.display !== 'none') {
    renderTemplates();
  }
  
  hideTemplateEditor();
  await showAlert(templateId ? '模板已更新' : '模板创建成功！');
}

// 创建自定义模板（保留用于从模板列表创建）
async function createCustomTemplate() {
  showTemplateEditor();
}

