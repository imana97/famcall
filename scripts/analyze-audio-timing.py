"""Read private lab evidence and report timing counters; never grants a speech pass."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "e2e/audio"))
from timing import playout_timing

parser = argparse.ArgumentParser()
parser.add_argument("reports", type=Path, nargs="+")
parser.add_argument("--metrics", type=Path, default=ROOT / ".local/audio-lab/metrics.jsonl")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
entries = [json.loads(line) for line in args.metrics.read_text().splitlines() if line.strip()]
summaries = []
for path in args.reports:
    report = json.loads(path.read_text())
    selected = [row for row in entries if row.get("callId") in report["callIds"] and
                report["startedAt"] <= row.get("receivedAt", 0) <= report["finishedAt"]]
    summaries.append({"report": str(path), "reportSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                      "measurementValid": report["measurementValid"], "buffered": report["buffered"],
                      "speechRecovery": report.get("speechRecovery"), "windows": playout_timing(selected, report),
                      "selectedMetrics": selected})
result = {"scope": "Diagnostic timing counters; not a speech or release pass. Windows exclude partial intervals at phase boundaries.",
          "sourceSha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                           for path in (Path(__file__).resolve(), ROOT / "e2e/audio/timing.py")},
          "reports": summaries}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2) + "\n")
print("Saved private timing diagnostics for", len(summaries), "measurements to", args.output)
