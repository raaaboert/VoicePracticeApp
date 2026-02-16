@echo off
setlocal

powershell -ExecutionPolicy Bypass -File "%~dp0launch-review-stack.ps1"
