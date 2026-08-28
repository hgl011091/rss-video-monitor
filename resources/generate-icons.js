const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 这个脚本用于生成各种尺寸的图标
// 需要安装: npm install -g @vscode/icons 或使用在线转换工具

console.log('图标生成说明:');
console.log('1. 请使用在线工具将 resources/icon.svg 转换为:');
console.log('   - resources/icon.ico (256x256, 128x128, 64x64, 48x48, 32x32, 16x16)');
console.log('   - resources/tray-icon.png (16x16 或 32x32)');
console.log('   - resources/tray-icon@2x.png (32x32 或 64x64)');
console.log('');
console.log('推荐在线工具:');
console.log('  - https://convertio.co/zh/svg-ico/');
console.log('  - https://cloudconvert.com/svg-to-ico');
console.log('  - https://www.favicon-generator.org/');
console.log('');
console.log('或使用 ImageMagick 命令行:');
console.log('  magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico');
console.log('  magick convert icon.svg -resize 16x16 tray-icon.png');
console.log('  magick convert icon.svg -resize 32x32 tray-icon@2x.png');

// 创建一个简单的 PNG 占位符（1x1 像素透明 PNG 的 base64）
const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const transparentPng = Buffer.from(transparentPngBase64, 'base64');

// 写入临时的透明 PNG 作为托盘图标占位符
fs.writeFileSync(path.join(__dirname, 'tray-icon.png'), transparentPng);
fs.writeFileSync(path.join(__dirname, 'tray-icon@2x.png'), transparentPng);

console.log('\n已创建透明 PNG 占位符，请替换为实际图标。');