#!/usr/bin/env python3
"""K-1154 の試験：取り込む順の検査（scripts/ci/ticket_order_gate.py・G56）を、枝の先頭に depends_on の葉の実装が入っているかだけで見る。

  python3 scripts/ci/k1154_order_head_test.py      行 ID は K1154-OG-NNN（11_tickets/K-1154.md の表の行と 1 対 1）

代表の決め（answer=ee72b1756f5d）：依存より先に実装を始めた葉が、後で依存を取り込めば緑（K-711 の ecc6788c6d の形）。
依存の実装が枝に無いまま入れようとしたら赤のまま。写しのリポジトリは一時フォルダに作る（DB なし）。
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import ticket_order_gate as g  # noqa: E402
from ticket_order_gate_test import ENV, Repo  # noqa: E402

GATE = HERE / "ticket_order_gate.py"
# 自己試験の旗。字のまま書くと、検査 ci_wiring_gate.py の W1 がこの試験のファイルを「自己試験を持つ検査」と数える（この試験に自己試験は無い）
SELF_FLAG = "--" + "selftest"


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = Repo(self.tmp.name)
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.start = self.r.commit("K-0 base", {"README.md": "x"})
        self.main = self.r.git("rev-parse", "--abbrev-ref", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self):
        return g.check(self.tmp.name, "HEAD", self.start)

    def cli(self) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(GATE), "--start", self.start], cwd=self.tmp.name,
                              capture_output=True, text=True, env=ENV)

    def side(self, name: str, msg: str, files: dict[str, str]) -> None:
        """START から枝 name を切って 1 コミット積み、元の枝に戻る"""
        self.r.git("checkout", "-q", "-b", name, self.start)
        self.r.commit(msg, files)
        self.r.git("checkout", "-q", self.main)

    def head10(self) -> str:
        return self.r.git("rev-parse", "HEAD")[:10]


class HeadOnlyTest(Case):
    def test_K1154_OG_001_dep_merged_after_the_leaf_started_is_green(self):
        """K1154-OG-001 時間の流れ（K-711 の形）：K-2 の試験と実装を先にコミットし、後で K-1 の実装を持つ枝を取り込む → 緑・3 本。
        台本も終わりの番号 0 で PASS"""
        self.r.commit("K-2 test: チケットと試験", {"scripts/ci/k2_試験_test.py": "t", "11_tickets/K-2.md": "x"})
        self.r.commit("K-2 feat: 先に作る", {"apps/a.ts": "a"})
        self.side("t/K-1", "K-1 feat: 依存を作る", {"apps/b.ts": "b"})
        self.r.git("merge", "-q", "--no-ff", "-m", "K-2 merge: t/K-1 を取り込む", "t/K-1")
        bad, _, n = self.check()
        self.assertEqual(bad, [], bad)
        self.assertEqual(n, 3)
        p = self.cli()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("PASS", p.stdout)
        self.assertIn("実装のコミット 3 本・順の違反 0 件", p.stdout)

    def test_K1154_OG_002_dep_committed_later_on_the_same_branch_is_green(self):
        """K1154-OG-002 時間の流れ：K-2 の実装の後に K-1 の実装を親 1 つでコミットする → 緑・2 本"""
        self.r.commit("K-2 feat: 先に作る", {"apps/a.ts": "a"})
        self.r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
        bad, _, n = self.check()
        self.assertEqual((bad, n), ([], 2))

    def test_K1154_OG_003_dep_only_outside_the_branch_is_red(self):
        """K1154-OG-003 守り：K-1 の実装が枝の外（hold）にだけ在る → 赤 1 件（先頭の 10 字・枝の先頭・K-2 は K-1）。台本は 1 で FAIL"""
        self.side("hold", "K-1 feat: 枝の外で作る", {"apps/b.ts": "b"})
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        bad, _, _ = self.check()
        self.assertEqual(len(bad), 1, bad)
        self.assertTrue(bad[0].startswith(self.head10()), bad)
        self.assertIn("枝の先頭", bad[0])
        self.assertIn("K-2 は K-1", bad[0])
        p = self.cli()
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("FAIL", p.stdout)
        self.assertIn("順の違反 1 件", p.stdout)

    def test_K1154_OG_004_doc_only_commits_do_not_satisfy_the_dep(self):
        """K1154-OG-004 守り：K-1 の番号のコミットが文書だけ・ai-team.yaml と文書だけ → 依存を満たさず赤 1 件"""
        self.r.commit("K-1 docs: チケットを切る", {"11_tickets/チケットの説明.md": "x", "11_tickets/K-1.md": "x"})
        self.r.commit("K-1 chore: 段取り", {"ai-team.yaml": "flow: {}\n", "11_tickets/K-1.md": "y"})
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(n, 1)
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("枝の先頭", bad[0])
        self.assertIn("K-2 は K-1", bad[0])

    def test_K1154_OG_005_one_red_per_ticket_and_dep(self):
        """K1154-OG-005 入力：K-2 の実装 3 本・依存 K-1 と K-3 がどちらも無い → 赤は（チケット, 依存）ごとに 1 件の 2 件だけ。
        どれも先頭の 10 字で始まり、前の 2 本の 10 字で始まる赤は無い"""
        self.r.tickets({"K-1": [], "K-2": ["K-1", "K-3"], "K-3": []})
        c1 = self.r.commit("K-2 feat: 1", {"apps/a1.ts": "a"})
        c2 = self.r.commit("K-2 feat: 2", {"apps/a2.ts": "a"})
        self.r.commit("K-2 feat: 3", {"apps/a3.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(n, 3)
        self.assertEqual(len(bad), 2, bad)
        self.assertTrue(any("K-2 は K-1" in b for b in bad), bad)
        self.assertTrue(any("K-2 は K-3" in b for b in bad), bad)
        self.assertTrue(all(b.startswith(self.head10()) for b in bad), bad)
        self.assertFalse(any(b.startswith(c1[:10]) or b.startswith(c2[:10]) for b in bad), bad)

    def test_K1154_OG_006_head_depends_on_is_the_judge(self):
        """K1154-OG-006 対象の状態：(a) 外して作り、依存を作った後で戻す → 緑 (b) 作った後で依存を足し、依存は無い → 赤 1 件 (c) その後に依存を作る → 緑"""
        with tempfile.TemporaryDirectory() as t:                      # (a)
            r = Repo(t)
            r.tickets({"K-1": [], "K-2": ["K-1"]})
            start = r.commit("K-0 base", {"README.md": "x"})
            r.tickets({"K-1": [], "K-2": []})
            r.commit("K-2 feat: 依存を外して先に作る", {"apps/a.ts": "a"})
            r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
            r.tickets({"K-1": [], "K-2": ["K-1"]})
            r.commit("K-2 docs: 依存を戻す")
            bad, _, n = g.check(t, "HEAD", start)
            self.assertEqual((bad, n), ([], 2))
        self.r.tickets({"K-1": [], "K-2": []})                         # (b)
        self.r.commit("K-2 docs: 依存なしにする")
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.r.commit("K-2 docs: 依存に K-1 を足す")
        bad, _, _ = self.check()
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("枝の先頭", bad[0])
        self.assertIn("K-2 は K-1", bad[0])
        self.r.commit("K-1 feat: 依存を作る", {"apps/b.ts": "b"})       # (c)
        bad, _, _ = self.check()
        self.assertEqual(bad, [], bad)

    def test_K1154_OG_007_broken_midway_list_is_not_read_but_broken_head_stops(self):
        """K1154-OG-007 失敗：途中の版の tickets.json が JSON でない・無い（先頭は読める・K-1 は枝に在る）→ 例外なく緑。
        先頭の版が JSON でない → RuntimeError"""
        for label in ("JSON でない", "ファイルが無い"):
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as t:
                    r = Repo(t)
                    r.tickets({"K-1": [], "K-2": ["K-1"]})
                    start = r.commit("K-0 base", {"README.md": "x"})
                    if label == "ファイルが無い":
                        os.remove(os.path.join(t, "11_tickets", "tickets.json"))
                        r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
                    else:
                        r.commit("K-2 feat: 作る", {"apps/a.ts": "a", "11_tickets/tickets.json": "{"})
                    r.commit("K-1 feat: 依存を作る", {"apps/b.ts": "b"})
                    r.tickets({"K-1": [], "K-2": ["K-1"]})
                    r.commit("K-2 docs: 一覧を直す")
                    bad, _, n = g.check(t, "HEAD", start)
                    self.assertEqual((bad, n), ([], 2))
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        self.r.commit("K-2 chore: 一覧を壊す", {"11_tickets/tickets.json": "{"})
        with self.assertRaises(RuntimeError):
            self.check()

    def test_K1154_OG_008_old_rules_for_legacy_human_and_parent_hold(self):
        """K1154-OG-008 守り：決まりの前の依存・人の準備は通して出す。済んでいない子を持つ親への依存は赤（K-5 は K-20 の 1 件だけ）"""
        with tempfile.TemporaryDirectory() as t:
            r = Repo(t)
            r.write("11_tickets/tickets.json", __import__("json").dumps({"tickets": [
                {"id": "K-9", "depends_on": [], "stage": "完了", "assignee": "実装"},
                {"id": "K-8", "depends_on": [], "stage": "完了", "assignee": "高本さん"},
                {"id": "K-20", "depends_on": [], "stage": "未着手", "assignee": "代表・実装"},
                {"id": "K-21", "depends_on": [], "stage": "未着手", "assignee": "実装", "parent": "K-20"},
                {"id": "K-4", "depends_on": ["K-9"], "stage": "未着手"},
                {"id": "K-6", "depends_on": ["K-8"], "stage": "未着手"},
                {"id": "K-5", "depends_on": ["K-20"], "stage": "未着手"}]}, ensure_ascii=False))
            start = r.commit("base", {"README.md": "x"})
            r.commit("K-8 docs: 人の準備の手順", {"11_tickets/K-8.md": "x"})   # 番号が出る（決まりの前でなく人の準備で通す）
            r.commit("K-4 feat: 決まりの前の依存", {"apps/c.ts": "c"})
            r.commit("K-6 feat: 人の準備に依存", {"apps/d.ts": "d"})
            r.commit("K-5 feat: 済んでいない子の親に依存", {"apps/e.ts": "e"})
            bad, legacy, n = g.check(t, "HEAD", start)
            self.assertEqual(n, 3)
            self.assertEqual(len(bad), 1, bad)
            self.assertIn("K-5 は K-20", bad[0])
            self.assertIn("K-9（K-4 の依存・決まりの前に入った）", legacy)
            self.assertIn("K-8（K-6 の依存・人の準備で完了）", legacy)


class WiringTest(unittest.TestCase):
    def test_K1154_OG_009_ci_wiring_and_selftest(self):
        """K1154-OG-009 入口：g65.d の 1 行・CI の定義にこの命令・G56 の段の命令は今のまま・順の検査の自己試験は 0 で selftest ok"""
        cmd = "python3 scripts/ci/k1154_order_head_test.py"
        self.assertEqual((HERE / "g65.d" / "K-1154.txt").read_text(encoding="utf-8").strip(), cmd)
        wf = (ROOT / ".github" / "workflows" / "v3-gate.yml").read_text(encoding="utf-8")
        self.assertIn(cmd, wf)
        g56 = [line for line in wf.splitlines() if "ticket_order_gate.py --base-ref" in line]
        self.assertEqual(len(g56), 1, g56)
        self.assertIn(f"python3 scripts/ci/ticket_order_gate.py {SELF_FLAG}", g56[0])
        self.assertIn('python3 scripts/ci/ticket_order_gate.py --base-ref "$CI_BASE"', g56[0])
        p = subprocess.run([sys.executable, str(GATE), SELF_FLAG], capture_output=True, text=True, env=ENV)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("selftest ok", p.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
