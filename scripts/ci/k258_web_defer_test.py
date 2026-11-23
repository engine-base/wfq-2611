#!/usr/bin/env python3
"""K-258 の試験：チケットの CI で画面の試験の組（web）を後回しにできる入口を作り、web の組の「同時に 1 つだけ」を外す。

  python3 scripts/ci/k258_web_defer_test.py      全部の行（行 ID は K258-CI-NNN。11_tickets/K-258.md の行の表と 1 対 1）

見る物：作り手（05_flow/build_testplan.py）が作った CI の定義（.github/workflows/v3-gate.yml）と、作り手の字。
web の組の if は、GitHub の式の小さな読み手（このファイルの eval_if）で、入力と static の出力の組み合わせごとに本当に評価する
（字があるかだけでは、条件の向きを取り違えても緑になるため）。
流す試験は 1 本も減らさない：defer は「この回は流さない」だけで、web の組の段（G48・G59・G70）はそのまま残る。
"""
from __future__ import annotations

import pathlib
import re
import unittest

import yaml
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from k640_runs_on_test import default_of  # noqa: E402  変数 CI_RUNNER が無いときの台（K-640）

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WF_PATH = ROOT / ".github" / "workflows" / "v3-gate.yml"
BUILDER = ROOT / "05_flow" / "build_testplan.py"
FLOW_CFG = ROOT / "ticket-flow.yaml"
ME = "python3 scripts/ci/k258_web_defer_test.py"

WF_TEXT = WF_PATH.read_text(encoding="utf-8")
WF = yaml.safe_load(WF_TEXT)
JOBS = WF["jobs"]
ON = WF.get("on", WF.get(True))   # YAML 1.1 は on を真偽に読むことがある
BUILDER_TEXT = BUILDER.read_text(encoding="utf-8")
WEB_GATES = ("G48 ", "G59 ", "G70 ")


def eval_if(expr: str, *, inputs_web: str, static_web: str, cancelled: bool = False, on_defer: str = "false") -> bool:
    """組の if（${{ … }}）を、この試験で使う語だけの小さな読み手で評価する。知らない語があれば止める（黙って真にしない）"""
    m = re.fullmatch(r"\s*\$\{\{(.*)\}\}\s*", expr, re.S)
    body = m.group(1) if m else expr
    known = {
        "needs.static.outputs.web_on_defer": repr(on_defer),   # K-1105：長い名前を先に置き換える（web の頭が同じ）
        "inputs.web": repr(inputs_web),
        "needs.static.outputs.web": repr(static_web),
    }
    py = body
    for k, v in known.items():
        py = py.replace(k, v)
    py = py.replace("!cancelled()", repr(not cancelled)).replace("cancelled()", repr(cancelled))
    py = py.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"!(?!=)", " not ", py)
    left = re.sub(r"'[^']*'|\b(and|or|not|True|False)\b|==|!=|[()\s]", "", py)
    if left:
        raise AssertionError(f"if の式に、この試験の読み手が知らない語がある：{left!r}（式：{expr}）")
    return bool(eval(py, {"__builtins__": {}}, {}))  # noqa: S307 — 上で語を確かめた式だけ


def web_if() -> str:
    return str(JOBS["web"]["if"])


class WebInput(unittest.TestCase):
    def test_K258_CI_001_dispatch_has_web_choice_run_defer_default_run(self):
        inputs = ON["workflow_dispatch"]["inputs"]
        self.assertIn("web", inputs, "workflow_dispatch に入力 web がある")
        web = inputs["web"]
        self.assertEqual(web.get("type"), "choice")
        self.assertEqual(list(web.get("options") or []), ["run", "defer"], "選べるのは run と defer の 2 つだけ")
        self.assertEqual(web.get("default"), "run", "入力を渡さない回・手で押した回は今までどおり流す")
        desc = str(web.get("description", ""))
        self.assertIn("defer", desc)
        self.assertIn("ci.py web", desc, "後回しにした分を流す入口（ticket-flow の ci.py web）を説明に書く")
        # 前からの入力はそのまま
        for k in ("scope", "ticket", "base", "target"):
            self.assertIn(k, inputs)
        self.assertEqual(inputs["scope"]["default"], "full")


class WebIf(unittest.TestCase):
    def test_K258_CI_002_web_job_if_skips_only_on_defer(self):
        expr = web_if()
        self.assertIn("inputs.web != 'defer'", expr.replace('"', "'"))
        self.assertIn("needs.static.outputs.web == 'true'", expr.replace('"', "'"), "今の条件（範囲の答え）は残す")
        self.assertIn("!cancelled()", expr, "今の条件（取り消された回は流さない）は残す")
        # 入力が空（push・入力を持たない回）・run・defer × static の答え
        self.assertTrue(eval_if(expr, inputs_web="", static_web="true"), "入力が空の回は今までどおり流れる")
        self.assertTrue(eval_if(expr, inputs_web="run", static_web="true"), "run は流れる")
        self.assertFalse(eval_if(expr, inputs_web="defer", static_web="true"), "defer の回は流れない")
        # K-1105：defer の回でも、範囲の台本が「突き合わせ（G70）に当たる部品を変えた」印（web_on_defer）を立てたら組は起きる（流すのは G70 だけ）
        self.assertTrue(eval_if(expr, inputs_web="defer", static_web="true", on_defer="true"), "defer でも印が立てば G70 のために流れる")
        self.assertFalse(eval_if(expr, inputs_web="defer", static_web="false", on_defer="true"), "範囲の外なら印があっても流れない")
        for w in ("", "run", "defer"):
            with self.subTest(inputs_web=w):
                self.assertFalse(eval_if(expr, inputs_web=w, static_web="false"), "範囲の外なら入力にかかわらず流れない")
                self.assertFalse(eval_if(expr, inputs_web=w, static_web="true", cancelled=True), "取り消された回は流れない")

    def test_K258_CI_009_reader_refuses_unknown_words(self):
        # 読み手が知らない語を黙って真にしないこと（この試験の土台の確かめ）
        with self.assertRaises(AssertionError):
            eval_if("${{ github.event_name == 'push' }}", inputs_web="", static_web="true")


class WebConcurrency(unittest.TestCase):
    def test_K258_CI_003_web_job_runs_in_parallel_across_runs(self):
        web = JOBS["web"]
        self.assertNotIn("concurrency", web, "web の組は回をまたいで同時に走れる（組ごとに使い捨ての VM・番号は VM の中だけ）")
        self.assertNotIn("kaname-web", WF_TEXT, "kaname-web の group が CI の定義のどこにも無い")
        self.assertEqual(default_of(web.get("runs-on")), ["self-hosted", "linux-vm"], "組ごとに使い捨ての Linux の VM で走る（同時に走れる前提）")
        # 定義の頭の concurrency（同じ枝の古い回を止める）はそのまま
        self.assertEqual(WF.get("concurrency"), {"group": "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": True})
        # 古いコメント（Mac の台は 1 台・同時に 1 つだけ）を残さない
        self.assertNotIn("回をまたいで同時に 1 つだけ", WF_TEXT)

    def test_K258_CI_004_only_web_job_if_reads_inputs_web(self):
        hits = []
        for name, job in JOBS.items():
            if "inputs.web" in str(job.get("if", "")):
                hits.append(f"{name}.if")
            if "inputs.web" in str(job.get("env", "")):
                hits.append(f"{name}.env")
            for st in job.get("steps", []):
                if "inputs.web" in str(st):
                    # K-631：画面の型の確かめ（static の組の 1 段）は、web=run の回に二重に流さないため inputs.web を読む
                    is_types = name == "static" and "next typegen" in str(st.get("run", "")) and "inputs.web != 'run'" in str(st.get("if", ""))
                    # K-1105：static の範囲の台本（G0・id: scope）は入力 web を受け、defer の回に G70 だけを選ぶ
                    is_scope = name == "static" and st.get("id") == "scope" and (st.get("env") or {}).get("CI_WEB_INPUT") == "${{ inputs.web }}"
                    hits.append(f"{name}: types" if is_types else (f"{name}: scope" if is_scope else f"{name}: {st.get('name')}"))
        self.assertEqual(sorted(hits), ["static: scope", "static: types", "web.if"],
                         "inputs.web を読むのは web の組の if と、画面の型の確かめの段（K-631）と、範囲の台本（G0・K-1105）だけ（ほかの組・段は今までどおり）")
        self.assertNotIn("inputs.web", str(WF.get("env", "")))


class OtherJobs(unittest.TestCase):
    def test_K258_CI_005_junit_collects_even_when_web_skipped(self):
        junit = JOBS["junit"]
        self.assertIn("web", junit.get("needs") or [], "junit は web の組を待ったまま（流れた回は web の JUnit もまとめる）")
        self.assertEqual(str(junit.get("if")), "always()", "web が飛ばされた（skipped）回でも junit の組は走って緑で終わる")
        self.assertNotIn("web", JOBS["auto-merge"].get("needs") or [], "取り込みの組は web を待たない（今までどおり）")
        for name, job in JOBS.items():
            if name in ("web", "junit"):
                continue
            with self.subTest(name):
                self.assertNotIn("web", job.get("needs") or [], "web を待つ組を新しく作らない（飛ばされると連れて飛ぶ）")

    def test_K258_CI_006_web_steps_kept(self):
        names = [str(s.get("name", "")) for s in JOBS["web"]["steps"]]
        for g in WEB_GATES:
            with self.subTest(g):
                self.assertEqual(sum(n.startswith(g) for n in names), 1, f"web の組の {g.strip()} の段は残る（試験を減らさない）")
        for st in JOBS["web"]["steps"]:
            self.assertNotIn("defer", str(st.get("if", "")), "defer で外れるのは組ごと。段ごとに外して一部だけ流す形にしない")
        self.assertIn("web", JOBS["static"].get("outputs") or {}, "範囲の答え web は今までどおり出る")


class Builder(unittest.TestCase):
    def test_K258_CI_007_builder_makes_same_shape(self):
        self.assertIn("web:", BUILDER_TEXT)
        self.assertIn("options: [run, defer]", BUILDER_TEXT, "作り手が入力 web を作る（v3-gate.yml は作り直す生成物）")
        self.assertIn("inputs.web != 'defer'", BUILDER_TEXT, "作り手が web の組の if を作る")
        self.assertNotIn("group: kaname-web", BUILDER_TEXT, "作り手が web の組の concurrency を作らない")

    def test_K258_CI_008_g65_runs_this_test_every_time(self):
        g65 = [s for s in JOBS["spec"]["steps"] if str(s.get("name", "")).startswith("G65 ")]
        self.assertEqual(len(g65), 1)
        self.assertIn(ME, str(g65[0].get("run", "")), "CI の形の試験（G65）でこの試験が毎回流れる（作り直しで形が戻らない）")
        self.assertIn("python3 scripts/ci/k172_ci_shape_test.py", str(g65[0].get("run", "")), "前からの試験も残る")
        import sys  # noqa: E402
        sys.path.insert(0, str(ROOT / "scripts" / "ci"))
        import gate_cmds  # noqa: E402  G65 の並びは scripts/ci/g65.d から作り手が作る（K-376）
        self.assertIn(ME, gate_cmds.commands(ROOT / "scripts" / "ci" / "g65.d", last="python3 scripts/ci/k248_scope_reach_test.py"))


class FlowConfig(unittest.TestCase):
    def test_K258_CI_010_ticket_flow_defers_web_rows(self):
        ci = (yaml.safe_load(FLOW_CFG.read_text(encoding="utf-8")) or {}).get("ci") or {}
        self.assertIs(ci.get("web_defer"), True, "チケットの CI は画面の行を後回しにする（ci.py が web=defer を渡す）")
        self.assertEqual(ci.get("web_rows"), "-UI-", "後回しにする行は行 ID に -UI- を含む行")
        inputs = ci.get("inputs") or {}
        self.assertEqual(inputs.get("web"), "web", "入力の名前 web を CI の定義の入力 web に渡す")
        for k in ("scope", "ticket", "base"):
            self.assertEqual(inputs.get(k), k, "前からの入力は残る")
        self.assertEqual(ci.get("workflow"), "v3-gate.yml")


if __name__ == "__main__":
    unittest.main(verbosity=2)
