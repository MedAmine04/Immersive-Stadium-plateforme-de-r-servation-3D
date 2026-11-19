@echo off
cd /d "%~dp0.."
if not exist .env copy .env.example .env >nul
docker compose up --build -d
echo.
echo Premier demarrage : la generation du stade (68 700 sieges) prend ~30 s.
echo Ouvrez http://localhost:3000
