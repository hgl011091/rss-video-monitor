/**
 * SVG 转 ICO (Node.js + sharp 版)
 * 用法：在项目根目录运行 `npm install sharp --save-dev` 后，执行 `node convert-icon.js`
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'resources', 'icon.svg');
const icoPath = path.join(__dirname, 'resources', 'icon.ico');

if (!fs.existsSync(svgPath)) {
    console.error('❌ 找不到源文件:', svgPath);
    process.exit(1);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];

async function convert() {
    try {
        console.log('正在转换 SVG -> ICO (多尺寸)...');
        
        // sharp 不直接支持输出 ICO，需先生成多尺寸 PNG 再合成
        // 这里使用 sharp 生成最大尺寸 PNG，再用系统工具或接受单尺寸
        // 简化方案：生成 256x256 PNG 作为临时方案，建议用 ImageMagick 版获得完美多尺寸 ICO
        
        await sharp(svgPath)
            .resize(256, 256)
            .png()
            .toFile(icoPath.replace('.ico', '-256.png'));
            
        console.log('✅ 已生成 256x256 PNG 备用图标:', icoPath.replace('.ico', '-256.png'));
        console.log('⚠️ 注意：sharp 无法直接输出标准多尺寸 .ico 文件。');
        console.log('   请优先使用 convert-icon.ps1 (需 ImageMagick) 获得完美 .ico');
        console.log('   或使用在线工具 (如 https://convertio.co/svg-ico/) 转换 icon.svg 为 icon.ico');
        
    } catch (err) {
        console.error('❌ 转换失败:', err.message);
        process.exit(1);
    }
}

convert();