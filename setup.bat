@echo off
title Meesho Auto Lister Setup
echo ========================================
echo   Welcome to Meesho Auto Lister Setup
echo ========================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install it from https://nodejs.org/
    pause
    exit /b
)

echo [1/3] Installing Backend Dependencies...
cd backend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b
)

echo.
echo [2/3] Setting up Environment Variables...
if not exist .env (
    copy .env.example .env
    echo [SUCCESS] Created .env file.
) else (
    echo [INFO] .env file already exists.
)

echo.
echo [3/3] Configuration Required
echo ----------------------------------------
echo Please open the 'backend/.env' file and 
echo add your Gemini API Key.
echo ----------------------------------------
echo.
echo After adding the API key, you can start 
echo the server by running 'npm start' in 
echo the backend folder.
echo.

pause
echo Starting server...
npm start
