import argparse
from pathlib import Path

from PIL import Image


CROPS = {
    1: (3, (75, 70, 610, 620)),
    2: (3, (75, 625, 790, 1060)),
    3: (4, (80, 60, 825, 475)),
    4: (4, (80, 610, 825, 1060)),
    5: (5, (75, 60, 790, 475)),
    6: (5, (75, 610, 790, 1060)),
}


parser = argparse.ArgumentParser()
parser.add_argument("test_id", nargs="?", default="test-01")
args = parser.parse_args()

output = Path(f"public/assets/{args.test_id}/questions")
output.mkdir(parents=True, exist_ok=True)
for number, (page, box) in CROPS.items():
    with Image.open(f"public/assets/{args.test_id}/page-{page:02}.webp") as image:
        image.crop(box).save(output / f"question-{number:02}.webp", "WEBP", quality=90)
    print(f"question {number}")
