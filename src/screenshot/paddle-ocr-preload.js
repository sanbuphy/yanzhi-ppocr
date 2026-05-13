const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paddleOcrBridge', {
    onRecognize(callback) {
        ipcRenderer.on('paddleocr-js:recognize', (_event, payload) => callback(payload));
    },
    sendReady(payload) {
        ipcRenderer.send('paddleocr-js:ready', payload);
    },
    sendReply(channel, payload) {
        ipcRenderer.send(channel, payload);
    },
    log(payload) {
        ipcRenderer.send('paddleocr-js:log', payload);
    }
});
