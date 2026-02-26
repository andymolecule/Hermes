import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

INPUT_DIR = Path("/input")
OUTPUT_DIR = Path("/output")
GROUND_TRUTH_PATH = INPUT_DIR / "ground_truth.csv"
SUBMISSION_PATH = INPUT_DIR / "submission.csv"
OUTPUT_PATH = OUTPUT_DIR / "score.json"


def fail(message: str) -> None:
    raise SystemExit(message)


def deterministic_json_write(payload: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    OUTPUT_PATH.write_text(serialized, encoding="utf-8")


def main() -> None:
    tolerance = float(os.getenv("HERMES_TOLERANCE", "0.001"))

    if not GROUND_TRUTH_PATH.exists():
        fail("Missing required file: /input/ground_truth.csv")
    if not SUBMISSION_PATH.exists():
        fail("Missing required file: /input/submission.csv")

    truth = pd.read_csv(GROUND_TRUTH_PATH)
    submission = pd.read_csv(SUBMISSION_PATH)

    missing_columns = [column for column in truth.columns if column not in submission.columns]
    if missing_columns:
        fail(f"Submission missing required columns: {','.join(missing_columns)}")

    submission = submission[truth.columns]

    total_rows = len(truth)
    comparable_rows = min(len(truth), len(submission))

    if comparable_rows == 0 and total_rows == 0:
        payload = {
            "details": {
                "comparable_rows": 0,
                "mismatched_row_penalty": 0,
                "tolerance": tolerance,
            },
            "matched_rows": 0,
            "score": 1.0,
            "total_rows": 0,
        }
        deterministic_json_write(payload)
        return

    matched_rows = 0

    for row_index in range(comparable_rows):
        truth_row = truth.iloc[row_index]
        submission_row = submission.iloc[row_index]
        row_matches = True
        for column in truth.columns:
            truth_value = truth_row[column]
            submission_value = submission_row[column]
            if pd.isna(truth_value) and pd.isna(submission_value):
                continue
            if pd.api.types.is_numeric_dtype(truth[column]) and pd.api.types.is_numeric_dtype(
                submission[column]
            ):
                if not np.isclose(float(truth_value), float(submission_value), atol=tolerance, rtol=0.0):
                    row_matches = False
                    break
            else:
                if str(truth_value) != str(submission_value):
                    row_matches = False
                    break
        if row_matches:
            matched_rows += 1

    mismatched_row_penalty = abs(len(truth) - len(submission))
    denominator = total_rows if total_rows > 0 else max(len(submission), 1)
    score = max(matched_rows - mismatched_row_penalty, 0) / denominator

    payload = {
        "details": {
            "comparable_rows": comparable_rows,
            "mismatched_row_penalty": mismatched_row_penalty,
            "tolerance": tolerance,
        },
        "matched_rows": matched_rows,
        "score": float(round(score, 12)),
        "total_rows": int(total_rows),
    }

    deterministic_json_write(payload)


if __name__ == "__main__":
    main()
