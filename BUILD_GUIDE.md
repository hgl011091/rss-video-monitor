# RSS视频监控 - 本地打包与图标转换工具说明

## 📦 核心问题已修复
**主程序双击不显示窗口** 的根因：`main/index.js` 引用了不存在的 `resources/icon.ico`，导致 Electron 窗口创建异常。  
**已修复**：代码改为智能检测图标是否存在，不存在则自动使用默认图标，保证窗口正常显示。

---

## 🛠️ 提供的自动化工具脚本

### 1. `build-portable.bat` —— 一键打包便携版（推荐）
- **功能**：自动安装依赖、打包 Windows 便携版 EXE 和 ZIP
- **使用方法**：
  1. 将项目文件夹复制到本地（如 `D:\Projects\rss-video-monitor`）
  2. **右键点击 `build-portable.bat` → "以管理员身份运行"**
  3. 等待完成，产物在 `dist\` 目录
- **产物**：
  - `dist\win-unpacked\rss-video-monitor.exe`（绿色便携版，可直接运行/复制）
  - `dist\RSS视频监控-v1.0.0-portable.zip`（分发包）

### 2. `convert-icon.ps1` —— SVG 转 ICO（PowerShell + ImageMagick）
- **功能**：将 `resources/icon.svg` 转换为标准多尺寸 `resources/icon.ico` (16~256px)
- **前置要求**：需安装 ImageMagick
  - `winget install ImageMagick.ImageMagick`
  - 或 `choco install imagemagick`
- **使用方法**：右键 `convert-icon.ps1` → "使用 PowerShell 运行"
- **转换成功后**：主程序会自动使用自定义图标（无需改代码）

### 3. `convert-icon.js` —— SVG 转 PNG 备用方案
- **功能**：生成 256x256 PNG 图标（sharp 库不支持直接输出多尺寸 ICO）
- **使用方法**：
  ```bash
  npm install sharp --save-dev
  node convert-icon.js
  ```
- **建议**：优先使用 `convert-icon.ps1` 获得完美 ICO

---

## 🔧 代码改动详情

### `main/index.js` 关键修复
```javascript
// 智能处理图标：存在则使用，不存在则使用默认，避免窗口创建异常
const iconPath = path.join(__dirname, '../resources/icon.ico');
const hasCustomIcon = require('fs').existsSync(iconPath);
const icon = hasCustomIcon ? iconPath : undefined;
// ...
icon: icon
```

---

## 🚀 快速开始清单

1. ✅ 代码已修复，开发模式 `npm start` 可正常显示窗口
2. 📋 复制项目到本地 Windows 电脑
3. 🖱️ 右键 `build-portable.bat` → "以管理员身份运行"
4. ⏳ 等待自动完成（约 1-3 分钟）
5. 🎉 在 `dist\win-unpacked\` 找到可直接分发的 `rss-video-monitor.exe`

---

## ❓ 常见问题

| 问题 | 解决方案 |
|------|----------|
| 打包报错 `EACCES`/`EPERM` | 必须**以管理员身份运行**脚本/终端 |
| 杀毒软件拦截 `app-builder.exe` | 将项目目录加入白名单，或暂时关闭实时防护 |
| 想要自定义图标 | 运行 `convert-icon.ps1` 生成 `icon.ico`，重新打包即可 |
| 便携版无法运行 | 确保目标机器为 Windows 10/11 x64，无需安装任何运行时 |

---

## 📞 技术支持
如遇问题，请检查：
1. 是否以管理员身份运行打包脚本
2. Node.js 版本 ≥ 18（建议 LTS）
3. 网络畅通（首次需下载 Electron 预编译二进制）

---
*本文档由 AI 自动生成，配合项目代码修复与打包工具链使用。*