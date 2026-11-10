"""Fetch a portable document renderer into ignored tools; no system install."""
from pathlib import Path
import urllib.request
import hashlib
import json
ROOT = Path(__file__).resolve().parents[1] / 'tools/document-renderer'
ROOT.mkdir(parents=True, exist_ok=True)
url = 'https://download.documentfoundation.org/libreoffice/portable/26.2.1/LibreOfficePortable_26.2.1_MultilingualAll.paf.exe'
target = ROOT / 'LibreOfficePortable.paf.exe'
if not target.exists():
    request = urllib.request.Request(url, headers={'User-Agent':'TEAR-document-rendering/1.0'})
    with urllib.request.urlopen(request, timeout=60) as source, target.open('wb') as out:
        while block := source.read(1024 * 1024):
            out.write(block)
assert target.read_bytes()[:2] == b'MZ'
print(json.dumps({'file':str(target), 'bytes':target.stat().st_size, 'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest()}))
