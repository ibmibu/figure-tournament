#!/usr/bin/env python3
"""Convert the 86 square SSBU fighter PNGs to WebP and switch static references."""
from pathlib import Path
import re
import shutil
from PIL import Image, features

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "fighters" / "square-v1"
TARGET = ROOT / "public" / "fighters" / "square-v2"
MANIFEST = ROOT / "lib" / "fighter-portraits.js"
CONFIG = ROOT / "next.config.js"
ATTRIBUTION = ROOT / "public" / "fighters" / "README.md"

def main():
    if not features.check("webp"):
        raise RuntimeError("Pillow WebP encoder is unavailable")
    source_files = sorted(SOURCE.glob("*.png"))
    if len(source_files) != 86:
        raise RuntimeError(f"Expected 86 source PNGs, found {len(source_files)}")
    if any(p.suffix != ".png" for p in SOURCE.iterdir()):
        raise RuntimeError("Unexpected files in the source directory")
    if TARGET.exists() and any(TARGET.iterdir()):
        raise RuntimeError("Target folder must be empty")

    mapping = MANIFEST.read_text(encoding="utf-8")
    config = CONFIG.read_text(encoding="utf-8")
    refs = re.findall(r'"/fighters/square-v1/([^"]+)\.png"', mapping)
    filenames = {p.stem for p in source_files}
    if len(refs) != 86 or set(refs) != filenames:
        raise RuntimeError("Fighter manifest must reference all 86 source portraits")
    if "source: '/fighters/square-v1/:path*'" not in config:
        raise RuntimeError("Expected portrait Cache-Control rule is missing")

    TARGET.mkdir(parents=True, exist_ok=True)
    original_bytes = converted_bytes = 0
    for source in source_files:
        target = TARGET / f"{source.stem}.webp"
        with Image.open(source) as original:
            if original.size != (128, 128):
                raise RuntimeError(f"Unexpected dimensions for {source.name}: {original.size}")
            original.convert("RGBA").save(target, "WEBP", quality=82, method=6)
        with Image.open(target) as result:
            if result.format != "WEBP" or result.size != (128, 128):
                raise RuntimeError(f"Invalid WebP: {target.name}")
            result.load()
        original_bytes += source.stat().st_size
        converted_bytes += target.stat().st_size

    if len(list(TARGET.glob("*.webp"))) != 86:
        raise RuntimeError("Wrong number of converted images")
    if converted_bytes >= original_bytes:
        raise RuntimeError("WebP did not reduce total image size")

    replacement = mapping.replace("/fighters/square-v1/", "/fighters/square-v2/")
    replacement = replacement.replace('.png"', '.webp"')
    assert set(re.findall(r'"/fighters/square-v2/([^"]+)\.webp"', replacement)) == filenames
    new_config = config.replace("source: '/fighters/square-v1/:path*'",
                                "source: '/fighters/square-v2/:path*'")
    MANIFEST.write_text(replacement, encoding="utf-8")
    CONFIG.write_text(new_config, encoding="utf-8")
    ATTRIBUTION.write_text(
        "# Square fighter portraits\n\n"
        "Source: https://github.com/pokerobybeto/smash-ultimate-assets\n"
        "Original images: Characters/Base (png)/<fighter>/Square/<fighter> (1).png\n\n"
        "86 default-costume square PNGs were encoded as 128x128 WebP, quality 82.\n"
        "Files are hosted locally under public/fighters/square-v2, not GitHub or Supabase.\n"
        "Versioned files are browser-cacheable for one year; future edits require square-v3.\n\n"
        "Characters and imagery belong to their rightsholders. Repository availability\n"
        "does not establish official permission to reuse the artwork.\n",
        encoding="utf-8",
    )
    shutil.rmtree(SOURCE)
    print(f"Converted 86 images: {original_bytes:,} -> {converted_bytes:,} bytes "
          f"({100 * (1 - converted_bytes / original_bytes):.1f}% smaller)")

if __name__ == "__main__":
    main()
