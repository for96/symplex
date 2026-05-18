@echo off
REM Launcher alternativo: serve i file via HTTP locale e apre il browser.
REM Utile se per qualsiasi motivo file:// non funziona o vuoi servire da rete.
REM Per fermare il server: chiudi la finestra "Simplesso server" minimizzata.

cd /d "%~dp0"
start "Simplesso server" /MIN python -m http.server 8000
timeout /t 1 /nobreak > nul
start "" "http://localhost:8000/index.html"
