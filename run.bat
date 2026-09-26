@echo off
title Control Engineering Simulator

echo ===================================================
echo  Control Engineering Simulator (Mobile Ready)
echo ===================================================

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Python detected.
    for /f "tokens=*" %%i in ('python -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8', 80)); print(s.getsockname()[0]); s.close()" 2^>nul') do set LOCAL_IP=%%i
    echo.
    echo PC Local URL:    http://localhost:8000
    if defined LOCAL_IP (
        echo Mobile URL:      http://%LOCAL_IP%:8000  (Same Wi-Fi)
    )
    echo ===================================================
    echo.
    start http://localhost:8000
    python -m http.server 8000
    goto :eof
)

where npx >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Node.js detected. Starting serve at http://localhost:8000 ...
    start http://localhost:8000
    npx serve -l 8000
    goto :eof
)

echo Python or Node not found. Opening standalone.html directly in browser...
start standalone.html
