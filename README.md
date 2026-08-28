[README.md](https://github.com/user-attachments/files/31554963/README.md)
<div align="center">

# 🎬 RSS 视频监控

**基于 Electron 的桌面端 RSS 订阅监控工具 —— 发现新视频，第一时间邮件通知你**

多源订阅 · 关键词过滤 · 定时检查 · 智能去重 · 精美 HTML 邮件通知

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## ✨ 功能特性

| | 功能 | 说明 |
|---|---|---|
| 📡 | **多源订阅** | 添加任意 RSS/Atom 源，支持启用/停用（B 站UP主、YouTube 频道等可通过 RSSHub 等工具生成订阅地址） |
| 🔍 | **关键词过滤** | 每个源可单独设置**包含/排除**关键词，只推送真正想看的投稿 |
| ⏰ | **定时检查** | 检查间隔可调（默认每 5 分钟），支持随时手动**立即检查** |
| 📧 | **邮件通知** | 发现新视频自动发送精美 HTML 邮件（缩略图卡片 + 「查看视频」按钮），同时附带纯文本版本 |
| 🔁 | **失败重试** | SMTP 发送失败自动重试 3 次（指数退避），发送前先验证连接 |
| 🖼️ | **缩略图提取** | 自动识别 `media:thumbnail` / `media:content` / `enclosure` / 正文内嵌图片 |
| 🧹 | **智能去重** | 已通知条目不再重复推送；去重记录与检查历史支持一键清除 |
| 🌗 | **三态主题** | 深色 / 浅色 / 跟随系统，无边框圆角窗口 + 自定义标题栏 |
| 🧰 | **系统托盘** | 最小化到托盘后台常驻，托盘菜单快捷操作，单实例运行 |
| 🔒 | **安全架构** | 渲染进程全程沙箱：`contextIsolation` + `sandbox`，不开启 `nodeIntegration` |

## 📸 界面预览

<img width="1614" height="900" alt="222" src="https://github.com/user-attachments/assets/2ca9f30c-4c39-4e9d-9eb7-b8e401c15481" />
<img width="1614" height="900" alt="111" src="https://github.com/user-attachments/assets/1c6044da-45ce-4953-84af-c43ab1b5f6d7" />
<img width="1614" height="1086" alt="444" src="https://github.com/user-attachments/assets/e16af1ef-9632-4543-a6fa-56243508835d" />
<img width="1614" height="1005" alt="333" src="https://github.com/user-attachments/assets/28b5cc1a-9b6e-4f44-82ad-e494adec4bc9" />


<p align="center">
  <img src="docs/screenshot-main.png" width="720" alt="主界面预览"/>
</p>

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（建议 LTS）
- Windows 10 / 11（x64）

### 开发运行

```bash
git clone https://github.com/hgl011091/rss-video-monitor.git
cd rss-video-monitor
npm install
npm start
```

### 打包 Windows 便携版 EXE

```bash
npm run build:win
```

产物在 `dist/` 目录：

| 产物 | 用途 |
|---|---|
| `win-unpacked/rss-video-monitor.exe` | 绿色免安装版，整个文件夹拷走即可运行 |
| `RSS视频监控-1.0.0-portable.exe` | 单文件便携版，双击即用 |

> 💡 也可以**以管理员身份**直接运行 `build-portable.bat` 一键完成（自动安装依赖 + 打包）。

## 📖 使用说明

1. **添加 RSS 源**：粘贴订阅地址，可设置包含/排除关键词
2. **配置邮箱**：填入 SMTP 信息，点击「发送测试」确认连通

   | 邮箱 | SMTP 服务器 | 端口 |
   |---|---|---|
   | QQ 邮箱 | `smtp.qq.com` | 465（SSL） |
   | 163 邮箱 | `smtp.163.com` | 465（SSL） |
   | Gmail | `smtp.gmail.com` | 465（SSL） |

   > 各大邮箱需使用**授权码**（而非登录密码），在邮箱设置中开启 SMTP 服务获取。
3. **开始监控**：点击「开始监控」进入后台定时检查；也可随时「立即检查」
4. **收到邮件**：卡片内点击「查看视频」直接跳转观看

## ⚙️ 数据与隐私

- 所有配置与检查记录**仅保存在本机**（electron-store，位于系统用户数据目录），不上传任何服务器
- SMTP 授权码保存在本机配置文件中，请保管好设备安全；建议使用专用授权码
- 程序不含任何统计、遥测或联网上报

## 🗂️ 项目结构

```
rss-video-monitor/
├─ main/                 # Electron 主进程（调度、RSS 解析、邮件、托盘、主题）
├─ preload/              # 预加载桥接（contextBridge IPC）
├─ renderer/             # 渲染层界面（原生 HTML/CSS/JS，无框架）
├─ resources/            # 图标资源（icon.svg → icon.ico 转换脚本）
├─ convert-icon.ps1      # SVG 转 ICO（需 ImageMagick）
├─ build-portable.bat    # 一键打包便携版
└─ BUILD_GUIDE.md        # 打包与图标转换详细说明
```

## 🛠️ 技术栈

| 模块 | 选型 |
|---|---|
| 桌面框架 | Electron 28 |
| RSS 解析 | rss-parser |
| 邮件发送 | nodemailer（SMTP / SSL / 重试） |
| 定时调度 | node-schedule |
| 本地存储 | electron-store |
| 网络请求 | axios |
| 打包分发 | electron-builder（portable / zip） |

## 🔗 相关项目

- **[dsh-rss-monitor](https://github.com/<你的用户名>/dsh-rss-monitor)** —— 同一套监控 / 去重 / 邮件通知逻辑的 **DeepSeek Harness 原生插件版**：无需独立运行，直接集成进 Harness 设置页，SMTP 密码走 Harness 凭据库。
## 📄 License

[MIT](LICENSE)
