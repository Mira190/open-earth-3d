"""Vendor what the web page used to fetch from third parties at load: three.js r186 with the
addons the app imports, three-mesh-bvh, and the fonts (Google Fonts, all SIL Open Font
Licence). Served from the site itself, the page no longer depends on cdnjs, jsDelivr or
Google being reachable (fonts.googleapis.com is blocked in mainland China, where a
render-blocking stylesheet that never arrives holds the first paint), sends no visitor's
address to them, and works offline.

    python3 pipeline/fetch_vendor.py

Writes web/vendor/three/{three.module.min.js, three.core.min.js, addons/...},
web/vendor/three-mesh-bvh/index.module.min.js, web/assets/fonts/*.woff2 and web/fonts.css.
The reef's WebGPU build (web/vendor/three/three.webgpu.js) is the same release and stays.
"""
import os
import re
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
WEB = os.path.join(ROOT, "web")
THREE = "0.186.1"
BVH = "0.9.16"
NPM = "https://cdn.jsdelivr.net/npm"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# what index.html imports from three/addons; their own imports are followed
ADDONS = ["controls/OrbitControls.js", "objects/Sky.js", "objects/Reflector.js", "loaders/GLTFLoader.js",
          "utils/SkeletonUtils.js", "utils/BufferGeometryUtils.js", "postprocessing/EffectComposer.js",
          "postprocessing/RenderPass.js", "postprocessing/UnrealBloomPass.js", "postprocessing/OutputPass.js",
          "postprocessing/ShaderPass.js"]

# the families index.html sets type in, latin and latin-ext only; Japanese and Chinese text
# falls back to the system's own fonts (Hiragino, Yu Gothic, Noto CJK) except the city names,
# subset to their characters
FONTS = [
    "family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,500..800",
    "family=Public+Sans:wght@400;500;600",
    "family=JetBrains+Mono:wght@400;500",
    "family=Zalando+Sans+Expanded:wght@200..500",
    "family=Inter+Tight:wght@400;500;600",
]
CJK = "family=Shippori+Mincho:wght@500&family=Noto+Serif+TC:wght@500&text=" + urllib.request.quote("大阪京都東香港")
SUBSETS = {"latin", "latin-ext"}


def get(url, binary=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else data.decode("utf8")


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def three():
    base = f"{NPM}/three@{THREE}"
    out = os.path.join(WEB, "vendor", "three")
    for f in ["three.module.min.js", "three.core.min.js"]:
        save(os.path.join(out, f), get(f"{base}/build/{f}"))
    todo, done = list(ADDONS), set()
    while todo:
        rel = todo.pop()
        if rel in done:
            continue
        done.add(rel)
        src = get(f"{base}/examples/jsm/{rel}", binary=False)
        save(os.path.join(out, "addons", rel), src.encode("utf8"))
        for dep in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]""", src):
            todo.append(os.path.normpath(os.path.join(os.path.dirname(rel), dep)).replace(os.sep, "/"))
    save(os.path.join(WEB, "vendor", "three-mesh-bvh", "index.module.min.js"), get(f"{NPM}/three-mesh-bvh@{BVH}/build/index.module.min.js"))
    print(f"three.js {THREE}: {len(done)} addons; three-mesh-bvh {BVH}")


def fonts():
    css_out, files = ["/* Vendored by pipeline/fetch_vendor.py from Google Fonts (SIL Open Font Licence). */"], {}
    for q, all_subsets in [(f, False) for f in FONTS] + [(CJK, True)]:
        css = get(f"https://fonts.googleapis.com/css2?{q}&display=swap", binary=False)
        for subset, block in re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*{[^}]*})", css) or [("all", b) for b in re.findall(r"@font-face\s*{[^}]*}", css)]:
            if not all_subsets and subset not in SUBSETS:
                continue
            fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
            weight = re.search(r"font-weight:\s*([\d ]+);", block).group(1).strip().replace(" ", "-")
            url = re.search(r"url\((https://[^)]+)\)", block).group(1)
            if url not in files:  # a variable font comes back once per weight asked for: keep one file
                files[url] = f"{fam.lower().replace(' ', '-')}-{weight}-{subset}.woff2"
                save(os.path.join(WEB, "assets", "fonts", files[url]), get(url))
            css_out.append(block.replace(url, f"assets/fonts/{files[url]}"))
    with open(os.path.join(WEB, "fonts.css"), "w", encoding="utf8") as f:
        f.write("\n".join(css_out) + "\n")
    print(f"fonts: {len(files)} files")


if __name__ == "__main__":
    three()
    fonts()
