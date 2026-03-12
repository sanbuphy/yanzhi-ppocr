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

const EXPLANATION_PENDING_TEXT = '正在生成 AI 解释，请稍候...';
const EXPLANATION_TIMEOUT_TEXT = 'AI请求超时';

function setButtonsDisabled(disabled) {
  cancelBtn.disabled = disabled;
  copyTextBtn.disabled = disabled;
  copyExplanationBtn.disabled = disabled;
  autoSaveBtn.disabled = disabled;
  browseBtn.disabled = disabled;
}

function updateExplanationButtonState(explanationText) {
  const value = String(explanationText || '').trim();
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
  const explanationText = String(explanationTextEl.value || '').trim();
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
  explanationTextEl.value = explanationText;
  submitted = false;
  copyTextBtn.disabled = false;
  cancelBtn.disabled = false;
  browseBtn.disabled = false;

  updateExplanationButtonState(explanationText);

  // 监听 AI 解释更新
  if (explanationChannel) {
    ipcRenderer.removeAllListeners(explanationChannel);
    ipcRenderer.on(explanationChannel, (innerEvent, updatePayload) => {
      explanationTextEl.value = String(updatePayload?.explanationText || '');
      updateExplanationButtonState(explanationTextEl.value);
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