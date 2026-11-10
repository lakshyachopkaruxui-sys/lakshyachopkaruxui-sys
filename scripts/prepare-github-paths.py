"""One-time migration of application-owned public literals to Vite base URLs."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
pattern = re.compile(r"(['\"`])/(?:models|audio|hdri|environment|textures|fonts|images)/[^\n]*?\1")
for path in sorted((ROOT / 'src').rglob('*.ts')):
    text = path.read_text(encoding='utf-8')
    if 'import { assetUrl }' in text:
        continue
    revised, count = pattern.subn(lambda match: 'assetUrl(' + match.group(0) + ')', text)
    if count:
        revised = "import { assetUrl } from '../utils/assetUrl';\n" + revised
        path.write_text(revised, encoding='utf-8')
        print(path.relative_to(ROOT), count)
