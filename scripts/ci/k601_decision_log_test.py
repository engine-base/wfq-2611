#!/usr/bin/env python3
"""K-601 の試験：段 8 の決定ログ §151（D-151.1〜20）。行 ID は K601-DC-NNN（11_tickets/K-601.md の表と 1 対 1）。
K-460 の DC の 2 行を移した（PM の決め 2026-11-20：切る段の持ち込みの作り手 build_index.py の K4 が、始める時点の本線に §151 が無いと止まるため、
決定ログを先に本線へ入れる葉を分けた。段 9 の K-425 と同じ形）。見ること：§151 の表が D-151.1〜20 を順に 1 行ずつ持つ・下ごしらえの文書と同じ集まり・
決定の検査（trace_gate の T3・T8）・決める人の決定の行と答えの記録の結びつき（G60）・この葉の decisions の被覆。
テストはチケットを作る人が書き、実装する人は変えない（D-128.125）"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DECISIONS = ROOT / "01_hearing" / "決定ログ_進行中.md"
DOC = ROOT / "07_functional" / "段8-F7" / "決定ログに足す行.md"
SELF = ROOT / "11_tickets" / "K-601.md"
COUNT = 20


def section_ids() -> list[str]:
    """§151 の「### 決めたこと」の表の行（ID の欄が D-151.n）を表の順に"""
    text = DECISIONS.read_text(encoding="utf-8")
    heads = list(re.finditer(r"^## 151\.[^\n]*$", text, re.M))
    if len(heads) != 1:
        raise AssertionError(f"決定ログの §151 が {len(heads)} 個（ちょうど 1 個のはず）")
    if "段 8" not in heads[0].group(0):
        raise AssertionError("§151 の題に「段 8」が無い")
    rest = text[heads[0].start() :]
    body = re.split(r"\n## \d+\.", rest[1:], maxsplit=1)[0]
    if not re.search(r"<!-- decision: D-151\s+status: confirmed", body):
        raise AssertionError("§151 に confirmed の decision の印が無い")
    return re.findall(r"^\|\s*(D-151\.\d+)\s*\|", body, re.M)


def run_py(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True, timeout=300)


class DecisionLogTest(unittest.TestCase):
    def test_K601_DC_001_section_rows(self) -> None:
        """K601-DC-001 §151（題に「段 8」）がちょうど 1 つ・confirmed の印・表に D-151.1〜20 が順にちょうど 1 回ずつ（n 行目が D-151.n）"""
        ids = section_ids()
        self.assertEqual(ids, [f"D-151.{n}" for n in range(1, COUNT + 1)], "表の並び（trace_gate は表の何行目かで番号を数える）")

    def test_K601_DC_002_same_as_doc(self) -> None:
        """K601-DC-002 『決定ログに足す行.md』の表の行の ID が、決定ログの §151 の行の ID と同じ集まり・同じ並び"""
        doc_ids = re.findall(r"^\|\s*(D-151\.\d+)\s*\|", DOC.read_text(encoding="utf-8"), re.M)
        self.assertEqual(doc_ids, section_ids())

    def test_K601_DC_003_trace_and_source_gates(self) -> None:
        """K601-DC-003 決定の検査（trace_gate：T3 文が在る・T6 reflect_in・T8 文の被覆）が 0 で終わり D-151 の赤が無い。決める人の決定の行は答えの記録と結びつく（decision_source_gate が 0）"""
        p = run_py("scripts/ci/trace_gate.py")
        out = p.stdout + p.stderr
        self.assertIsNone(re.search(r"\bT[0-9]\b[^\n]*D-151\.\d+", out), out)
        self.assertEqual(p.returncode, 0, out)
        g = run_py(
            "scripts/ci/decision_source_gate.py",
            "--log",
            "01_hearing/決定ログ_進行中.md",
            "--answers",
            "01_hearing/decider-answers.jsonl",
            "--label",
            "高本さん",
            "--since",
            "D-130",
        )
        self.assertEqual(g.returncode, 0, g.stdout + g.stderr)

    def test_K601_DC_004_self_decisions(self) -> None:
        """K601-DC-004 この葉の頭の decisions: に D-151.1〜20 が全部在る（文の被覆 T8 の導出物）"""
        head = SELF.read_text(encoding="utf-8").split("---")[1]
        m = re.search(r"^decisions:\s*\[(.*)\]$", head, re.M)
        dec = [x.strip() for x in (m.group(1) if m else "").split(",")]
        missing = [f"D-151.{n}" for n in range(1, COUNT + 1) if f"D-151.{n}" not in dec]
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
