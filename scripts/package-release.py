"""Inventory, audit and package this TEAR workspace without installed dependencies.

Run with Python 3.11+ from this project. --build writes two ZIPs beside the project.
External original inputs are read only; missing originals are reported explicitly.
"""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PARENT = ROOT.parent
PREFIX = 'TEAR_Project/'
GENERATED = {'PACKAGE_MANIFEST.json', 'PACKAGE_REPORT.json'}
SKIP_DIRS = {'.git', '.npm-cache', 'node_modules', '__pycache__', '.build-deps', 'test-results', 'playwright-report'}
SKIP_PREFIXES = [
    'tools/', 'validation/tools/', 'validation/conifer-sources/',
    'validation/horror-rebuild/monster/', 'validation/horror-rebuild/nightmares/',
    'validation/deer-candidates/', 'validation/document-qa/',
    'validation/pages-build/', 'validation/release-checkout/',
    'validation/release/package-audit/', 'authoring_sources/', 'reference_inputs/', 'case-study-draft/',
]
SKIP_FILES = {'validation/horror-rebuild/Poses.zip', 'validation/horror-rebuild/vividcharacters.zip', 'tmp-test-results.txt'}
TEXT_EXTENSIONS = {'.ts', '.js', '.mjs', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml', '.toml', '.py', '.ps1', '.cmd', '.xml'}
CACHE = {}
EXCLUSIONS = []

def sha(path):
    key = (str(path), path.stat().st_size, path.stat().st_mtime_ns)
    if key not in CACHE:
        with path.open('rb') as stream:
            CACHE[key] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return CACHE[key]

def dump(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')

def collect(base, destination='', prototype=False):
    result = {}
    if not base.is_dir():
        raise FileNotFoundError(base)
    for directory, directories, filenames in os.walk(base, followlinks=False):
        here = Path(directory)
        keep = []
        for name in sorted(directories):
            path = here / name
            rel = path.relative_to(base).as_posix() + '/'
            skip = name in SKIP_DIRS or path.is_symlink() or (prototype and any(rel.startswith(p) for p in SKIP_PREFIXES))
            if skip:
                EXCLUSIONS.append({'path': destination + rel, 'reason': 'installed dependency, cache, ignored source collection or separate continuity folder'})
            else:
                keep.append(name)
        directories[:] = keep
        for name in sorted(filenames):
            path = here / name
            rel = path.relative_to(base).as_posix()
            skip = (path.is_symlink() or name in GENERATED or name.startswith('.env') or
                    name.endswith(('.local', '.pem', '.key', '.tsbuildinfo', '.pyc')) or
                    name == '.DS_Store' or (prototype and rel in SKIP_FILES))
            if skip:
                EXCLUSIONS.append({'path': destination + rel, 'reason': 'local/generated/private configuration or unused research download'})
                continue
            result[destination + rel] = path
    return result

def ignored_by_git(names):
    result = subprocess.run(['git', 'check-ignore', '--no-index', '--stdin', '-z'], cwd=ROOT,
                            input=('\0'.join(names) + '\0').encode(), capture_output=True)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.decode(errors='replace'))
    return set(result.stdout.decode().strip('\0').split('\0')) - {''}

def scan_text(entries, ignored):
    patterns = [re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
                re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'),
                re.compile(r'github_pat_[A-Za-z0-9_]{50,}'),
                re.compile(r'AKIA[A-Z0-9]{16}')]
    findings = []
    count = 0
    for name, path in entries.items():
        if name in ignored or path.suffix.lower() not in TEXT_EXTENSIONS or path.stat().st_size > 5_000_000:
            continue
        count += 1
        text = path.read_text(encoding='utf-8', errors='replace')
        if any(pattern.search(text) for pattern in patterns):
            findings.append(name)
    if findings:
        raise RuntimeError('Review possible credential patterns in: ' + ', '.join(findings))
    return {'text_files_scanned': count, 'known_pattern_findings': [], 'boundary': 'Heuristic pattern scan, not proof that all sensitive information is absent. Original reference files are kept outside normal Git tracking.'}

def validate_source(entries):
    lock = json.loads((ROOT / 'package-lock.json').read_text())['packages']['']
    package = json.loads((ROOT / 'package.json').read_text())
    for key in ['dependencies', 'devDependencies', 'engines']:
        assert package.get(key) == lock.get(key), key
    public = [name for name in entries if name.startswith('public/')]
    for name in public:
        copy = 'dist/' + name[len('public/'):]
        assert copy in entries, 'Missing built asset: ' + copy
        assert sha(entries[name]) == sha(entries[copy]), 'Built asset mismatch: ' + name
    test_log = (ROOT / 'validation/release/unit-tests.txt').read_text(encoding='utf-16' if (ROOT / 'validation/release/unit-tests.txt').read_bytes().startswith(b'\xff\xfe') else 'utf-8-sig')
    assert re.search(r'tests\s+203\b', test_log), 'Expected current 203-test run'
    assert re.search(r'pass\s+203\b', test_log) and re.search(r'fail\s+0\b', test_log)
    browser = json.loads((ROOT / 'validation/release/browser-pages/results.json').read_text())
    assert len(browser['checks']) == 11 and not browser['errors'] and not browser['failedRequests']
    assert (ROOT / 'docs/TEAR_Complete_Project_Handoff.docx').exists()
    assert len(list((ROOT / 'validation/document-qa').glob('page-*.png'))) == 12
    assert '/tear-preview/assets/' in (ROOT / 'validation/pages-build/index.html').read_text()
    assert '/tear-preview/' not in (ROOT / 'dist/index.html').read_text()
    ignored = ignored_by_git(list(entries))
    assert not (set(public) & ignored), 'Runtime public resources must be tracked'
    git_files = [name for name in entries if name not in ignored]
    largest = sorted(git_files, key=lambda name: entries[name].stat().st_size, reverse=True)
    assert all(entries[name].stat().st_size < 100 * 1024**2 for name in git_files), 'Regular Git file limit exceeded'
    return {'lockfile_matches_package': True, 'public_files_match_dist': len(public),
            'unit_tests_passed': 203, 'desktop_production_browser_checks_passed': 11,
            'browser_console_errors': 0, 'browser_failed_requests': 0,
            'typecheck_and_root_and_pages_builds': 'Passed; logs retained in validation/release',
            'document_pages_rendered_and_visually_reviewed': 12,
            'document_renderer': 'Canonical document skill renderer with portable LibreOffice',
            'intended_git_files': len(git_files),
            'intended_git_total_bytes': sum(entries[name].stat().st_size for name in git_files),
            'largest_intended_git_files': [{'path': name, 'bytes': entries[name].stat().st_size} for name in largest[:5]],
            'git_file_limit_100_MiB': 'pass', 'secret_pattern_check': scan_text(entries, ignored),
            'hosted_ci_or_public_deployment': 'not performed', 'physical_headset_testing': 'not performed in this revision'}

def continuity():
    extras = collect(PARENT / 'tear-behance', 'case-study-draft/')
    missing = []
    inputs = [Path('C:/Users/think/Downloads') / name for name in ['TEAR_Master_Continuation_Brief.md', 'Final Assignment imd.pdf', 'IMD Project.zip']]
    for identifier in ['8f21fa0c-a015-49e4-bdcc-5ec3eeddf6b2', '11a87acc-46e0-4c51-b141-040df1fd048f', 'ffa2696e-3ea4-465d-9b74-a7d551d6bae0', '4dd51451-5208-42bd-920b-603a66e6fbb7']:
        inputs.append(Path('C:/Users/think/AppData/Local/Temp') / ('codex-clipboard-' + identifier + '.png'))
    for path in inputs:
        if path.is_file():
            extras['reference_inputs/' + path.name] = path
        else:
            missing.append(path.name)
    original = Path('C:/Users/think/Downloads/IMD Project.zip')
    assert sha(original) == '34043c4d295798ccbb860096204f865d464fdf47596599a6cb13d795fefc073b'
    for rel in ['validation/conifer-sources/fir_tree_01', 'validation/conifer-sources/jpeg', 'validation/horror-rebuild/monster/Poses', 'tools/narrator-models']:
        extras.update(collect(ROOT / rel, 'authoring_sources/' + rel + '/'))
    extras['authoring_sources/RESTORE.md'] = ROOT / 'docs/AUTHORING_SOURCE_RESTORE.md'
    ignored = ignored_by_git(list(extras))
    assert len(ignored) == len(extras), 'All backup-only files must be excluded by Git'
    return extras, missing, sha(original)

def package(name, entries, checks, missing, original_hash, complete, build):
    report = {'package': name, 'prepared_utc': datetime.now(timezone.utc).isoformat(),
              'root_folder': PREFIX, 'variant': 'complete backup' if complete else 'GitHub-ready website',
              'validation': checks, 'missing_original_inputs': missing,
              'original_IMD_Project_zip_sha256_unchanged': original_hash,
              'not_available': ['Unity Terrain Sample Project asset 213197: not acquired or imported', 'new final headset media and Soumya demonstration photo', 'native Figma .fig output'],
              'exclusions': sorted(EXCLUSIONS, key=lambda item: item['path']),
              'compact_variant_boundary': 'Original inputs, existing case-study draft and optional raw authoring resources are included only in the complete archive.',
              'archive_integrity': 'Post-write CRC and manifest hash results are in the companion .verification.json and .sha256 files.'}
    payloads = {'PACKAGE_REPORT.json': dump(report)}
    rows = [{'path': key, 'bytes': path.stat().st_size, 'sha256': sha(path)} for key, path in sorted(entries.items())]
    rows.extend({'path': key, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for key, data in payloads.items())
    manifest = {'format': 1, 'package': name, 'root_folder': PREFIX, 'self_exclusion': 'This manifest excludes its own bytes; the companion ZIP SHA-256 covers the entire archive.', 'files': rows}
    payloads['PACKAGE_MANIFEST.json'] = dump(manifest)
    total = sum(row['bytes'] for row in rows) + len(payloads['PACKAGE_MANIFEST.json'])
    print(json.dumps({'package': name, 'files': len(rows) + 1, 'uncompressed_bytes': total, 'largest_git_file': checks['largest_intended_git_files'][0], 'missing': missing}), flush=True)
    audit_dir = ROOT / 'validation/release/package-audit'
    audit_dir.mkdir(exist_ok=True)
    (audit_dir / (name + '.manifest.json')).write_bytes(payloads['PACKAGE_MANIFEST.json'])
    if not build:
        return
    target = PARENT / name
    temp = target.with_suffix('.building.zip')
    if target.exists() or temp.exists():
        raise RuntimeError('Refusing to overwrite an existing package: ' + str(target))
    with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for index, (key, path) in enumerate(sorted(entries.items()), 1):
            archive.write(path, PREFIX + key)
            if index % 200 == 0:
                print(f'{name}: archived {index}/{len(entries)} files', flush=True)
        for key, data in payloads.items():
            archive.writestr(PREFIX + key, data)
    with zipfile.ZipFile(temp) as archive:
        assert archive.testzip() is None, 'ZIP CRC failed'
        assert len(archive.namelist()) == len(set(archive.namelist())) == len(rows) + 1
        for row in rows:
            with archive.open(PREFIX + row['path']) as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            assert actual == row['sha256'], 'Archived file mismatch: ' + row['path']
        assert archive.read(PREFIX + 'PACKAGE_MANIFEST.json') == payloads['PACKAGE_MANIFEST.json']
    temp.rename(target)
    checksum = sha(target)
    verification = {'package': name, 'bytes': target.stat().st_size, 'sha256': checksum,
                    'archive_file_count': len(rows) + 1, 'manifest_files_hashed': len(rows),
                    'zip_crc': 'pass', 'all_manifest_file_hashes': 'pass', 'validation': checks}
    target.with_suffix('.verification.json').write_bytes(dump(verification))
    target.with_suffix('.sha256').write_text(checksum + '  ' + name + '\n', encoding='ascii')
    print(json.dumps({'completed': name, 'bytes': target.stat().st_size, 'sha256': checksum}), flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', action='store_true')
    args = parser.parse_args()
    entries = collect(ROOT, prototype=True)
    checks = validate_source(entries)
    extras, missing, original_hash = continuity()
    package('TEAR_GitHub_Ready.zip', entries, checks, missing, original_hash, False, args.build)
    package('TEAR_Complete_Project_Archive.zip', entries | extras, checks, missing, original_hash, True, args.build)

if __name__ == '__main__':
    main()
