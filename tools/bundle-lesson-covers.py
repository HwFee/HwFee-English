"""Create a separate cherina-pod ZIP with per-lesson offline covers."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import urllib.error
import urllib.request
import zipfile

PAYLOAD = re.compile(r'(<script\b[^>]*\bid=["\']data["\'][^>]*>)([\s\S]*?)(</script>)')


def rewrite_payload(html, change):
    match = PAYLOAD.search(html)
    if not match:
        raise ValueError('Missing lesson/index payload')
    data = json.loads(match[2])
    change(data)
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    return html[:match.start(2)] + payload + html[match.end(2):]


def image_extension(blob):
    if blob.startswith(b'\xff\xd8\xff'):
        return '.jpg'
    if blob.startswith(b'\x89PNG\r\n\x1a\n'):
        return '.png'
    if blob[:4] == b'RIFF' and blob[8:12] == b'WEBP':
        return '.webp'
    raise ValueError('Response is not a JPEG, PNG or WebP image')


def fetch_cover(source, cache):
    key = hashlib.sha256(source.encode()).hexdigest()
    for file in cache.glob(key + '.*'):
        blob = file.read_bytes()
        return blob, image_extension(blob)
    candidates = [source]
    if 'maxresdefault.' in source:
        candidates.append(source.replace('maxresdefault.', 'hqdefault.'))
    failure = None
    for url in candidates:
        for _ in range(2):
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(request, timeout=20) as response:
                    blob = response.read(4 * 1024 * 1024 + 1)
                if len(blob) > 4 * 1024 * 1024:
                    raise ValueError('Cover exceeds 4 MiB')
                extension = image_extension(blob)
                (cache / (key + extension)).write_bytes(blob)
                return blob, extension
            except Exception as error:
                failure = error
    raise RuntimeError(f'Cannot download {source}: {failure}')


def bundle(source, target, cache):
    if target.exists():
        raise FileExistsError(f'Output already exists: {target}')
    cache.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as original:
        lessons = {str(PurePosixPath(name).parent): json.loads(original.read(name))
                   for name in original.namelist() if name.endswith('/lesson.json')}
        if not lessons:
            raise ValueError('No folder lessons found')
        images = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            work = {executor.submit(fetch_cover, data['image'], cache): folder
                    for folder, data in lessons.items()}
            for future in concurrent.futures.as_completed(work):
                folder = work[future]
                blob, extension = future.result()
                images[folder] = (blob, 'images/cover' + extension)
                print(f'Covers: {len(images)}/{len(lessons)}', flush=True)
        temporary = target.with_suffix('.building.zip')
        try:
            with zipfile.ZipFile(temporary, 'w', allowZip64=True) as output:
                for entry in original.infolist():
                    path = PurePosixPath(entry.filename)
                    folder = str(path.parent)
                    if folder in images and path.name == 'lesson.json':
                        data = json.loads(original.read(entry))
                        data['image'] = images[folder][1]
                        output.writestr(entry, json.dumps(data, ensure_ascii=False, indent=2).encode())
                    elif folder in images and path.name in ('player.html', 'handout.html'):
                        html = original.read(entry).decode('utf-8')
                        local_cover = images[folder][1]
                        old_cover = lessons[folder]['image']
                        if PAYLOAD.search(html):
                            html = rewrite_payload(html, lambda data: data.update(image=local_cover))
                        html = html.replace(old_cover, local_cover)
                        if path.name == 'handout.html':
                            html = html.replace('>打印 / 存为 PDF</button>', '>存为 PDF</button>')
                        output.writestr(entry, html.encode())
                    elif path.name == 'index.html' and PAYLOAD.search(original.read(entry).decode('utf-8')):
                        html = original.read(entry).decode('utf-8')

                        def update_index(data):
                            for lesson in data.get('lessons', []):
                                lesson_folder = str(path.parent / lesson['dir'])
                                if lesson_folder in images:
                                    lesson['image'] = str(PurePosixPath(lesson['dir']) / images[lesson_folder][1])

                        output.writestr(entry, rewrite_payload(html, update_index).encode())
                    else:
                        with original.open(entry) as reader, output.open(entry, 'w') as writer:
                            shutil.copyfileobj(reader, writer, 1024 * 1024)
                for folder, (blob, name) in sorted(images.items()):
                    output.writestr(folder + '/' + name, blob, compress_type=zipfile.ZIP_STORED)
            with zipfile.ZipFile(temporary) as result:
                broken = result.testzip()
                if broken:
                    raise ValueError(f'ZIP validation failed: {broken}')
                for entry in original.infolist():
                    if '/audio/' in entry.filename and result.getinfo(entry.filename).CRC != entry.CRC:
                        raise ValueError(f'Audio changed: {entry.filename}')
                for folder, (_, name) in images.items():
                    data = json.loads(result.read(folder + '/lesson.json'))
                    assert data['image'] == name
                    assert folder + '/' + name in result.namelist()
                    player = result.read(folder + '/player.html').decode()
                    payload = json.loads(PAYLOAD.search(player)[2])
                    assert payload['image'] == name
            temporary.rename(target)
        except Exception:
            if temporary.exists():
                temporary.unlink()
            raise
    print(json.dumps({'output': str(target), 'lessons': len(images), 'bytes': target.stat().st_size}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('--cache', type=Path, default=Path('.tmp/lesson-cover-downloads'))
    args = parser.parse_args()
    bundle(args.source, args.target, args.cache)
