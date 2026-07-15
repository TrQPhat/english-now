from __future__ import annotations

import argparse
import json
from pathlib import Path

import fitz
import numpy as np
from rapidocr import RapidOCR


def main() -> None:
    parser = argparse.ArgumentParser(description="OCR every page and retain layout boxes.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scale", type=float, default=1.8)
    args = parser.parse_args()

    engine = RapidOCR()
    pages = []
    with fitz.open(args.pdf) as document:
        for page_number, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(args.scale, args.scale),
                colorspace=fitz.csRGB,
                alpha=False,
            )
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height, pixmap.width, pixmap.n
            )
            output = engine(image)
            lines = []
            if output.txts is not None:
                for box, text, score in zip(
                    output.boxes, output.txts, output.scores, strict=True
                ):
                    lines.append(
                        {
                            "box": [[round(float(x), 2), round(float(y), 2)] for x, y in box],
                            "text": text,
                            "score": round(float(score), 4),
                        }
                    )
            pages.append(
                {
                    "page": page_number,
                    "width": pixmap.width,
                    "height": pixmap.height,
                    "lines": lines,
                }
            )
            print(f"{args.pdf.name}: {page_number}/{len(document)} ({len(lines)} lines)", flush=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"source": args.pdf.name, "pages": pages}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
