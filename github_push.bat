@echo off
title GitHub Push (hatnac/control-pendulum)
echo ========================================================
echo  Pushing to GitHub: https://github.com/hatnac/control-pendulum
echo  (A browser login popup will appear. Please sign in as hatnac.)
echo ========================================================
echo.

git push -u origin main

echo.
if %ERRORLEVEL% equ 0 (
    echo ========================================================
    echo  SUCCESS: Upload to GitHub complete!
    echo ========================================================
) else (
    echo ========================================================
    echo  FAILED: Could not push to GitHub.
    echo ========================================================
)
echo.
pause
