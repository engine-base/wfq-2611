#!/usr/bin/env python3
"""K-780 の試験（決定ログ §153・D-153.1〜33）。行 ID は K780-DC-NNN（11_tickets/K-780.md の表と 1 対 1）。
段 10 の K-673・段 7 の K-382 と同じ形：決定ログの新しい節を、切る段の枝で書いた控え（07_functional/段6-F5/決定ログに足す行.md）から運ぶ。
見ること：§153 の表が D-153.1〜33 を順に 1 行ずつ持つ・どの行も「PM の決め」で高本さん・answer= を持たない・勧めで切った物は「代表に確認中」・
決定の検査（trace_gate の T3・T6・T8）・決める人の決定の行と答えの記録の結びつき（decision_source_gate）・この葉の decisions の被覆。K-731 の DC の 3 行を移した（PM の決め 2026-11-23：段 6 には決定ログだけを運ぶ葉が無く、始める時点の本線に §153 が無いと build_index の K4 が止まるため、段 5 の K-430・段 8 の K-601・段 10 の K-673 と同じ形で分けた）。テストはチケットを作る人が書き、実装する人は変えない"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DECISIONS = ROOT / "01_hearing" / "決定ログ_進行中.md"
SELF = ROOT / "11_tickets" / "K-780.md"
COUNT = 33
# 代表の答えが返って「高本さん・answer=」に直した行：番号 → (日付, 印)（2026-11-22 夜に答えがそろった。15 は答えの記録の無い代表の言葉＝REP_WORDS）
REP_ANSWERED: dict[int, tuple[str, str]] = {
    1: ("2026-11-22", "d19b3e65213a"), 2: ("2026-11-22", "7bf501c78e06"), 3: ("2026-11-22", "d9a08e0fb56f"),
    4: ("2026-11-22", "e3b81d3590e1"), 5: ("2026-11-22", "0d7c530e1344"), 6: ("2026-11-22", "6db0059f32ff"),
    7: ("2026-11-22", "0fa9ccaf6b20"), 8: ("2026-11-22", "7a5e388ceaf4"), 9: ("2026-11-22", "f65970586cdd"),
    10: ("2026-11-22", "4be39872256a"), 11: ("2026-11-22", "f493bd620f24"), 12: ("2026-11-22", "ec883ef22fb2"),
    13: ("2026-11-22", "0bbeefca6b65"), 14: ("2026-11-22", "cbd258bb993c"),
    16: ("2026-11-22", "bd8c684b9d3f"), 17: ("2026-11-22", "c3cceef74d52"), 24: ("2026-11-22", "c8c97228a730"),
    30: ("2026-11-22", "233748ad7f36"), 33: ("2026-11-22", "3781e90d23e0"),
}
# 代表の言葉（answer= がまだ無い行）：番号 → 行に書く字。高本さん・answer= は持たない。answer= が付いたら REP_ANSWERED へ移す（今は無い）
REP_WORDS: dict[int, str] = {15: "2026-11-22 19:50 代表の言葉"}
# 勧めで切った PM の決め（「代表に確認中」を持つ行）。それ以外の行は正本から導いた決めか作り方の決め
CONFIRMING: set[int] = set()  # 2026-11-22 夜に答えがそろい、確認中の行は無い
ANSWER = re.compile(r"answer=([0-9a-f]{12})")


def section_rows() -> tuple[dict[str, str], list[str]]:
    text = DECISIONS.read_text(encoding="utf-8")
    m = re.search(r"^## 153\.", text, re.M)
    if not m:
        raise AssertionError("決定ログに §153 が無い")
    rest = text[m.start() + 1 :]
    nxt = re.search(r"^## \d+\.", rest, re.M)
    body = text[m.start() :] if not nxt else text[m.start() : m.start() + 1 + nxt.start()]
    rows: dict[str, str] = {}
    order: list[str] = []
    for ln in body.splitlines():
        r = re.match(r"^\|\s*(D-153\.\d+)\s*\|", ln)
        if r:
            rows.setdefault(r.group(1), ln)
            order.append(r.group(1))
    return rows, order


class DecisionLogTest(unittest.TestCase):
    def test_K780_DC_001_section_rows(self) -> None:
        """§153 の表に D-153.1〜33 が順にちょうど 1 回ずつ（n 行目が D-153.n）在り、代表の決めの行（1〜14・16・17・24・30・33）は 2026-11-22 高本さん・answer=<印> を持ち、15 は「2026-11-22 19:50 代表の言葉」、ほかはどの行も「PM の決め」を持ち高本さん・answer= を持たない。「代表に確認中」の行は無い。決定ログに足す控えと字が同じ"""
        rows, order = section_rows()
        self.assertEqual(order, [f"D-153.{n}" for n in range(1, COUNT + 1)], "表の並び（trace_gate は表の何行目かで番号を数える）")
        bad: list[str] = []
        for n in range(1, COUNT + 1):
            ln = rows[f"D-153.{n}"]
            has_rep = "高本さん" in ln or ANSWER.search(ln) is not None
            if n in REP_ANSWERED:
                date, ans = REP_ANSWERED[n]
                if not ("高本さん" in ln and date in ln and f"answer={ans}" in ln):
                    bad.append(f"D-153.{n}：代表の決め（{date} 高本さん・answer={ans}）が無い")
                continue
            if n in REP_WORDS:
                if REP_WORDS[n] not in ln or has_rep or "PM の決め" in ln:
                    bad.append(f"D-153.{n}：「{REP_WORDS[n]}」を持ち、高本さん・answer=・「PM の決め」を持たない形でない")
                continue
            if "PM の決め" not in ln or has_rep:
                bad.append(f"D-153.{n}：PM の決めを持ち高本さん・answer= を持たない形でない")
            if n in CONFIRMING and "代表に確認中" not in ln:
                bad.append(f"D-153.{n}：勧めで切った物は「代表に確認中」と書く")
            if n not in CONFIRMING and "代表に確認中" in ln:
                bad.append(f"D-153.{n}：正本から導いた決め・作り方の決めに「代表に確認中」を付けない")
        self.assertEqual(bad, [])
        src = (ROOT / "07_functional" / "段6-F5" / "決定ログに足す行.md").read_text(encoding="utf-8")
        for ln in rows.values():
            self.assertIn(ln, src, "控えと字が違う行")

    def test_K780_DC_002_trace_gate(self) -> None:
        """決定の検査（trace_gate：T3 文が在る・T6 reflect_in・T8 文の被覆）が 0 で終わり、D-153 の赤が無い（作る段で tickets.json と要件一覧を作り直してから）"""
        p = subprocess.run([sys.executable, "scripts/ci/trace_gate.py"], cwd=ROOT, capture_output=True, text=True, timeout=300)
        out = p.stdout + p.stderr
        self.assertIsNone(re.search(r"\bT3\b[^\n]*D-153\.\d+|\bT8\b[^\n]*D-153\.\d+", out), out)
        self.assertEqual(p.returncode, 0, out)

    def test_K780_DC_003_self_decisions(self) -> None:
        """この葉の頭の decisions: に D-153.1〜33 が全部在る（T8 の導出物）"""
        head = SELF.read_text(encoding="utf-8").split("---")[1]
        m = re.search(r"^decisions:\s*\[(.*)\]$", head, re.M)
        dec = [x.strip() for x in (m.group(1) if m else "").split(",")]
        self.assertEqual([f"D-153.{n}" for n in range(1, COUNT + 1) if f"D-153.{n}" not in dec], [])

    def test_K780_DC_004_decision_source_gate(self) -> None:
        """K780-DC-004 決める人の決定の行（代表の決め 1〜14・16・17・24・30・33）の answer=<印> が、答えの記録 01_hearing/decider-answers.jsonl に在る（decision_source_gate が 0 で終わる）"""
        g = subprocess.run(
            [sys.executable, "scripts/ci/decision_source_gate.py", "--log", "01_hearing/決定ログ_進行中.md", "--answers", "01_hearing/decider-answers.jsonl", "--label", "高本さん", "--since", "D-130"],
            cwd=ROOT, capture_output=True, text=True, timeout=300,
        )
        self.assertEqual(g.returncode, 0, g.stdout + g.stderr)


if __name__ == "__main__":
    unittest.main()
