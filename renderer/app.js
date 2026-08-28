// ========================================
// RSS视频监控 - 渲染进程主逻辑
// ========================================

class RSSVideoMonitor {
  constructor() {
    this.currentTab = 'dashboard';
    this.feeds = [];
    this.history = [];
    this.notifiedItems = [];
    this.isChecking = false;
    this.nextCheckTimer = null;
    this.checkInterval = 5;

    this.init();
  }

  async init() {
    // 等待 DOM 准备就绪
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  async setup() {
    this.bindEvents();
    await this.loadConfig();
    this.setupIpcListeners();
    this.applyTheme();
    this.applyMaterial();
    this.startNextCheckTimer();

    // 修复：初始化完成后主动同步监控状态，避免启动时序竞态导致 UI 显示错误
    this.syncMonitoringStatus();
  }

  // ========================================
  // 事件绑定
  // ========================================
  bindEvents() {
    // 标题栏按钮
    document.getElementById('minimizeBtn').addEventListener('click', () => window.electronAPI.window.minimize());
    document.getElementById('maximizeBtn').addEventListener('click', () => this.toggleMaximize());
    document.getElementById('closeBtn').addEventListener('click', () => window.electronAPI.window.close());

    document.getElementById('monitorToggleBtn').addEventListener('click', () => window.electronAPI.monitor.toggle());

    // 导航切换
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // 仪表盘操作
    document.getElementById('manualCheckBtn').addEventListener('click', () => this.manualCheck());
    document.getElementById('viewAllHistoryBtn').addEventListener('click', () => this.switchTab('history'));

    // RSS源管理
    document.getElementById('addFeedBtn').addEventListener('click', () => this.openFeedModal());
    document.getElementById('feedModalClose').addEventListener('click', () => this.closeFeedModal());
    document.getElementById('feedModalCancel').addEventListener('click', () => this.closeFeedModal());
    document.getElementById('feedForm').addEventListener('submit', (e) => this.saveFeed(e));
    document.getElementById('testFeedBtn').addEventListener('click', () => this.testFeed());

    // 模态框点击遮罩关闭
    document.getElementById('feedModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeFeedModal();
    });
    document.getElementById('videoModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeVideoModal();
    });

    // 设置 - 常规
    document.getElementById('checkIntervalSelect').addEventListener('change', (e) => this.saveSettings({ checkInterval: parseInt(e.target.value) }));
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', (e) => this.saveSettings({ theme: e.target.value }));
    });
    document.getElementById('autoStartCheckbox').addEventListener('change', (e) => this.toggleAutoStart(e.target.checked));

    // 设置 - 邮件
    document.getElementById('togglePasswordBtn').addEventListener('click', () => this.togglePasswordVisibility());
    document.getElementById('testEmailBtn').addEventListener('click', () => this.testEmail());
    document.getElementById('saveEmailBtn').addEventListener('click', () => this.saveEmailConfig());

    // 设置 - 数据管理
    document.getElementById('exportConfigBtn').addEventListener('click', () => this.exportConfig());
    document.getElementById('importConfigBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
    document.getElementById('importFileInput').addEventListener('change', (e) => this.importConfig(e));
    document.getElementById('clearNotifiedBtn').addEventListener('click', () => this.clearNotifiedItems());
    document.getElementById('clearHistoryBtn').addEventListener('click', () => this.clearHistory());
    // 注意：检查更新按钮已移除，不再需要绑定

    // 键盘快捷键
    document.addEventListener('keydown', (e) => this.handleKeydown(e));

    // 窗口最大化状态同步
    window.electronAPI.window.isMaximized().then(maximized => {
      document.getElementById('maximizeBtn').classList.toggle('maximized', maximized);
    });
  }

  // ========================================
  // IPC 监听器
  // ========================================
  setupIpcListeners() {
    // 主题变更
    window.electronAPI.on('theme-changed', (data) => {
      // 支持新旧两种格式
      if (typeof data === 'string') {
        // 旧格式: 'dark' | 'light'
        document.documentElement.setAttribute('data-theme', data);
      } else if (data && typeof data === 'object') {
        // 新格式: { theme: 'system'|'light'|'dark', resolvedTheme: 'dark'|'light' }
        document.documentElement.setAttribute('data-theme', data.theme);
      }
    });

    // 检查开始
    window.electronAPI.on('check-started', (data) => {
      this.isChecking = true;
      this.updateStatusIndicator(true, data.manual ? '正在检查...' : '自动检查中...');
      this.showLoading(data.manual ? '正在检查 RSS 源...' : '自动检查中...');
    });

    // 检查完成
    window.electronAPI.on('check-complete', (data) => {
      this.isChecking = false;
      this.hideLoading();

      // 存储历史数据
      if (data.history) {
        this.history = data.history;
      }

      // 更新监控状态UI
      this.updateStatusIndicator(false, '监控运行中');
      this.loadConfig(); // 重新加载配置和统计
      
      this.renderHistory(); // 直接渲染历史数据

      if (data.newItems.length > 0) {
        this.showToast('success', '发现新视频', `共发现 ${data.newItems.length} 个新视频`);
        // 播放提示音
        this.playNotificationSound();
      }

      if (data.errors.length > 0) {
        this.showToast('warning', '检查完成，有错误', `${data.errors.length} 个源检查失败`);
      }

      if (data.manual) {
        if (data.newItems.length === 0 && data.errors.length === 0) {
          this.showToast('info', '检查完成', '没有发现新视频');
        }
      }
    });

    // 监控状态变更
    window.electronAPI.on('monitoring-status-changed', async (data) => {
      this.updateMonitoringUI(data.enabled);
    });

    // 邮件状态
    window.electronAPI.on('email-status', (data) => {
      if (data.success) {
        this.showToast('success', '邮件发送成功', data.message);
      } else {
        this.showToast('error', '邮件发送失败', data.message);
      }
    });
  }

  // ========================================
  // 主题应用
  // ========================================
  applyTheme() {
    const theme = document.documentElement.getAttribute('data-theme') || 'system';
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  // ========================================
  // 材质效果应用
  // ========================================
  async applyMaterial() {
    try {
      const { build, isWin11, platform } = await window.electronAPI.system.getWindowsVersion();
      
      if (platform === 'win32') {
        if (isWin11) {
          document.body.classList.add('mica');
          console.log('[Renderer] Windows 11 Mica 材质已启用 (build:', build, ')');
        } else {
          document.body.classList.add('acrylic');
          console.log('[Renderer] Windows 10 亚克力材质已启用 (build:', build, ')');
        }
      } else {
        document.body.classList.add('glass');
        console.log('[Renderer] 标准磨砂玻璃材质已启用');
      }
    } catch (error) {
      console.error('[Renderer] 获取系统版本失败:', error);
      document.body.classList.add('glass'); // 降级
    }
  }

  // ========================================
  // 监控状态同步（修复启动时序竞态）
  // ========================================
  async syncMonitoringStatus() {
    try {
      const status = await window.electronAPI.monitor.getStatus();
      console.log('[Renderer] get-monitoring-status 返回:', status);
      this.updateMonitoringUI(status.enabled);
      
      console.log('[Renderer] 监控状态同步完成:', status.enabled ? '运行中' : '已停止');
    } catch (error) {
      console.error('[Renderer] 同步监控状态失败:', error);
      this.showToast('error', '状态同步失败', `无法获取监控状态: ${error.message}`);
    }
  }

  // ========================================
  // 配置加载
  // ========================================
  async loadConfig() {
    try {
      const config = await window.electronAPI.config.get();
      this.feeds = config.rssFeeds || [];
      this.checkInterval = config.checkInterval || 5;
      // 加载历史记录
      this.history = config.history || [];

      // 更新 UI
      this.updateStats(config);
      this.renderFeedsList();
      this.renderRecentVideos();
      this.renderMonitorStatus(config);
      this.updateMonitoringUI(config.enabled);
      this.updateStatusIndicator(config.enabled, config.enabled ? '监控运行中' : '监控已停止');

      // 表单填充
      document.getElementById('checkIntervalSelect').value = this.checkInterval;
      document.querySelector(`input[name="theme"][value="${config.theme || 'system'}"]`).checked = true;

      // 邮件配置填充
      const email = config.emailConfig || {};
      document.getElementById('smtpHost').value = email.host || '';
      document.getElementById('smtpPort').value = email.port || 465;
      document.getElementById('smtpSecure').value = email.secure !== false ? 'true' : 'false';
      document.getElementById('smtpUser').value = email.user || '';
      document.getElementById('smtpPass').value = email.pass || '';
      document.getElementById('smtpFrom').value = email.from || '';
      document.getElementById('smtpTo').value = email.to || '';

      this.updateNextCheckTime();

      // 加载开机自启状态
      this.loadAutoStartStatus();
    } catch (error) {
      console.error('加载配置失败:', error);
      this.showToast('error', '加载配置失败', error.message);
    }
  }

  async loadAutoStartStatus() {
    try {
      const enabled = await window.electronAPI.autoStart.get();
      document.getElementById('autoStartCheckbox').checked = enabled;
    } catch (error) {
      console.error('加载开机自启状态失败:', error);
      // 默认不勾选
      document.getElementById('autoStartCheckbox').checked = false;
    }
  }

  // 更新历史记录（从主进程获取检查历史）
  async loadHistory() {
    try {
      // 从主进程获取检查历史
      const config = await window.electronAPI.config.get();
      this.history = config.history || [];
      this.renderHistory();
    } catch (error) {
      console.error('加载历史失败:', error);
      // 如果加载失败，尝试使用已缓存的历史数据
      if (!this.history || this.history.length === 0) {
        this.renderHistory(); // 渲染空状态或已有数据
      }
      this.showToast('warning', '加载历史失败', '将显示本地缓存的历史记录');
    }
  }

  // ========================================
  // 统计卡片更新
  // ========================================
  updateStats(config) {
    const enabledFeeds = this.feeds.filter(f => f.enabled).length;

    document.getElementById('statFeeds').textContent = this.feeds.length;
    document.getElementById('statEnabledFeeds').textContent = enabledFeeds;
    document.getElementById('statNotified').textContent = (config.notifiedItems || []).length;
    

    // 徽章
    const badge = document.getElementById('feedsBadge');
    badge.textContent = this.feeds.length;
    badge.style.display = this.feeds.length > 0 ? 'flex' : 'none';
  }

  // ========================================
  // 最近视频渲染
  // ========================================
  renderRecentVideos() {
    const container = document.getElementById('recentVideos');
    
    // 从历史记录中提取最近发现的视频
    const recentVideos = [];
    if (this.history && this.history.length > 0) {
      // 按时间倒序遍历历史
      const sortedHistory = [...this.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      for (const entry of sortedHistory) {
        if (entry.newItems && entry.newItems.length > 0) {
          for (const item of entry.newItems) {
            recentVideos.push({
              ...item,
              checkTime: entry.timestamp,
              checkType: entry.manual ? '手动' : '自动'
            });
          }
        }
        // 只取最近 10 个视频
        if (recentVideos.length >= 10) break;
      }
    }

    if (recentVideos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2.18"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
          </svg>
          <p>暂无发现的视频</p>
          <span>配置 RSS 源并开始监控后将显示在这里</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="recent-videos-list">
        ${recentVideos.slice(0, 10).map(video => `
          <div class="recent-video-item">
            <div class="recent-video-thumbnail">
              ${video.thumbnail ? `<img src="${video.thumbnail}" alt="" onerror="this.style.display='none'">` : ''}
            </div>
            <div class="recent-video-info">
              <h4 class="recent-video-title">${this.escapeHtml(video.title)}</h4>
              <div class="recent-video-meta">
                <span class="recent-video-source">${this.escapeHtml(video.feedName || '未知源')}</span>
                <span class="recent-video-time">${new Date(video.checkTime).toLocaleString('zh-CN')}</span>
                <span class="recent-video-type">${video.checkType || ''}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ========================================
  // 监控状态渲染
  // ========================================
  renderMonitorStatus(config) {
    const email = config.emailConfig || {};
    const hasEmail = email.host && email.user && email.pass && email.to;

    document.getElementById('monitorState').textContent = config.enabled ? '运行中' : '已停止';
    document.getElementById('monitorState').className = 'status-value ' + (config.enabled ? 'running' : 'stopped');
    document.getElementById('checkInterval').textContent = `${this.checkInterval} 分钟`;
    document.getElementById('emailStatus').textContent = hasEmail ? '已配置' : '未配置';
    document.getElementById('emailStatus').style.color = hasEmail ? 'var(--accent-secondary)' : 'var(--text-tertiary)';
  }

  updateMonitoringUI(enabled) {
    document.getElementById('monitorState').textContent = enabled ? '运行中' : '已停止';
    document.getElementById('monitorState').className = 'status-value ' + (enabled ? 'running' : 'stopped');
    this.updateStatusIndicator(enabled, enabled ? '监控运行中' : '监控已停止');

    // 更新托盘菜单状态（通过主进程）
    // 导航栏徽章
    const navFeeds = document.getElementById('navFeeds');
    navFeeds.querySelector('.nav-badge').style.display = this.feeds.length > 0 ? 'flex' : 'none';
  }

  // ========================================
  // RSS源列表渲染
  // ========================================
  renderFeedsList() {
    const container = document.getElementById('feedsList');

    if (this.feeds.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9"></path>
            <path d="M4 4a16 16 0 0 1 16 16"></path>
            <circle cx="5" cy="19" r="1"></svg>
          </svg>
          <p>暂无 RSS 源</p>
          <span>点击「添加 RSS 源」开始配置</span>
        </div>
      `;
      return;
    }

    container.innerHTML = '<div class="feed-list">' + this.feeds.map(feed => this.renderFeedItem(feed)).join('') + '</div>';

    // 绑定事件
    container.querySelectorAll('.feed-action-btn.edit').forEach(btn => {
      btn.addEventListener('click', () => this.openFeedModal(btn.dataset.id));
    });
    container.querySelectorAll('.feed-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', () => this.deleteFeed(btn.dataset.id));
    });
    container.querySelectorAll('.feed-action-btn.test').forEach(btn => {
      btn.addEventListener('click', () => this.testSingleFeed(btn.dataset.id));
    });
  }

  renderFeedItem(feed) {
    const keywords = (feed.keywords || []).map(k => `<span class="keyword-tag include">${this.escapeHtml(k)}</span>`).join('');
    const excludeKeywords = (feed.excludeKeywords || []).map(k => `<span class="keyword-tag exclude">${this.escapeHtml(k)}</span>`).join('');

    return `
      <div class="feed-item" data-id="${feed.id}">
        <div class="feed-info">
          <div class="feed-header">
            <span class="feed-name">${this.escapeHtml(feed.name)}</span>
            <span class="feed-status ${feed.enabled ? 'enabled' : 'disabled'}">
              <span class="status-dot ${feed.enabled ? 'running' : ''}"></span>
              ${feed.enabled ? '启用' : '禁用'}
            </span>
          </div>
          <div class="feed-url">${this.escapeHtml(feed.url)}</div>
          ${keywords || excludeKeywords ? `<div class="feed-keywords">${keywords}${excludeKeywords}</div>` : ''}
        </div>
        <div class="feed-actions">
          <button class="feed-action-btn test" data-id="${feed.id}" title="测试">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
          </button>
          <button class="feed-action-btn edit" data-id="${feed.id}" title="编辑">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            </svg>
          </button>
          <button class="feed-action-btn delete danger" data-id="${feed.id}" title="删除">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  // ========================================
  // 历史记录渲染
  // ========================================
  renderHistory() {
    const container = document.getElementById('historyList');

    if (!this.history || this.history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <p>暂无检查记录</p>
          <span>开始监控后将记录检查历史</span>
        </div>
      `;
      return;
    }

    // 按时间倒序排列（最新的在前）
    const sortedHistory = [...this.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    container.innerHTML = `
      <div class="history-list">
        ${sortedHistory.map(entry => this.renderHistoryEntry(entry)).join('')}
      </div>
    `;
  }

  renderHistoryEntry(entry) {
    const date = new Date(entry.timestamp);
    const timeString = date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).replace(/\//g, '-');

    const type = entry.manual ? '手动检查' : '自动检查';
    const status = entry.errors.length > 0 ? '错误' : entry.newItems.length > 0 ? `发现 ${entry.newItems.length} 个新项目` : '无新项目';
    const statusClass = entry.errors.length > 0 ? 'error' : entry.newItems.length > 0 ? 'success' : 'info';

    return `
      <div class="history-item">
        <div class="history-header">
          <span class="history-time">${timeString}</span>
          <span class="history-type">${type}</span>
        </div>
        <div class="history-body">
          <span class="history-status ${statusClass}">${status}</span>
          ${entry.newItems.length > 0 ? `
            <div class="history-details">
              新发现 ${entry.newItems.length} 个视频：
              ${entry.newItems.map(item => `
                <div class="history-item-detail">
                  <strong>${item.feedName}</strong>: ${item.title}
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${entry.errors.length > 0 ? `
            <div class="history-details">
              错误：
              ${entry.errors.map(err => `
                <div class="history-item-detail">
                  ${err.feed}: ${err.error}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ========================================
  // 标签页切换
  // ========================================
  switchTab(tabName) {
    // 更新导航
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 更新面板
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    });

    this.currentTab = tabName;

    // 特定标签页的加载逻辑
    if (tabName === 'history') {
      this.loadHistory();
    }
  }

  // ========================================
  // 窗口控制
  // ========================================
  async toggleMaximize() {
    const maximized = await window.electronAPI.window.maximize();
    document.getElementById('maximizeBtn').classList.toggle('maximized', maximized);
  }

  // ========================================
  // 状态指示器
  // ========================================
  updateStatusIndicator(running, text) {
    const dot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    dot.classList.toggle('running', running);
    statusText.textContent = text;
  }

  // 更新监控状态面板的上次检查时间
  

  // ========================================
  // 手动检查
  // ========================================
  async manualCheck() {
    if (this.isChecking) return;

    const btn = document.getElementById('manualCheckBtn');
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="loading-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-linecap="round"></path>
      </svg>
      检查中...
    `;

    try {
      await window.electronAPI.monitor.manualCheck();
    } catch (error) {
      this.showToast('error', '检查失败', error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        立即检查
      `;
    }
  }

  // ========================================
  // RSS源管理
  // ========================================
  openFeedModal(feedId = null) {
    const modal = document.getElementById('feedModal');
    const form = document.getElementById('feedForm');
    const title = document.getElementById('feedModalTitle');
    const submitText = document.getElementById('feedModalSubmitText');

    form.reset();
    document.getElementById('feedId').value = '';
    document.getElementById('feedEnabled').checked = true;

    if (feedId) {
      const feed = this.feeds.find(f => f.id === feedId);
      if (feed) {
        title.textContent = '编辑 RSS 源';
        submitText.textContent = '保存';
        document.getElementById('feedId').value = feed.id;
        document.getElementById('feedName').value = feed.name;
        document.getElementById('feedUrl').value = feed.url;
        document.getElementById('feedEnabled').checked = feed.enabled !== false;
        document.getElementById('feedKeywords').value = (feed.keywords || []).join(', ');
        document.getElementById('feedExcludeKeywords').value = (feed.excludeKeywords || []).join(', ');
      }
    } else {
      title.textContent = '添加 RSS 源';
      submitText.textContent = '添加';
    }

    modal.classList.add('active');
    document.getElementById('feedName').focus();
  }

  closeFeedModal() {
    document.getElementById('feedModal').classList.remove('active');
  }

  async saveFeed(e) {
    e.preventDefault();

    const feedId = document.getElementById('feedId').value;
    const feedData = {
      name: document.getElementById('feedName').value.trim(),
      url: document.getElementById('feedUrl').value.trim(),
      enabled: document.getElementById('feedEnabled').checked,
      keywords: document.getElementById('feedKeywords').value.split(',').map(k => k.trim()).filter(k => k),
      excludeKeywords: document.getElementById('feedExcludeKeywords').value.split(',').map(k => k.trim()).filter(k => k)
    };

    if (!feedData.name || !feedData.url) {
      this.showToast('error', '验证失败', '名称和 RSS 链接不能为空');
      return;
    }

    try {
      const feeds = [...this.feeds];
      if (feedId) {
        const index = feeds.findIndex(f => f.id === feedId);
        if (index !== -1) {
          feeds[index] = { ...feeds[index], ...feedData };
        }
      } else {
        feeds.push({ ...feedData, id: Date.now().toString() });
      }

      await window.electronAPI.config.saveRssFeeds(feeds);
      this.feeds = feeds;
      this.renderFeedsList();
      this.loadConfig(); // 更新统计
      this.closeFeedModal();
      this.showToast('success', feedId ? '更新成功' : '添加成功', `RSS源 "${feedData.name}" ${feedId ? '已更新' : '已添加'}`);
    } catch (error) {
      this.showToast('error', '保存失败', error.message);
    }
  }

  async deleteFeed(feedId) {
    if (!confirm('确定要删除这个 RSS 源吗？')) return;

    try {
      this.feeds = this.feeds.filter(f => f.id !== feedId);
      await window.electronAPI.config.saveRssFeeds(this.feeds);
      this.renderFeedsList();
      this.loadConfig();
      this.showToast('success', '删除成功', 'RSS源已删除');
    } catch (error) {
      this.showToast('error', '删除失败', error.message);
    } finally {
      await this.syncMonitoringStatus();
    }
  }

  async testFeed() {
    const url = document.getElementById('feedUrl').value.trim();
    if (!url) {
      this.showToast('error', '验证失败', '请先输入 RSS 链接');
      return;
    }

    const btn = document.getElementById('testFeedBtn');
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="loading-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-linecap="round"></path>
      </svg>
      测试中...
    `;

    try {
      const result = await window.electronAPI.rss.testFeed(url);
      if (result.success) {
        this.showToast('success', '测试成功', `源标题: ${result.title}\n文章数: ${result.itemsCount}`);
      } else {
        this.showToast('error', '测试失败', result.message);
      }
    } catch (error) {
      this.showToast('error', '测试失败', error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        测试连接
      `;
    }
  }

  async testSingleFeed(feedId) {
    const feed = this.feeds.find(f => f.id === feedId);
    if (!feed) return;

    this.showLoading(`正在测试 "${feed.name}"...`);

    try {
      const result = await window.electronAPI.rss.testFeed(feed.url);
      this.hideLoading();
      if (result.success) {
        this.showToast('success', '测试成功', `源标题: ${result.title}\n文章数: ${result.itemsCount}`);
      } else {
        this.showToast('error', '测试失败', result.message);
      }
    } catch (error) {
      this.hideLoading();
      this.showToast('error', '测试失败', error.message);
    }
  }

  // ========================================
  // 邮件配置
  // ========================================
  togglePasswordVisibility() {
    const input = document.getElementById('smtpPass');
    const eyeIcon = document.querySelector('.icon-eye');
    const eyeOffIcon = document.querySelector('.icon-eye-off');

    if (input.type === 'password') {
      input.type = 'text';
      eyeIcon.style.display = 'none';
      eyeOffIcon.style.display = 'block';
    } else {
      input.type = 'password';
      eyeIcon.style.display = 'block';
      eyeOffIcon.style.display = 'none';
    }
  }

  async testEmail() {
    const config = {
      host: document.getElementById('smtpHost').value.trim(),
      port: parseInt(document.getElementById('smtpPort').value) || 465,
      secure: document.getElementById('smtpSecure').value === 'true',
      user: document.getElementById('smtpUser').value.trim(),
      pass: document.getElementById('smtpPass').value,
      from: document.getElementById('smtpFrom').value.trim(),
      to: document.getElementById('smtpTo').value.trim()
    };

    if (!config.host || !config.user || !config.pass || !config.to) {
      this.showToast('error', '验证失败', '请填写完整的邮件配置');
      return;
    }

    const btn = document.getElementById('testEmailBtn');
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="loading-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-linecap="round"></path>
      </svg>
      发送中...
    `;

    try {
      const result = await window.electronAPI.email.test(config);
      if (result.success) {
        this.showToast('success', '测试成功', result.message);
      } else {
        this.showToast('error', '测试失败', result.message);
      }
    } catch (error) {
      this.showToast('error', '测试失败', error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        发送测试邮件
      `;
    }
  }

  async saveEmailConfig() {
    const config = {
      host: document.getElementById('smtpHost').value.trim(),
      port: parseInt(document.getElementById('smtpPort').value) || 465,
      secure: document.getElementById('smtpSecure').value === 'true',
      user: document.getElementById('smtpUser').value.trim(),
      pass: document.getElementById('smtpPass').value,
      from: document.getElementById('smtpFrom').value.trim(),
      to: document.getElementById('smtpTo').value.trim()
    };

    try {
      await window.electronAPI.config.saveEmailConfig(config);
      this.loadConfig();
      this.showToast('success', '保存成功', '邮件配置已保存');
    } catch (error) {
      this.showToast('error', '保存失败', error.message);
    }
  }

  // ========================================
  // 设置保存
  // ========================================
  async saveSettings(settings) {
    try {
      await window.electronAPI.config.saveSettings(settings);
      if (settings.checkInterval) {
        this.checkInterval = settings.checkInterval;
        this.updateNextCheckTime();
      }
      this.showToast('success', '保存成功', '设置已更新');
    } catch (error) {
      this.showToast('error', '保存失败', error.message);
    }
  }

  async toggleAutoStart(enabled) {
    try {
      const result = await window.electronAPI.autoStart.set(enabled);
      if (!result.success) {
        this.showToast('error', '设置失败', result.message || '不支持的平台');
        document.getElementById('autoStartCheckbox').checked = !enabled;
      } else {
        this.showToast('success', '设置成功', enabled ? '已启用开机自启' : '已禁用开机自启');
      }
    } catch (error) {
      this.showToast('error', '设置失败', error.message);
      document.getElementById('autoStartCheckbox').checked = !enabled;
    }
  }

  // ========================================
  // 数据管理
  // ========================================
  async exportConfig() {
    try {
      const config = await window.electronAPI.backup.export();
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rss-video-monitor-config-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('success', '导出成功', '配置文件已下载');
    } catch (error) {
      this.showToast('error', '导出失败', error.message);
    }
  }

  async importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const config = JSON.parse(text);
      await window.electronAPI.backup.import(config);
      await this.loadConfig();
      this.showToast('success', '导入成功', '配置已导入并应用');
    } catch (error) {
      this.showToast('error', '导入失败', error.message);
    } finally {
      event.target.value = '';
    }
  }

  async clearNotifiedItems() {
    if (!confirm('确定要清空所有通知记录吗？这将导致已通知的视频重新发送通知。')) return;

    try {
      await window.electronAPI.notifications.clear();
      this.loadConfig();
      this.showToast('success', '清空成功', '通知记录已清空');
    } catch (error) {
      this.showToast('error', '清空失败', error.message);
    }
  }

  async clearHistory() {
    if (!confirm('确定要清空检查历史吗？')) return;

    try {
      await window.electronAPI.history.clear();
      this.history = [];
      this.renderHistory();
      this.showToast('success', '清空成功', '检查历史已清空');
    } catch (error) {
      this.showToast('error', '清空失败', error.message);
    }
  }

  checkUpdate() {
    this.showToast('info', '检查更新', '当前已是最新版本 (v1.0.0)');
  }

  // ========================================
  // 视频详情模态框
  // ========================================
  openVideoModal(video) {
    const modal = document.getElementById('videoModal');
    const body = document.getElementById('videoModalBody');
    const title = document.getElementById('videoModalTitle');

    title.textContent = video.title;

    const pubDate = video.pubDate ? new Date(video.pubDate).toLocaleString('zh-CN') : '未知时间';
    const thumbnail = video.thumbnail ? `
      <div class="video-detail-thumbnail">
        <img src="${this.escapeHtml(video.thumbnail)}" alt="" onerror="this.style.display='none'">
      </div>
    ` : '';

    body.innerHTML = `
      <div class="video-detail">
        <div class="video-detail-header">
          ${thumbnail}
          <div class="video-detail-info">
            <h4 class="video-detail-title">${this.escapeHtml(video.title)}</h4>
            <div class="video-detail-meta">
              <span>来源: ${this.escapeHtml(video.feedName)}</span>
              <span>发布时间: ${pubDate}</span>
            </div>
          </div>
          ${video.contentSnippet ? `<div class="video-detail-description">${this.escapeHtml(video.contentSnippet)}</div>` : ''}
          <div class="video-detail-actions">
            <a href="${this.escapeHtml(video.link)}" target="_blank" class="btn btn-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              在浏览器打开
            </a>
            <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${this.escapeHtml(video.link)}'); window.rssMonitor.showToast('success', '已复制', '视频链接已复制到剪贴板')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2-2v1"></path>
              </svg>
              复制链接
            </button>
          </div>
        </div>
      </div>
    `;

    modal.classList.add('active');
  }

  closeVideoModal() {
    document.getElementById('videoModal').classList.remove('active');
  }

  // ========================================
  // Toast 提示
  // ========================================
  showToast(type, title, message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
      warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
      info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type]}</div>
      <div class="toast-content">
        <div class="toast-title">${this.escapeHtml(title)}</div>
        <div class="toast-message">${this.escapeHtml(message)}</div>
      </div>
      <button class="toast-close" aria-label="关闭">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());

    container.appendChild(toast);

    // 自动移除
    setTimeout(() => {
      toast.style.animation = 'slideInRight 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // ========================================
  // 加载遮罩
  // ========================================
  showLoading(text = '加载中...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').classList.add('active');
  }

  hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
  }

  // ========================================
  // 下次检查时间
  // ========================================
  startNextCheckTimer() {
    this.updateNextCheckTime();
    this.nextCheckTimer = setInterval(() => this.updateNextCheckTime(), 30000);
  }

  updateNextCheckTime() {
    const config = window.electronAPI?.config?.get;
    if (!config) return;

    // 简单计算下次检查时间
    const lastCheck = localStorage.getItem('lastCheckTime');
    if (lastCheck) {
      const next = new Date(parseInt(lastCheck) + this.checkInterval * 60 * 1000);
      document.getElementById('nextCheck').textContent = next.toLocaleTimeString('zh-CN');
    } else {
      document.getElementById('nextCheck').textContent = '即将开始';
    }
  }

  // ========================================
  // 键盘快捷键
  // ========================================
  handleKeydown(e) {
    // ESC 关闭模态框
    if (e.key === 'Escape') {
      this.closeFeedModal();
      this.closeVideoModal();
    }

    // Ctrl/Cmd + 数字键切换标签页
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const tabs = ['dashboard', 'feeds', 'history', 'settings'];
      this.switchTab(tabs[parseInt(e.key) - 1]);
    }

    // Ctrl/Cmd + R 手动检查
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.shiftKey) {
      e.preventDefault();
      this.manualCheck();
    }
  }

  // ========================================
  // 工具函数
  // ========================================
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#039;');
  }

  playNotificationSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      // 忽略音频错误
    }
  }
}

// 全局实例化
window.rssMonitor = new RSSVideoMonitor();

// 导出供调试用
if (typeof module !== 'undefined') {
  module.exports = RSSVideoMonitor;
}