@echo off
chcp 65001 >nul
echo ==========================================
echo ACTUALIZANDO ARCHIVO .env
echo ==========================================
echo.

cd /d "%~dp0"

(
echo # ==========================================
echo # ARCHIVO .env CONFIGURADO PARA SUPABASE
echo # ==========================================
echo # Actualizado: 2026-05-07
echo # ==========================================
echo.
echo # ==========================================
echo # SUPABASE DATABASE (Production)
echo # ==========================================
echo # Connect to Supabase via connection pooling (para queries de aplicacion)
echo DATABASE_URL="postgresql://postgres.cedhofinlsorsveeqvuh:LiSquEhWsqrXiG8t@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
echo.
echo # Direct connection to the database (para migraciones Prisma)
echo DIRECT_URL="postgresql://postgres.cedhofinlsorsveeqvuh:LiSquEhWsqrXiG8t@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
echo.
echo # ==========================================
echo # SEGURIDAD
echo # ==========================================
echo JWT_SECRET="super-secret-key-for-contex360-mvp"
echo GEMINI_API_KEY="AIzaSyATkFkZsTJCumwrLLuL0GEJpiY302nodzQ"
echo.
echo # ==========================================
echo # SERVIDOR
echo # ==========================================
echo PORT=3001
echo VITE_API_BASE_URL="http://localhost:3001"
echo CORS_ORIGIN="http://localhost:5173"
echo.
echo # ==========================================
echo # CONFIGURACION COMPLETA - LISTO PARA USAR
echo # ==========================================
) > .env

if %errorlevel% equ 0 (
    echo [OK] Archivo .env actualizado exitosamente
echo.
    echo Verificando configuracion...
    type .env | findstr /c:"DATABASE_URL"
    type .env | findstr /c:"DIRECT_URL"
    echo.
    echo ==========================================
    echo CONFIGURACION COMPLETADA
echo ==========================================
    echo.
    echo Pasos siguientes:
    echo 1. Cierra y guarda el archivo en tu IDE
    echo 2. Reinicia el backend: npm run start:dev
    echo.
) else (
    echo [ERROR] No se pudo actualizar el archivo
)

pause
