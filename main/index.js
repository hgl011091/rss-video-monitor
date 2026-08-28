console.log('[Main] Starting RSS Video Monitor...');
console.log('[Main] Process argv:', process.argv);
console.log('[Main] __dirname:', __dirname);

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled Rejection:', reason);
});

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const Parser = require('rss-parser');
const nodemailer = require('nodemailer');
const schedule = require('node-schedule');
const axios = require('axios');

// 请求单实例锁 - 必须在 app.whenReady() 之前
const gotTheLock = app.requestSingleInstanceLock();
console.log('[Main] Single instance lock:', gotTheLock);
if (!gotTheLock) {
  console.log('[Main] Another instance running, quitting');
  app.quit();
}

console.log('[Main] Loading electron-store...');
let Store;
let store;
try {
  Store = require('electron-store');
  console.log('[Main] electron-store module loaded');
  store = new Store({
    name: 'rss-video-monitor-config',
    defaults: {
      rssFeeds: [],
      emailConfig: {
        host: '',
        port: 465,
        secure: true,
        user: '',
        pass: '',
        from: '',
        to: ''
      },
      checkInterval: 5,
      enabled: false,
      lastCheck: null,
      notifiedItems: [],
      theme: 'system'
    }
  });
} catch (err) {
  console.error('[Main] electron-store init failed:', err);
  // 降级到内存存储
  store = {
    get: (key, defaultValue) => defaultValue,
    set: (key, value) => {},
    onDidChange: () => {}
  };
}
console.log('[Main] Store initialization complete');

// 初始化 RSS 解析器
const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

let mainWindow = null;
let tray = null;
let checkJob = null;
let isQuitting = false;

// 创建主窗口
function createWindow() {
  console.log('[Main] >>> createWindow() called');
  console.log('[Main] __dirname:', __dirname);
  console.log('[Main] Preload path:', path.join(__dirname, '../preload/index.js'));
  console.log('[Main] Renderer path:', path.join(__dirname, '../renderer/index.html'));
  console.log('[Main] Preload exists:', require('fs').existsSync(path.join(__dirname, '../preload/index.js')));
  console.log('[Main] Renderer exists:', require('fs').existsSync(path.join(__dirname, '../renderer/index.html')));

  // 智能处理图标：存在则使用，不存在则使用默认，避免窗口创建异常
  const iconPath = path.join(__dirname, '../resources/icon.ico');
  const hasCustomIcon = require('fs').existsSync(iconPath);
  if (hasCustomIcon) {
    console.log('[Main] 使用自定义图标:', iconPath);
  } else {
    console.log('[Main] 未找到自定义图标，使用默认图标:', iconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true
    },
    show: true,
    center: true,
    icon: hasCustomIcon ? iconPath : undefined
  });

  // 窗口级系统材质（Mica/Acrylic）会绘制为矩形背景，遮挡 CSS 圆角并产生方形角尖，
  // 已禁用。改用 CSS 半透明磨砂玻璃层模拟，保证四角圆润干净。
  if (process.platform === 'win32') {
    const os = require('os');
    const release = os.release();
    const build = parseInt(release.split('.')[2] || '0', 10);
    const isWin11 = build >= 22000;
    console.log(`[Main] Windows ${isWin11 ? '11' : '10'} build ${build}，使用 CSS 磨砂玻璃（窗口级材质已禁用以保证圆角干净）`);
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Main] Failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[Renderer Console]', message);
  });

  mainWindow.on('ready-to-show', () => {
    console.log('[Main] Window ready to show');
    applyTheme();
  });

  mainWindow.on('show', () => {
    console.log('[Main] Window show event fired');
    console.log('[Main] Window bounds after show:', mainWindow.getBounds());
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Main] Failed to load:', errorCode, errorDescription, validatedURL);
    mainWindow.loadFile(path.join(__dirname, '../renderer/error.html')).catch(() => {});
  });

  // 加载渲染进程
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  console.log('[Main] Loading renderer from:', rendererPath);
  console.log('[Main] Renderer exists:', require('fs').existsSync(rendererPath));
  console.log('[Main] isDev:', isDev);

  if (isDev) {
    console.log('[Main] Dev mode loading file:', rendererPath);
    mainWindow.loadFile(rendererPath).then(() => {
      console.log('[Main] Dev mode loadFile succeeded');
      mainWindow.webContents.openDevTools();
    }).catch(err => {
      console.error('[Main] Dev mode loadFile error:', err);
    });
  } else {
    console.log('[Main] Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath).then(() => {
      console.log('[Main] loadFile succeeded');
    }).catch(err => {
      console.error('[Main] loadFile error:', err);
    });
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'win32') {
        mainWindow.setSkipTaskbar(true);
      }
    }
  });

  mainWindow.on('closed', () => {
    console.log('[Main] Window closed');
    mainWindow = null;
  });

  // 创建系统托盘
  createTray();

  console.log('[Main] createWindow() completed, returning window');
  return mainWindow;
}

// 创建系统托盘
function createTray() {
  // 优先使用 .ico 格式（Windows 托盘最佳兼容性）
  // 尝试多个可能的路径
  const possiblePaths = [
    // 打包后：process.resourcesPath/resources/icon.ico
    path.join(process.resourcesPath, 'icon.ico'),
    // 打包后：process.resourcesPath/resources/icon.ico (resources 子目录)
    path.join(process.resourcesPath, 'resources', 'icon.ico'),
    // 开发环境：__dirname/../resources/icon.ico
    path.join(__dirname, '..', 'resources', 'icon.ico'),
    // 开发环境：__dirname/../resources/tray-icon.png (备选)
    path.join(__dirname, '..', 'resources', 'tray-icon.png'),
    // 打包后 resources 子目录
    path.join(process.resourcesPath, 'resources', 'tray-icon.png'),
    path.join(process.resourcesPath, 'tray-icon.png'),
  ];

  let trayIcon = nativeImage.createEmpty();
  for (const iconPath of possiblePaths) {
    if (require('fs').existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (!trayIcon.isEmpty()) {
        console.log('[Main] Tray icon loaded from:', iconPath);
        break;
      }
    }
  }

  // 如果所有路径都失败，创建空图标
  if (trayIcon.isEmpty()) {
    console.warn('[Main] Tray icon not found, using empty icon');
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: '立即检查',
      click: () => checkRssFeeds(true)
    },
    { type: 'separator' },
    {
      label: store.get('enabled') ? '暂停监控' : '开始监控',
      click: () => toggleMonitoring()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('RSS视频监控');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// 应用主题
function applyTheme() {
  const theme = store.get('theme');
  let shouldUseDark = false;

  if (theme === 'dark') {
    shouldUseDark = true;
  } else if (theme === 'light') {
    shouldUseDark = false;
  } else {
    shouldUseDark = nativeTheme.shouldUseDarkColors;
  }

  if (mainWindow) {
    // 发送原始主题设置和计算后的实际主题
    mainWindow.webContents.send('theme-changed', { 
      theme: theme,           // 原始设置: 'system' | 'light' | 'dark'
      resolvedTheme: shouldUseDark ? 'dark' : 'light'  // 实际应用: 'dark' | 'light'
    });
  }

  nativeTheme.themeSource = shouldUseDark ? 'dark' : 'light';
}

// 切换监控状态
function toggleMonitoring() {
  const enabled = !store.get('enabled');
  store.set('enabled', enabled);

  if (enabled) {
    startMonitoring();
  } else {
    stopMonitoring();
  }

  updateTrayMenu();
  broadcastMonitoringStatus(); // 每次切换后立即广播最新监控状态
  return enabled;
}

// 更新托盘菜单
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: '立即检查',
      click: () => checkRssFeeds(true)
    },
    { type: 'separator' },
    {
      label: store.get('enabled') ? '暂停监控' : '开始监控',
      click: () => toggleMonitoring()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// 开始监控
function startMonitoring() {
  const interval = store.get('checkInterval');

  if (checkJob) checkJob.cancel();
  checkJob = schedule.scheduleJob(`*/${interval} * * * *`, () => checkRssFeeds(false));

  // 立即执行一次
  checkRssFeeds(false);

  console.log(`[Monitor] 开始监控，间隔: ${interval} 分钟`);
  broadcastMonitoringStatus();
}

// 停止监控
function stopMonitoring() {
  if (checkJob) {
    checkJob.cancel();
    checkJob = null;
  }
  console.log('[Monitor] 停止监控');
  broadcastMonitoringStatus();
}

// 广播监控状态
function broadcastMonitoringStatus() {
  notifyRenderer('monitoring-status-changed', {
    enabled: !!checkJob,
    lastCheck: store.get('lastCheck'),
    checkInterval: store.get('checkInterval')
  });
}

// 检查 RSS 源 - 改进版：并发控制、更好 GUID、异步邮件
async function checkRssFeeds(manual = false) {
  const feeds = store.get('rssFeeds');
  const notifiedItems = new Set(store.get('notifiedItems'));
  const newItems = [];
  const errors = [];

  if (feeds.length === 0) {
    console.log('[Monitor] 没有配置 RSS 源');
    notifyRenderer('check-complete', { newItems: [], errors: [], manual });
    return { newItems, errors };
  }

  const enabledFeeds = feeds.filter(f => f.enabled);
  console.log(`[Monitor] ${manual ? '手动' : '定时'}检查开始，共 ${enabledFeeds.length}/${feeds.length} 个启用源`);
  notifyRenderer('check-started', { manual });

  // 生成更稳健的 GUID（使用 link + title hash，避免标题变化导致重复）
  function generateGuid(item, feedUrl) {
    const base = item.guid || item.link || item.title || '';
    return require('crypto').createHash('md5').update(`${feedUrl}|${base}`).digest('hex').slice(0, 16);
  }

  // 并发控制：最多同时检查 3 个源
  const CONCURRENCY = 3;
  const feedQueue = [...enabledFeeds];
  const running = new Set();

  async function checkFeed(feed) {
    try {
      console.log(`[Monitor] 正在检查: ${feed.name} (${feed.url})`);
      const feedData = await parser.parseURL(feed.url);
      let feedNewItems = 0;

      for (const item of feedData.items) {
        const guid = generateGuid(item, feed.url);

        if (notifiedItems.has(guid)) continue;

        // 关键词过滤
        if (feed.keywords?.length > 0) {
          const title = (item.title || '').toLowerCase();
          const content = (item.contentSnippet || item.content || '').toLowerCase();
          const match = feed.keywords.some(kw => 
            title.includes(kw.toLowerCase()) || content.includes(kw.toLowerCase())
          );
          if (!match) continue;
        }

        if (feed.excludeKeywords?.length > 0) {
          const title = (item.title || '').toLowerCase();
          const content = (item.contentSnippet || item.content || '').toLowerCase();
          const match = feed.excludeKeywords.some(kw => 
            title.includes(kw.toLowerCase()) || content.includes(kw.toLowerCase())
          );
          if (match) continue;
        }

        const newItem = {
          feedName: feed.name,
          feedUrl: feed.url,
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          contentSnippet: item.contentSnippet,
          content: item.content,
          guid,
          thumbnail: getThumbnail(item)
        };

        newItems.push(newItem);
        notifiedItems.add(guid);
        feedNewItems++;
      }

      console.log(`[Monitor] ${feed.name} 检查完成，新增 ${feedNewItems} 个`);
      return { feed: feed.name, success: true };
    } catch (error) {
      const errMsg = error.message || '未知错误';
      console.error(`[Monitor] 检查 ${feed.name} 失败:`, errMsg);
      errors.push({ feed: feed.name, error: errMsg });
      return { feed: feed.name, success: false, error: errMsg };
    }
  }

  // 并发执行检查
  const runningPromises = new Map(); // feedUrl -> promise

  async function runNext() {
    if (feedQueue.length === 0) return;
    const feed = feedQueue.shift();
    const promise = checkFeed(feed).finally(() => {
      runningPromises.delete(feed.url);
    });
    runningPromises.set(feed.url, promise);
    
    // 如果队列还有且未达并发限制，继续启动
    if (feedQueue.length > 0 && runningPromises.size < CONCURRENCY) {
      await runNext();
    }
  }

  // 启动初始并发
  const initialBatch = Math.min(CONCURRENCY, feedQueue.length);
  for (let i = 0; i < initialBatch; i++) {
    await runNext();
  }

  // 等待所有检查完成
  while (runningPromises.size > 0) {
    await Promise.race(runningPromises.values());
  }

  // 更新已通知列表（保留最近 1000 条）
  const updatedNotified = Array.from(notifiedItems).slice(-1000);
  store.set('notifiedItems', updatedNotified);
  store.set('lastCheck', new Date().toISOString());

  // 保存检查历史
  const historyEntry = {
    timestamp: new Date().toISOString(),
    manual,
    newItems,
    errors
  };
  let history = store.get('history') || [];
  history.push(historyEntry);
  // 只保留最近 50 条历史记录
  if (history.length > 50) {
    history = history.slice(-50);
  }
  store.set('history', history);

  console.log(`[Monitor] 检查完成，发现 ${newItems.length} 个新项目`);

  // 发送邮件通知（异步不阻塞）
  if (newItems.length > 0) {
    sendEmailNotification(newItems);
  }

  // 通知前端检查完成和监控状态
  notifyRenderer('check-complete', { 
    newItems, 
    errors, 
    manual, 
    lastCheck: store.get('lastCheck'),
    history: history
  });
  broadcastMonitoringStatus();

  return { newItems, errors };
}

// 获取缩略图
function getThumbnail(item) {
  // 尝试从 media:thumbnail 获取
  if (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url) {
    return item['media:thumbnail'].$.url;
  }
  if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) {
    return item['media:content'].$.url;
  }
  // 尝试从 enclosure 获取
  if (item.enclosure && item.enclosure.url && (item.enclosure.type?.startsWith('image/') || item.enclosure.url.match(/\.(jpg|jpeg|png|gif|webp)$/i))) {
    return item.enclosure.url;
  }
  // 尝试从 content 中提取图片
  const content = item.content || item.contentSnippet || '';
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

  return null;
}

// 发送邮件通知 - 异步带重试
async function sendEmailNotification(items) {
  const emailConfig = store.get('emailConfig');

  if (!emailConfig.host || !emailConfig.user || !emailConfig.pass || !emailConfig.to) {
    console.log('[Email] 邮件配置不完整，跳过发送');
    notifyRenderer('email-status', { success: false, message: '邮件配置不完整' });
    return;
  }

  // 异步发送，不阻塞主流程
  sendEmailWithRetry(items, emailConfig).catch(err => {
    console.error('[Email] 异步发送彻底失败:', err);
    notifyRenderer('email-status', { success: false, message: `发送失败: ${err.message}` });
  });
}

// 带重试的邮件发送
async function sendEmailWithRetry(items, emailConfig, maxRetries = 3) {
  const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.pass
    }
  });

  const html = buildEmailHtml(items);
  const text = buildEmailText(items);
  const mailOptions = {
    from: emailConfig.from || emailConfig.user,
    to: emailConfig.to,
    subject: `🎬 RSS视频监控 - 发现 ${items.length} 个新视频`,
    text,
    html
  };

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await transporter.verify();
      await transporter.sendMail(mailOptions);
      console.log(`[Email] 邮件发送成功 (尝试 ${attempt}/${maxRetries})`);
      notifyRenderer('email-status', { success: true, message: `已发送 ${items.length} 个新视频通知` });
      return;
    } catch (error) {
      lastError = error;
      console.warn(`[Email] 发送失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
      if (attempt < maxRetries) {
        // 指数退避：1s, 2s, 4s...
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Email] ${delay}ms 后重试...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // 所有重试都失败
  console.error('[Email] 邮件发送彻底失败:', lastError.message);
  notifyRenderer('email-status', { success: false, message: `发送失败: ${lastError.message}` });
  throw lastError;
}

// 构建邮件 HTML
function buildEmailHtml(items) {
  const now = new Date().toLocaleString('zh-CN');

  let itemsHtml = '';
  for (const item of items) {
    const pubDate = item.pubDate ? new Date(item.pubDate).toLocaleString('zh-CN') : '未知时间';
    const thumbnail = item.thumbnail ? `<img src="${item.thumbnail}" alt="" style="max-width: 200px; max-height: 150px; border-radius: 8px; display: block; margin: 10px 0;">` : '';

    itemsHtml += `
      <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 16px; background: #fafafa;">
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          ${thumbnail ? `<div style="flex-shrink: 0;">${thumbnail}</div>` : ''}
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">来源: ${escapeHtml(item.feedName)}</div>
            <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #1a1a2e;">${escapeHtml(item.title)}</h3>
            <div style="font-size: 13px; color: #666; margin-bottom: 12px;">发布时间: ${pubDate}</div>
            ${item.contentSnippet ? `<div style="font-size: 13px; color: #444; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.contentSnippet)}</div>` : ''}
            <a href="${escapeHtml(item.link)}" target="_blank" style="display: inline-block; padding: 8px 16px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 500;">查看视频</a>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 600;">🎬 RSS视频监控</h1>
          <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">发现 ${items.length} 个新视频 · ${now}</p>
        </div>
        <div style="padding: 24px;">
          ${itemsHtml}
        </div>
        <div style="background: #f8f9fa; padding: 16px 24px; border-top: 1px solid #e0e0e0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #999;">RSS视频监控程序 · 自动检测新发布视频</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// 构建邮件纯文本
function buildEmailText(items) {
  let text = `RSS视频监控 - 发现 ${items.length} 个新视频\n\n`;

  for (const item of items) {
    const pubDate = item.pubDate ? new Date(item.pubDate).toLocaleString('zh-CN') : '未知时间';
    text += `标题: ${item.title}\n`;
    text += `来源: ${item.feedName}\n`;
    text += `时间: ${pubDate}\n`;
    text += `链接: ${item.link}\n`;
    if (item.contentSnippet) {
      text += `摘要: ${item.contentSnippet}\n`;
    }
    text += '\n---\n\n';
  }

  return text;
}

// HTML 转义
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

// 通知渲染进程
function notifyRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// IPC 处理器
function setupIpcHandlers() {
  // 窗口控制
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
    return mainWindow?.isMaximized();
  });
  ipcMain.handle('window-close', () => mainWindow?.hide());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized());

  // 配置管理
  ipcMain.handle('get-config', () => {
    try {
      return {
        rssFeeds: store.get('rssFeeds'),
        emailConfig: store.get('emailConfig'),
        checkInterval: store.get('checkInterval'),
        enabled: store.get('enabled'),
        lastCheck: store.get('lastCheck'),
        theme: store.get('theme'),
        notifiedItems: store.get('notifiedItems') || [],
        history: store.get('history') || []
      };
    } catch (error) {
      console.error('[Main] get-config error:', error);
      return {
        rssFeeds: [],
        emailConfig: {},
        checkInterval: 5,
        enabled: false,
        lastCheck: null,
        theme: 'system',
        notifiedItems: [],
        history: []
      };
    }
  });

  // 系统信息
  ipcMain.handle('get-windows-version', () => {
    try {
      const os = require('os');
      const release = os.release(); // 如 "10.0.22631"
      const parts = release.split('.');
      const build = parseInt(parts[2] || '0', 10);
      const isWin11 = build >= 22000;
      return { build, isWin11, platform: process.platform };
    } catch (error) {
      console.error('[Main] get-windows-version error:', error);
      return { build: 0, isWin11: false, platform: process.platform };
    }
  });

  ipcMain.handle('save-rss-feeds', (_, feeds) => {
    store.set('rssFeeds', feeds);
    if (store.get('enabled')) {
      startMonitoring();
    }
    broadcastMonitoringStatus(); // 保存 RSS 源后强制广播状态
    return { success: true };
  });

  ipcMain.handle('save-email-config', (_, config) => {
    store.set('emailConfig', config);
    broadcastMonitoringStatus(); // 保存邮件配置后强制广播状态
    return { success: true };
  });

  ipcMain.handle('save-settings', (_, settings) => {
    if (settings.checkInterval !== undefined) {
      store.set('checkInterval', settings.checkInterval);
      if (store.get('enabled')) {
        startMonitoring();
      }
    }
    if (settings.theme !== undefined) {
      store.set('theme', settings.theme);
      applyTheme();
    }
    broadcastMonitoringStatus(); // 保存设置后强制广播状态
    return { success: true };
  });

  // 测试邮件
  ipcMain.handle('test-email', async (_, config) => {
    try {
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass
        }
      });

      await transporter.verify();

      await transporter.sendMail({
        from: config.from || config.user,
        to: config.to,
        subject: 'RSS视频监控 - 测试邮件',
        text: '这是一封测试邮件，说明邮件配置正确。',
        html: `
          <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #6366f1;">RSS视频监控 - 测试邮件</h2>
            <p>这是一封测试邮件，说明邮件配置正确。</p>
            <p style="color: #666; font-size: 14px;">发送时间: ${new Date().toLocaleString('zh-CN')}</p>
          </div>
        `
      });

      return { success: true, message: '测试邮件发送成功' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 手动检查
  ipcMain.handle('manual-check', () => checkRssFeeds(true));

  // 切换监控
  ipcMain.handle('toggle-monitoring', () => toggleMonitoring());

  // 获取监控状态
  ipcMain.handle('get-monitoring-status', () => ({
    enabled: store.get('enabled'),
    lastCheck: store.get('lastCheck'),
    feedsCount: store.get('rssFeeds').length,
    notifiedCount: store.get('notifiedItems').length
  }));

  // 开机自启设置
  ipcMain.handle('get-auto-start', () => {
    if (process.platform === 'win32') {
      return app.getLoginItemSettings().openAtLogin;
    }
    return false;
  });

  ipcMain.handle('set-auto-start', (_, enabled) => {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true,
        path: process.execPath,
        args: []
      });
      return { success: true };
    }
    return { success: false, message: '仅支持 Windows' };
  });

  // 测试 RSS 源
  ipcMain.handle('test-rss-feed', async (_, url) => {
    try {
      const feed = await parser.parseURL(url);
      return {
        success: true,
        title: feed.title,
        description: feed.description,
        itemsCount: feed.items.length,
        latestItem: feed.items[0] ? {
          title: feed.items[0].title,
          link: feed.items[0].link,
          pubDate: feed.items[0].pubDate
        } : null
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 清除通知历史
  ipcMain.handle('clear-notified-items', () => {
    store.set('notifiedItems', []);
    return { success: true };
  });

  // 清除检查历史
  ipcMain.handle('clear-history', () => {
    try {
      store.set('history', []);
      return { success: true };
    } catch (error) {
      console.error('[Main] clear-history error:', error);
      return { success: false, error: error.message };
    }
  });

  // 导出/导入配置
  ipcMain.handle('export-config', () => {
    const config = {
      rssFeeds: store.get('rssFeeds'),
      emailConfig: { ...store.get('emailConfig'), pass: '' }, // 不导出密码
      checkInterval: store.get('checkInterval'),
      theme: store.get('theme')
    };
    return config;
  });

  ipcMain.handle('import-config', (_, config) => {
    if (config.rssFeeds) store.set('rssFeeds', config.rssFeeds);
    if (config.emailConfig) store.set('emailConfig', { ...store.get('emailConfig'), ...config.emailConfig });
    if (config.checkInterval) store.set('checkInterval', config.checkInterval);
    if (config.theme) {
      store.set('theme', config.theme);
      applyTheme();
    }
    if (store.get('enabled')) startMonitoring();
    broadcastMonitoringStatus(); // 导入配置后强制广播状态
    return { success: true };
  });
}

console.log('[Main] Registering app.whenReady handler...');

// 应用生命周期
app.whenReady().then(() => {
  console.log('[Main] >>> App is ready, creating window...');
  try {
    createWindow();
    setupIpcHandlers();
    applyTheme();

    // 如果之前是启用状态，恢复监控
    if (store.get('enabled')) {
      startMonitoring();
    }

    app.on('activate', () => {
      console.log('[Main] App activated');
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  } catch (err) {
    console.error('[Main] Error in app.whenReady:', err);
  }
}).catch(err => {
  console.error('[Main] app.whenReady promise rejected:', err);
});

console.log('[Main] app.whenReady handler registered');

app.on('window-all-closed', () => {
  console.log('[Main] All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Main] Before quit');
  isQuitting = true;
  stopMonitoring();
  if (tray) tray.destroy();
});

// 处理第二个实例启动
app.on('second-instance', () => {
  console.log('[Main] Second instance launched');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Main] Before quit');
  isQuitting = true;
  stopMonitoring();
  if (tray) tray.destroy();
});

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  console.error('[Main] 未捕获异常:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] 未处理的 Promise 拒绝:', reason);
});