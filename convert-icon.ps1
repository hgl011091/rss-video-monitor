<# 
.SYNOPSIS
    将 resources/icon.svg 转换为 resources/icon.ico (多尺寸)，供 Electron 打包使用。

.DESCRIPTION
    依赖 ImageMagick (magick 命令)。若未安装，请先安装：
    - winget install ImageMagick.ImageMagick
    - 或 choco install imagemagick
    - 或从 https://imagemagick.org/script/download.php 下载安装

.NOTES
    运行方式：右键此文件 -> "使用 PowerShell 运行"，或在管理员 PowerShell 中执行：
    .\convert-icon.ps1
#>

param()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$SvgPath = Join-Path $ScriptDir "resources\icon.svg"
$IcoPath = Join-Path $ScriptDir "resources\icon.ico"

if (-not (Test-Path $SvgPath)) {
    Write-Error "找不到源文件: $SvgPath"
    exit 1
}

# 检查 magick 命令
$MagickCmd = Get-Command "magick" -ErrorAction SilentlyContinue
if (-not $MagickCmd) {
    $MagickCmd = Get-Command "convert" -ErrorAction SilentlyContinue
}
if (-not $MagickCmd) {
    Write-Warning "未检测到 ImageMagick (magick/convert 命令)。"
    Write-Host "请先安装 ImageMagick："
    Write-Host "  winget install ImageMagick.ImageMagick"
    Write-Host "  或 choco install imagemagick"
    Write-Host "  或访问 https://imagemagick.org/script/download.php"
    Write-Host ""
    Write-Host "安装后请重新打开 PowerShell 再运行此脚本。"
    Read-Host "按回车键退出"
    exit 1
}

Write-Host "正在转换 SVG -> ICO (多尺寸: 16,24,32,48,64,128,256)..."
try {
    # 使用 magick 转换，生成多尺寸 ICO
    & $MagickCmd.Source $SvgPath -define icon:auto-resize=256,128,64,48,32,24,16 $IcoPath
    if ($LASTEXITCODE -eq 0 -and (Test-Path $IcoPath)) {
        Write-Host "✅ 成功生成: $IcoPath"
        Write-Host "现在可以取消 main/index.js 中 icon 路径的注释，恢复自定义图标。"
    } else {
        Write-Error "转换失败，退出码: $LASTEXITCODE"
    }
} catch {
    Write-Error "发生异常: $_"
}
Read-Host "按回车键退出"