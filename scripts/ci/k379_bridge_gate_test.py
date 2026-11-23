#!/usr/bin/env python3
"""K-379 の試験：CI の画面の組（web）に、Bridge の輪が Chrome を動かす通しの画面の試験の専用の段（G73）を足す。

  python3 scripts/ci/k379_bridge_gate_test.py      行 ID は K379-CI-NNN（11_tickets/K-379.md の行の表と 1 対 1）

見る物（どれも読むだけ・DB も画面も Chrome も使わない）：
  ・作り手（05_flow の build_testplan.py）が作った CI の定義（.github/workflows/v3-gate.yml）の画面の組の段の形
      「画面を立ち上げる」の後に Bridge の組み立て（配布と同じ build）→ 専用の段 G73（scripts/ci/web_run.py gate 73・JUnit は別の名前）
  ・範囲の地図（scripts/ci/ci_scope.d/_base.json と、作り直した scripts/ci/ci_scope.json）の web_select.gates の 73 と jobs.web.paths
  ・範囲を決める台本（web_select.py・ci_scope.py・web_run.py）の答え：全部の CI では必ず流れ、チケットの CI では on に当たる変更のときだけ選ばれる。
      突き合わせに入れた組が在っても 73 は毎回にはならない。K-238 の G70 の選び方は変わらない
  ・試験の持ち主の検査（test_owner_gate.py）が、専用の段の試験を「試験」と数える

実ブラウザの見張りの試験（apps/web/tests/bridge/k379-bridge-chrome.spec.ts・行 K379-BRG-NNN）は、この段（G73）が CI の画面の組で流す。
作りものの木は tempfile の中に作る。
"""
from __future__ import annotations

import json
import os
import pathlib
import re
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
import test_owner_gate  # noqa: E402
import web_run  # noqa: E402
import web_select  # noqa: E402

WORKFLOW = ROOT / ".github" / "workflows" / "v3-gate.yml"
SCOPE = ROOT / "scripts" / "ci" / "ci_scope.json"
BASE = ROOT / "scripts" / "ci" / "ci_scope.d" / "_base.json"
G65_DIR = ROOT / "scripts" / "ci" / "g65.d"
ME = "python3 scripts/ci/k379_bridge_gate_test.py"

GID = "73"
WATCH = "apps/web/tests/bridge/k379-bridge-chrome.spec.ts"   # この葉が持つ見張りの試験（後の葉が足しても、これは残る）
FID = "apps/web/tests/fidelity/fidelity.spec.ts"             # K-238 の G70 の試験
BUILD = "pnpm --filter @kaname/bridge build"

# 変えたファイルの見本は、どれも実在しない名前にする（k379-sample）。実在するファイルの道を字で書くと、切る段の検査（cut_check.py prior）が
#   「そのファイルを使う試験」としてこの試験を拾い、そのファイルを変える葉の全部に「替えない」の行を書かせることになる。
# on に当たる変更（1 つずつ）。Bridge の道と、預けたログイン情報の口・DB・画面と、的のログイン画面
DELEGATE_BRIDGE = "/".join(["apps/api/src/features/F5/delegate", "bridge.ts"])   # on がファイル 1 つを名指しする物（道を分けて書く・上の訳）
# Bridge の部品の一覧と組み立ての設定（on が名指しする実在のファイル。道を分けて書く・上の訳）
BRIDGE_PKG = "/".join(["apps/bridge", "package.json"])
BRIDGE_TSCONFIG = "/".join(["apps/bridge", "tsconfig.json"])
CRED_API = "apps/api/src/features/F3/credentials/k379-sample.ts"   # 預けたログイン情報の口（K379-CI-008 が名前で指す）
ON_HITS = [
    "apps/bridge/src/k379-sample.ts",
    "apps/bridge/src/renderer/k379-sample.html",
    "apps/bridge/scripts/k379-sample.mjs",
    BRIDGE_PKG,
    BRIDGE_TSCONFIG,
    CRED_API,
    "apps/api/src/hooks/credentials-k379.ts",
    "apps/api/src/features/F3/connect-pc/k379-sample.ts",
    DELEGATE_BRIDGE,
    "packages/db/migrations/20991231000000_k379_credential_sample.sql",
    "packages/db/policies/20991231000000_k379_credential_sample.sql",
    "apps/web/features/F3/credentials/k379-sample.tsx",
    "apps/web/app/(app)/settings/credentials/k379-sample.tsx",
    "apps/web/app/(dev)/dev/fake-login/k379-sample.tsx",
]
PART = "apps/web/tests/_lib/k379-part.ts"       # G48 の試験が読み込む試験の部品（作りもの）
TOOL = "apps/web/tests/bridge/k379-tool.ts"     # 段の試験が読み込む試験の部品（作りもの）
OTHER_SCREEN = "apps/web/app/k379-a/page.tsx"   # 別のチケット（K-1）の画面のコード（作りもの）
DOC = "k379-sample.md"                          # どの決まりにも当たらない文書（作りもの）
# on に当たらない変更（1 つずつ）。関係ない口・その登録・仕事の別の口・関係ない migration・文書・別のチケットの画面のコード・別の試験の部品・Bridge の単体の試験
ON_MISSES = [
    "apps/api/src/features/F1/login/k379-sample.ts",
    "apps/api/src/hooks/k379-sample.ts",
    "apps/api/src/features/F5/delegate/k379-sample.ts",
    "packages/db/migrations/20991231000000_k379_other_sample.sql",
    DOC,
    OTHER_SCREEN,
    PART,
    "apps/bridge/test/k379-sample.test.ts",
]

# 作りものの一覧と持ち主（K-238 の試験と同じ形）
G48 = ["apps/web/tests/k/a.spec.ts"]
G59 = ["apps/web/tests/skeleton/m1.spec.ts"]
IMP = {PART: {"apps/web/tests/k/a.spec.ts"}, TOOL: {WATCH}}
TICKETS = {
    "K-1": {"tests": ["apps/web/tests/k/a.spec.ts"], "changes": [OTHER_SCREEN], "depends_on": []},
    "K-2": {"tests": [WATCH, "scripts/ci/x_test.py"], "changes": ["scripts/ci/x.py"], "depends_on": []},
    "K-3": {"tests": ["apps/web/tests/skeleton/m1.spec.ts"], "changes": [], "depends_on": []},
    "K-4": {"tests": [], "changes": [], "depends_on": ["K-2"]},
}


def clean_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def web_steps() -> list[dict]:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]["web"]["steps"]


def named(st: list[dict], head: str) -> list[int]:
    return [i for i, s in enumerate(st) if str(s.get("name", "")).startswith(head)]


def web_cfg() -> dict:
    return json.loads(SCOPE.read_text(encoding="utf-8"))["web_select"]


def gate() -> dict:
    return web_cfg()["gates"][GID]


def pick(changed: list[str], ticket: str = "K-99", cfg: dict | None = None) -> dict:
    t = {**TICKETS, ticket: TICKETS.get(ticket, {"tests": [], "changes": [], "depends_on": []})}
    return web_select.select(changed, ticket, t, G48, G59, IMP, web_cfg() if cfg is None else cfg)


def sample(pat: str) -> str:
    """on の glob に当たる道を 1 つ作る（** は 2 段のフォルダとファイル・* は字）"""
    return pat.replace("**", "a/b.ts").replace("*", "x")


class Workflow(unittest.TestCase):
    def test_K379_CI_001_bridge_built_before_gate(self) -> None:
        """K379-CI-001 画面の組に Bridge の組み立ての段がちょうど 1 つ。配布と同じ build の命令だけで、画面を立ち上げた後・専用の段 G73 より前に在り、飛ばす・落ちても進む形にしない"""
        st = web_steps()
        build = [i for i, s in enumerate(st) if "@kaname/bridge" in str(s.get("run", ""))]
        self.assertEqual(len(build), 1, "Bridge を組み立てる段は 1 つ")
        s = st[build[0]]
        self.assertEqual(str(s["run"]).strip(), BUILD, "命令は配布と同じ build の 1 つだけ（|| true・; true・tsc の写しを書かない）")
        for key in ("if", "env", "shell", "continue-on-error"):
            self.assertNotIn(key, s, f"組み立ての段に {key} を付けない（飛ばす・秘密を渡す・落ちても進む）")
        install = [i for i, x in enumerate(st) if re.search(r"pnpm install\b", str(x.get("run", "")))]
        up = [i for i, x in enumerate(st) if "start:test" in str(x.get("run", ""))]
        g73 = named(st, f"G{GID} ")
        self.assertEqual((len(install), len(up), len(g73)), (1, 1, 1))
        self.assertLess(install[0], build[0], "部品を入れた後に組み立てる（前に置くと tsc が無くて落ちる）")
        self.assertLess(up[0], build[0], "「画面を立ち上げる」の後に組み立てる")
        self.assertLess(build[0], g73[0], "専用の段 G73 より前に組み立てる（段の試験は apps/bridge/dist を読む）")

    def test_K379_CI_002_gate_step_shape(self) -> None:
        """K379-CI-002 画面の組に G73 がちょうど 1 つ：web_run.py gate 73・JUnit はほかの段と別の名前 junit/web-bridge.xml・立てた画面 3124・範囲の台本の出力 4 つを env で受け、
        条件は !cancelled() だけ。G48・G59・G70 は 1 つずつ残る"""
        st = web_steps()
        g73 = [st[i] for i in named(st, f"G{GID} ")]
        self.assertEqual(len(g73), 1)
        run = str(g73[0]["run"])
        self.assertRegex(run, rf"python3 scripts/ci/web_run\.py gate {GID}\s*$")
        self.assertIn('PLAYWRIGHT_JUNIT_OUTPUT_NAME="$GITHUB_WORKSPACE/junit/web-bridge.xml"', run)
        self.assertIn("BASE_URL=http://127.0.0.1:3124", run)
        self.assertEqual(g73[0].get("env"), {
            "CI_FULL": "${{ needs.static.outputs.full }}",
            "CI_WEB_GATES": "${{ needs.static.outputs.web_gates }}",
            "CI_WEB_SPECS": "${{ needs.static.outputs.web_g48 }}",
            "CI_WEB_OTHER": "${{ needs.static.outputs.web_g59 }}",
        })
        self.assertEqual(str(g73[0].get("if")), "${{ !cancelled() }}", "段ごとに外さない（defer で外れるのは組ごと・選ばれなければ web_run.py が 0 本で終わる）")
        self.assertNotIn("continue-on-error", g73[0])
        # JUnit の置き場は段ごとに別（同じ名前だと後の段が前の段の記録を上書きする）。組の既定は junit/web.xml
        outs = re.findall(r"junit/([\w-]+\.xml)", "\n".join(str(s.get("run", "")) for s in st))
        self.assertEqual(outs.count("web-bridge.xml"), 1)
        self.assertEqual(len(outs), len(set(outs)), outs)
        self.assertNotIn("web.xml", outs)
        for head in ("G48 ", "G59 ", "G70 "):
            self.assertEqual(len(named(st, head)), 1, f"{head.strip()} の段は残る（試験を減らさない）")
        g70 = st[named(st, "G70 ")[0]]
        self.assertRegex(str(g70["run"]), r"junit/web-fidelity\.xml.* python3 scripts/ci/web_run\.py gate 70\s*$", "G70 の命令は変えない")


class ScopeMap(unittest.TestCase):
    def test_K379_CI_003_gate_registered(self) -> None:
        """K379-CI-003 範囲の地図の web_select.gates に 73 が在り、試験（実ファイル）と on を持つ。本体（_base.json）と作り直した ci_scope.json が同じで、
        専用の段の設定の検査（段の命令が workflow に在る・G48／G59 と重ならない・実ファイル）が本物の木で 0 件。70 の試験は前のまま・on は前と同じ 4 個"""
        g = gate()
        self.assertIn(WATCH, g["tests"])
        self.assertTrue(g["on"], "on が空（チケットの CI でこの段を起こす変更が無い）")
        for t in g["tests"]:
            self.assertTrue((ROOT / t).is_file(), t)
        base = json.loads(BASE.read_text(encoding="utf-8"))["web_select"]["gates"]
        self.assertEqual(web_cfg()["gates"], base, "ci_scope.json は _base.json から作り直した物（python3 scripts/ci/build_registries.py）")
        self.assertEqual(web_select.check_gates(str(ROOT), web_cfg()), [])
        g70 = web_cfg()["gates"]["70"]
        self.assertEqual(g70["tests"], [FID])
        self.assertEqual(len(g70["on"]), 4, "70 の on は前のまま 4 個（比べ方の道具 2 つ・突き合わせの設定・キャンバスの絵。当たり方は K379-CI-008 と K-238 の試験が見る）")

    def test_K379_CI_004_on_changes_pick_gate(self) -> None:
        """K379-CI-004 チケットの CI：on に当たる変更（Bridge の src と台本・Bridge の部品の一覧と組み立ての設定・預けたログイン情報の口と登録・PC をつなぐ口・仕事を取る口・預けたログイン情報の migration と行の守り・
        預けたログイン情報の画面・的のログイン画面）のどれか 1 つで、73 に段の試験が全部選ばれ、web の組が起きる回に止める文が出ない。
        チケット自身・依存のチケットの tests に在る／段の試験が読み込む部品を変えた、でも選ばれる"""
        mine = sorted(gate()["tests"])
        cases = [(f, "K-99") for f in ON_HITS]
        cases += [(DOC, "K-2"), (DOC, "K-4"), (TOOL, "K-99"), (WATCH, "K-99")]
        for f, tid in cases:
            r = pick([f], tid)
            label = f"{f}（{tid}）"
            want = [WATCH] if f in (WATCH, TOOL) or tid in ("K-2", "K-4") else mine
            self.assertEqual(r["gates"][GID], want, label)
            p = {"mode": "ticket", "jobs": {"unit": False, "database": False, "web": True}, "errors": [], "reasons": []}
            out = ci_scope.with_web_selection(p, r)
            self.assertTrue(out["jobs"]["web"], label)
            self.assertEqual(out["errors"], [], label)
            self.assertEqual(out["web_gates"][GID], want, label)

    def test_K379_CI_005_unrelated_changes_do_not_pick_gate(self) -> None:
        """K379-CI-005 on に当たらない変更（関係ない口・関係ない migration・文書・別のチケットの画面のコード・別の試験の部品・Bridge の単体の試験）では 73 は選ばれない。
        突き合わせに入れた組が在る木でも 73 は毎回にならない（70 も関係ない変更では選ばれない：K-1105 で「入れた組が在れば毎回」を部品の対応に替えた）"""
        for f in ON_MISSES:
            self.assertEqual(pick([f])["gates"][GID], [], f)
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="k379-gate-"))
        try:
            (tmp / "04_design").mkdir()
            (tmp / "11_tickets").mkdir()
            (tmp / "04_design" / "fidelity.json").write_text(json.dumps({"groups": [{"id": "g", "enrolled": True}]}), encoding="utf-8")
            rules = {"web_select": web_cfg(), "spec": {}}
            r = ci_scope._web_pick(str(tmp), str(tmp / "11_tickets"), rules, {"changes": [ci_scope.Change("M", DOC, None)]}, "K-99")
            self.assertEqual(r["gates"][GID], [], "入れた組が在っても 73 は関係ない変更では選ばれない")
            self.assertEqual(r["gates"]["70"], [], "70 も関係ない変更（文書）では選ばれない（K-1105）")
            r = ci_scope._web_pick(str(tmp), str(tmp / "11_tickets"), rules,
                                   {"changes": [ci_scope.Change("M", ON_HITS[0], None)]}, "K-99")
            self.assertEqual(r["gates"][GID], sorted(gate()["tests"]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_K379_CI_006_full_runs_all_and_ticket_runs_selected(self) -> None:
        """K379-CI-006 web_run の専用の段 73：全部の CI は設定の一覧を全部・範囲の回は選んだ試験だけ・選ばれなければ命令 0。
        範囲の回に一覧が渡っていなければ 1、73 が空でも G48 か G59 かほかの専用の段（70）に流す物があれば 0、どの段も空なら 1。
        70 が空で 73 に流す物がある回の gate 70 も 0。全部に倒れる変更では 73 も全部"""
        tests = gate()["tests"]
        rel = [t[len("apps/web/"):] for t in tests]
        run = [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", *rel]]
        self.assertEqual(web_run.gate_tests(GID), tests)
        self.assertEqual(web_run.gate_commands(GID, True, {}, tests), run, "全部の回は選んだ物に関わらず設定の一覧を全部")
        self.assertEqual(web_run.gate_commands(GID, False, {GID: [WATCH]}, tests),
                         [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", WATCH[len("apps/web/"):]]])
        self.assertEqual(web_run.gate_commands(GID, False, {GID: []}, tests), [])

        def run_gate(**over: str) -> int:
            e = {**clean_env(), "CI_FULL": "false", "CI_WEB_SPECS": "[]", "CI_WEB_OTHER": "[]", **over}
            e = {k: v for k, v in e.items() if v != "<無い>"}
            return subprocess.run([sys.executable, str(HERE / "web_run.py"), "gate", GID], capture_output=True, text=True,
                                  env=e, cwd=ROOT).returncode
        for bad in ("<無い>", "", "{oops", "{}", '{"70": []}'):
            self.assertEqual(run_gate(CI_WEB_GATES=bad), 1, repr(bad))
        both = json.dumps({"70": [], GID: []})
        self.assertEqual(run_gate(CI_WEB_GATES=both, CI_WEB_SPECS='["apps/web/tests/k/a.spec.ts"]'), 0)
        self.assertEqual(run_gate(CI_WEB_GATES=both, CI_WEB_OTHER='["apps/web/tests/skeleton/m1.spec.ts"]'), 0)
        self.assertEqual(run_gate(CI_WEB_GATES=both), 1)
        # 73 だけが選ばれた回に G48・G59・G70 は「壊れている」で止まらない
        only = {**clean_env(), "CI_FULL": "false", "CI_WEB_SPECS": "[]", "CI_WEB_OTHER": "[]", "CI_WEB_GATES": json.dumps({"70": [], GID: tests})}
        for part in (["g48"], ["g59"], ["gate", "70"]):
            r = subprocess.run([sys.executable, str(HERE / "web_run.py"), *part], capture_output=True, text=True, env=only, cwd=ROOT)
            self.assertEqual(r.returncode, 0, " ".join(part) + r.stdout)
        # 逆の形：70 だけが選ばれ、73・G48・G59 が空の回（突き合わせに入れた組が在ると 70 は毎回選ばれる。画面の行を持たない口だけの葉の回がこの形）。
        #   73 は「選ばれなかっただけ」で 0。専用の段が 2 つになったので、自分の段が空のときは、ほかの専用の段に流す物が在るかも見る
        self.assertEqual(run_gate(CI_WEB_GATES=json.dumps({"70": [FID], GID: []})), 0)
        # 画面の試験の設定・共通の画面のコードを変えた回（G48・G59 が全部に倒れる）は 73 も全部
        for f in (web_cfg()["all_on"][0], "apps/web/components/k/k379-sample.tsx"):
            self.assertEqual(pick([f])["gates"][GID], sorted(tests), f)

    def test_K379_CI_007_on_wakes_web_job(self) -> None:
        """K379-CI-007 on に当たる変更で画面の組そのものが起きる：jobs.web.paths に Bridge の src と台本が在り、on の glob はどれも apps/web の中か jobs.web.paths に当たる
        （当たらない on は「選ばれたのに組が起きない」）"""
        paths = json.loads(SCOPE.read_text(encoding="utf-8"))["jobs"]["web"]["paths"]
        for p in ("apps/bridge/src/**", "apps/bridge/scripts/**", BRIDGE_PKG, BRIDGE_TSCONFIG):
            self.assertIn(p, paths)
        for pat in gate()["on"]:
            f = sample(pat)
            self.assertTrue(web_select._match(f, pat), f"{pat} の見本 {f} が当たらない（見本の作り方が合わない glob）")
            self.assertTrue(f.startswith("apps/web/") or ci_scope.match(f, paths), f"{pat}：変えても画面の組が起きない（jobs.web.paths に無い）")
        for f in ON_HITS:
            self.assertTrue(f.startswith("apps/web/") or ci_scope.match(f, paths), f)
        # 前からの起こし方は残る（絵と設定・口・DB・70 の on）
        for p in ("04_design/**", "apps/api/src/**", "packages/db/migrations/**", "packages/db/policies/**"):
            self.assertIn(p, paths)
        for pat in web_cfg()["gates"]["70"]["on"]:
            self.assertTrue(ci_scope.match(sample(pat), paths), f"{pat}：70 の on で画面の組が起きなくなった")

    def test_K379_CI_008_old_targets_unchanged(self) -> None:
        """K379-CI-008 前からの選ぶ先は変わらない：G48・G59・持ち主の答えは 73 の設定が有っても無くても同じ。G70 は比べ方の変更で選ばれ 73 は選ばれない。
        73 の on の変更で G70 は選ばれない（入れた組の無い素の設定で）"""
        cfg = web_cfg()
        without = {**cfg, "gates": {k: v for k, v in cfg["gates"].items() if k != GID}}
        cases = [([OTHER_SCREEN], "K-99"), ([PART], "K-99"), ([DOC], "K-3"),
                 ([ON_HITS[0]], "K-99"), ([CRED_API], "K-1"), ([cfg["all_on"][0]], "K-99")]
        for changed, tid in cases:
            a, b = pick(changed, tid), pick(changed, tid, without)
            self.assertEqual((a["g48"], a["g59"], a["tasks"], a["gates"]["70"]), (b["g48"], b["g59"], b["tasks"], b["gates"]["70"]), changed)
        for pat in cfg["gates"]["70"]["on"]:
            r = pick([sample(pat)])
            self.assertEqual((r["gates"]["70"], r["gates"][GID]), ([FID], []), pat)
        for f in ON_HITS:
            if f.startswith("apps/web/"):
                continue   # 持ち主の当たらない画面のコード・共通の画面のコードは前からの決まりで全部に倒れ、専用の段も全部選ぶ（K-238）
            self.assertEqual(pick([f])["gates"]["70"], [], f)


class Owners(unittest.TestCase):
    def test_K379_CI_009_gate_tests_count_as_tests(self) -> None:
        """K379-CI-009 試験の持ち主の検査は、workflow の専用の段（web_run.py gate 73）の試験を「試験」と数える。段の試験は G48（e2e:k の一覧）にも G59 にも無い"""
        wf = WORKFLOW.read_text(encoding="utf-8")
        globs = test_owner_gate.workflow_globs(wf)
        for t in gate()["tests"]:
            self.assertIn(t, globs, f"{t} が試験と数えられない（tests: に書くと TO3・書かないと持ち主なし）")
            self.assertEqual(test_owner_gate.test_files([t], globs), [t])
            self.assertNotIn(t, web_select.domain_g48(str(ROOT)), "e2e:k の一覧に入ると、Bridge を組み立てていない G48 でも流れて落ちる")
            self.assertNotIn(t, web_select.domain_g59(str(ROOT)))
        self.assertIn(FID, globs, "G70 の試験も今までどおり数える")

    def test_K379_CI_010_registries(self) -> None:
        """K379-CI-010 登録先：G65 の置き場でこの試験の命令を持つファイルは K-379.txt のちょうど 1 つ。見張りの試験（組み立てた Bridge を読み込み一時の置き場を作る）は
        範囲の地図に読み手として載っている（載っていないと範囲の試験 CS-032 が赤）"""
        holders = sorted(p.name for p in G65_DIR.glob("*.txt") if ME in p.read_text(encoding="utf-8").splitlines())
        self.assertEqual(holders, ["K-379.txt"])
        rules = ci_scope.load_rules(str(SCOPE))
        self.assertNotIn(WATCH, ci_scope.unmapped_readers(str(ROOT), rules))
        self.assertIn(WATCH, rules.get("reads_ok", {}), "読み手の訳は reads_ok に書く（scripts/ci/ci_scope.d/K-379.json）")


if __name__ == "__main__":
    unittest.main(verbosity=2)
