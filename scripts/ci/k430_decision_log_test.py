#!/usr/bin/env python3
"""K-430 の試験：段 5 の決定ログ §150（D-150.1〜61）。行 ID は K430-DC-NNN（11_tickets/K-430.md の表と 1 対 1）。
段 9 の K-425 と同じ形（切る段の持ち込みの作り手 build_index.py の K4 が、始める時点の本線に §150 が無いと止まるため、決定ログを先に本線へ入れる葉を分けた）。
見ること：§150 の表が D-150.1〜59 を順に 1 行ずつ持ち、代表の決めの行（35〜45）と PM の決めの行（それ以外）を分けて見る・
決定の検査（trace_gate の T3・T8）・この葉の decisions の被覆。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DECISIONS = ROOT / "01_hearing" / "決定ログ_進行中.md"
SELF = ROOT / "11_tickets" / "K-430.md"
COUNT = 61  # D-150.61（本文の道具・2026-11-22 の代表の言葉）は K-584 が運ぶ。K-430 自身の decisions は 1〜60（COUNT_K430）
COUNT_K430 = 60
SELF_584 = ROOT / "11_tickets" / "K-584.md"
IMPROVED = {2, 3, 5, 8, 10, 12, 14, 15}  # 2026-11-21 に「改めた」に書き換えた行（番号は残す）
IMPROVED_1122 = {11: 60, 54: 60, 48: 61}  # 2026-11-22 に改めた行（番号 → 改めた先）：11・54 は D-150.60（業務の型を物として無くす）・48 は D-150.61（本文の道具）
REP_1122 = {60}  # 2026-11-22 の代表の決め（answer=08a63df0368c）
REP_ANSWER = set(range(35, 46))  # 代表の決め：高本さん ＋ answer=<印> を持つ行（決め 10〜13 の行は answer=bc3c857621bc・2026-11-21 に 7 つまとめて確かめた）
REP_WORD_ONLY = {61: "2026-11-22"}  # 印（answer=）の無い代表の言葉だけの行（番号 → 言葉の日付）。D-150.61：答えの記録の番号は後で付く
ANSWER = re.compile(r"answer=([0-9a-f]{12})")


def section_rows() -> tuple[dict[str, list[str]], list[str]]:
    """§150 の「### 決めたこと」の表の行（ID の欄が D-150.n）を表の順に"""
    text = DECISIONS.read_text(encoding="utf-8")
    m = re.search(r"^## 150\.", text, re.M)
    if not m:
        raise AssertionError("決定ログに §150 が無い")
    rest = text[m.start() + 1 :]
    nxt = re.search(r"^## \d+\.", rest, re.M)
    body = text[m.start() :] if not nxt else text[m.start() : m.start() + 1 + nxt.start()]
    rows: dict[str, list[str]] = {}
    order: list[str] = []
    for ln in body.splitlines():
        r = re.match(r"^\|\s*(D-150\.\d+)\s*\|", ln)
        if r:
            rows.setdefault(r.group(1), []).append(ln)
            order.append(r.group(1))
    return rows, order


def run_py(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True, timeout=300)


class DecisionLogTest(unittest.TestCase):
    def test_K430_DC_001_section_rows(self) -> None:
        """§150 の表に D-150.1〜59 が順にちょうど 1 回ずつ（n 行目が D-150.n）在り、代表の決めの行（35〜45）と PM の決めの行（それ以外）を分けて見る：PM の決めの行は「PM の決め」（改めた行は「改めた（2026-11-21 → D-150.」）を持って高本さん・answer= を持たず、代表の決めの行は answer=<12 桁> つき（高本さんと一緒）か「代表の言葉 2026-11-21」（高本さん・answer= なし）のどちらか"""
        rows, order = section_rows()
        want = [f"D-150.{n}" for n in range(1, COUNT + 1)]
        self.assertEqual(order, want, "§150 の表の並び（trace_gate は表の何行目かで番号を数える）")
        bad = []
        for n in range(1, COUNT + 1):
            ln = rows[f"D-150.{n}"][0]
            has_rep = "高本さん" in ln or ANSWER.search(ln) is not None
            if n in IMPROVED_1122:
                to = IMPROVED_1122[n]
                if f"改めた（2026-11-22 → D-150.{to}）" not in ln:
                    bad.append(f"D-150.{n}：「改めた（2026-11-22 → D-150.{to}）」が無い")
            elif n in REP_1122:
                if not ("高本さん" in ln and "2026-11-22" in ln and "answer=08a63df0368c" in ln):
                    bad.append(f"D-150.{n}：代表の決め（2026-11-22 高本さん・answer=08a63df0368c）が無い")
            elif n in IMPROVED:
                if "改めた（2026-11-21 → D-150." not in ln:
                    bad.append(f"D-150.{n}：「改めた（2026-11-21 → D-150.」が無い")
            elif n in REP_ANSWER:
                if not ("高本さん" in ln and "2026-11-21" in ln and ANSWER.search(ln)):
                    bad.append(f"D-150.{n}：代表の決め（2026-11-21 高本さん・answer=<12 桁>）が無い")
            elif n in REP_WORD_ONLY:
                said = f"代表の言葉 {REP_WORD_ONLY[n]}"
                if said not in ln or has_rep:
                    bad.append(f"D-150.{n}：「{said}」を持ち高本さん・answer= を持たない形でない")
            elif "PM の決め" not in ln:
                bad.append(f"D-150.{n}：PM の決めが無い")
            if (n not in REP_ANSWER) and (n not in REP_WORD_ONLY) and has_rep and n not in IMPROVED and n not in IMPROVED_1122 and n not in REP_1122:
                bad.append(f"D-150.{n}：PM の決めの行に高本さん・answer= を書かない")
            if 46 <= n <= 59 and n not in IMPROVED_1122 and "2026-11-21" not in ln:
                bad.append(f"D-150.{n}：日付 2026-11-21 が無い")
            if "PM の判断" in ln and "高本さん" in ln:
                bad.append(f"D-150.{n}：PM の判断と高本さんを 1 つの行に混ぜない")
        self.assertEqual(bad, [])

    def test_K430_DC_002_trace_gate(self) -> None:
        """決定の検査（trace_gate：T3 文が在る・T6 reflect_in・T8 文の被覆）が 0 で終わり、D-150 の赤が無い"""
        p = run_py("scripts/ci/trace_gate.py")
        out = p.stdout + p.stderr
        self.assertIsNone(re.search(r"\bT3\b[^\n]*D-150\.\d+|\bT8\b[^\n]*D-150\.\d+", out), out)
        self.assertEqual(p.returncode, 0, out)

    def test_K430_DC_003_self_decisions(self) -> None:
        """この葉の頭の decisions: に D-150.1〜60 が全部在り、D-150.61 は K-584 の decisions: に在る（文の被覆 T8 の導出物）"""
        head = SELF.read_text(encoding="utf-8").split("---")[1]
        m = re.search(r"^decisions:\s*\[(.*)\]$", head, re.M)
        dec = [x.strip() for x in (m.group(1) if m else "").split(",")]
        missing = [f"D-150.{n}" for n in range(1, COUNT_K430 + 1) if f"D-150.{n}" not in dec]
        self.assertEqual(missing, [])
        head584 = SELF_584.read_text(encoding="utf-8").split("---")[1]
        m584 = re.search(r"^decisions:\s*\[(.*)\]$", head584, re.M)
        dec584 = [x.strip() for x in (m584.group(1) if m584 else "").split(",")]
        self.assertIn(f"D-150.{COUNT}", dec584, "D-150.61 を運ぶのは K-584")


if __name__ == "__main__":
    unittest.main()
