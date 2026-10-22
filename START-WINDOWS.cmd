@echo off
if not exist "%~dp0app\dist\win-unpacked\Clay.exe" (
  echo Clay is not built yet. Run npm run dist:win from the app folder.
  pause
  exit /b 1
)
start "" /D "%~dp0app\dist\win-unpacked" "%~dp0app\dist\win-unpacked\Clay.exe"
