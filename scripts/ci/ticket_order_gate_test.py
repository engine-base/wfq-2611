#!/usr/bin/env python3
"""取り込む順の検査（scripts/ci/ticket_order_gate.py・G56・K-94）の試験（K-159。K-1154 で替えた）。
行 ID（K159-CI-011〜030）は 11_tickets/K-159.md の表に結ぶ。テストはチケットと一緒に先に書き、実装に入ったら変えない（D-132）。

K-1154（代表の決め answer=ee72b1756f5d・2026-11-24）で、裁くのは枝の先頭だけになった：枝の先頭の版の depends_on が
START..rev の実装のコミットに在れば緑で、コミットの順（依存より前か後か）は見ない。下の「コミットごと」の説明は K-159 の時の形で、
K159-CI-013・014・015・028 の期待は K-1154 で「赤は空」に替えた（依存は枝の先頭までに入っている）。

由来：検査は HEAD の tickets.json の depends_on を START..HEAD の全部の実装のコミットに当てていた。K-62 が回 3 で depends_on に
K-143 を足すと、それより前の K-62 の実装のコミットまで「K-143 の実装が祖先に無い」で赤になった（依存を後から足すたびに過去が赤）。

試験が決める形（check(root, rev="HEAD", start=START) -> (赤の理由, 決まりの前に入ったとして通した依存, 見た実装のコミットの数) は変えない）:
  ・コミットごと：各実装のコミットを「そのコミットの版の 11_tickets/tickets.json」の depends_on で裁く（git の版から読む）。
    依存の実装のコミット（番号を持つ、文書だけでないコミット）が祖先にあるか、同じコミットに依存の番号もあれば緑。
    依存を足したコミットそのものも、足した後として裁く（そのコミットの版に依存がある）。
    赤の文は「<sha の頭 10 字> <チケット> は <依存> に依存するが…」（前と同じ形）
  ・外して戻した依存（テスター Q 回 1 の #2・PM の判断 (ア)）：各コミットは「その版の depends_on」に、「rev の版の depends_on のうち、
    START の版か、枝の中のそれより前の版に一度でも載っていたもの」を足して裁く（初めて足した依存は過去のコミットを赤にしない・
    外して実装し後で戻した依存は、外していた間の実装のコミットを赤にする）
  ・その版の tickets.json が無い（ファイルが無い）・JSON でない・そのチケットが載っていない → rev の版の depends_on で裁く（前と同じ・緩めない）
  ・載っているが depends_on の欄が無い・null → 依存なし（[]・前と同じ）。rev の版でも同じ
  ・rev の版の tickets.json が無い・JSON でない・"tickets" が無い → RuntimeError（main は FAIL・exit 1。読めなければ空として緑にしない）
  ・文書だけかを決める生成物の一覧（scripts/ci/generated.json）も rev の版から読む（作業場所の未コミットの一覧は見ない）
    ただし共有の generated_outputs(root)（ci_scope.py の human_generated が使う）は変えない（作業場所から読むまま・引数 1 つ）。
    この検査は版から読む別の関数を使う
  ・枝の先頭（rev）：実装のコミットを持つチケットの、rev の版の depends_on が全部、START..rev の実装のコミットにあること
    （依存が取り込まれていない実装を取り込まない・原則 11）。赤の文は「枝の先頭」と「<チケット> は <依存> に依存する」を含む。
    同じ（チケット, 依存）をコミットごとの赤で既に出していれば、枝の先頭の赤は重ねて出さない（前からの自己試験の数が変わらない）
  ・rev の depends_on・stage も git の版（rev）から読む。作業場所の未コミットの tickets.json は見ない
  ・決まりの前に入った依存（START..rev のどのコミットにも番号が無く、rev の版の stage が確認中・完了）は前と同じく通す
  ・git が失敗したら RuntimeError（main が FAIL・exit 1）
  ・ai-team.yaml（進め方の設定）は文書・設定の扱い：11_tickets などと ai-team.yaml だけに触るコミットは実装に数えない
    （PM の判断 2026-11-10：設定は製品の実装ではない。3fdbb37f の形）。ai-team.yaml と実装のファイルの両方に触るコミットは実装に数える
    ただし is_doc_only（ci_scope.py と共有）は変えない：ai-team.yaml は ci_scope では今までどおり「追えない変更」で全部を流す（緩めない）
使い方: python3 scripts/ci/ticket_order_gate_test.py
"""
import contextlib, io, json, os, subprocess, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import ticket_order_gate as g  # noqa: E402

ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
       "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}


class Repo:
    """写しのリポジトリ。tickets() で 11_tickets/tickets.json を書き、commit() でまとめてコミットする"""

    def __init__(self, d: str):
        self.d = d
        self.git("init", "-q")

    def git(self, *a: str) -> str:
        return subprocess.run(["git", "-c", "core.quotePath=false", *a], cwd=self.d, check=True,
                              capture_output=True, text=True, env=ENV).stdout.strip()

    def write(self, path: str, text: str) -> None:
        p = os.path.join(self.d, path)
        os.makedirs(os.path.dirname(p) or self.d, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)

    def tickets(self, deps: dict[str, list[str]], stage: dict[str, str] | None = None) -> None:
        stage = stage or {}
        self.write("11_tickets/tickets.json", json.dumps(
            {"tickets": [{"id": k, "depends_on": v, "stage": stage.get(k, "未着手")} for k, v in deps.items()]}, ensure_ascii=False))

    def commit(self, msg: str, files: dict[str, str] | None = None) -> str:
        for p, t in (files or {}).items():
            self.write(p, t)
        self.git("add", "-A")
        self.git("commit", "-qm", msg)
        return self.git("rev-parse", "HEAD")


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = Repo(self.tmp.name)
        self.r.tickets({"K-1": [], "K-2": []})
        self.start = self.r.commit("K-0 base", {"README.md": "x"})

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, rev: str = "HEAD"):
        return g.check(self.tmp.name, rev, self.start)


class PerCommitTest(Case):
    def test_K159_CI_011_dep_added_later_does_not_judge_past_commits(self):
        """K159-CI-011 時間の流れ (d)：K-2 を作った後で、文書のコミットで K-2 の depends_on に K-1 を足す。K-1 は枝の中で後から作る
        → 赤にならない（足す前の K-2 の実装のコミットを、後から足した依存で裁かない）。見た実装のコミットは 2 本"""
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        self.r.commit("K-1 feat: 依存を作る", {"apps/b.ts": "b"})
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.r.commit("K-2 docs: 依存に K-1 を足す")
        bad, _, n = self.check()
        self.assertEqual(bad, [])
        self.assertEqual(n, 2)

    def test_K159_CI_012_head_deps_not_in_branch_is_red(self):
        """K159-CI-012 守り (e)：依存を後から足し、その依存の実装が枝に無い → 今までどおり赤（枝の先頭の depends_on で見る）。
        赤の文は「枝の先頭」と「K-2 は K-1」を含み、足す前の実装のコミットを名指ししない"""
        c1 = self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.r.commit("K-2 docs: 依存に K-1 を足す")
        bad, _, _ = self.check()
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("枝の先頭", bad[0])
        self.assertIn("K-2 は K-1", bad[0])
        self.assertNotIn(c1[:10], bad[0])

    def test_K159_CI_013_commit_after_dep_added_without_dep_is_red(self):
        """K159-CI-013 時間の流れ (f)（K-1154 で替えた）：依存を足した後の K-2 の実装のコミットが K-1 を祖先に持たなくても、
        K-1 を後から枝に入れたので枝の先頭では満たしている → 緑（コミットごとには裁かない）。見た実装のコミットは 3 本"""
        self.r.commit("K-2 feat: 作る 1", {"apps/a.ts": "a"})
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.r.commit("K-2 docs: 依存に K-1 を足す")
        self.r.commit("K-2 feat: 作る 2", {"apps/a2.ts": "a"})
        self.r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
        bad, _, n = self.check()
        self.assertEqual(bad, [], bad)
        self.assertEqual(n, 3)

    def test_K159_CI_014_commit_that_adds_the_dep_is_judged_with_it(self):
        """K159-CI-014 時間の流れ（G-12 切り替わりの瞬間・K-1154 で替えた）：実装と一緒に depends_on に K-1 を足したコミット（K-62 の 3637c890 の形）の後に
        K-1 を枝に入れる → 枝の先頭で満たしているので緑"""
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.r.commit("K-2 feat: 作り、依存を足す", {"apps/a.ts": "a"})   # 文に依存の番号を書かない（3637c890 の文は K-62 だけ）
        self.r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
        bad, _, _ = self.check()
        self.assertEqual(bad, [], bad)

    def test_K159_CI_015_unreadable_or_missing_falls_back_to_head(self):
        """K159-CI-015 失敗（K-1154 で替えた）：そのコミットの版の tickets.json が無い・JSON でない・そのチケットが載っていない → 途中の版は読まず、
        枝の先頭の depends_on で裁く。K-1 は枝の先頭までに入っているので、例外を出さず緑"""
        for label, broken in (("JSON でない", "{"), ("載っていない", json.dumps({"tickets": [{"id": "K-1", "depends_on": []}]})),
                              ("ファイルが無い", None)):
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as t:
                    r = Repo(t)
                    r.tickets({"K-1": [], "K-2": []})
                    start = r.commit("K-0 base", {"README.md": "x"})
                    if broken is None:
                        os.remove(os.path.join(t, "11_tickets", "tickets.json"))
                        c1 = r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
                    else:
                        c1 = r.commit("K-2 feat: 作る", {"apps/a.ts": "a", "11_tickets/tickets.json": broken})
                    r.tickets({"K-1": [], "K-2": ["K-1"]})
                    r.commit("K-2 docs: 直す")
                    r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
                    bad, _, n = g.check(t, "HEAD", start)
                    self.assertEqual((bad, n), ([], 2))
                    self.assertTrue(c1)

    def test_K159_CI_016_japanese_file_names(self):
        """K159-CI-016 入力（TP-TOOL-01）：日本語の名前の文書だけのコミット（11_tickets・07_qa/test-specs）は実装に数えない（依存が
        未完了でも見ない）。日本語の名前の実装のファイルを持つコミットは実装に数え、依存が無ければ赤"""
        self.r.tickets({"K-1": [], "K-2": [], "K-3": ["K-1"]})
        self.r.commit("K-3 docs: チケットを切る", {"11_tickets/チケットの説明.md": "x", "07_qa/test-specs/k/試験.md": "x"})
        bad, _, n = self.check()
        self.assertEqual((bad, n), ([], 0))
        c = self.r.commit("K-3 feat: 作る", {"apps/画面の部品.ts": "x"})
        bad, _, n = self.check()
        self.assertEqual(n, 1)
        self.assertTrue(any(b.startswith(c[:10]) and "K-3 は K-1" in b for b in bad), bad)

    def test_K159_CI_017_reads_versions_not_working_tree(self):
        """K159-CI-017 入口（TP-TOOL-03）：rev の depends_on は git の版から読む。作業場所の未コミットの tickets.json に満たせない依存を
        足しても結果は変わらない（まっさらな写しと手元で同じ）。rev に古いコミットを渡せば、その版で裁く"""
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        older = self.r.commit("K-2 docs: 依存に K-1 を足す")
        self.r.commit("K-1 feat: 依存を作る", {"apps/b.ts": "b"})
        self.r.tickets({"K-1": ["K-9"], "K-2": ["K-1", "K-8"]})   # コミットしない
        bad, _, _ = self.check()
        self.assertEqual(bad, [])
        bad_old, _, _ = self.check(older)                         # この版では K-1 がまだ枝に無い
        self.assertEqual(len(bad_old), 1, bad_old)
        self.assertIn("枝の先頭", bad_old[0])

    def test_K159_CI_020_same_commit_dep_is_green(self):
        """K159-CI-020 操作の揺れ：1 つのコミットに K-2 と依存の K-1 の番号が両方ある → 緑（前と同じ）。枝の先頭でも満たしている"""
        self.r.tickets({"K-1": [], "K-2": ["K-1"]})
        self.r.commit("K-1 K-2 feat: まとめて作る", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual((bad, n), ([], 1))

    def test_K159_CI_029_other_ticket_named_in_the_subject_is_not_its_implementation(self):  # K-309
        """K159-CI-029 入力（K-309・PM の決め 2026-11-18）：実装の持ち主は件名の頭の番号（「<ID> <種類>:」の <ID>）だけで決める。
        件名の中に出てくるほかのチケットの番号（本線の cccf8b2c「K-304 fix: …K-309 まで閉じる」の形）はそのチケットの実装に数えない
        → 依存の K-1 より前に作った K-2 の話を書いた K-3 の実装は、K-2 の依存の赤にならない（緑）。
        頭に番号を並べた件名（「K-1 K-2 feat:」）は今までどおり両方の実装。頭の番号のチケットの依存は今までどおり裁く（赤）"""
        self.r.tickets({"K-1": [], "K-2": ["K-1"], "K-3": []})
        self.r.commit("K-3 fix: K-2 が来るまで口を閉じる", {"apps/c.ts": "c"})
        bad, _, n = self.check()
        self.assertEqual((bad, n), ([], 1))
        self.r.tickets({"K-1": [], "K-2": ["K-1"], "K-3": [], "K-4": ["K-1"]})
        c = self.r.commit("K-4 feat: K-3 の口を使う", {"apps/d.ts": "d"})
        bad, _, n = self.check()
        self.assertEqual(n, 2)
        self.assertEqual(len(bad), 1, bad)
        self.assertTrue(bad[0].startswith(c[:10]) and "K-4 は K-1" in bad[0], bad)

    def test_K159_CI_030_head_list_and_subjects_without_a_head_keep_the_old_rule(self):  # K-309
        """K159-CI-030 入力（K-309・精査の指摘）：(a) 頭に並べた番号は区切り（空白・,・・）に関わらず全部が持ち主（K-2 の依存 K-1 を同じコミットで満たす・緑）。
        (b)(c) 頭に番号が並んでいない件名（「fix: K-2 …」「K-2〜K-3 feat:」）は前のまま件名の全部の番号が持ち主で、依存の K-1 より前なら赤（黙って裁かれなくならない）
        (d) 依存を満たす側は前のまま件名の全部の番号：「K-3 feat: K-1 の口を作る」の後の K-2（依存 K-1）は緑（満たす側を狭めて、前に入った取り込みを赤にしない）"""
        for subj in ("K-2 K-1 feat: まとめて作る", "K-2,K-1 feat: まとめて作る", "K-2・K-1 feat: まとめて作る"):
            with self.subTest(subj=subj):
                with tempfile.TemporaryDirectory() as d:
                    r = Repo(d)
                    r.tickets({"K-1": [], "K-2": ["K-1"]})
                    start = r.commit("K-0 base", {"README.md": "x"})
                    r.commit(subj, {"apps/a.ts": "a"})
                    bad, _, n = g.check(d, "HEAD", start)
                    self.assertEqual((bad, n), ([], 1))
        for subj in ("fix: K-2 の口を作る", "K-2〜K-3 feat: まとめて作る"):
            with self.subTest(subj=subj):
                with tempfile.TemporaryDirectory() as d:
                    r = Repo(d)
                    r.tickets({"K-1": [], "K-2": ["K-1"], "K-3": []})
                    start = r.commit("K-0 base", {"README.md": "x"})
                    c = r.commit(subj, {"apps/a.ts": "a"})
                    bad, _, n = g.check(d, "HEAD", start)
                    self.assertEqual(n, 1)
                    self.assertTrue(any(b.startswith(c[:10]) and "K-2 は K-1" in b for b in bad), bad)
        with tempfile.TemporaryDirectory() as d:
            r = Repo(d)
            r.tickets({"K-1": [], "K-2": ["K-1"], "K-3": []})
            start = r.commit("K-0 base", {"README.md": "x"})
            r.commit("K-3 feat: K-1 の口を作る", {"apps/a.ts": "a"})
            r.commit("K-2 feat: 口を使う", {"apps/b.ts": "b"})
            bad, _, n = g.check(d, "HEAD", start)
            self.assertEqual((bad, n), ([], 2))

    def test_K159_CI_022_process_config_is_not_implementation(self):
        """K159-CI-022 入力：11_tickets と ai-team.yaml だけに触る段取りのコミット（3fdbb37f「K-77 K-37 K-133 chore」の形）は、
        番号のチケットの依存が未完了でも実装に数えない（0 本・緑）。ai-team.yaml と実装のファイルの両方に触るコミットは実装に数え、赤"""
        self.r.tickets({"K-1": [], "K-2": [], "K-3": ["K-1"]})
        self.r.commit("K-3 chore: 段階の範囲と見込みを書く", {"ai-team.yaml": "flow: {}\n", "11_tickets/K-3.md": "x"})
        bad, _, n = self.check()
        self.assertEqual((bad, n), ([], 0))
        c = self.r.commit("K-3 feat: 設定と一緒に作る", {"ai-team.yaml": "flow: {a: 1}\n", "apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual(n, 1)
        self.assertTrue(any(b.startswith(c[:10]) and "K-3 は K-1" in b for b in bad), bad)

    def test_K159_CI_023_unreadable_head_tickets_raises(self):
        """K159-CI-023 失敗（TP-TOOL-02）：rev の版の tickets.json が無い・JSON でない・"tickets" が無い → RuntimeError
        （読めなければ空として全部緑にしない・main は FAIL で exit 1）"""
        for label, content in (("JSON でない", "{"), ("tickets が無い", json.dumps({"items": []})), ("ファイルが無い", None)):
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as t:
                    r = Repo(t)
                    r.tickets({"K-1": [], "K-2": ["K-1"]})
                    start = r.commit("K-0 base", {"README.md": "x"})
                    r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
                    if content is None:
                        os.remove(os.path.join(t, "11_tickets", "tickets.json"))
                        r.commit("K-2 chore: 一覧を消す")
                    else:
                        r.commit("K-2 chore: 一覧を壊す", {"11_tickets/tickets.json": content})
                    with self.assertRaises(RuntimeError):
                        g.check(t, "HEAD", start)

    def test_K159_CI_024_missing_or_null_depends_on_is_no_deps(self):
        """K159-CI-024 入力：そのコミットの版・rev の版で、チケットは載っているが depends_on の欄が無い・null → 依存なし（前と同じ）。緑"""
        self.r.write("11_tickets/tickets.json", json.dumps({"tickets": [{"id": "K-1"}, {"id": "K-2", "depends_on": None}]}))
        self.r.commit("K-2 feat: 作る", {"apps/a.ts": "a"})
        bad, _, n = self.check()
        self.assertEqual((bad, n), ([], 1))

    def test_K159_CI_025_generated_list_is_read_from_the_version(self):
        """K159-CI-025 入口（TP-TOOL-03）：文書だけかを決める生成物の一覧（scripts/ci/generated.json）は rev の版から読む。
        作業場所に未コミットで apps/a.ts を生成物と書いても、apps/a.ts に触る K-3 の実装のコミットは実装に数え、依存が無ければ赤"""
        self.r.tickets({"K-1": [], "K-2": [], "K-3": ["K-1"]})
        c = self.r.commit("K-3 feat: 作る", {"apps/a.ts": "a"})
        self.r.write("scripts/ci/generated.json", json.dumps({"generators": [{"outputs": ["apps/a.ts"]}]}))   # コミットしない
        bad, _, n = self.check()
        self.assertEqual(n, 1)
        self.assertTrue(any(b.startswith(c[:10]) and "K-3 は K-1" in b for b in bad), bad)

    def test_K159_CI_026_shared_is_doc_only_is_not_loosened(self):
        """K159-CI-026 守り：取り込む順の検査で ai-team.yaml を実装に数えないことは、共有の is_doc_only に入れない。
        is_doc_only(["ai-team.yaml"]) は False のまま。ci_scope.py の root_kind で ai-team.yaml を doc にするのは
        ci_scope.json の no_test_paths に書いた行だけ（K-156 の決まり・試験が読まない設定）で、is_doc_only からは漏れない：
        no_test_paths からその行を抜いた決まりでは root_kind("ai-team.yaml") は "unmapped"（全部を流す）"""
        import ci_scope  # noqa: PLC0415

        self.assertFalse(g.is_doc_only(["ai-team.yaml"], set()))
        rules = ci_scope.load_rules(str(HERE / "ci_scope.json"))
        without = {**rules, "no_test_paths": [p for p in rules["no_test_paths"] if p != "ai-team.yaml"]}
        self.assertEqual(ci_scope.root_kind("ai-team.yaml", without, str(ROOT)), "unmapped")
        self.assertEqual(ci_scope.root_kind("11_tickets/K-1.md", rules, str(ROOT)), "doc")

    def test_K159_CI_027_shared_generated_outputs_is_unchanged(self):
        """K159-CI-027 守り：共有の generated_outputs(root) は変えない ── 引数 1 つで呼べて、作業場所の scripts/ci/generated.json
        （未コミットでも）を読む。ci_scope.py が取り込む関数と同じもの（ci_scope の human_generated の読み元が変わらない）"""
        import ci_scope  # noqa: PLC0415

        self.assertIs(ci_scope.generated_outputs, g.generated_outputs)
        self.r.write("scripts/ci/generated.json", json.dumps({"generators": [{"outputs": ["docs/作られた.md", "apps/x.ts"]}]}))
        self.assertEqual(g.generated_outputs(self.tmp.name), {"docs/作られた.md", "apps/x.ts"})

    def test_K159_CI_028_dep_removed_then_restored_is_red(self):
        """K159-CI-028（K-1154 で替えた）：depends_on から依存を外して先に実装し、依存を作った後で戻す → 枝の先頭の depends_on の K-1 は
        枝に入っているので緑（コミットの順は見ない・answer=ee72b1756f5d）。外したのが START の版でも、枝の中で一度足した後でも同じ"""
        for label, at_start in (("START の版にあった", True), ("枝の中で一度足した", False)):
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as t:
                    r = Repo(t)
                    r.tickets({"K-1": [], "K-2": ["K-1"] if at_start else []})
                    start = r.commit("K-0 base", {"README.md": "x"})
                    if not at_start:
                        r.tickets({"K-1": [], "K-2": ["K-1"]})
                        r.commit("K-2 docs: 依存を足す")
                    r.tickets({"K-1": [], "K-2": []})
                    r.commit("K-2 feat: 依存を外して先に作る", {"apps/a.ts": "a"})
                    r.commit("K-1 feat: 依存を後から作る", {"apps/b.ts": "b"})
                    r.tickets({"K-1": [], "K-2": ["K-1"]})
                    r.commit("K-2 docs: 依存を戻す")
                    bad, _, n = g.check(t, "HEAD", start)
                    self.assertEqual((bad, n), ([], 2))

    def test_K159_CI_021_git_failure_raises(self):
        """K159-CI-021 失敗：START が無い（浅い写し・違うリポジトリ）など git が失敗 → RuntimeError（止める側・main は FAIL で exit 1）"""
        with self.assertRaises(RuntimeError):
            g.check(self.tmp.name, "HEAD", "0" * 40)


class RegressionTest(unittest.TestCase):
    def test_K159_CI_018_old_rules_still_hold(self):
        """K159-CI-018 守り（回帰）：前からの自己試験（依存より先に作れば赤・枝の外の実装は数えない・決まりの前に入った依存は通す）が緑"""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = g.selftest()
        self.assertEqual(rc, 0, out.getvalue())

    def test_K159_CI_019_real_repo_runs(self):
        """K159-CI-019 守り（TP-TOOL-02・G-16）：本物の作業場所で流せる（例外にならない）・実装のコミットを 1 本以上見る。時間を出す"""
        t0 = time.monotonic()
        _, _, n = g.check(str(ROOT))
        print(f"\n  本物の作業場所：実装のコミット {n} 本・{time.monotonic() - t0:.2f} 秒", file=sys.stderr)
        self.assertGreater(n, 0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
