#!/usr/bin/env python3
"""K-643 の試験：順の検査（scripts/ci/ticket_order_gate.py・G56）が、親が 2 つ以上のコミット（取り込みのコミット）を
「件名の番号のチケットの実装」に数えない。親が 1 つのコミットは今までどおり数える。

  python3 scripts/ci/k643_merge_not_impl_test.py      全部の行（行 ID は K643-CI-NNN。11_tickets/K-643.md の行の表と 1 対 1）

偽の git の履歴（使い捨ての一時のリポジトリ）に、枝を分けて取り込みのコミットを作り、check() の答えを見る。
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ticket_order_gate as g  # noqa: E402
from ticket_order_gate_test import Repo  # noqa: E402


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

    def side(self, name: str, msg: str, files: dict[str, str]) -> None:
        """start から枝 name を切って 1 コミット積み、元の枝に戻る"""
        self.r.git("checkout", "-q", "-b", name, self.start)
        self.r.commit(msg, files)
        self.r.git("checkout", "-q", self.main)

    def merge(self, name: str, msg: str) -> str:
        """元の枝に name を取り込む（親が 2 つ）。元の枝にも 1 コミット積んで早送りにしない"""
        self.r.git("merge", "-q", "--no-ff", "-m", msg, name)
        return self.r.git("rev-parse", "HEAD")


class MergeNotImplTest(Case):
    def test_K643_CI_001_merge_commit_is_not_the_impl_of_its_subject_ticket(self):
        """K643-CI-001 入力：K-2（K-1 に依存）の件名の取り込みのコミットが、K-1 の実装を祖先に持たない形（K-392 merge: … の形）
        → 緑。取り込みのコミットは実装に数えないので、K-1 を取り込みの後に作る。コミットごとの裁きは緑・見た実装のコミットは取り込みを除いた 3 本（前は 4 本で、K-2 が赤だった）"""
        self.side("side", "K-5 feat: 別の枝の物", {"apps/other.ts": "o"})
        self.r.commit("K-9 feat: 本線の物", {"apps/main.ts": "m"})
        m = self.merge("side", "K-2 merge: 取り込みの列の前の木 t/K-5 を取り込む")
        self.assertEqual(len(self.r.git("rev-list", "--parents", "-n1", m).split()), 3, "親が 2 つの取り込み")
        self.r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})   # 枝の先頭では K-1 が入っている（先頭の検査は緑）
        bad, _, n = self.check()
        self.assertEqual(bad, [], bad)
        self.assertEqual(n, 3)   # K-5・K-9・K-1 の 3 本（取り込みの 1 本は数えない）

    def test_K643_CI_002_single_parent_commit_still_counts(self):
        """K643-CI-002 守り：同じ件名・同じ依存でも、親が 1 つのコミットなら今までどおり実装に数え、K-1 が祖先に無ければ赤
        （「取り込み」と書いた件名だけで外さない・親の数で決める）"""
        c = self.r.commit("K-2 merge: 取り込みと書いてあるだけの普通のコミット", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(n, 1)
        self.assertEqual(len(bad), 1, bad)
        self.assertTrue(bad[0].startswith(c[:10]), bad)
        self.assertIn("K-2 は K-1", bad[0])

    def test_K643_CI_003_impl_after_merge_is_counted_and_judged(self):
        """K643-CI-003 時間の流れ：取り込みのコミットの後に、自分の番号の親 1 つのコミット（ぶつかりを直した中身）が出れば、
        それは実装に数え、K-1 が枝に無ければ赤。K-1 の実装を持つ枝を取り込んだ後は緑（数え漏れにならない・K-1154 で枝の先頭だけで裁く形に替えた）"""
        self.side("side", "K-5 feat: 別の枝の物", {"apps/other.ts": "o"})
        self.r.commit("K-9 feat: 本線の物", {"apps/main.ts": "m"})
        self.merge("side", "K-2 merge: 取り込みの列の前の木 t/K-5 を取り込む")
        fix = self.r.commit("K-2 fix: ぶつかりを直した中身", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(n, 3)   # K-5・K-9・K-2 の直し
        self.assertEqual(len(bad), 1, bad)
        self.assertTrue(bad[0].startswith(fix[:10]), bad)
        # K-1 の実装を持つ枝を取り込んだ後なら、同じ直しは緑
        self.r.git("checkout", "-q", "-b", "ok", self.start)
        self.r.commit("K-1 feat: 依存を作る", {"apps/b.ts": "b"})
        self.r.git("checkout", "-q", self.main)
        self.merge("ok", "K-3 merge: 依存の枝を取り込む")
        self.r.commit("K-2 fix: 依存の後の直し", {"apps/a2.ts": "a"})
        bad2, _, _ = self.check()
        self.assertEqual(bad2, [], bad2)   # K-1154：枝の先頭に K-1 が入ったので、前の直し（K-1 より前）も赤にしない

    def test_K643_CI_004_dependency_reaching_through_a_merge_is_satisfied(self):
        """K643-CI-004 守り：依存 K-1 の実装が取り込みのコミットの向こうの枝にあり、その後に K-2 の実装が来れば緑
        （取り込みのコミットを実装に数えなくても、祖先の道は取り込みを通って届く）"""
        self.side("side", "K-1 feat: 依存を作る", {"apps/b.ts": "b"})
        self.r.commit("K-9 feat: 本線の物", {"apps/main.ts": "m"})
        self.merge("side", "K-1 merge: 取り込みの列の前の木 t/K-1 を取り込む")
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(bad, [], bad)
        self.assertEqual(n, 3)   # K-1・K-9・K-2（取り込みは数えない）

    def test_K643_CI_005_dependency_whose_only_commit_is_a_merge_still_satisfies(self):
        """K643-CI-005 守り：依存 K-1 の番号が件名にあるのが取り込みのコミット（K-1 merge: …）だけでも、その後の K-2 の実装は依存を満たす側で緑
        （取り込みは裁かないが、満たす側に数える＝前からの数え方を狭めない。本線の履歴には K-63 のように取り込みの件名にだけ番号がある依存があり、
        外すと K-64 が赤になる）。見た実装のコミットは取り込みを除いた 3 本"""
        self.side("side", "K-5 feat: 別の枝の物", {"apps/other.ts": "o"})
        self.r.commit("K-9 feat: 本線の物", {"apps/main.ts": "m"})
        self.merge("side", "K-1 merge: 取り込みの列の前の木 t/K-5 を取り込む")
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(bad, [], bad)
        self.assertEqual(n, 3)

    def test_K643_CI_006_octopus_merge_with_three_parents_is_not_impl(self):
        """K643-CI-006 入力：親が 3 つの取り込み（2 つ以上）も実装に数えない。K-2 の件名で K-1 の実装を持たない → 緑（K-1 は取り込みの後に作る）・見た本数は取り込みを除いた 4 本"""
        self.side("s1", "K-5 feat: 枝 1", {"apps/o1.ts": "1"})
        self.side("s2", "K-6 feat: 枝 2", {"apps/o2.ts": "2"})
        self.r.commit("K-9 feat: 本線の物", {"apps/main.ts": "m"})
        self.r.git("merge", "-q", "--no-ff", "-m", "K-2 merge: 2 つの枝を取り込む", "s1", "s2")
        self.assertEqual(len(self.r.git("rev-list", "--parents", "-n1", "HEAD").split()), 4, "親が 3 つ")
        self.r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
        bad, _, n = self.check()
        self.assertEqual(bad, [], bad)
        self.assertEqual(n, 4)

    def test_K643_CI_007_ticket_with_only_a_merge_is_judged_at_the_head(self):
        """K643-CI-007 守り：中身を取り込みのコミットの中だけに持つチケット（K-2 は K-1 に依存・K-2 の番号は取り込みの件名にだけある）は、
        コミットごとには裁かれないが、枝の先頭の検査に入る。K-1 の実装が枝に無ければ赤（「枝の先頭」と「K-2 は K-1」を含む）。K-1 が枝に入れば緑"""
        self.side("side", "K-5 feat: 別の枝の物", {"apps/other.ts": "o"})
        self.r.commit("K-9 feat: 本線の物", {"apps/main.ts": "m"})
        self.merge("side", "K-2 merge: 取り込みの列の前の木 t/K-5 を取り込む")
        bad, _, _ = self.check()
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("枝の先頭", bad[0])
        self.assertIn("K-2 は K-1", bad[0])
        self.r.commit("K-1 feat: 依存を作る", {"apps/b.ts": "b"})
        bad2, _, _ = self.check()
        self.assertEqual(bad2, [], bad2)


if __name__ == "__main__":
    unittest.main()
