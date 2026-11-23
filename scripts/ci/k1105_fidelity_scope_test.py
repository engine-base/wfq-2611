#!/usr/bin/env python3
"""K-1105 の試験：画面の部品を変えた葉のチケットの CI の範囲に、その部品を頁が読むキャンバスの突き合わせ（G70）の組を入れる。
画面の行を後回しにする回（web=defer）でも G70 だけは流す。

  python3 scripts/ci/k1105_fidelity_scope_test.py      全部の行（行 ID は K1105-CS-NNN。11_tickets/K-1105.md の行の表と 1 対 1）
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

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "scripts" / "tickets"))
import ci_scope  # noqa: E402

IN_CI = bool(os.environ.get("CI"))


# 作りものの木（tempfile の中）に頁・部品・CSS・組の設定を置き、
# 本物の決まり（scripts/ci/ci_scope.json の web_select）で ci_scope.gate_cfg → web_select.select → ci_scope.with_web_selection を通す。
import web_run  # noqa: E402
import web_select  # noqa: E402

K1105_FID = "apps/web/tests/fidelity/fidelity.spec.ts"


def k1105_web_cfg() -> dict:
    return json.loads((ROOT / "scripts" / "ci" / "ci_scope.json").read_text(encoding="utf-8"))["web_select"]


class K1105Tree:
    """頁 2 つ（詳細・入口）と、その頁が import で読む部品と CSS。組は詳細（ticket-detail）・入口（login）・頁の無い組（ghost）"""

    def __init__(self, ghost: bool = False) -> None:
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="k1105-"))
        w = {
            "apps/web/app/layout.tsx": 'import "./globals.css";\nexport default function L({ children }) { return children; }\n',
            "apps/web/app/globals.css": '@import "../styles/k-tokens.css";\n',
            "apps/web/styles/k-tokens.css": ":root { --k-x: 1px; }\n",
            # 動く道（[id]）と区切りの括弧（(work)）・別名 @/ ・export { } from
            "apps/web/app/(work)/tickets/[id]/page.tsx": 'import { Detail } from "@/features/F4/detail";\nexport default function P() { return <Detail />; }\n',
            "apps/web/features/F4/detail.tsx": 'export { Stage } from "../F6/slots";\nexport function Detail() { return null; }\n',
            "apps/web/features/F6/slots.tsx": 'export { Stage } from "./progress/slot";\n',
            "apps/web/features/F6/progress/slot.tsx": 'import { View } from "./views";\nexport const Stage = View;\n',
            "apps/web/features/F6/progress/views.tsx": 'import "./progress.css";\nconst Lazy = () => import("./lazy");\nexport const View = Lazy;\n',
            "apps/web/features/F6/progress/progress.css": '@import "./locked.css";\n.k-a { gap: var(--k-x); }\n',
            "apps/web/features/F6/progress/locked.css": ".k-b { gap: var(--k-x); }\n",
            "apps/web/features/F6/progress/lazy.tsx": "export default function Lazy() { return null; }\n",
            "apps/web/app/(outside)/login/page.tsx": 'import { Box } from "../../../components/auth/box";\nexport default function P() { return <Box />; }\n',
            "apps/web/components/auth/box.tsx": "export function Box() { return null; }\n",
            # どの組の頁からも読まれない部品（開発用の頁だけが読む）
            "apps/web/app/(dev)/dev/mock/page.tsx": 'import { Mock } from "@/features/F9/mock-only";\nexport default function P() { return <Mock />; }\n',
            "apps/web/features/F9/mock-only.tsx": "export function Mock() { return null; }\n",
            # 途中の layout（区切りの括弧の中）と頁の隣の loading：その下の頁の組だけが読む
            "apps/web/app/(work)/layout.tsx": 'import { Nav } from "@/components/shell/nav";\nexport default function L({ children }) { return children; }\n',
            "apps/web/components/shell/nav.tsx": "export function Nav() { return null; }\n",
            "apps/web/app/(work)/tickets/[id]/loading.tsx": 'import { Skel } from "./skel";\nexport default function L() { return <Skel />; }\n',
            "apps/web/app/(work)/tickets/[id]/skel.tsx": "export function Skel() { return null; }\n",
            # 字の段（/legal/terms）が動く段 [kind] に当たる組。字の段の頁（/legal/about）が在ればそちらが先
            "apps/web/app/(outside)/legal/[kind]/page.tsx": 'import { Legal } from "@/features/F1/legal";\nexport default function P() { return <Legal />; }\n',
            "apps/web/app/(outside)/legal/about/page.tsx": 'import { About } from "@/features/F1/about";\nexport default function P() { return <About />; }\n',
            "apps/web/features/F1/legal.tsx": "export function Legal() { return null; }\n",
            "apps/web/features/F1/about.tsx": "export function About() { return null; }\n",
            # import で辿れない物（fs で読む文面）：どの頁・入口からも辿れない
            "apps/web/content/legal/terms.md": "# 規約\n",
            # 頁が読むワークスペースのパッケージ（package.json の workspace:）
            "apps/web/package.json": json.dumps({"name": "@kaname/web", "dependencies": {"@kaname/config": "workspace:*", "react": "19"}}),
            "packages/config/package.json": json.dumps({"name": "@kaname/config"}),
            "packages/config/src/legal.ts": "export const X = 1;\n",
            "packages/other/package.json": json.dumps({"name": "@kaname/other"}),
            "packages/other/src/a.ts": "export const Y = 1;\n",
        }
        groups = [{"id": "ticket-detail", "app": "/tickets/{ticket}", "enrolled": True},
                  {"id": "login", "app": "/login?step=terms", "enrolled": True},
                  {"id": "legal", "app": "/legal/terms", "enrolled": True},
                  {"id": "about", "app": "/legal/about", "enrolled": True}]
        if ghost:
            groups += [{"id": "ghost", "app": "/no-such-page", "enrolled": True}, {"id": "noapp", "enrolled": True}]
        w["04_design/fidelity.json"] = json.dumps({"groups": groups}, ensure_ascii=False)
        for rel, text in w.items():
            f = self.root / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(text, encoding="utf-8")

    def cfg(self) -> dict:
        return ci_scope.gate_cfg(str(self.root), k1105_web_cfg())

    def pick(self, changed: list[str], tickets: dict | None = None) -> dict:
        return web_select.select(changed, "K-99", tickets or {}, [], [], {}, self.cfg())

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


def k1105_plan(web: bool = True) -> dict:
    return {"mode": "scoped", "jobs": {"unit": False, "database": False, "web": web}, "errors": [], "reasons": [],
            "unit_shards": 0, "unit_files": [], "migration_files": [], "coverage_args": [], "base": "", "mismatches": []}


class K1105FidelityScope(unittest.TestCase):
    def setUp(self) -> None:
        self.t = K1105Tree()

    def tearDown(self) -> None:
        self.t.close()

    def test_K1105_CS_001_part_change_picks_groups_whose_page_reads_it(self) -> None:
        """K1105-CS-001 画面の部品・その CSS を変えた差分で、その部品を頁が import で辿って読む組だけが G70 に入り、組の一覧が出る"""
        for f in ("apps/web/features/F6/progress/progress.css", "apps/web/features/F6/progress/views.tsx",
                  "apps/web/features/F6/progress/locked.css", "apps/web/features/F6/progress/lazy.tsx"):
            r = self.t.pick([f])
            self.assertEqual(r["gates"]["70"], [K1105_FID], f)
            self.assertEqual(r["gate_groups"].get("70"), ["ticket-detail"], f)
        r = self.t.pick(["apps/web/components/auth/box.tsx"])
        self.assertEqual(r["gate_groups"].get("70"), ["login"], "相対の道で読む部品・問いの付いた道（?step=terms）の組")
        # 頁そのもの・頁の隣の loading が読む部品・途中の layout（区切りの括弧の中）が読む部品は、その下の頁の組だけ
        for f in ("apps/web/app/(work)/tickets/[id]/page.tsx", "apps/web/app/(work)/tickets/[id]/skel.tsx",
                  "apps/web/components/shell/nav.tsx", "apps/web/app/(work)/layout.tsx"):
            self.assertEqual(self.t.pick([f])["gate_groups"].get("70"), ["ticket-detail"], f)
        # 字の段は同じ字の段の頁が先、無ければ動く段 [x] に当たる（/legal/terms → [kind]・/legal/about → about）
        self.assertEqual(self.t.pick(["apps/web/features/F1/legal.tsx"])["gate_groups"].get("70"), ["legal"])
        self.assertEqual(self.t.pick(["apps/web/features/F1/about.tsx"])["gate_groups"].get("70"), ["about"])
        r = self.t.pick(["apps/web/components/auth/box.tsx", "apps/web/features/F6/progress/progress.css"])
        self.assertEqual(r["gate_groups"].get("70"), ["login", "ticket-detail"], "2 つの部品なら両方の組（並びは名前の順）")
        out = ci_scope.with_web_selection(k1105_plan(), r)
        self.assertEqual(json.loads(ci_scope.outputs(out)["web_gate_groups"]), {"70": ["login", "ticket-detail"]})

    def test_K1105_CS_002_part_no_group_reads_is_not_picked(self) -> None:
        """K1105-CS-002 どの組の頁も読まない部品（開発用の頁だけが読む）を変えた差分では、G70 は入らない（組の一覧も出ない）"""
        for f in ("apps/web/features/F9/mock-only.tsx", "apps/web/app/(dev)/dev/mock/page.tsx"):
            r = self.t.pick([f])
            self.assertEqual(r["gates"]["70"], [], f)
            self.assertNotIn("70", r["gate_groups"], f)

    def test_K1105_CS_003_token_change_picks_all_groups(self) -> None:
        """K1105-CS-003 トークン（apps/web/styles/**・正本 04_design/DESIGN-*.md・作り手）・全部の頁が読む物（globals.css・根の layout）を変えたら、
        G70 は組を絞らずに全部（組の一覧を出さない）"""
        for f in ("apps/web/styles/k-tokens.css", "04_design/DESIGN-kaname.md", "04_design/gen_tokens.py",
                  "apps/web/app/globals.css", "apps/web/app/layout.tsx"):
            r = self.t.pick([f])
            self.assertEqual(r["gates"]["70"], [K1105_FID], f)
            self.assertNotIn("70", r["gate_groups"], f)
        # 部品の対応の道具そのものを変えたら、70 は全部で画面の組も起きる（画面の試験の道具と同じ・web_select.all_on と jobs.web.paths）
        r = self.t.pick(["scripts/ci/fidelity_parts.py"])
        self.assertEqual(r["gates"]["70"], [K1105_FID])
        self.assertNotIn("70", r["gate_groups"])
        rules = json.loads((ROOT / "scripts" / "ci" / "ci_scope.json").read_text(encoding="utf-8"))
        self.assertTrue(ci_scope.match("scripts/ci/fidelity_parts.py", rules["jobs"]["web"]["paths"]), "変えた回に画面の組が起きる")
        self.assertEqual(rules["web_select"]["all_on"][0], "apps/web/playwright.config.ts", "all_on の先頭は前のまま（末尾に足す）")
        # トークンと部品を同時に変えても全部（絞らない）
        r = self.t.pick(["apps/web/styles/k-tokens.css", "apps/web/components/auth/box.tsx"])
        self.assertNotIn("70", r["gate_groups"])

    def test_K1105_CS_004_undecidable_is_all_or_includes_unknown_group(self) -> None:
        """K1105-CS-004 決められないときは安全な側：頁が見つからない組は、どの部品を変えても入る。決まりの unsure（画面に字を出す共通の部品）は全部。
        前からの「全部」の道（突き合わせの試験・その道具・チケットの tests:）も組を絞らない"""
        g = K1105Tree(ghost=True)
        try:
            files = g.cfg()["gates"]["70"]["group_files"]
            self.assertIsNone(files["ghost"], "頁の無い組は None（決められない）")
            self.assertIsNone(files["noapp"], "app の道が無い組も None")
            self.assertIn("apps/web/features/F6/progress/progress.css", files["ticket-detail"])
            self.assertEqual(g.pick(["apps/web/components/auth/box.tsx"])["gate_groups"].get("70"), ["ghost", "login", "noapp"])
            self.assertEqual(g.pick(["apps/web/features/F9/mock-only.tsx"])["gate_groups"].get("70"), ["ghost", "noapp"])
        finally:
            g.close()
        # 決まりの unsure・頁が読むワークスペースのパッケージ（apps/web/package.json の workspace:）の src・どの頁や入口からも辿れない画面の物は全部
        for f in ("packages/errors/src/catalog.ts", "packages/config/src/legal.ts", "apps/web/content/legal/terms.md"):
            r = self.t.pick([f])
            self.assertEqual(r["gates"]["70"], [K1105_FID], f)
            self.assertNotIn("70", r["gate_groups"], f)
        self.assertEqual(self.t.pick(["packages/other/src/a.ts"])["gates"]["70"], [], "頁が読まないパッケージは入らない")
        # 前からの全部の道（on のファイル：キャンバス・組の設定）と部品を同時に変えても絞らない
        for f in ("04_design/canvas/Main.dc.html", "04_design/fidelity.json"):
            r = self.t.pick([f, "apps/web/components/auth/box.tsx"])
            self.assertEqual(r["gates"]["70"], [K1105_FID], f)
            self.assertNotIn("70", r["gate_groups"], f)
        for f in (K1105_FID, "apps/web/tests/_lib/fidelity-states.ts"):
            r = web_select.select([f, "apps/web/components/auth/box.tsx"], "K-99", {}, [], [],
                                  {"apps/web/tests/_lib/fidelity-states.ts": {K1105_FID}}, self.t.cfg())
            self.assertEqual(r["gates"]["70"], [K1105_FID], f)
            self.assertNotIn("70", r["gate_groups"], f)
        mine = {"K-99": {"tests": [K1105_FID], "changes": [], "depends_on": []}}
        self.assertNotIn("70", self.t.pick(["apps/web/components/auth/box.tsx"], mine)["gate_groups"])
        dep = {"K-99": {"tests": [], "changes": [], "depends_on": ["K-2"]}, "K-2": {"tests": [K1105_FID], "changes": [], "depends_on": []}}
        r = self.t.pick(["apps/web/components/auth/box.tsx"], dep)
        self.assertEqual(r["gates"]["70"], [K1105_FID], "依存のチケットの tests: に突き合わせの試験")
        self.assertNotIn("70", r["gate_groups"])

    def test_K1105_CS_005_defer_keeps_only_g70(self) -> None:
        """K1105-CS-005 画面の行を後回しにする回（web=defer）：G70 に当たれば web の組を起こす印（web_on_defer）が立ち、G48・G59・G73 の一覧は空。
        当たらなければ印は立たない。後回しにしない回は今までどおり（G48 の一覧は残り、印は立たない）"""
        hit = {**self.t.pick(["apps/web/features/F6/progress/progress.css"]), "g48": ["apps/web/tests/k/a.spec.ts"],
               "g59": ["apps/web/tests/skeleton/m1.spec.ts"], "tasks": ["K-1"]}
        hit["gates"] = {**hit["gates"], "73": ["apps/web/tests/bridge/k379-bridge-chrome.spec.ts"]}
        out = ci_scope.with_web_selection(k1105_plan(), hit, defer=True)
        o = ci_scope.outputs(out)
        self.assertEqual((o["web_on_defer"], o["web"]), ("true", "true"))
        self.assertEqual((json.loads(o["web_g48"]), json.loads(o["web_g59"]), json.loads(o["web_tasks"])), ([], [], []))
        self.assertEqual(json.loads(o["web_gates"]), {"70": [K1105_FID], "73": []})
        self.assertEqual(json.loads(o["web_gate_groups"]), {"70": ["ticket-detail"]})
        self.assertEqual(out["errors"], [])
        miss = self.t.pick(["apps/web/features/F9/mock-only.tsx"])
        miss = {**miss, "g48": ["apps/web/tests/k/a.spec.ts"]}
        out = ci_scope.with_web_selection(k1105_plan(), miss, defer=True)
        self.assertEqual(ci_scope.outputs(out)["web_on_defer"], "false")
        self.assertEqual(out["errors"], [], "defer で空にした一覧では止める文を出さない（G48 に当たる回は前のとおり選べている）")
        # 段 73 だけに当たる defer の回：印は立たず、止める文も出ない
        only73 = {**self.t.pick(["apps/web/features/F9/mock-only.tsx"]), "on_defer": []}
        only73["gates"] = {"70": [], "73": ["apps/web/tests/bridge/k379-bridge-chrome.spec.ts"]}
        out = ci_scope.with_web_selection(k1105_plan(), only73, defer=True)
        self.assertEqual((ci_scope.outputs(out)["web_on_defer"], out["errors"]), ("false", []))
        self.assertEqual(json.loads(ci_scope.outputs(out)["web_gates"]), {"70": [], "73": []})
        # 全部の回は defer でも印を立てず、組の一覧は空（鍵は出す）
        full = ci_scope.outputs(ci_scope.with_web_selection({**k1105_plan(), "mode": "full"}, hit, defer=True))
        self.assertEqual((full["web_on_defer"], json.loads(full["web_gate_groups"])), ("false", {}))
        self.assertEqual(ci_scope.outputs(ci_scope.with_web_selection(k1105_plan(web=False), hit, defer=True))["web_on_defer"], "false",
                         "web の組が起きない回（画面を変えていない）は印を立てない")
        now = ci_scope.outputs(ci_scope.with_web_selection(k1105_plan(), hit))
        self.assertEqual((now["web_on_defer"], json.loads(now["web_g48"])), ("false", ["apps/web/tests/k/a.spec.ts"]))

    def test_K1105_CS_006_runner_narrows_to_groups(self) -> None:
        """K1105-CS-006 web_run の G70：組の一覧が渡ったら --grep で、その組の幅ごとの突き合わせと組に属さない行（設定・値の読み方）だけを流す。
        一覧が無い・全部の回は絞らない"""
        cfg = k1105_web_cfg()["gates"]["70"]
        rx = web_run.group_grep(cfg["group_title"], ["ticket-detail", "band-approval"])
        cmd = web_run.gate_commands("70", False, {"70": [K1105_FID]}, cfg["tests"], rx)
        self.assertEqual(cmd, [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", "tests/fidelity/fidelity.spec.ts", "--grep", rx]])
        title = lambda t: f"fidelity/fidelity.spec.ts {t}"  # noqa: E731  Playwright は道と名前をつないだ字に当てる
        yes = ["K238-VF-003 ticket-detail（TicketDetail）幅 375：組の値と読み込んだ書体がキャンバスと同じ",
               "K238-VF-003 band-approval（TicketDetail）幅 1440：組の値と読み込んだ書体がキャンバスと同じ",
               "K238-VF-001 設定を読み、組が 1 つ以上在り", "K238-VF-017 readVals は当たった数"]
        no = ["K238-VF-003 login（AuthLogin）幅 375：組の値", "K238-VF-003 ticket-detail-x（Y）幅 375：組の値",
              "K238-VF-003 band-approval-2（Y）幅 375：組の値"]
        for t in yes:
            self.assertRegex(title(t), rx, t)
        for t in no:
            self.assertNotRegex(title(t), rx, t)
        # Playwright と同じ JS の RegExp（旗 gi）でも同じ答え
        node = shutil.which("node")
        if node or IN_CI:
            js = ("const rx=new RegExp(process.argv[1],'gi');const ts=JSON.parse(process.argv[2]);"
                  "console.log(JSON.stringify(ts.map(t=>{rx.lastIndex=0;return rx.test(t);})))")
            r = subprocess.run([node or "node", "-e", js, rx, json.dumps([title(t) for t in yes + no], ensure_ascii=False)],
                               capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(r.stdout), [True] * len(yes) + [False] * len(no))
        # env から読む道：無い・空・壊れている・70 の鍵が無い・空の一覧は絞らない（""）。一覧が在れば式
        for raw in (None, "", "{oops", "{}", '{"70": []}', '["ticket-detail"]'):
            env = {} if raw is None else {"CI_WEB_GATE_GROUPS": raw}
            self.assertEqual(web_run.gate_grep_from_env("70", env), "", repr(raw))
        self.assertEqual(web_run.gate_grep_from_env("70", {"CI_WEB_GATE_GROUPS": '{"70": ["ticket-detail"]}'}),
                         web_run.group_grep(cfg["group_title"], ["ticket-detail"]))
        self.assertEqual(web_run.gate_commands("70", False, {"70": [K1105_FID]}, cfg["tests"], ""),
                         [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", "tests/fidelity/fidelity.spec.ts"]])
        self.assertEqual(web_run.gate_commands("70", True, {}, cfg["tests"], rx),
                         [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", "tests/fidelity/fidelity.spec.ts"]],
                         "全部の回は絞らない")

    def test_K1105_CS_007_workflow_runs_g70_on_defer(self) -> None:
        """K1105-CS-007 CI の定義：範囲の台本に入力 web を渡し、static が web_gate_groups・web_on_defer を出し、web の組は defer の回でも印が立てば起き、
        G70 の段に組の一覧が渡る。作り手（05_flow/build_testplan.py）が同じ形を作る"""
        import yaml  # noqa: PLC0415
        wf = yaml.safe_load((ROOT / ".github" / "workflows" / "v3-gate.yml").read_text(encoding="utf-8"))
        jobs = wf["jobs"]
        outs = jobs["static"].get("outputs") or {}
        for k in ("web_gate_groups", "web_on_defer"):
            self.assertEqual(outs.get(k), "${{ steps.scope.outputs.%s }}" % k, k)
        g0 = [s for s in jobs["static"]["steps"] if s.get("id") == "scope"]
        self.assertEqual(len(g0), 1)
        self.assertEqual(g0[0]["env"].get("CI_WEB_INPUT"), "${{ inputs.web }}")
        self.assertIn('--web "$CI_WEB_INPUT"', g0[0]["run"])
        web_if = str(jobs["web"]["if"]).replace('"', "'")
        self.assertIn("(inputs.web != 'defer' || needs.static.outputs.web_on_defer == 'true')", web_if)
        self.assertIn("needs.static.outputs.web == 'true'", web_if)
        g70 = [s for s in jobs["web"]["steps"] if str(s.get("name", "")).startswith("G70 ")]
        self.assertEqual(len(g70), 1)
        self.assertEqual((g70[0].get("env") or {}).get("CI_WEB_GATE_GROUPS"), "${{ needs.static.outputs.web_gate_groups }}")
        builder = (ROOT / "05_flow" / "build_testplan.py").read_text(encoding="utf-8")
        for w in ("web_on_defer", "web_gate_groups", "CI_WEB_INPUT", "CI_WEB_GATE_GROUPS"):
            self.assertIn(w, builder, w)
        # 範囲の台本の入口は --web を受け、決まった形でない値は止める
        r = subprocess.run([sys.executable, str(HERE / "ci_scope.py"), "--web", "later", "--json", "--no-vitest"],
                           capture_output=True, text=True, cwd=ROOT)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("invalid choice", r.stderr, "--web の値を選べる形で止める（--web を知らないだけの止まり方でない）")
        ap = ci_scope.decide_parser()
        for w in ("", "run", "defer"):
            self.assertEqual(ap.parse_args(["--web", w]).web, w, w)
        self.assertEqual(ap.parse_args([]).web, "", "入力が無い回（push）は空")

    def test_K1105_CS_008_real_tree_maps_every_group(self) -> None:
        """K1105-CS-008 本物の木：入れた組はどれも頁が見つかり（None が無い）、K-395 が変えた段の札の部品（views.tsx・progress.css）は
        チケットの詳細の組（ticket-detail）と帯の組（band-*）に当たり、入口の組（login）には当たらない"""
        cfg = ci_scope.gate_cfg(str(ROOT), k1105_web_cfg())
        files = cfg["gates"]["70"]["group_files"]
        groups = json.loads((ROOT / "04_design" / "fidelity.json").read_text(encoding="utf-8"))["groups"]
        self.assertEqual(sorted(files), sorted(g["id"] for g in groups if g.get("enrolled")))
        self.assertEqual([k for k, v in files.items() if v is None], [], "頁が見つからない組がある")
        r = web_select.select(["apps/web/features/F6/progress/progress.css", "apps/web/features/F6/progress/views.tsx"],
                              "K-99", {}, [], [], {}, cfg)
        got = r["gate_groups"].get("70") or []
        self.assertIn("ticket-detail", got)
        self.assertIn("band-approval", got)
        self.assertNotIn("login", got)
        self.assertEqual(r["gates"]["70"], [K1105_FID])


if __name__ == "__main__":
    unittest.main(verbosity=2)
