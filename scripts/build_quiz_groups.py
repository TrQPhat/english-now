from __future__ import annotations

import json
import re
from pathlib import Path


TEST_IDS = ("test-01", "test-02", "test-03")
GROUP_RANGES = {
    3: [(start, start + 2) for start in range(32, 71, 3)],
    4: [(start, start + 2) for start in range(71, 101, 3)],
    6: [(131, 134), (135, 138), (139, 142), (143, 146)],
    7: [
        (147, 148), (149, 150), (151, 152),
        (153, 155), (156, 158), (159, 161), (162, 164), (165, 167),
        (168, 171), (172, 175),
        (176, 180), (181, 185), (186, 190), (191, 195), (196, 200),
    ],
}
MARKER_RE = re.compile(r"^\s*\[.*-.*\]\s*$")
SKIP_RE = re.compile(r"^(PART [34]|p\.\d+|\d+)$", re.IGNORECASE)


def position(line: dict) -> tuple[float, float]:
    return min(point[0] for point in line["box"]), min(point[1] for point in line["box"])


def transcript_stream(ocr: dict) -> list[str]:
    stream = []
    for page in ocr["pages"]:
        columns = [[], []]
        for line in page["lines"]:
            x, y = position(line)
            columns[0 if x < page["width"] * 0.48 else 1].append((y, x, line["text"].strip()))
        for column in columns:
            stream.extend(text for _, _, text in sorted(column) if text)
    return stream


def extract_transcripts(ocr: dict) -> dict[tuple[int, int], str]:
    ranges = GROUP_RANGES[3] + GROUP_RANGES[4]
    transcripts: dict[tuple[int, int], list[str]] = {item: [] for item in ranges}
    current = -1
    for text in transcript_stream(ocr):
        if MARKER_RE.match(text):
            current += 1
            if current >= len(ranges):
                break
            continue
        if current < 0 or current >= len(ranges) or SKIP_RE.match(text):
            continue
        if "Answer Key" in text or "Actual Test" in text:
            continue
        transcripts[ranges[current]].append(text)
    return {key: "\n".join(lines).strip() for key, lines in transcripts.items()}


def group_type(part: int) -> str:
    return {
        1: "photo",
        2: "response",
        3: "conversation",
        4: "talk",
        5: "sentence",
        6: "passage",
        7: "reading-set",
    }[part]


def main() -> None:
    groups = []
    for test_id in TEST_IDS:
        suffix = test_id[-2:]
        structured = json.loads(Path(f"data/{test_id}-structured.json").read_text(encoding="utf-8"))
        result_ocr = json.loads(Path(f".work/ocr/result-{suffix}.json").read_text(encoding="utf-8"))
        questions = {item["number"]: item for item in structured["questions"]}
        transcripts = extract_transcripts(result_ocr)

        ranges_by_part = {
            1: [(number, number) for number in range(1, 7)],
            2: [(number, number) for number in range(7, 32)],
            3: GROUP_RANGES[3],
            4: GROUP_RANGES[4],
            5: [(number, number) for number in range(101, 131)],
            6: GROUP_RANGES[6],
            7: GROUP_RANGES[7],
        }
        for part, ranges in ranges_by_part.items():
            for start, end in ranges:
                members = [questions[number] for number in range(start, end + 1)]
                context_pages = sorted({page for item in members for page in item["contextPages"]})
                groups.append(
                    {
                        "id": f"{test_id}-part-{part}-{start}-{end}",
                        "testId": test_id,
                        "part": part,
                        "type": group_type(part),
                        "sourceRange": {"from": start, "to": end},
                        "questionNumbers": list(range(start, end + 1)),
                        "contextPages": context_pages,
                        "transcript": transcripts.get((start, end), ""),
                    }
                )

    Path("data/quiz-groups.json").write_text(
        json.dumps({"version": 1, "groups": groups}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"groups={len(groups)} questions={sum(len(group['questionNumbers']) for group in groups)}")
    for part in range(1, 8):
        selected = [group for group in groups if group["part"] == part]
        print(f"part={part} groups={len(selected)} questions={sum(len(group['questionNumbers']) for group in selected)}")
    missing = [group["id"] for group in groups if group["part"] in (3, 4) and not group["transcript"]]
    if missing:
        raise RuntimeError(f"Missing transcripts: {missing}")


if __name__ == "__main__":
    main()
