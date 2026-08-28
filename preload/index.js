// preload/index.js - 兼容沙箱模式的标准写法
// 沙箱模式下仍可使用 require('electron') 获取 contextBridge 和 ipcRenderer

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  config: {
    get: () => ipcRenderer.invoke('get-config'),
    saveRssFeeds: (feeds) => ipcRenderer.invoke('save-rss-feeds', feeds),
    saveEmailConfig: (config) => ipcRenderer.invoke('save-email-config', config),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  },
  monitor: {
    toggle: () => ipcRenderer.invoke('toggle-monitoring'),
    manualCheck: () => ipcRenderer.invoke('manual-check'),
    getStatus: () => ipcRenderer.invoke('get-monitoring-status'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  },
  autoStart: {
    get: () => ipcRenderer.invoke('get-auto-start'),
    set: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  },
  rss: {
    testFeed: (url) => ipcRenderer.invoke('test-rss-feed', url),
  },
  email: {
    test: (config) => ipcRenderer.invoke('test-email', config),
  },
  system: {
    getWindowsVersion: () => ipcRenderer.invoke('get-windows-version'),
  },
  notifications: {
    clear: () => ipcRenderer.invoke('clear-notified-items'),
  },
  history: {
    clear: () => ipcRenderer.invoke('clear-history'),
  },
  backup: {
    export: () => ipcRenderer.invoke('export-config'),
    import: (config) => ipcRenderer.invoke('import-config', config),
  },
  on: (channel, callback) => {
    const validChannels = [
      'theme-changed',
      'check-started',
      'check-complete',
      'monitoring-status-changed',
      'email-status'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },
  off: (channel, callback) => {
    const validChannels = [
      'theme-changed',
      'check-started',
      'check-complete',
      'monitoring-status-changed',
      'email-status'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback);
    }
  },
});

console.log('[Preload] electronAPI exposed to renderer');