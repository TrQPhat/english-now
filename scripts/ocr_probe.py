from __future__ import annotations

import argparse
from pathlib import Path

import fitz
import numpy as np
from rapidocr import RapidOCR


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OCR selected PDF pages for quality checks.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("pages", nargs="+", type=int, help="One-based page numbers")
    parser.add_argument("--scale", type=float, default=2.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    engine = RapidOCR()

    with fitz.open(args.pdf) as document:
        for page_number in args.pages:
            if not 1 <= page_number <= len(document):
                raise ValueError(f"Page {page_number} is outside 1..{len(document)}")

            page = document[page_number - 1]
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(args.scale, args.scale),
                colorspace=fitz.csRGB,
                alpha=False,
            )
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height, pixmap.width, pixmap.n
            )
            output = engine(image)

            print(f"\n===== {args.pdf.name} / page {page_number} =====")
            if output.txts is None:
                print("[NO TEXT]")
                continue

            for text, score in zip(output.txts, output.scores, strict=True):
                print(f"{score:.3f}\t{text}")


if __name__ == "__main__":
    main()
