const { ipcRenderer } = require('electron');
const path = require('path');

const originalTextEl = document.getElementById('originalText');
const explanationTextEl = document.getElementById('explanationText');
const savePathEl = document.getElementById('savePath');
const classifyInfoEl = document.getElementById('classifyInfo');
const browseBtn = document.getElementById('browseBtn');
const cancelBtn = document.getElementById('cancel');
const copyTextBtn = document.getElementById('copyText');
const copyExplanationBtn = document.getElementById('copyExplanation');
const autoSaveBtn = document.getElementById('autoSave');

let submitChannel = '';
let cancelChannel = '';
let explanationChannel = '';
let classifyChannel = '';
let browseChannel = '';
let browseResultChannel = '';
let saveToFileChannel = '';
let submitted = false;
let explanationReady = false;
let cancelSent = false;
let rawExplanationText = ''; // 保存原始 markdown 文本用于复制

// Markdown 渲染函数（复用 main.js 的实现）
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
  html = html.replace(/\*([^*\n]+?)\*/g, (match, text) => {
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
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

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

  // 处理列表和段落
  const listLines = html.split('\n');
  let result = [];
  let listItems = [];
  let currentListType = null;

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

    // 非列表项
    flushList();

    if (!trimmed) {
      result.push('');
    } else if (trimmed.match(/^<(h[1-6]|pre|blockquote|hr|ul|ol|p)/)) {
      result.push(trimmed);
    } else {
      result.push(`<p>${trimmed}</p>`);
    }
  });

  flushList();

  html = result.join('\n');

  // 清理多余标签
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]|ul|ol|pre|blockquote|hr)/g, '$1');
  html = html.replace(/(<\/h[1-6]|<\/ul>|<\/ol>|<\/pre>|<\/blockquote>|<\/hr>)<\/p>/g, '$1');
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

// 设置 AI 解释文本（同时保存原始文本和渲染 HTML）
function setExplanationText(text) {
  rawExplanationText = String(text || '');
  explanationTextEl.innerHTML = renderMarkdown(rawExplanationText) || `<span style="color: var(--muted);">${EXPLANATION_PENDING_TEXT}</span>`;
}

const EXPLANATION_PENDING_TEXT = '正在生成 AI 解释，请稍候...';
const EXPLANATION_TIMEOUT_TEXT = 'AI请求超时';

function setButtonsDisabled(disabled) {
  cancelBtn.disabled = disabled;
  copyTextBtn.disabled = disabled;
  copyExplanationBtn.disabled = disabled;
  autoSaveBtn.disabled = disabled;
  browseBtn.disabled = disabled;
}

function updateExplanationButtonState() {
  const value = rawExplanationText.trim();
  const isPending = !value || value === EXPLANATION_PENDING_TEXT;
  const isTimeout = value === EXPLANATION_TIMEOUT_TEXT;
  const isFailure = value.startsWith('AI 解释生成失败') || value.startsWith('AI解释生成失败') || value.startsWith('❌');
  explanationReady = !isPending && !isTimeout && !isFailure;
  copyExplanationBtn.disabled = submitted || !explanationReady;
  autoSaveBtn.disabled = submitted || !explanationReady;
}

function submit(action) {
  if (submitted || !submitChannel) return;
  const originalText = String(originalTextEl.value || '').trim();
  const explanationText = rawExplanationText.trim();
  const savePath = String(savePathEl.value || '').trim();

  if (action === 'copy_explanation' && !explanationReady) {
    explanationTextEl.focus();
    return;
  }

  if (action === 'auto_save') {
    if (!explanationReady) {
      explanationTextEl.focus();
      return;
    }
    if (!savePath) {
      savePathEl.focus();
      showToast('请选择或输入保存文件路径', 'error');
      return;
    }

    // 执行保存
    autoSaveBtn.disabled = true;
    autoSaveBtn.textContent = '保存中...';

    // 先监听保存结果
    ipcRenderer.once('textcapture:save-result', (event, result) => {
      if (result.success) {
        showToast('保存成功！', 'success');
        setTimeout(() => {
          doSubmit(action, originalText, explanationText, result.path);
        }, 800);
      } else {
        showToast(result.error || '保存失败', 'error');
        autoSaveBtn.disabled = false;
        autoSaveBtn.textContent = '保存到文件';
      }
    });

    // 发送保存请求（使用动态 channel）
    ipcRenderer.send(saveToFileChannel, {
      filePath: savePath,
      text: originalText,
      explanation: explanationText
    });
    return;
  }

  if (!originalText) {
    originalTextEl.focus();
    return;
  }

  doSubmit(action, originalText, explanationText, '');
}

function doSubmit(action, originalText, explanationText, savePath) {
  submitted = true;
  setButtonsDisabled(true);
  ipcRenderer.send(submitChannel, { action, originalText, explanationText, savePath });
}

function sendCancelOnce() {
  if (cancelSent || !cancelChannel) return;
  cancelSent = true;
  ipcRenderer.send(cancelChannel);
}

function cancel() {
  if (submitted) return;
  submitted = true;
  setButtonsDisabled(true);
  sendCancelOnce();
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2000);
}

ipcRenderer.on('textcapture:confirm-data', (event, payload) => {
  const originalText = String(payload?.originalText || '');
  const explanationText = String(payload?.explanationText || '');
  submitChannel = String(payload?.submitChannel || '');
  cancelChannel = String(payload?.cancelChannel || '');
  explanationChannel = String(payload?.explanationChannel || '');
  classifyChannel = String(payload?.classifyChannel || '');
  browseChannel = String(payload?.browseChannel || '');
  browseResultChannel = String(payload?.browseResultChannel || '');
  saveToFileChannel = String(payload?.saveToFileChannel || '');
  cancelSent = false;

  originalTextEl.value = originalText;
  setExplanationText(explanationText);
  submitted = false;
  copyTextBtn.disabled = false;
  cancelBtn.disabled = false;
  browseBtn.disabled = false;

  updateExplanationButtonState();

  // 监听 AI 解释更新
  if (explanationChannel) {
    ipcRenderer.removeAllListeners(explanationChannel);
    ipcRenderer.on(explanationChannel, (innerEvent, updatePayload) => {
      setExplanationText(updatePayload?.explanationText || '');
      updateExplanationButtonState();
    });
  }

  // 监听分类结果
  if (classifyChannel) {
    ipcRenderer.removeAllListeners(classifyChannel);
    ipcRenderer.on(classifyChannel, (innerEvent, updatePayload) => {
      const classifyResult = updatePayload?.classifyResult;
      if (classifyResult && classifyResult.success && classifyResult.savePath) {
        savePathEl.value = classifyResult.savePath;
        const folderName = classifyResult.folderName || path.basename(path.dirname(classifyResult.savePath));
        classifyInfoEl.textContent = `智能推荐保存到「${folderName}」文件夹（置信度: ${Math.round((classifyResult.confidence || 0.5) * 100)}%）`;
        classifyInfoEl.classList.remove('error');
      } else {
        classifyInfoEl.textContent = classifyResult?.error || '无法智能分类';
        classifyInfoEl.classList.add('error');
      }
    });
  }

  // 监听浏览结果
  if (browseResultChannel) {
    ipcRenderer.removeAllListeners(browseResultChannel);
    ipcRenderer.on(browseResultChannel, (innerEvent, updatePayload) => {
      if (updatePayload?.selectedPath) {
        savePathEl.value = updatePayload.selectedPath;
      }
    });
  }
});

// 浏览按钮
browseBtn.addEventListener('click', () => {
  if (browseChannel) {
    ipcRenderer.send(browseChannel);
  }
});

cancelBtn.addEventListener('click', cancel);
copyTextBtn.addEventListener('click', () => submit('copy_text'));
copyExplanationBtn.addEventListener('click', () => submit('copy_explanation'));
autoSaveBtn.addEventListener('click', () => submit('auto_save'));

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
  }
});

window.addEventListener('beforeunload', () => {
  if (explanationChannel) {
    ipcRenderer.removeAllListeners(explanationChannel);
  }
  if (classifyChannel) {
    ipcRenderer.removeAllListeners(classifyChannel);
  }
  if (browseResultChannel) {
    ipcRenderer.removeAllListeners(browseResultChannel);
  }
  if (!submitted) {
    sendCancelOnce();
    submitted = true;
  }
});