#!/usr/bin/env python3
"""
Собирает из компонентов один самодостаточный файл dist/index.single.html:
CSS и JS инлайнятся в теги, картинка героя превращается обратно в data:URI.
Такой файл можно открыть двойным кликом или положить на любой хостинг одним куском.

Запуск из корня репозитория:  python3 tools/build_single.py
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
OUT = ROOT / "dist" / "index.single.html"

CSS = re.compile(r'[ \t]*<link rel="stylesheet" href="(assets/[^"]+)">[ \t]*\n?')
JS = re.compile(r'[ \t]*<script src="(assets/[^"]+)"></script>[ \t]*\n?')
IMG = re.compile(r'href="(assets/img/[^"]+)"')

MIME = {".webp": "image/webp", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        sys.exit(f"нет файла: {rel}")
    return path.read_text(encoding="utf-8")


def main() -> None:
    html = SRC.read_text(encoding="utf-8")
    html = CSS.sub(lambda m: f"<style>\n{read(m.group(1))}</style>\n", html)
    html = JS.sub(lambda m: f"<script>\n{read(m.group(1))}</script>\n", html)

    def inline_img(m):
        rel = m.group(1)
        path = ROOT / rel
        mime = MIME.get(path.suffix.lower(), "application/octet-stream")
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        return f'href="data:{mime};base64,{data}"'

    html = IMG.sub(inline_img, html)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)} — {len(html.encode('utf-8')):,} байт")


if __name__ == "__main__":
    main()
