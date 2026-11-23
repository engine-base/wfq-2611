#!/usr/bin/env python3
"""K-673 の試験（決定ログ §152・D-152.1〜37）。行 ID は K673-DC-NNN（11_tickets/K-673.md の表と 1 対 1）。
段 9 の K-425・段 5 の K-430 と同じ形：決定ログの新しい節を、切る段の枝で書いたまま運ぶ。
見ること：§152 の表が D-152.1〜37 を順に 1 行ずつ持つ・代表の決め（1〜8 は答えの記録つき・9〜13 は代表の言葉）と PM の決め（14〜）を分けて見る・
決定の検査（trace_gate の T3・T6・T8）・この葉の decisions の被覆。テストはチケットを作る人が書き、実装する人は変えない"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DECISIONS = ROOT / "01_hearing" / "決定ログ_進行中.md"
SELF = ROOT / "11_tickets" / "K-673.md"
COUNT = 37
# 代表の決めの行：番号 → (行の日付, answer の印)。決め 1〜8 は問い合わせの答えの記録つき
REP_ANSWER = {
    1: ("2026-11-21", "6d11a514116f"),
    2: ("2026-11-21", "bc3c857621bc"),
    3: ("2026-11-21", "bc3c857621bc"),
    4: ("2026-11-21", "bc3c857621bc"),
    5: ("2026-11-21", "836b911fcf82"),
    6: ("2026-11-21", "233756b2891a"),
    7: ("2026-11-21", "e053d5507686"),
    8: ("2026-11-22", "08a63df0368c"),
}
REP_WORD_ONLY = set(range(9, 14))  # 決め 9〜13：代表の言葉 2026-11-22（答えの記録の番号は後で付く。高本さん・answer= を書かない）
PM_FIRM = set(range(14, 23))  # 14〜22：正本から導いた PM の決め（23〜37 は勧めで切り、代表の言葉 2026-11-22 18:55 で確定）
ANSWER = re.compile(r"answer=([0-9a-f]{12})")


def section_rows() -> tuple[dict[str, str], list[str]]:
    text = DECISIONS.read_text(encoding="utf-8")
    m = re.search(r"^## 152\.", text, re.M)
    if not m:
        raise AssertionError("決定ログに §152 が無い")
    rest = text[m.start() + 1 :]
    nxt = re.search(r"^## \d+\.", rest, re.M)
    body = text[m.start() :] if not nxt else text[m.start() : m.start() + 1 + nxt.start()]
    rows: dict[str, str] = {}
    order: list[str] = []
    for ln in body.splitlines():
        r = re.match(r"^\|\s*(D-152\.\d+)\s*\|", ln)
        if r:
            rows.setdefault(r.group(1), ln)
            order.append(r.group(1))
    return rows, order


class DecisionLogTest(unittest.TestCase):
    def test_K673_DC_001_section_rows(self) -> None:
        """§152 の表に D-152.1〜37 が順にちょうど 1 回ずつ（n 行目が D-152.n）在り、代表の決め（1〜8 は日付と answer=<12 桁> つきの高本さん・9〜13 は「代表の言葉 2026-11-22」で高本さん・answer= なし）と PM の決め（14〜 は「PM の決め」・高本さん・answer= なし。23〜37 は「代表の言葉 2026-11-22 18:55」（勧めのまま確定）も持つ）を分けて見る"""
        rows, order = section_rows()
        self.assertEqual(order, [f"D-152.{n}" for n in range(1, COUNT + 1)], "表の並び（trace_gate は表の何行目かで番号を数える）")
        bad: list[str] = []
        for n in range(1, COUNT + 1):
            ln = rows[f"D-152.{n}"]
            has_rep = "高本さん" in ln or ANSWER.search(ln) is not None
            if n in REP_ANSWER:
                date, ans = REP_ANSWER[n]
                if not ("高本さん" in ln and date in ln and f"answer={ans}" in ln):
                    bad.append(f"D-152.{n}：代表の決め（{date} 高本さん・answer={ans}）が無い")
            elif n in REP_WORD_ONLY:
                if "代表の言葉 2026-11-22" not in ln or has_rep:
                    bad.append(f"D-152.{n}：「代表の言葉 2026-11-22」を持ち高本さん・answer= を持たない形でない")
            else:
                if "PM の決め" not in ln or has_rep:
                    bad.append(f"D-152.{n}：PM の決めを持ち高本さん・answer= を持たない形でない")
                if n not in PM_FIRM and "代表の言葉 2026-11-22 18:55" not in ln:
                    bad.append(f"D-152.{n}：勧めで切った物は「代表の言葉 2026-11-22 18:55」（勧めのまま確定）と書く")
        self.assertEqual(bad, [])

    def test_K673_DC_002_trace_gate(self) -> None:
        """決定の検査（trace_gate：T3 文が在る・T6 reflect_in・T8 文の被覆）が 0 で終わり、D-152 の赤が無い（作る段で tickets.json と要件一覧を作り直してから）"""
        p = subprocess.run([sys.executable, "scripts/ci/trace_gate.py"], cwd=ROOT, capture_output=True, text=True, timeout=300)
        out = p.stdout + p.stderr
        self.assertIsNone(re.search(r"\bT3\b[^\n]*D-152\.\d+|\bT8\b[^\n]*D-152\.\d+", out), out)
        self.assertEqual(p.returncode, 0, out)

    def test_K673_DC_003_self_decisions(self) -> None:
        """この葉の頭の decisions: に D-152.1〜37 が全部在る（T8 の導出物）"""
        head = SELF.read_text(encoding="utf-8").split("---")[1]
        m = re.search(r"^decisions:\s*\[(.*)\]$", head, re.M)
        dec = [x.strip() for x in (m.group(1) if m else "").split(",")]
        self.assertEqual([f"D-152.{n}" for n in range(1, COUNT + 1) if f"D-152.{n}" not in dec], [])

    def test_K673_DC_004_answers_and_gate(self) -> None:
        """答えの記録に決め 1〜8 の 6 つの印が在り、決める人の決定の検査（decision_source_gate・label 高本さん・since D-130）が 0 で終わる"""
        answers = (ROOT / "01_hearing" / "decider-answers.jsonl").read_text(encoding="utf-8")
        missing = [a for a in sorted({v[1] for v in REP_ANSWER.values()}) if f'"id": "{a}"' not in answers]
        self.assertEqual(missing, [], "答えの記録に無い印")
        p = subprocess.run(
            [sys.executable, "scripts/ci/decision_source_gate.py", "--log", str(DECISIONS), "--answers",
             str(ROOT / "01_hearing" / "decider-answers.jsonl"), "--label", "高本さん", "--since", "D-130"],
            cwd=ROOT, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main()
