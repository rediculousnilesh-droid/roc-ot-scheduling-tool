@echo off
:: If called with "server" arg, run the server directly
if "%~1"=="server" goto :findnode

:: Otherwise, launch server minimized and open browser
start /min "ROC OT Scheduling Tool Server" "%~f0" server
timeout /t 4 /nobreak >nul
start "" http://localhost:3000
exit /b

:findnode
cd /d "%~dp0server"

where node >nul 2>&1
if %ERRORLEVEL% EQU 0 goto :start
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    goto :start
)
if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
    goto :start
)
echo ERROR: Node.js not found.
pause
exit /b 1

:start
npx tsx src/index.ts
