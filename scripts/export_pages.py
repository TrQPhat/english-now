from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a scanned test PDF for the web.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scale", type=float, default=1.6)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    with fitz.open(args.pdf) as document:
        width = len(str(len(document)))
        for index, page in enumerate(document, start=1):
            target = args.output / f"page-{index:0{width}d}.webp"
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(args.scale, args.scale),
                colorspace=fitz.csRGB,
                alpha=False,
            )
            pixmap.pil_save(target, format="WEBP", quality=86, method=4)
            print(target)


if __name__ == "__main__":
    main()

