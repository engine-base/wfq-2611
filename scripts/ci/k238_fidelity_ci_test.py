#!/usr/bin/env python3
"""K-238 の試験（突き合わせの CI へのつなぎ）：入っていない組の数を毎回出し、持ち主のチケットが取り込み済みなのに入っていない組を赤にする。
CI の spec の組（G69）と web の組（G70）で流れ、比べ方を変えた回も web の組が動く。

  python3 scripts/ci/k238_fidelity_ci_test.py      行 ID は K238-VF-NNN（11_tickets/K-238.md の行の表と 1 対 1）

検査：python3 scripts/ci/fidelity_config.py --owners-done --base-ref <版>
  ・設定 04_design/fidelity.json の組のうち enrolled でない組の数を「入っていない組 N / M」で出す
  ・組の持ち主が取り込み済みなのに enrolled でない組があれば 1（組の id と持ち主を同じ行に出す）
    取り込み済み＝<版> の履歴に件名が「<持ち主> 」で始まるコミットが在る（本線は早送りで進むので、取り込んだチケットのコミットは本線の履歴に載る）か、
    持ち主のチケット（11_tickets/<owner>.md）の stage が「確認中」か「完了」か、--ticket <番号> で渡した今のチケット（取り込む前の自分の CI で赤にする）か、
    持ち主が子を持つ親で、子（parent: <持ち主>）が 1 本以上あり全部が取り込み済み（子が 0 本なら前の決めのまま）
  ・持ち主の md が無い・stage が読めない（行が無い・知らない値）・<版> が読めない は 1。--base-ref が無ければ 2
作りものの設定と git の木は tempfile の中に作る。

範囲を決める台本（web_select.py・ci_scope.py・web_run.py）の 3 つ目の選ぶ先「専用の段の画面の試験」（ci_scope.json の web_select.gates）：
  G48・G59 の一覧に無く、専用の段（G70）が流す画面の試験。比べ方の道具・突き合わせの試験の道具を変えた差分で選ばれ、関係ない画面の差分では選ばれない。
  専用の段はほかにも在る（73＝Bridge の輪と Chrome・K-379）。この試験は選んだ一覧のうち 70 の答えだけを見る（K-379 の切る段で、一覧まるごとの比べから替えた）。
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import ci_scope  # noqa: E402
import web_run  # noqa: E402
import web_select  # noqa: E402
GATE = HERE / "fidelity_config.py"
SPEC = ROOT / "apps" / "web" / "tests" / "fidelity" / "fidelity.spec.ts"
STATES = ROOT / "apps" / "web" / "tests" / "_lib" / "fidelity-states.ts"
WORKFLOW = ROOT / ".github" / "workflows" / "v3-gate.yml"
SCOPE = ROOT / "scripts" / "ci" / "ci_scope.json"
COMPARE = HERE / "fidelity_compare.mjs"
TOOL = HERE / "visual_fidelity.mjs"


def clean_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


GIT_ID = ["-c", "user.name=k238", "-c", "user.email=k238@example.invalid", "-c", "commit.gpgsign=false"]


class Fake:
    def __init__(self) -> None:
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="k238-"))
        self.git("init", "-q")
        self.commit("はじめ")

    def git(self, *args: str) -> None:
        subprocess.run(["git", *GIT_ID, *args], cwd=self.root, check=True, capture_output=True, env=clean_env())

    def commit(self, subject: str) -> None:
        self.git("commit", "-q", "--allow-empty", "-m", subject)

    def write(self, rel: str, text: str) -> None:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def ticket(self, tid: str, stage: str, parent: str = "") -> None:
        head = f"parent: {parent}\n" if parent else ""
        self.write(f"11_tickets/{tid}.md", f"---\nid: {tid}\n{head}stage: {stage}\n---\n")

    def config(self, groups: list[tuple[str, str, bool]]) -> None:
        self.write("04_design/fidelity.json", json.dumps(
            {"_doc": "試し", "groups": [{"id": g, "owner": o, "enrolled": e} for g, o, e in groups]}, ensure_ascii=False))

    def run(self, *extra: str, base: str | None = "HEAD") -> subprocess.CompletedProcess:
        args = [sys.executable, str(GATE), "--root", str(self.root), "--owners-done", *extra]
        if base is not None:
            args += ["--base-ref", base]
        return subprocess.run(args, capture_output=True, text=True, env=clean_env(), cwd=self.root)

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


class OwnersDoneTest(unittest.TestCase):
    def setUp(self) -> None:
        self.f = Fake()

    def tearDown(self) -> None:
        self.f.close()

    def line_with(self, out: str, *words: str) -> bool:
        return any(all(w in line for w in words) for line in out.splitlines())

    def test_K238_VF_004_counts_not_enrolled(self) -> None:
        """K238-VF-004 持ち主が着手前・作業中で取り込まれていなければ、入っていない組があっても 0 で終わり、「入っていない組 2 / 3」を出す"""
        self.f.ticket("K-1", "未着手")
        self.f.ticket("K-2", "作業中")
        self.f.commit("K-10 feat: 別のチケット（K-1 の取り込みではない）")
        self.f.config([("a", "K-1", False), ("b", "K-2", False), ("c", "K-1", True)])
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("入っていない組 2 / 3", r.stdout)

    def test_K238_VF_005_owner_done_but_not_enrolled_is_red(self) -> None:
        """K238-VF-005 持ち主の stage が確認中・完了なのに enrolled でない組があれば 1 で、組の id と持ち主を同じ行に出す。入れれば 0"""
        for stage in ("確認中", "完了"):
            self.f.ticket("K-3", stage)
            self.f.config([("grp-done-x", "K-3", False)])
            r = self.f.run()
            self.assertEqual(r.returncode, 1, stage)
            self.assertTrue(self.line_with(r.stdout, "grp-done-x", "K-3"), r.stdout)
        self.f.config([("grp-done-x", "K-3", True)])
        self.assertEqual(self.f.run().returncode, 0)

    def test_K238_VF_018_merged_by_history_is_red(self) -> None:
        """K238-VF-018 md の stage は未着手のままでも、<版> の履歴に件名が「K-3 」で始まるコミットが在れば取り込み済みとして 1（組の id と持ち主を同じ行に）。「K-30 」は K-3 の取り込みでない"""
        self.f.ticket("K-3", "未着手")
        self.f.config([("grp-merged-y", "K-3", False)])
        self.f.commit("K-30 feat: 番号の頭が同じ別のチケット")
        self.assertEqual(self.f.run().returncode, 0, "K-30 を K-3 と数えた")
        self.f.commit("K-3 feat: 画面を直す")
        r = self.f.run()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertTrue(self.line_with(r.stdout, "grp-merged-y", "K-3"), r.stdout)
        self.assertEqual(self.f.run(base="HEAD~1").returncode, 0, "版より後のコミットを数えた")

    def test_K238_VF_006_missing_owner_ticket_is_red(self) -> None:
        """K238-VF-006 組の持ち主のチケットのファイルが無ければ 1 で、持ち主と「無い」を出す（落ちて終わらない）"""
        self.f.config([("e", "K-404", False)])
        r = self.f.run()
        self.assertEqual(r.returncode, 1)
        self.assertTrue(self.line_with(r.stdout, "K-404", "無い"), r.stdout)
        self.assertNotIn("Traceback", r.stderr)

    def test_K238_VF_019_unreadable_stage_is_red(self) -> None:
        """K238-VF-019 持ち主の md に stage の行が無い・知らない値なら 1 で持ち主を出す。「保留」は取り込み前として数える（0）"""
        self.f.config([("f", "K-5", False)])
        for text in ("---\nid: K-5\n---\n", "---\nid: K-5\nstage: なにか\n---\n"):
            self.f.write("11_tickets/K-5.md", text)
            r = self.f.run()
            self.assertEqual(r.returncode, 1, text)
            self.assertIn("K-5", r.stdout)
            self.assertNotIn("Traceback", r.stderr)
        self.f.ticket("K-5", "保留")
        self.assertEqual(self.f.run().returncode, 0)

    def test_K238_VF_020_base_required_and_readable(self) -> None:
        """K238-VF-020 --owners-done に --base-ref が無ければ 2、読めない版なら 1（履歴を見ずに緑にしない）"""
        self.f.ticket("K-1", "未着手")
        self.f.config([("a", "K-1", False)])
        self.assertEqual(self.f.run(base=None).returncode, 2)
        r = self.f.run(base="no-such-ref-k238")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertNotIn("Traceback", r.stderr)

    def test_K238_VF_029_current_ticket_counts_as_merged(self) -> None:
        """K238-VF-029 --ticket K-3 を渡すと、版の履歴にも stage にも無くても K-3 を取り込み済みとして数え、入れ忘れた組は 1（組の id と持ち主を同じ行に）。
        別の番号（K-30）を渡したときと、--ticket を渡さないときは 0"""
        self.f.ticket("K-3", "未着手")
        self.f.config([("grp-self-z", "K-3", False)])
        r = self.f.run("--ticket", "K-3")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertTrue(self.line_with(r.stdout, "grp-self-z", "K-3"), r.stdout)
        self.assertEqual(self.f.run("--ticket", "K-30").returncode, 0)
        self.assertEqual(self.f.run().returncode, 0)

    def test_K238_VF_030_parent_owner_counts_by_children(self) -> None:
        """K238-VF-030 持ち主が子を持つ親なら子だけで決める（親自身の履歴・stage は見ない）：子が残っていれば、親の件名（K-3 docs）を積んでも 0。
        最後の子の CI（--ticket K-32）では 1、子が全部取り込み済みなら 1（組の id と持ち主を同じ行に）。孫を持つ子は、その孫で決める（たどって当てる）。
        子の無い持ち主は前の決め（自分の履歴・stage・--ticket）"""
        self.f.ticket("K-3", "未着手")
        self.f.ticket("K-31", "完了", parent="K-3")
        self.f.ticket("K-32", "未着手", parent="K-3")
        self.f.ticket("K-40", "完了", parent="K-4")
        self.f.config([("grp-parent-w", "K-3", False)])
        self.f.commit("K-3 docs: 親が自分の文書を直す")
        self.assertEqual(self.f.run().returncode, 0, "子の K-32 が残っているのに、親の件名で取り込み済みと数えた")
        r = self.f.run("--ticket", "K-32")
        self.assertEqual(r.returncode, 1, "最後の子の CI で止まらない：" + r.stdout)
        self.assertTrue(self.line_with(r.stdout, "grp-parent-w", "K-3"), r.stdout)
        self.f.commit("K-32 feat: 子の残り")
        r = self.f.run()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertTrue(self.line_with(r.stdout, "grp-parent-w", "K-3"), r.stdout)
        # 孫：K-6 の子 K-61 は孫 K-611 だけを持つ。K-61 自身は件名も stage も無いが、孫が済めば済み
        self.f.ticket("K-6", "未着手")
        self.f.ticket("K-61", "未着手", parent="K-6")
        self.f.ticket("K-611", "未着手", parent="K-61")
        self.f.config([("grp-grand-u", "K-6", False)])
        self.assertEqual(self.f.run().returncode, 0)
        self.f.ticket("K-611", "完了", parent="K-61")
        r = self.f.run()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertTrue(self.line_with(r.stdout, "grp-grand-u", "K-6"), r.stdout)
        # 子の無い持ち主
        self.f.ticket("K-5", "未着手")
        self.f.config([("grp-leaf-v", "K-5", False)])
        self.assertEqual(self.f.run().returncode, 0, "子の無い持ち主を取り込み済みと数えた")

    def test_K238_VF_007_real_tree(self) -> None:
        """K238-VF-007 本物の木で 0 で終わり、入っていない組の数を出す"""
        r = subprocess.run([sys.executable, str(GATE), "--owners-done", "--base-ref", "HEAD"], cwd=ROOT,
                           capture_output=True, text=True, env=clean_env())
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"入っていない組 \d+ / \d+")


class RunnerTest(unittest.TestCase):
    def test_K238_VF_008_runner_has_no_fixed_wait(self) -> None:
        """K238-VF-008 実ブラウザの突き合わせ・画面を整える道具・比べ方の部品・道具に、決めた秒数の待ち（waitForTimeout）が無い"""
        for p in (SPEC, STATES, COMPARE, TOOL):
            self.assertNotIn("waitForTimeout", p.read_text(encoding="utf-8"), p)

    def test_K238_VF_021_tool_uses_shared_capture(self) -> None:
        """K238-VF-021 道具 visual_fidelity.mjs は fidelity_compare.mjs の capture を import して使い、自前の動きを止める CSS・aria-busy の待ち・読み直しの輪を持たない"""
        t = TOOL.read_text(encoding="utf-8")
        self.assertRegex(t, r"import\s*\{[^}]*\bcapture\b[^}]*\}\s*from\s*\"\./fidelity_compare\.mjs\"")
        self.assertRegex(t, r"\bcapture\(")
        for word in ("aria-busy", "animation:none", "SETTLE_TRIES", "readVals("):
            self.assertNotIn(word, t)

    def test_K238_VF_009_states_route_fonts(self) -> None:
        """K238-VF-009 キャンバスの外の書体の道（fonts.googleapis.com・fonts.gstatic.com）を手元の書体（@fontsource-variable/noto-sans-jp）に差し替える routeCanvasFonts は
        fidelity_compare.mjs に 1 つだけ在り、試験の部品（fidelity-states.ts）はそれを出し直し、道具（visual_fidelity.mjs）はキャンバスを開くときに使う（道具も外へ読みに行かない）"""
        c = COMPARE.read_text(encoding="utf-8")
        self.assertIn("export async function routeCanvasFonts", c)
        # 書体の部品は apps/web の node_modules にしか無い：apps/web/package.json を起点に createRequire で探す
        self.assertIn("createRequire", c)
        self.assertIn("apps/web/package.json", c)
        for word in ("fonts.googleapis.com", "fonts.gstatic.com", "@fontsource-variable/noto-sans-jp"):
            self.assertIn(word, c)
        st = STATES.read_text(encoding="utf-8")
        self.assertRegex(st, r"export\s*\{[^}]*\brouteCanvasFonts\b[^}]*\}\s*from\s*\"[./]*scripts/ci/fidelity_compare\.mjs\"")
        self.assertNotIn("fonts.gstatic.com", st, "差し替えを 2 か所に持たない")
        t = TOOL.read_text(encoding="utf-8")
        self.assertRegex(t, r"import\s*\{[^}]*\brouteCanvasFonts\b[^}]*\}\s*from\s*\"\./fidelity_compare\.mjs\"")
        self.assertRegex(t, r"\brouteCanvasFonts\(")


class WiringTest(unittest.TestCase):
    def test_K238_VF_010_runs_in_ci(self) -> None:
        """K238-VF-010 spec の組に G69（設定の検査・入っていない組・K-216 と K-238 の試験）、web の組に G70（実ブラウザの突き合わせ）が 1 つずつ在り、continue-on-error が無い"""
        wf = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
        g69 = [s for s in wf["jobs"]["spec"]["steps"] if str(s.get("name", "")).startswith("G69 ")]
        web = wf["jobs"]["web"]["steps"]
        g70 = [s for s in web if str(s.get("name", "")).startswith("G70 ")]
        self.assertEqual((len(g69), len(g70)), (1, 1))
        names = [str(s.get("name", "")) for s in web]
        g59 = [i for i, n in enumerate(names) if n.startswith("G59 ")]
        self.assertEqual(len(g59), 1)
        self.assertGreater(names.index(g70[0]["name"]), g59[0], "G70 は G59 が立てた画面を使うので G59 より後")
        # 入れた組を弱めても緑になる旗は CI で使わない（K-216 の申し送り）
        for s in (g69[0], g70[0]):
            for bad in ("--no-base", "--required", "--report-only"):
                self.assertNotIn(bad, s["run"])
        self.assertRegex(g69[0]["run"], r"fidelity_config\.py --owners-done --base-ref \"\$CI_BASE\" \$\{CI_TICKET:\+--ticket \"\$CI_TICKET\"\}")
        self.assertEqual((g69[0].get("env") or {}).get("CI_TICKET"), "${{ inputs.ticket }}", "今のチケットを見張りに渡す（空の回は --ticket を足さない）")
        for want in ("python3 scripts/ci/fidelity_config.py --base-ref \"$CI_BASE\"", "python3 scripts/ci/k238_fidelity_ci_test.py"):
            self.assertIn(want, g69[0]["run"])
        # 自己試験と K-216 の試験 2 本は G65 が持つ（二重に流さない）
        g65 = [s for s in wf["jobs"]["spec"]["steps"] if str(s.get("name", "")).startswith("G65 ")]
        self.assertEqual(len(g65), 1)
        for once in ("fidelity_config.py --selftest", "k216_fidelity_config_test.py", "k216_fidelity_compare.test.mjs"):
            self.assertIn(once, g65[0]["run"])
            self.assertNotIn(once, g69[0]["run"])
        # G70 は範囲の台本が選んだ専用の段の試験だけを流す（全部の回は設定の一覧）
        self.assertIn("python3 scripts/ci/web_run.py gate 70", g70[0]["run"])
        # 範囲の台本の一覧が組をまたいで渡る（static の outputs → G48・G59・G70 の env）
        self.assertEqual(wf["jobs"]["static"]["outputs"].get("web_gates"), "${{ steps.scope.outputs.web_gates }}")
        for n in ("G48 ", "G59 ", "G70 "):
            step = [s for s in web if str(s.get("name", "")).startswith(n)]
            self.assertEqual(len(step), 1, n)
            self.assertEqual((step[0].get("env") or {}).get("CI_WEB_GATES"), "${{ needs.static.outputs.web_gates }}", n)
        g70env = g70[0].get("env") or {}
        self.assertEqual(g70env.get("CI_WEB_SPECS"), "${{ needs.static.outputs.web_g48 }}")
        self.assertEqual(g70env.get("CI_WEB_OTHER"), "${{ needs.static.outputs.web_g59 }}")
        self.assertIn("needs.static.outputs.web_gates", str(g70[0].get("env", "")))
        self.assertIn("needs.static.outputs.full", str(g70[0].get("env", "")))
        for s in (g69[0], g70[0]):
            self.assertNotIn("continue-on-error", s)

    def test_K238_VF_011_web_job_wakes_on_compare_changes(self) -> None:
        """K238-VF-011 比べ方（scripts/ci/fidelity_compare.mjs・visual_fidelity.mjs）を変えた回も web の組が動く（ci_scope.json の jobs.web.paths に在る。04_design/** は前から在る）"""
        paths = json.loads(SCOPE.read_text(encoding="utf-8"))["jobs"]["web"]["paths"]
        for p in ("scripts/ci/fidelity_compare.mjs", "scripts/ci/visual_fidelity.mjs", "04_design/**"):
            self.assertIn(p, paths)


FID = "apps/web/tests/fidelity/fidelity.spec.ts"
STATES_REL = "apps/web/tests/_lib/fidelity-states.ts"
G48 = ["apps/web/tests/k/a.spec.ts"]
G59 = ["apps/web/tests/skeleton/m1.spec.ts"]
IMP = {STATES_REL: {FID}, "apps/web/tests/_lib/row.ts": {"apps/web/tests/k/a.spec.ts"}}
TICKETS = {
    "K-1": {"tests": ["apps/web/tests/k/a.spec.ts"], "changes": ["apps/web/app/a/page.tsx"], "depends_on": []},
    "K-2": {"tests": [FID, "scripts/ci/x_test.py"], "changes": ["scripts/ci/fidelity_config.py"], "depends_on": []},
    "K-3": {"tests": ["apps/web/tests/skeleton/m1.spec.ts"], "changes": [], "depends_on": []},
    "K-4": {"tests": [], "changes": [], "depends_on": ["K-2"]},
}


def web_cfg() -> dict:
    return json.loads(SCOPE.read_text(encoding="utf-8"))["web_select"]


def pick(changed: list[str], ticket: str = "K-99", cfg: dict | None = None) -> dict:
    t = {**TICKETS, ticket: TICKETS.get(ticket, {"tests": [], "changes": [], "depends_on": []})}
    return web_select.select(changed, ticket, t, G48, G59, IMP, web_cfg() if cfg is None else cfg)


class GateSelectTest(unittest.TestCase):
    def test_K238_VF_024_fidelity_changes_pick_gate(self) -> None:
        """K238-VF-024 比べ方の道具（fidelity_compare.mjs・visual_fidelity.mjs）・突き合わせの試験の道具（fidelity-states.ts）・突き合わせの試験そのものを変えた差分で、
        専用の段 70 に突き合わせの試験が選ばれ、web の組が起き（止める文が出ない）、G48・G59 は空のまま"""
        cases = [(f, "K-99") for f in ("scripts/ci/fidelity_compare.mjs", "scripts/ci/visual_fidelity.mjs", STATES_REL, FID,
                                         "04_design/fidelity.json", "04_design/canvas/Main.dc.html")]
        cases += [("README.md", "K-2"),                       # チケット自身の tests に在る
                  ("README.md", "K-4"),                       # depends_on のチケットの tests に在る
                  ("scripts/ci/fidelity_config.py", "K-99")]  # その試験を持つチケットの changes のファイルを変えた
        for f, tid in cases:
            r = pick([f], tid)
            f = f"{f}（{tid}）"
            self.assertEqual(r["gates"]["70"], [FID], f)
            self.assertEqual((r["g48"], r["g59"]), ([], []), f)
            p = {"mode": "ticket", "jobs": {"unit": False, "database": False, "web": True}, "errors": [], "reasons": []}
            out = ci_scope.with_web_selection(p, r)
            self.assertTrue(out["jobs"]["web"], f)
            self.assertEqual(out["errors"], [], f)
            self.assertEqual(json.loads(ci_scope.outputs({**self.base_plan(), **out})["web_gates"])["70"], [FID])

    def test_K238_VF_024_web_off_stays_off(self) -> None:
        """K238-VF-024 web の組が起きていない回（jobs.web が False）は、専用の段に当たっても False のまま（起こすかは jobs.web の地図が決める）。止める文は出さず web_gates は出す"""
        r = pick(["scripts/ci/fidelity_config.py"], "K-99")
        p = {"mode": "ticket", "jobs": {"unit": False, "database": False, "web": False}, "errors": [], "reasons": []}
        out = ci_scope.with_web_selection(p, r)
        self.assertFalse(out["jobs"]["web"])
        self.assertEqual(out["errors"], [])
        self.assertEqual(out["web_gates"]["70"], [FID])

    @staticmethod
    def base_plan() -> dict:
        return {"mode": "ticket", "unit_shards": 0, "unit_files": [], "migration_files": [], "coverage_args": [], "base": "",
                "reasons": [], "mismatches": [], "errors": []}

    def test_K238_VF_025_unrelated_screen_does_not_pick_gate(self) -> None:
        """K238-VF-025 関係ない画面の差分（別のチケットの画面のコード・別の試験の部品）では専用の段 70 は選ばれない（G48 の答えは前と同じ）"""
        for f in ("apps/web/app/a/page.tsx", "apps/web/tests/_lib/row.ts"):
            r = pick([f])
            self.assertEqual(r["gates"]["70"], [], f)
            self.assertEqual(r["g48"], ["apps/web/tests/k/a.spec.ts"], f)
        # 入れた組が有っても、画面の部品でない差分（関係ないファイル・別の試験の部品）では専用の段を選ばない（K-1105 で「必ず選ぶ」から替えた：
        # 組は、その組の頁が import で辿って読む部品を変えたときに選ぶ。頁の見つからない組は、どの部品を変えても選ぶ）。G48 の答えは同じ。
        # ci_scope が実際に選ぶ所（_web_pick）を偽の木に当てる。fidelity.json が無い・壊れているときも例外で落ちない（形の誤りは G69 が赤にする）
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="k238-gate-"))
        try:
            (tmp / "04_design").mkdir()
            (tmp / "11_tickets").mkdir()
            rules = {"web_select": web_cfg(), "spec": {}}
            plan = {"changes": [ci_scope.Change("M", "README.md", None)]}
            part = {"changes": [ci_scope.Change("M", "apps/web/features/x.tsx", None)]}
            for text, part_want in ((json.dumps({"groups": [{"id": "g", "enrolled": True}]}), [FID]),
                                    (json.dumps({"groups": [{"id": "g", "enrolled": False}]}), None),
                                    (None, None), ("{oops", None)):
                f = tmp / "04_design" / "fidelity.json"
                if text is None:
                    f.unlink(missing_ok=True)
                else:
                    f.write_text(text, encoding="utf-8")
                r = ci_scope._web_pick(str(tmp), str(tmp / "11_tickets"), rules, plan, "K-99")
                self.assertEqual(r["gates"]["70"], [], text)
                r = pick(["apps/web/tests/_lib/row.ts"], cfg=ci_scope.gate_cfg(str(tmp), web_cfg()))
                self.assertEqual((r["gates"]["70"], r["g48"], r["g59"]), ([], ["apps/web/tests/k/a.spec.ts"], []), text)
                if part_want is not None:   # 入れた組（頁の無い組 g）が在る：部品を変えた差分では選ぶ
                    r = ci_scope._web_pick(str(tmp), str(tmp / "11_tickets"), rules, part, "K-99")
                    self.assertEqual(r["gates"]["70"], part_want, text)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_K238_VF_026_gate_tests_must_exist(self) -> None:
        """K238-VF-026 専用の段の設定に書いた試験が実ファイルとして無ければ赤（本物の木は 0 件・無い試験は道と段を出す）"""
        self.assertEqual(web_select.check_gates(str(ROOT), web_cfg()), [])
        cfg = {**web_cfg(), "gates": {"70": {"tests": ["apps/web/tests/fidelity/no-such.spec.ts"], "on": []}}}
        errs = web_select.check_gates(str(ROOT), cfg)
        self.assertEqual(len(errs), 1)
        self.assertIn("no-such.spec.ts", errs[0])
        self.assertIn("70", errs[0])
        # 段の番号に対応する web_run.py gate <番号> の段が workflow に無い（選んでも誰も流さない）
        errs = web_select.check_gates(str(ROOT), {**web_cfg(), "gates": {"71": {"tests": [FID], "on": []}}})
        self.assertTrue(any("71" in e and "web_run.py gate 71" in e for e in errs), errs)
        # 専用の段の試験が G48 の一覧にも在る（2 回流れる）
        dup = web_select.domain_g48(str(ROOT))[0]
        errs = web_select.check_gates(str(ROOT), {**web_cfg(), "gates": {"70": {"tests": [FID, dup], "on": []}}})
        self.assertTrue(any(dup in e and "G48" in e for e in errs), errs)

    def test_K238_VF_027_old_two_targets_unchanged(self) -> None:
        """K238-VF-027 前からの 2 つの選ぶ先（G48・G59）と持ち主の答えは、専用の段の設定が有っても無くても同じ"""
        without = {k: v for k, v in web_cfg().items() if k != "gates"}
        cases = [(["apps/web/app/a/page.tsx"], "K-99"), (["apps/web/tests/_lib/row.ts"], "K-99"), (["README.md"], "K-3"),
                 (["scripts/ci/fidelity_compare.mjs"], "K-2"), (["apps/web/package.json"], "K-99")]
        for changed, tid in cases:
            a, b = pick(changed, tid), pick(changed, tid, without)
            self.assertEqual((a["g48"], a["g59"], a["tasks"]), (b["g48"], b["g59"], b["tasks"]), changed)
        self.assertEqual(pick(["apps/web/package.json"])["gates"]["70"], [FID], "画面の試験の設定を変えたら専用の段も全部")
        # 全部に倒れる回（共通の画面のコード・トークンの CSS）は専用の段も全部（見た目にいちばん効く変更で突き合わせを流す）
        for f in ("apps/web/styles/k-tokens.css", "apps/web/components/k/shell.tsx"):
            r = pick([f])
            self.assertEqual(r["gates"]["70"], [FID], f)
            self.assertEqual(r["g48"], G48, f)

    def test_K238_VF_028_runner_runs_only_selected(self) -> None:
        """K238-VF-028 web_run の専用の段：全部の回は設定の一覧・範囲の回は選んだ試験だけ・選ばれなければ何も流さない。
        専用の段だけが選ばれた回に G48・G59 は「壊れている」で止まらない"""
        cfg_tests = web_cfg()["gates"]["70"]["tests"]
        self.assertEqual(web_run.gate_commands("70", True, {}, cfg_tests),
                         [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", "tests/fidelity/fidelity.spec.ts"]])
        self.assertEqual(web_run.gate_commands("70", False, {"70": [FID]}, cfg_tests),
                         [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", "tests/fidelity/fidelity.spec.ts"]])
        self.assertEqual(web_run.gate_commands("70", False, {"70": []}, cfg_tests), [])
        env = {**clean_env(), "CI_FULL": "false", "CI_WEB_SPECS": "[]", "CI_WEB_OTHER": "[]", "CI_WEB_GATES": json.dumps({"70": [FID]})}
        for part in ("g48", "g59"):
            r = subprocess.run([sys.executable, str(HERE / "web_run.py"), part], capture_output=True, text=True, env=env, cwd=ROOT)
            self.assertEqual(r.returncode, 0, part + r.stdout)
        env["CI_WEB_GATES"] = json.dumps({"70": []})
        r = subprocess.run([sys.executable, str(HERE / "web_run.py"), "g48"], capture_output=True, text=True, env=env, cwd=ROOT)
        self.assertEqual(r.returncode, 1, "どの段にも流す物が無いのに web の組が動いた（壊れている）を黙って緑にしない")

        def gate(**over: str) -> int:
            e = {**clean_env(), "CI_FULL": "false", "CI_WEB_SPECS": "[]", "CI_WEB_OTHER": "[]", **over}
            e = {k: v for k, v in e.items() if v != "<無い>"}
            return subprocess.run([sys.executable, str(HERE / "web_run.py"), "gate", "70"], capture_output=True, text=True,
                                  env=e, cwd=ROOT).returncode
        # 範囲の回に一覧が渡っていない（無い・空・JSON でない・"70" の鍵が無い）は 1
        for bad in ("<無い>", "", "{oops", "{}"):
            self.assertEqual(gate(CI_WEB_GATES=bad), 1, repr(bad))
        # "70" が空でも G48 か G59 に流す物があれば 0（この段は選ばれなかっただけ）、3 つとも空なら 1
        self.assertEqual(gate(CI_WEB_GATES='{"70": []}', CI_WEB_SPECS='["apps/web/tests/k/a.spec.ts"]'), 0)
        self.assertEqual(gate(CI_WEB_GATES='{"70": []}', CI_WEB_OTHER='["apps/web/tests/skeleton/m1.spec.ts"]'), 0)
        self.assertEqual(gate(CI_WEB_GATES='{"70": []}'), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
