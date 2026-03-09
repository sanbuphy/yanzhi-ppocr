const { ipcRenderer } = require('electron');

const originalTextEl = document.getElementById('originalText');
const explanationTextEl = document.getElementById('explanationText');
const cancelBtn = document.getElementById('cancel');
const copyTextBtn = document.getElementById('copyText');
const copyExplanationBtn = document.getElementById('copyExplanation');
const autoSaveBtn = document.getElementById('autoSave');

let submitChannel = '';
let cancelChannel = '';
let explanationChannel = '';
let submitted = false;
let explanationReady = false;

const EXPLANATION_PENDING_TEXT = '正在生成 AI 解释，请稍候...';
const EXPLANATION_TIMEOUT_TEXT = 'AI请求超时';

function setButtonsDisabled(disabled) {
  cancelBtn.disabled = disabled;
  copyTextBtn.disabled = disabled;
  copyExplanationBtn.disabled = disabled;
  autoSaveBtn.disabled = disabled;
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
  if (action === 'copy_explanation' && !explanationReady) {
    explanationTextEl.focus();
    return;
  }
  if (action === 'auto_save' && !explanationReady) {
    explanationTextEl.focus();
    return;
  }
  if (!originalText) {
    originalTextEl.focus();
    return;
  }
  submitted = true;
  setButtonsDisabled(true);
  ipcRenderer.send(submitChannel, { action, originalText, explanationText });
}

function cancel() {
  if (submitted) return;
  submitted = true;
  setButtonsDisabled(true);
  if (cancelChannel) {
    ipcRenderer.send(cancelChannel);
  }
}

ipcRenderer.on('textcapture:confirm-data', (event, payload) => {
  const originalText = String(payload?.originalText || '');
  const explanationText = String(payload?.explanationText || '');
  submitChannel = String(payload?.submitChannel || '');
  cancelChannel = String(payload?.cancelChannel || '');
  explanationChannel = String(payload?.explanationChannel || '');
  originalTextEl.value = originalText;
  explanationTextEl.value = explanationText;
  submitted = false;
  copyTextBtn.disabled = false;
  cancelBtn.disabled = false;
  updateExplanationButtonState(explanationText);
  if (explanationChannel) {
    ipcRenderer.removeAllListeners(explanationChannel);
    ipcRenderer.on(explanationChannel, (innerEvent, updatePayload) => {
      explanationTextEl.value = String(updatePayload?.explanationText || '');
      updateExplanationButtonState(explanationTextEl.value);
    });
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
  if (!submitted && cancelChannel) {
    ipcRenderer.send(cancelChannel);
  }
});
