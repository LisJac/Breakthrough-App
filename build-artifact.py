"""Make the claude.ai preview page from index.html.

The artifact host adds its own <!doctype>, <html>, <head> and <body>, so this
strips those and keeps everything else. CSS and JS are published alongside as
separate files with the same relative paths. Run: python3 build-artifact.py
"""
import re, pathlib

root = pathlib.Path(__file__).parent
src = (root / "index.html").read_text()

head = re.search(r"<head>(.*?)</head>", src, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", src, re.S).group(1)
# Keep the title, description and font/style links; the host supplies charset and viewport.
keep = "\n".join(l for l in head.strip().splitlines() if not re.search(r"<meta (charset|name=\"viewport\")", l))

out = root / "dist"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(keep + "\n" + body.strip() + "\n")
print("wrote", out / "index.html")
