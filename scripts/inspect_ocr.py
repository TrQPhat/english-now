from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ocr", type=Path)
    args = parser.parse_args()
    data = json.loads(args.ocr.read_text(encoding="utf-8"))
    pattern = re.compile(r"^\s*(\d{1,3})[.。]\s")
    for page in data["pages"]:
        numbers = []
        for line in page["lines"]:
            match = pattern.match(line["text"])
            if match and 1 <= int(match.group(1)) <= 200:
                numbers.append(int(match.group(1)))
        print(f"{page['page']:02}: {numbers}")


if __name__ == "__main__":
    main()
