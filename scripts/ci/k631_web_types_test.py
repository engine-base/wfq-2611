#!/usr/bin/env python3
"""K-631 の試験：チケットの CI が画面の試験を後回しにする回（web=defer）でも、画面の組み立ての型の確かめは流れる。

  python3 scripts/ci/k631_web_types_test.py      全部の行（行 ID は K631-CI-NNN。11_tickets/K-631.md の行の表と 1 対 1）

見る物：作り手（05_flow/build_testplan.py）が作った CI の定義（.github/workflows/v3-gate.yml）と、手元の CI に出す前の検査の設定
（ticket-flow.yaml の preflight_jobs）。段の if は、GitHub の式の小さな読み手（このファイルの eval_if）で、入力と static の出力の
組み合わせごとに本当に評価する（字があるかだけでは、条件の向きを取り違えても緑になるため）。命令は、偽の pnpm を PATH に置いて
本物の bash で流し、「typegen の後に tsc・どちらが落ちても段が落ちる」を確かめる（node を使わない・決まった時間で終わる）。
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
WF = yaml.safe_load((ROOT / ".github" / "workflows" / "v3-gate.yml").read_text(encoding="utf-8"))
CFG = yaml.safe_load((ROOT / "ticket-flow.yaml").read_text(encoding="utf-8"))
JOBS = WF["jobs"]
TYPES_MARK = "next typegen"


def eval_if(expr: str, *, inputs_web: str, static_web: str, cancelled: bool = False) -> bool:
    """段・組の if（${{ … }}）を、この試験で使う語だけの小さな読み手で評価する。知らない語があれば止める（黙って真にしない）"""
    m = re.fullmatch(r"\s*\$\{\{(.*)\}\}\s*", str(expr), re.S)
    py = m.group(1) if m else str(expr)
    # K-1105：web の組の if の web_on_defer（G70 に当たる部品を変えた印）は、この試験では立たない回（"false"）として読む。長い名前を先に置き換える
    known = {"needs.static.outputs.web_on_defer": repr("false"), "inputs.web": repr(inputs_web), "needs.static.outputs.web": repr(static_web), "steps.scope.outputs.web": repr(static_web)}
    for k, v in known.items():
        py = py.replace(k, v)
    py = py.replace("!cancelled()", repr(not cancelled)).replace("cancelled()", repr(cancelled))
    py = py.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"!(?!=)", " not ", py)
    left = re.sub(r"'[^']*'|\b(and|or|not|True|False)\b|==|!=|[()\s]", "", py)
    if left:
        raise AssertionError(f"if の式に、この試験の読み手が知らない語がある：{left!r}（式：{expr}）")
    return bool(eval(py, {"__builtins__": {}}, {}))  # noqa: S307 — 上で語を確かめた式だけ


def type_steps() -> list[tuple[str, dict]]:
    """next typegen を呼ぶ段を、全部の組から集める（組の名前と段）"""
    return [(job, st) for job, j in JOBS.items() for st in j.get("steps", []) if TYPES_MARK in str(st.get("run", ""))]


def the_step() -> tuple[str, dict]:
    found = type_steps()
    assert len(found) == 1, f"画面の型の確かめの段がちょうど 1 つ（見つかった数 {len(found)}：{[j for j, _ in found]}）"
    return found[0]


def step_runs(web_in: str, static_web: str) -> bool:
    return eval_if(the_step()[1].get("if", "true"), inputs_web=web_in, static_web=static_web)


def web_job_builds(web_in: str, static_web: str) -> bool:
    """web の組が流れるか（流れれば `build:test`＝next build の型の確かめも流れる）"""
    return eval_if(JOBS["web"].get("if", "true"), inputs_web=web_in, static_web=static_web)


class DeferStillChecksTypes(unittest.TestCase):
    def test_K631_CI_001_defer_round_with_screens_still_runs_the_type_check(self):
        job, st = the_step()
        self.assertEqual(job, "static", "DB もブラウザも要らない組（static）に置く：出す前の手元の検査（preflight_jobs）もこの組を流す")
        self.assertTrue(step_runs("defer", "true"), "画面の範囲を含み、画面の試験を後回しにする回（web=defer）でも型の確かめは流れる")
        self.assertFalse(web_job_builds("defer", "true"), "（前提）defer の回は web の組＝next build が流れない。だから型の段が要る")
        self.assertIn("steps.scope.outputs.web", str(st.get("if")), "条件は範囲の台本（G0）の答え web を読む")
        steps = JOBS["static"]["steps"]
        scope_at = [i for i, x in enumerate(steps) if x.get("id") == "scope"]
        self.assertEqual(len(scope_at), 1, "static の組に id: scope の段（G0）がちょうど 1 つ")
        self.assertGreater(steps.index(st), scope_at[0], "型の段は G0 より後ろ（前に置くと出力 web が空で、一度も流れない静かな死に段になる）")

    def test_K631_CI_002_not_run_twice_and_not_without_screens(self):
        self.assertFalse(step_runs("run", "true"), "web=run の回は web の組の next build が同じ型を見る。二重に流さない")
        self.assertTrue(web_job_builds("run", "true"))
        self.assertFalse(step_runs("defer", "false"), "画面の範囲を含まない回は流さない")
        self.assertFalse(step_runs("run", "false"))
        self.assertFalse(eval_if(the_step()[1].get("if", "true"), inputs_web="defer", static_web="true", cancelled=True), "取り消された回は流さない")
        for web_in in ("run", "defer"):   # 入力の 2 つの値のどちらでも、型の確かめが流れる道はちょうど 1 つ
            ran = int(step_runs(web_in, "true")) + int(web_job_builds(web_in, "true"))
            self.assertEqual(ran, 1, f"web={web_in} の回で、型を見る道（型の段・web の組の build）がちょうど 1 つ流れる（実際 {ran}）")

    def test_K631_CI_003_the_step_is_light_and_in_the_pre_push_check(self):
        job, st = the_step()
        run = str(st["run"])
        self.assertRegex(run, r"NEXT_DIST_DIR=\.next-prod\s+pnpm[^&]*next typegen\s*&&[^&]*tsc --noEmit",
                         "route の型を .next-prod に作ってから tsc。出力先は build:test と同じ：tsconfig は .next を除き .next-prod/types だけを数えるので、揃えないと Link の型（link.d.ts）とページの型（validator.ts）が tsc に入らず、next build より弱い確かめになる")
        web_dir = ROOT / "apps" / "web"
        self.assertIn(".next-prod/types/**/*.ts", (web_dir / "tsconfig.json").read_text(encoding="utf-8"), "（前提）tsc が数える route の型の置き場")
        self.assertIn("NEXT_DIST_DIR=.next-prod", json.loads((web_dir / "package.json").read_text(encoding="utf-8"))["scripts"]["build:test"], "（前提）build:test の出力先も .next-prod")
        self.assertIn("@kaname/web", run, "画面（apps/web）の型を見る")
        for heavy in ("build:test", "next build", "docker", "playwright", "db:migrate"):
            self.assertNotIn(heavy, run, f"軽い段にする（{heavy} を呼ばない）")
        self.assertIn("static", CFG["preflight_jobs"], "出す前の手元の検査は static を流す。この段もそこで流れる")
        self.assertNotIn("web", CFG["preflight_jobs"], "出す前の手元の検査は web の組を流さない（だから型の段は static に要る）")
        self.assertTrue(step_runs("", "true"), "出す前の手元の検査は web の入力を渡さない（空）。それでも流れる")
        builds = [s for s in JOBS["web"]["steps"] if "build:test" in str(s.get("run", ""))]
        self.assertEqual(len(builds), 1, "web の組の next build（build:test）は前のまま 1 つ")
        self.assertIn("inputs.web != 'defer'", str(JOBS["web"]["if"]).replace('"', "'"), "web の組の条件（defer は組ごと流さない）は変えない")

    def test_K631_CI_004_a_red_type_check_fails_the_step(self):
        run = str(the_step()[1]["run"])
        with tempfile.TemporaryDirectory() as d:
            log = pathlib.Path(d) / "calls.log"
            fake = pathlib.Path(d) / "pnpm"
            fake.write_text(
                "#!/bin/bash\n"
                f'echo "$*" >> "{log}"\n'
                'case "$*" in *typegen*) exit "${FAKE_TYPEGEN:-0}";; *tsc*) exit "${FAKE_TSC:-0}";; esac\n',
                encoding="utf-8")
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)

            def go(typegen: int, tsc: int) -> tuple[int, list[str]]:
                log.write_text("", encoding="utf-8")
                env = {**os.environ, "PATH": f"{d}:{os.environ['PATH']}", "FAKE_TYPEGEN": str(typegen), "FAKE_TSC": str(tsc)}
                r = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", run], cwd=d, env=env, capture_output=True, text=True, timeout=30)
                return r.returncode, [ln for ln in log.read_text(encoding="utf-8").splitlines() if ln]

            code, calls = go(0, 0)
            self.assertEqual(code, 0, "型がそろっていれば緑")
            self.assertEqual(len(calls), 2)
            self.assertIn("typegen", calls[0], "先に route の型を作る")
            self.assertIn("tsc --noEmit", calls[1], "次に tsc")
            code, calls = go(0, 2)
            self.assertNotEqual(code, 0, "画面の型のずれ（tsc が落ちる）なら段が赤")
            code, calls = go(1, 0)
            self.assertNotEqual(code, 0, "route の型が作れなければ赤")
            self.assertEqual(len(calls), 1, "typegen が落ちたら tsc まで進まない")


if __name__ == "__main__":
    unittest.main(verbosity=2)
