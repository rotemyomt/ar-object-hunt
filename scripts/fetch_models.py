#!/usr/bin/env python3
"""Download the vision models listed in scripts/models.json into client/public/models.

Each file is fetched from a pinned Hugging Face revision and its SHA-256 is verified
before it's kept, so a changed or tampered upstream file can never slip into the game.
Usage:  python3 scripts/fetch_models.py      (no dependencies beyond the standard library)
"""
import hashlib
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "public" / "models"
SRC = ROOT / ".cache" / "models"  # build inputs, not shipped
MANIFEST = json.loads((ROOT / "scripts" / "models.json").read_text())


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    SRC.mkdir(parents=True, exist_ok=True)
    for m in MANIFEST["models"]:
        dest = (OUT if m.get("dest", "public") == "public" else SRC) / m["file"]
        if dest.exists() and sha256(dest) == m["sha256"]:
            print(f"ok      {m['file']} (cached)")
            continue
        url = f"https://huggingface.co/{m['repo']}/resolve/{m['revision']}/{m['path']}"
        print(f"fetch   {m['file']} <- {url}")
        tmp = dest.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=300) as r, tmp.open("wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        got = sha256(tmp)
        if got != m["sha256"]:
            tmp.unlink(missing_ok=True)
            print(f"FAILED  {m['file']}: sha256 {got} != {m['sha256']}", file=sys.stderr)
            return 1
        tmp.replace(dest)
        print(f"ok      {m['file']} ({dest.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
