from pathlib import Path
import subprocess
import hashlib

root = Path(__file__).resolve().parents[1] / 'tools/document-renderer'
installer = root / 'LibreOfficePortable.paf.exe'
destination = root / 'LibreOfficePortable'
assert hashlib.file_digest(installer.open('rb'),'sha256').hexdigest() == '3409f75e56916214afa745fa2cd1bd64103cb02c85fbc50d306997c41690a294'
startup = subprocess.STARTUPINFO()
startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = subprocess.SW_HIDE
# NSIS requires /D last and its directory unquoted; there is no command shell.
command = f'"{installer}" /S /D={destination}'
result = subprocess.run(command, shell=False, startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW)
print('Portable extraction exit', result.returncode, flush=True)
print([str(path) for path in destination.rglob('soffice.exe')])
