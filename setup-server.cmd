@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\setup-server.ps1"
pause
