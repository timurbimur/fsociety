@echo off
title FSOCIETY UPDATER
color 0A

echo.
echo  ███████╗███████╗ ██████╗  ██████╗██╗███████╗████████╗██╗   ██╗
echo  ██╔════╝██╔════╝██╔═══██╗██╔════╝██║██╔════╝╚══██╔══╝╚██╗ ██╔╝
echo  █████╗  ███████╗██║   ██║██║     ██║█████╗     ██║    ╚████╔╝ 
echo  ██╔══╝  ╚════██║██║   ██║██║     ██║██╔══╝     ██║     ╚██╔╝  
echo  ██║     ███████║╚██████╔╝╚██████╗██║███████╗   ██║      ██║   
echo  ╚═╝     ╚══════╝ ╚═════╝  ╚═════╝╚═╝╚══════╝   ╚═╝      ╚═╝  
echo.
echo  AUTO-UPDATER v1.0 // root@fsociety
echo  ----------------------------------------
echo.

:: Check if git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERR] Git is not installed!
    echo  [ERR] Download from: https://git-scm.com
    pause
    exit /b 1
)

:: Check if node is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERR] Node.js is not installed!
    echo  [ERR] Download from: https://nodejs.org
    pause
    exit /b 1
)

echo  [SYS] Backing up your .env file...
if exist .env copy .env .env.backup >nul
echo  [OK]  Backup saved to .env.backup

echo.
echo  [SYS] Pulling latest version from GitHub...
git pull origin main

if %errorlevel% neq 0 (
    echo.
    echo  [ERR] Update failed! Restoring backup...
    if exist .env.backup copy .env.backup .env >nul
    pause
    exit /b 1
)

echo.
echo  [OK]  Code updated successfully!

:: Restore .env if git pull overwrote it
if exist .env.backup (
    copy .env.backup .env >nul
    echo  [OK]  API keys restored from backup
)

echo.
echo  [SYS] Checking dependencies...
npm install --silent 2>nul
echo  [OK]  Dependencies ready

echo.
echo  ----------------------------------------
echo  [OK]  FSOCIETY IS UP TO DATE
echo  [SYS] Launching app...
echo  ----------------------------------------
echo.

npm start
