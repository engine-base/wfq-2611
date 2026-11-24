#!/usr/bin/env python3
"""K-341 の試験：取り込む順の検査（scripts/ci/ticket_order_gate.py・G56）の git の呼び出しを、コミットの数によらない数回にまとめる。

  python3 scripts/ci/k341_order_gate_speed_test.py      行 ID は K341-CI-NNN（チケット 11_tickets/K-341.md の表の行と 1 対 1）

速さは時間で見ない（台で揺れる）。git を呼ぶ回数を数える（K341-CI-001）。確かめの中身が変わらないことは、
  ・まとめて読んだ物（コミットごとの件名・変えたファイル・親）と「先祖か」の答えが、1 本ずつ git に聞いた答えと同じ（K341-CI-002）
  ・直す前の版（git の中の OLD_BLOB）と、出力（PASS／FAIL・違反の一覧・決まりの前に入ったとして通した依存）と終わりの番号が 1 字も違わない（K341-CI-003）。
    ただし K-1154 で枝の先頭だけで裁く形にしたので、依存より先に作り後で依存が枝に入る写し（HEAD_ONLY_GREEN）は「前は FAIL・今は PASS」を見る。
    残りの赤の写しは、★ の行を字でなく（チケット, 依存）の組と件数で比べ、今の ★ の行が「<先頭の 10 字> 枝の先頭」で始まることを見る（★ でない行は 1 字も違わない）
で見る。写しのリポジトリは一時フォルダに作る（DB なし）。
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import ticket_order_gate as g  # noqa: E402

NUM = re.compile(r"実装のコミット (\d+) 本")
PAIR = re.compile(r"(K-\d+) は (K-\d+) に依存する")   # ★ の行の（チケット, 依存）
# 直す前の scripts/ci/ticket_order_gate.py（本線 c93019c7 の版・最後に変えたのは 8ae2be25）。比べる相手として git の中から読む
OLD_BLOB = "c27ded84719384af0950160bcb17ddc4b607a409"
GATE = HERE / "ticket_order_gate.py"
# K-1154（answer=ee72b1756f5d）で答えが変わる写し：依存より先に作り、後で依存が枝に入る。直す前の版は FAIL・新しい版は PASS
HEAD_ONLY_GREEN = {"skew", "before", "restore"}
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
       "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
TICKETS = "11_tickets/tickets.json"


class Repo:
    """写しのリポジトリ。日付を 1 本ずつ進め、skew=True のコミットは日付を過去に戻す（親より古い子）"""

    def __init__(self, d: str):
        self.d = d
        os.makedirs(d, exist_ok=True)
        self.t = 1_700_000_000
        self.git("init", "-q", "-b", "main")

    def git(self, *a: str, date: int | None = None) -> str:
        env = ENV if date is None else {**ENV, "GIT_AUTHOR_DATE": f"{date} +0000", "GIT_COMMITTER_DATE": f"{date} +0000"}
        return subprocess.run(["git", "-c", "core.quotePath=false", *a], cwd=self.d, check=True,
                              capture_output=True, text=True, env=env).stdout.strip()

    def write(self, path: str, text: str) -> None:
        p = os.path.join(self.d, path)
        os.makedirs(os.path.dirname(p) or self.d, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)

    def tickets(self, ts: dict[str, dict]) -> None:
        import json
        self.write(TICKETS, json.dumps({"tickets": [{"id": k, **v} for k, v in ts.items()]}, ensure_ascii=False))

    def _date(self, skew: bool) -> int:
        self.t += 60
        return self.t - 86_400 if skew else self.t

    def commit(self, msg: str, files: dict[str, str] | None = None, skew: bool = False, empty: bool = False) -> str:
        for p, t in (files or {}).items():
            self.write(p, t)
        self.git("add", "-A")
        self.git("commit", "-qm", msg, *(["--allow-empty"] if empty else []), date=self._date(skew))
        return self.git("rev-parse", "HEAD")

    def merge(self, branch: str, msg: str, unrelated: bool = False) -> str:
        self.git("merge", "-q", "--no-ff", "-m", msg, *(["--allow-unrelated-histories"] if unrelated else []), branch,
                 date=self._date(False))
        return self.git("rev-parse", "HEAD")


def tricky_repo(d: str) -> tuple[Repo, str, str]:
    """件名・変えたファイル・親・先祖の答えを試すための形を全部持つ写し。(リポジトリ, START, 比べる元の枝の名前)
    形：枝分かれと取り込み（--no-ff）・関わりの無い歴史の取り込み（そちらの根が範囲に入る）・名前の付け替え（git mv）・
    日本語・空白・引用符の入ったファイル名・変えたファイルの無いコミット・親より日付の古いコミット（ログの順が先祖の順と食い違う）"""
    r = Repo(d)
    r.tickets({"K-1": {"depends_on": [], "stage": "未着手", "assignee": "実装"},
               "K-2": {"depends_on": ["K-1"], "stage": "未着手", "assignee": "実装"},
               "K-3": {"depends_on": ["K-2"], "stage": "未着手", "assignee": "実装"},
               "K-4": {"depends_on": ["K-9"], "stage": "未着手", "assignee": "実装"},
               "K-5": {"depends_on": ["K-8"], "stage": "未着手", "assignee": "実装"},
               "K-6": {"depends_on": ["K-20"], "stage": "未着手", "assignee": "実装"},
               "K-7": {"depends_on": ["K-1"], "stage": "未着手", "assignee": "実装"},
               "K-8": {"depends_on": [], "stage": "完了", "assignee": "高本さん"},
               "K-9": {"depends_on": [], "stage": "完了", "assignee": "実装"},
               "K-20": {"depends_on": [], "stage": "未着手", "assignee": "代表・実装"},
               "K-21": {"depends_on": [], "stage": "未着手", "assignee": "実装", "parent": "K-20"}})
    start = r.commit("K-0 base", {"README.md": "x", "apps/old name.ts": "o"})
    r.commit("K-3 docs: チケットを切る", {"11_tickets/K-3.md": "x"})
    r.git("checkout", "-q", "-b", "side")
    r.commit("K-1 feat: 枝で作る", {"apps/画面の部品.ts": "a"})
    r.commit("K-2 feat: 日付が親より古い", {"apps/a\"q.ts": "b"}, skew=True)
    r.git("checkout", "-q", "main")
    r.commit("K-7 feat: 先に作る（K-1 はまだ枝の外）", {"apps/c d.ts": "c"})
    r.git("mv", "apps/old name.ts", "apps/新しい名前.ts")
    r.commit("K-4 refactor: 名前を付け替える")
    r.merge("side", "K-1 K-2 Merge branch 'side'")
    r.commit("K-3 feat: 取り込みの後で作る", {"apps/e.ts": "e"})
    r.commit("K-5 chore: 変えたファイルの無いコミット", empty=True)
    base = "fork"
    r.git("branch", base)
    r.git("checkout", "-q", "--orphan", "other")
    r.git("rm", "-rqf", ".")
    r.commit("K-21 feat: 関わりの無い歴史で作る", {"lib/z.ts": "z"})
    r.git("checkout", "-q", "main")
    r.merge("other", "K-6 Merge 関わりの無い歴史", unrelated=True)
    r.commit("K-6 feat: 子が済んだ親に依存", {"apps/f.ts": "f"}, skew=True)
    return r, start, base


def skew_repo(d: str) -> tuple[Repo, str, dict[str, str]]:
    """一覧（git log --reverse）の順が先祖の順と食い違う形（精査 R の指摘）。START → A → P（本線）、P から枝を作り X（親 P より日付が古い）、
    本線に Q を足して X の枝を取り込む（M）。一覧は A → X → P → Q → M の順になり、
    ・A は P を通って X の先祖で、一覧でも X より前（直す前の版は数える → 一覧の順になめて先祖を作ると落とす）
    ・P は X の親だが、一覧では X より後ろ（直す前の版は「前の実装のコミット」に入れず数えない → 絞り込みを忘れると緑に緩む）
    A・P・X はどれも実装のコミットで、X のチケット K-13 は A の K-11 と P の K-12 の両方に依存する。(リポジトリ, START, 名前 → sha)"""
    r = Repo(d)
    r.tickets({"K-11": {"depends_on": [], "stage": "未着手"}, "K-12": {"depends_on": [], "stage": "未着手"},
               "K-13": {"depends_on": ["K-11", "K-12"], "stage": "未着手"}, "K-14": {"depends_on": [], "stage": "未着手"}})
    r.t = 1_700_000_000 + 1_000
    start = r.commit("K-0 base", {"README.md": "x"})
    r.t = 1_700_000_000 + 1_140
    a = r.commit("K-11 feat: A", {"apps/a.ts": "a"})
    r.t = 1_700_000_000 + 1_940
    p = r.commit("K-12 feat: P", {"apps/p.ts": "p"})
    r.git("checkout", "-q", "-b", "x")
    r.t = 1_700_000_000 + 1_440
    x = r.commit("K-13 feat: X（親 P より日付が古い）", {"apps/x.ts": "x"})
    r.git("checkout", "-q", "main")
    r.t = 1_700_000_000 + 2_940
    q = r.commit("K-14 feat: Q", {"apps/q.ts": "q"})
    m = r.merge("x", "K-13 Merge branch 'x'")
    return r, start, {"A": a, "P": p, "X": x, "Q": q, "M": m}


def violation_repos(d: str) -> list[tuple[str, str, str | None]]:
    """前からの違反の型（依存より先に作る・枝の外の実装・外して戻した依存・済んでいない子の親・枝の先頭の依存）と、緑の型。
    (写しのフォルダ, START, 比べる元か None) のリスト"""
    out: list[tuple[str, str, str | None]] = []

    def new(name: str) -> tuple[Repo, str]:
        r = Repo(os.path.join(d, name))
        r.tickets({"K-1": {"depends_on": [], "stage": "未着手"}, "K-2": {"depends_on": ["K-1"], "stage": "未着手"},
                   "K-9": {"depends_on": [], "stage": "完了"}, "K-4": {"depends_on": ["K-9"], "stage": "未着手"}})
        return r, r.commit("K-0 base", {"README.md": "x"})

    r, s = new("before")                                     # 依存より先に作る → 赤
    r.commit("K-2 feat: 先に作る", {"apps/a.ts": "a"})
    r.commit("K-1 feat: 後から", {"apps/b.ts": "b"})
    out.append((r.d, s, None))
    r, s = new("hold")                                       # 枝の外の実装は数えない → 赤
    r.git("checkout", "-q", "-b", "hold")
    r.commit("K-1 feat: 枝の外", {"apps/b.ts": "b"})
    r.git("checkout", "-q", "main")
    r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
    out.append((r.d, s, None))
    r, s = new("restore")                                    # 外して先に作り、後で戻す → 赤
    r.tickets({"K-1": {"depends_on": []}, "K-2": {"depends_on": []}})
    r.commit("K-2 feat: 外して作る", {"apps/a.ts": "a"})
    r.commit("K-1 feat: 後から", {"apps/b.ts": "b"})
    r.tickets({"K-1": {"depends_on": []}, "K-2": {"depends_on": ["K-1"]}})
    r.commit("K-2 docs: 戻す")
    out.append((r.d, s, None))
    r, s = new("head")                                       # 枝の先頭の依存が枝に無い → 赤
    r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
    r.tickets({"K-1": {"depends_on": []}, "K-2": {"depends_on": ["K-1", "K-30"]}, "K-30": {"stage": "未着手"}})
    r.commit("K-2 docs: 依存を足す")
    out.append((r.d, s, None))
    r, s = new("parent")                                     # 枝で parent を外した子（比べる元を渡す） → 赤
    r.tickets({"K-21": {"depends_on": [], "parent": "K-22", "assignee": "実装"}, "K-22": {"depends_on": []},
               "K-6": {"depends_on": ["K-22"]}})
    r.commit("K-21 K-22 docs: 一覧", {"11_tickets/K-22.md": "x"})
    r.git("branch", "fork")
    r.tickets({"K-21": {"depends_on": [], "assignee": "実装"}, "K-22": {"depends_on": []}, "K-6": {"depends_on": ["K-22"]}})
    r.commit("K-21 docs: 親を外す", {"11_tickets/K-21.md": "x"})
    r.commit("K-6 feat: 親に依存", {"apps/e.ts": "e"})
    out.append((r.d, s, "fork"))
    r, s = new("green")                                      # 緑：依存が先・決まりの前に入った依存
    r.commit("K-1 feat: 先に", {"apps/b.ts": "b"})
    r.commit("K-2 feat: 後から", {"apps/a.ts": "a"})
    r.commit("K-4 feat: 決まりの前に入った依存", {"apps/c.ts": "c"})
    out.append((r.d, s, None))
    return out


def run_gate(script: str, repo: str, start: str, base: str | None) -> tuple[int, str]:
    args = [sys.executable, script, "--start", start, *(["--base-ref", base] if base is not None else [])]
    p = subprocess.run(args, cwd=repo, capture_output=True, text=True, env=ENV)
    return p.returncode, p.stdout + p.stderr


class GitCallTest(unittest.TestCase):
    def count(self, repo: str, start: str, base: str | None) -> int:
        real = subprocess.Popen
        calls: list[list[str]] = []

        def spy(cmd, *a, **k):
            if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == "git":
                calls.append(list(cmd))
            return real(cmd, *a, **k)
        # subprocess.run も中で Popen を使うので、Popen を数えれば run と直の Popen の両方が入る
        with mock.patch.object(g.subprocess, "Popen", side_effect=spy):
            g.check(repo, "HEAD", start, base=base)
        return len(calls)

    def build(self, d: str, n: int) -> tuple[str, str]:
        r = Repo(d)
        r.tickets({f"K-{i}": {"depends_on": [f"K-{i - 1}"] if i > 1 else [], "stage": "未着手"} for i in range(1, n + 1)})
        start = r.commit("K-0 base", {"README.md": "x"})
        for i in range(1, n + 1):
            if i % 5 == 0:                                   # 5 本ごとに枝を作って取り込む（取り込みのコミットも数える）
                r.git("checkout", "-q", "-b", f"b{i}")
                r.commit(f"K-{i} feat: 枝で作る", {f"apps/{i}.ts": str(i)})
                r.git("checkout", "-q", "main")
                r.merge(f"b{i}", f"K-{i} Merge")
            else:
                r.commit(f"K-{i} feat: 作る", {f"apps/{i}.ts": str(i)})
        r.git("branch", "fork", start)
        return r.d, start

    def test_K341_CI_001_git_calls_do_not_grow_with_commits(self):
        """K341-CI-001 守り（G-16 有限の資源）：git を呼ぶ回数（subprocess.Popen で起こした git の数）は、範囲のコミットの数によらない。実装のコミット 6 本と 36 本の写しで
        呼ぶ回数が同じで、比べる元なしは 8 回以下・比べる元ありは 12 回以下（直す前は 1 本ごとに diff-tree と merge-base を呼び、
        本物の作業場所で 3,690 回だった）"""
        with tempfile.TemporaryDirectory() as d:
            small, s1 = self.build(os.path.join(d, "small"), 6)
            large, s2 = self.build(os.path.join(d, "large"), 36)
            for base in (None, "fork"):
                with self.subTest(base=base):
                    a, b = self.count(small, s1, base), self.count(large, s2, base)
                    self.assertEqual(a, b, f"6 本で {a} 回・36 本で {b} 回")
                    self.assertLessEqual(b, 8 if base is None else 12)


class SameAnswerTest(unittest.TestCase):
    def test_K341_CI_002_batched_log_and_ancestry_match_git_one_by_one(self):
        """K341-CI-002 入力（TP-TOOL-01・02）：まとめて読んだコミットの一覧 commit_log(root, start, head_sha) が、1 本ずつ git に聞いた物と同じ。
        並び（git log --reverse の順）・件名・変えたファイル（git diff-tree --no-commit-id --name-only -r --root の並び。
        取り込みのコミットは空・関わりの無い歴史の根は全部・名前の付け替えは消した名前と足した名前・日本語・空白・引用符の名前）・
        親（git rev-list --parents）。ancestry(一覧) が返す「先祖か」は、範囲の全部の組で git merge-base --is-ancestor と同じ"""
        with tempfile.TemporaryDirectory() as d:
            r, start, _ = tricky_repo(d)
            head = r.git("rev-parse", "HEAD")
            got = g.commit_log(d, start, head)
            want_rows = [l.split("\t", 1) for l in r.git("log", "--reverse", "--format=%H%x09%s", f"{start}..{head}").splitlines()]
            self.assertEqual([(x[0], x[1]) for x in got], [(s, t) for s, t in want_rows])
            for sha, subj, files, parents in got:
                with self.subTest(subj=subj):
                    want = [f for f in r.git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha).splitlines() if f]
                    self.assertEqual(list(files), want)
                    self.assertEqual(list(parents), r.git("rev-list", "--parents", "-n", "1", sha).split()[1:])
            names = {f for _, _, files, _ in got for f in files}
            for must in ("apps/画面の部品.ts", "apps/c d.ts", "apps/新しい名前.ts", "apps/old name.ts", "lib/z.ts", '"apps/a\\"q.ts"'):
                self.assertIn(must, names)                    # 形が写しに本当にある（何も見ずに同じにならない）
            self.assertTrue(any(len(p) == 2 and not f for _, _, f, p in got))
            self.assert_ancestry(d, got)
        with tempfile.TemporaryDirectory() as d:
            r, start, c = skew_repo(d)
            got = g.commit_log(d, start, c["M"])
            order = [x[0] for x in got]
            self.assertEqual(order, [c[k] for k in ("A", "X", "P", "Q", "M")])   # 形が写しに本当にある（子 X が親 P より前）
            self.assert_ancestry(d, got)

    def assert_ancestry(self, d: str, got: list) -> None:
        is_anc = g.ancestry(got)
        shas = [x[0] for x in got]
        for a in shas:
            for b in shas:
                want = subprocess.run(["git", "merge-base", "--is-ancestor", a, b], cwd=d).returncode == 0
                self.assertEqual(is_anc(a, b), want, f"{a[:8]} → {b[:8]}")

    def test_K341_CI_003_output_is_identical_to_the_version_before(self):
        """K341-CI-003 守り（回帰）：直す前の版（OLD_BLOB）と直した版を同じ写しで流し、出力（★ の違反の一覧・決まりの前に入ったとして通した依存・
        実装のコミットの数・PASS／FAIL の行）と終わりの番号が 1 字も違わない。写しは K341-CI-002 の形（取り込み・関わりの無い歴史・日付の
        食い違い）を、比べる元なし・ありの両方と、一覧の順が先祖の順と食い違う写し（skew_repo・K-13 が一覧で後ろの親 P の K-12 に依存して赤）と、前からの違反の型（依存より先・枝の外・外して戻す・枝の先頭・parent を外した子）と緑の型。
        赤の型は本当に FAIL で ★ を出し、緑の型は PASS（比べるだけで何も見ていない、にならない）"""
        old = subprocess.run(["git", "cat-file", "blob", OLD_BLOB], cwd=ROOT, check=True, capture_output=True).stdout
        with tempfile.TemporaryDirectory() as d:
            old_script = os.path.join(d, "old_gate.py")
            with open(old_script, "wb") as f:
                f.write(old)
            r, start, base = tricky_repo(os.path.join(d, "tricky"))
            sk, sk_start, _ = skew_repo(os.path.join(d, "skew"))
            cases = [(r.d, start, None), (r.d, start, base), (sk.d, sk_start, None)] + violation_repos(os.path.join(d, "v"))
            fails = passes = changed = 0
            for repo, s, b in cases:
                with self.subTest(repo=os.path.basename(repo), base=b):
                    want = run_gate(old_script, repo, s, b)
                    got = run_gate(str(GATE), repo, s, b)
                    if os.path.basename(repo) in HEAD_ONLY_GREEN:
                        # K-1154：依存より先に作り、後で依存が枝に入る写し。直す前の版はコミットごとに裁いて FAIL、新しい版は枝の先頭だけで裁いて PASS
                        self.assertEqual(want[0], 1, want[1])
                        self.assertIn("FAIL", want[1])
                        self.assertEqual(got[0], 0, got[1])
                        self.assertIn("PASS", got[1])
                        self.assertNotIn("★", got[1])
                        changed += 1
                        continue
                    # K-643：直す前の版は取り込みのコミット（親 2 つ）も実装に数える。違うのは「実装のコミット N 本」の数だけ（取り込みの数ぶん少ない）
                    merges = int(subprocess.run(["git", "rev-list", "--merges", "--count", f"{s}..HEAD"], cwd=repo, capture_output=True, text=True).stdout)
                    self.assertEqual(got[0], want[0])
                    # K-1154：★ の行は、直す前は「<そのコミットの 10 字> …」、今は「<先頭の 10 字> 枝の先頭：…」。字でなく（チケット, 依存）の組と件数で比べる。
                    # ★ でない行（決まりの前に通した依存・本数・PASS／FAIL）は今までどおり 1 字も違わない
                    head10 = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()[:10]
                    star_w = [x for x in want[1].splitlines() if "★" in x]
                    star_g = [x for x in got[1].splitlines() if "★" in x]
                    self.assertEqual(sorted(PAIR.findall("\n".join(star_g))), sorted(PAIR.findall("\n".join(star_w))))
                    self.assertEqual(len(star_g), len(star_w))
                    self.assertTrue(all(x.strip().startswith(f"★ {head10} 枝の先頭") for x in star_g), star_g)
                    rest = lambda out: NUM.sub("実装のコミット N 本", "\n".join(x for x in out.splitlines() if "★" not in x))  # noqa: E731
                    self.assertEqual(rest(got[1]), rest(want[1]))
                    self.assertEqual(int(NUM.search(want[1]).group(1)) - int(NUM.search(got[1]).group(1)), merges)
                    fails += want[0] == 1 and "★" in want[1] and "FAIL" in want[1]
                    passes += want[0] == 0 and "PASS" in want[1]
            self.assertEqual(changed, 3)   # skew・before・restore
            self.assertGreaterEqual(fails, 3)   # hold・head・parent
            self.assertGreaterEqual(passes, 1)  # green


if __name__ == "__main__":
    unittest.main(verbosity=1)
