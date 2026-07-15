from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


QUESTION_RE = re.compile(r"^\s*(\d{1,3})(?:[.。]|\s)\s*(.*)$")
CHOICE_RE = re.compile(r"^\s*[\(\[]([A-D])[\)\]]\s*(.*)$")


def part_for(number: int) -> int:
    for part, start, end in (
        (1, 1, 6), (2, 7, 31), (3, 32, 70), (4, 71, 100),
        (5, 101, 130), (6, 131, 146), (7, 147, 200),
    ):
        if start <= number <= end:
            return part
    raise ValueError(number)


def answer_map(quiz: dict) -> dict[int, str]:
    answers = {}
    for part in quiz["parts"]:
        compact = part["answers"].replace(" ", "")
        for offset, answer in enumerate(compact):
            answers[part["from"] + offset] = answer
    return answers


def line_position(line: dict) -> tuple[float, float]:
    box = line["box"]
    return min(point[0] for point in box), min(point[1] for point in box)


def parse_candidate(lines: list[dict], number: int, page: int) -> dict:
    first = QUESTION_RE.match(lines[0]["text"])
    first_text = first.group(2).strip() if first else ""
    first_choice = CHOICE_RE.match(first_text)
    question_lines = [] if first_choice else ([first_text] if first_text else [])
    choices: dict[str, str] = {}
    active_choice = first_choice.group(1) if first_choice else None
    if first_choice:
        choices[active_choice] = first_choice.group(2).strip()
    for line in lines[1:]:
        text = line["text"].strip()
        choice = CHOICE_RE.match(text)
        if choice:
            active_choice = choice.group(1)
            choices[active_choice] = choice.group(2).strip()
        elif active_choice:
            choices[active_choice] = f"{choices[active_choice]} {text}".strip()
        elif text:
            question_lines.append(text)
    footer = re.compile(
        r"(?:GO ON TO THE NEXT PAGE.*|\d*\s*Actual Test \d+\s*\d*)$",
        re.IGNORECASE,
    )
    question_text = footer.sub("", " ".join(question_lines)).strip()
    choices = {letter: footer.sub("", text).strip() for letter, text in choices.items()}
    return {
        "number": number,
        "sourcePage": page,
        "text": question_text,
        "choices": choices,
    }


def candidates_from_page(page: dict) -> list[dict]:
    width = page["width"]
    columns = [[], []]
    for line in page["lines"]:
        x, y = line_position(line)
        # The scan uses two narrow columns whose right column starts around 49%
        # of the page. The whitespace gutter itself is near 42%.
        columns[0 if x < width * 0.42 else 1].append((y, x, line))

    candidates = []
    for column in columns:
        ordered = [item[2] for item in sorted(column)]
        starts = [index for index, line in enumerate(ordered) if QUESTION_RE.match(line["text"])]
        for offset, start in enumerate(starts):
            end = starts[offset + 1] if offset + 1 < len(starts) else len(ordered)
            match = QUESTION_RE.match(ordered[start]["text"])
            number = int(match.group(1))
            if 1 <= number <= 200:
                candidates.append(parse_candidate(ordered[start:end], number, page["page"]))
    return candidates


def page_fallback(number: int, detected: dict[int, int]) -> int:
    if number <= 6:
        return 3 + (number - 1) // 2
    nearest = min(detected, key=lambda item: abs(item - number))
    return detected[nearest]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ocr", type=Path)
    parser.add_argument("quiz", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--result-ocr", type=Path)
    parser.add_argument("--overrides", type=Path)
    args = parser.parse_args()

    ocr = json.loads(args.ocr.read_text(encoding="utf-8"))
    quiz = json.loads(args.quiz.read_text(encoding="utf-8"))
    answers = answer_map(quiz)
    by_number: dict[int, list[dict]] = {}
    for page in ocr["pages"]:
        for candidate in candidates_from_page(page):
            by_number.setdefault(candidate["number"], []).append(candidate)

    best = {}
    for number, candidates in by_number.items():
        best[number] = max(
            candidates,
            key=lambda item: (len(item["choices"]), len(item["text"])),
        )

    if args.result_ocr:
        result_ocr = json.loads(args.result_ocr.read_text(encoding="utf-8"))
        result_candidates: dict[int, list[dict]] = {}
        for page in result_ocr["pages"]:
            for candidate in candidates_from_page(page):
                if 7 <= candidate["number"] <= 31:
                    result_candidates.setdefault(candidate["number"], []).append(candidate)
        for number, candidates in result_candidates.items():
            scripted = max(candidates, key=lambda item: (len(item["choices"]), len(item["text"])))
            if len(scripted["choices"]) == 3:
                best[number] = scripted
    detected_pages = {number: item["sourcePage"] for number, item in best.items()}

    questions = []
    for number in range(1, 201):
        parsed = best.get(
            number,
            {"number": number, "sourcePage": page_fallback(number, detected_pages), "text": "", "choices": {}},
        )
        parsed.update(
            {
                "part": part_for(number),
                "correctAnswer": answers[number],
                "contextPages": [parsed["sourcePage"]],
            }
        )
        if number >= 176:
            previous_page = parsed["sourcePage"] - 1
            questions_on_previous_page = {
                item for item, page_number in detected_pages.items() if page_number == previous_page
            }
            if previous_page > 0 and not questions_on_previous_page:
                parsed["contextPages"] = [previous_page, parsed["sourcePage"]]
        if 131 <= number <= 146 and not parsed["text"]:
            parsed["text"] = f"Choose the best option for blank {number}."
        questions.append(parsed)

    if args.overrides:
        overrides = json.loads(args.overrides.read_text(encoding="utf-8"))
        for raw_number, fields in overrides.items():
            questions[int(raw_number) - 1].update(fields)

    result = {
        "id": quiz["id"],
        "title": quiz["title"],
        "sourcePdf": quiz["sourcePdf"],
        "answerSourcePdf": quiz["answerSourcePdf"],
        "pagePattern": quiz["pagePattern"],
        "questions": questions,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    expected_choices = lambda n: 3 if 7 <= n <= 31 else 4
    incomplete = [
        question["number"] for question in questions
        if not question["text"] or len(question["choices"]) != expected_choices(question["number"])
    ]
    print(f"questions={len(questions)} incomplete={len(incomplete)}")
    print(incomplete)


if __name__ == "__main__":
    main()
