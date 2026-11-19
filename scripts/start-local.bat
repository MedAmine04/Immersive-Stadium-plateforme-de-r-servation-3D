@echo off
REM Mode sans Docker pour l'application : PostgreSQL seul est lance via Docker (port 5433).
cd /d "%~dp0.."
docker compose up -d db || goto :err
cd apps\api
if not exist .venv ( python -m venv .venv )
call .venv\Scripts\activate.bat
pip install -r requirements.txt || goto :err
set DATABASE_URL=postgresql+psycopg://stadium:stadium_local_pwd@localhost:5433/stadium
set ENV=development
start "API" cmd /k "uvicorn app.main:app --port 8000"
cd ..\web
call npm install || goto :err
set API_URL=http://localhost:8000
start "WEB" cmd /k "npm run dev"
echo Ouvrez http://localhost:3000
exit /b 0
:err
echo Une etape a echoue.
exit /b 1
