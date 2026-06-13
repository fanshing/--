@echo off
chcp 65001 >nul
title 连锁博弈

cd /d "%~dp0"

echo ========================
echo   连锁博弈 - 服务器启动
echo ========================
echo.

if not exist "node_modules" (
    echo [1/2] 安装依赖中...
    call npm install
    echo.
)

echo [2/2] 启动服务器...
echo.
echo 游戏地址: http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo.

node server/index.js

pause
