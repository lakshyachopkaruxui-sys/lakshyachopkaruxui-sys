from pathlib import Path
import urllib.request
import subprocess
ROOT = Path(__file__).resolve().parents[1] / 'tools/document-renderer'
for name in ['7zr.exe','7z2603-x64.exe']:
    url='https://github.com/ip7z/7zip/releases/download/26.03/'+name
    request=urllib.request.Request(url,headers={'User-Agent':'TEAR-document-rendering/1.0'})
    target=ROOT/name
    with urllib.request.urlopen(request,timeout=60) as src:
        target.write_bytes(src.read())
    assert target.read_bytes()[:2]==b'MZ'
    print(name,target.stat().st_size,flush=True)
result=subprocess.run([str(ROOT/'7zr.exe'),'x',str(ROOT/'7z2603-x64.exe'),'-o'+str(ROOT/'7zip'),'-y'],capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
print(result.stdout[-2500:],result.stderr,flush=True)
raise SystemExit(result.returncode)
