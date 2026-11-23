#!/usr/bin/env python3
"""K-237 の試験：速さの台帳（scripts/ci/perf_budget.json）。行 ID は K237-LG-NNN（11_tickets/K-237.md の表と 1 対 1）。
台帳は 4 つの欄を持つ：api（口ごとの DB の文の数と begin の上限・apps/api/test/k237_perf_budget.test.ts が測る）・
screens（画面ごとの口の数と直列の段の上限と呼んでよい口・apps/web/tests/k/k237-screen-budget.spec.ts が測る）・
screens_excluded（台帳で測らない画面と理由）・staging（staging のログインの要らない道の答えまでの時間の上限・scripts/ci/staging_perf.py が測る）。
ここは台帳の形・目標（K-233〜K-236 で下げた後の値）より緩くないこと・ログインの要る段 1 の画面と画面が呼ぶ口を全部持つこと・CI の結びを見る。
台帳を目標より緩めるには、この試験（実装の後は変えられない）を変えるチケットが要る。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）"""
from __future__ import annotations

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scripts" / "ci" / "perf_budget.json"
SCOPE = ROOT / "scripts" / "ci" / "ci_scope.json"

# 目標（K-233・K-234・K-235・K-236 の後の値・切る段で本線の写しに試しの形を入れて測った）。台帳はこれより緩くできない
API_TARGETS = {  # 道 → (文, begin)
    "/api/auth-ext/me": (10, 2),
    "/api/v1/scopes": (7, 1),
    "/api/v1/ticket_kinds": (7, 1),
    "/api/v1/members?limit=200": (6, 1),
    "/api/v1/tickets?limit=50": (7, 1),
    "/api/v1/me/ticket-drafts": (6, 1),
    "/api/v1/tickets/:id": (15, 1),
    "/api/v1/tickets/:id/runs": (7, 1),
    "/api/v1/approvals/queue": (8, 1),
    "/api/v1/bridge/devices": (3, 0),
    "/api/v1/me/setup-tasks": (7, 1),
}
SCREEN_TARGETS = {  # 画面の道 → 口の数の上限（直列の段はどれも 1）
    "/tickets": 8,
    "/tickets?new=1": 9,
    "/tickets/:id": 8,  # K-392：やり取りの最初の 20 件（GET /tickets/:id/timeline・タブの読んでいない数）と K-397：決定の一覧（GET /tickets/:id/decisions）を詳細と同時に読む。段は 1 のまま（台帳は K-392 で 7・K-397 で 8）
    "/approvals": 4,
}
STAGING_TARGETS = {  # (住所の名前, 方法, 道) → 答えまでの時間の中央値の上限（ms）
    ("STAGING_BASE_URL", "GET", "/login"): 800,
    ("STAGING_API_BASE", "GET", "/health"): 400,
    ("STAGING_API_BASE", "GET", "/api/v1/auth/terms/current"): 400,
    ("STAGING_API_BASE", "OPTIONS", "/api/v1/scopes"): 400,
}
# 目標の表に無い項目（後から足した口・画面・道）にも掛ける天井（台帳に緩い値で足して通さない）
CAP_STATEMENTS, CAP_BEGINS, CAP_CALLS, CAP_MS = 15, 2, 9, 800
# ログインの要らない画面（台帳の screens の外。キャンバスの組の app の道で、外枠の外にある物）
PUBLIC_SCREENS = {"/login", "/login?step=terms", "/signup", "/verify-email", "/legal/terms"}
TS_READERS = ["apps/api/test/k237_perf_budget.test.ts", "apps/web/tests/k/k237-screen-budget.spec.ts"]
PY_TESTS = ["python3 scripts/ci/k237_perf_ledger_test.py", "python3 scripts/ci/k237_staging_perf_test.py"]
FIDELITY = ROOT / "04_design" / "fidelity.json"
TESTPLAN = ROOT / "05_flow" / "build_testplan.py"
GATE = ROOT / ".github" / "workflows" / "v3-gate.yml"


def load() -> dict:
    return json.loads(LEDGER.read_text(encoding="utf-8"))


def bare(path: str) -> str:
    return path.split("?")[0]


class PerfLedger(unittest.TestCase):
    def test_K237_LG_001_shape(self) -> None:
        """K237-LG-001 台帳の形：api は name・method（GET）・path・max_statements（正の整数）・max_begins（0 以上の整数）、
        screens は path・marks・calls・max_calls・max_stages（1）、screens_excluded は path・why（空でない）、
        staging は name・base（STAGING_BASE_URL か STAGING_API_BASE）・method（GET か OPTIONS）・path・max_ms（正の整数）。同じ道の項目は 2 つ持たない"""
        d = load()
        self.assertEqual(sorted(k for k in d if not k.startswith("_")), ["api", "screens", "screens_excluded", "staging"])
        for a in d["api"]:
            self.assertEqual(set(a) - {"_why"}, {"name", "method", "path", "max_statements", "max_begins"}, a)
            self.assertEqual(a["method"], "GET")
            self.assertIsInstance(a["max_statements"], int)
            self.assertGreater(a["max_statements"], 0)
            self.assertIsInstance(a["max_begins"], int)
            self.assertGreaterEqual(a["max_begins"], 0)
        for s in d["screens"]:
            self.assertEqual(set(s) - {"_why"}, {"path", "marks", "calls", "max_calls", "max_stages"}, s)
            self.assertEqual(s["max_stages"], 1)
            self.assertTrue(s["marks"] and all(m.startswith("GET /api/") for m in s["marks"]), s)
        for x in d["screens_excluded"]:
            self.assertEqual(set(x), {"path", "why"}, x)
            self.assertTrue(str(x["why"]).strip(), x)
        for t in d["staging"]:
            self.assertEqual(set(t) - {"_why"}, {"name", "base", "method", "path", "max_ms"}, t)
            self.assertIn(t["base"], ("STAGING_BASE_URL", "STAGING_API_BASE"))
            self.assertIn(t["method"], ("GET", "OPTIONS"))
            self.assertIsInstance(t["max_ms"], int)
            self.assertGreater(t["max_ms"], 0)
        for key, rows in (
            ("api", [a["path"] for a in d["api"]]),
            ("screens", [s["path"] for s in d["screens"]] + [x["path"] for x in d["screens_excluded"]]),
        ):
            self.assertEqual(len(rows), len(set(rows)), f"{key} に同じ道が 2 つある")

    def test_K237_LG_002_not_looser_than_targets(self) -> None:
        """K237-LG-002 目標より緩くない：目標の口・画面・staging の道が全部台帳に在り、どの上限も目標以下。
        目標の表に無い項目も天井（文 15・begin 2・口 9・800ms）以下"""
        d = load()
        api = {a["path"]: (a["max_statements"], a["max_begins"]) for a in d["api"]}
        for path, (st, bg) in API_TARGETS.items():
            self.assertIn(path, api, f"台帳に口が無い：{path}")
            self.assertLessEqual(api[path][0], st, path)
            self.assertLessEqual(api[path][1], bg, path)
        for path, (st, bg) in api.items():
            self.assertLessEqual(st, CAP_STATEMENTS, path)
            self.assertLessEqual(bg, CAP_BEGINS, path)
        scr = {s["path"]: s["max_calls"] for s in d["screens"]}
        for path, n in SCREEN_TARGETS.items():
            self.assertIn(path, scr, f"台帳に画面が無い：{path}")
            self.assertLessEqual(scr[path], n, path)
        for path, n in scr.items():
            self.assertLessEqual(n, CAP_CALLS, path)
        stg = {(t["base"], t["method"], t["path"]): t["max_ms"] for t in d["staging"]}
        for key, ms in STAGING_TARGETS.items():
            self.assertIn(key, stg, f"台帳に staging の項目が無い：{key}")
            self.assertLessEqual(stg[key], ms, key)
        for key, ms in stg.items():
            self.assertLessEqual(ms, CAP_MS, key)

    def test_K237_LG_003_screens_calls_covered(self) -> None:
        """K237-LG-003 被覆：画面の呼んでよい口（calls）と目印（marks）の道は、全部 api に上限がある（上限の無い口を画面が呼べない）。
        marks の道は calls にも在る"""
        d = load()
        api = {bare(a["path"]) for a in d["api"]}
        for s in d["screens"]:
            for c in s["calls"]:
                self.assertIn(bare(c), api, f"{s['path']} の {c} に上限が無い")
            for m in s["marks"]:
                p = bare(m.split(" ", 1)[1])
                self.assertIn(p, api, f"{s['path']} の目印 {m} に上限が無い")
                self.assertIn(p, [bare(c) for c in s["calls"]], f"{s['path']} の目印 {m} が calls に無い")

    def test_K237_LG_004_ci_wiring(self) -> None:
        """K237-LG-004 CI の結び：(a) ci_scope.json の data_links に、台帳を変えたら TS の 2 本（口・画面）が流れる行がある
        (b) 05_flow/build_testplan.py の G65 の命令と、作り直した v3-gate.yml の G65 の段の命令に、Python の 2 本がある（毎回流れる）"""
        links = json.loads(SCOPE.read_text(encoding="utf-8"))["data_links"]
        tests = {t for ln in links if "scripts/ci/perf_budget.json" in ln.get("paths", []) for t in ln.get("tests", [])}
        self.assertTrue(set(TS_READERS) <= tests, tests)
        import sys  # noqa: E402
        sys.path.insert(0, str(ROOT / "scripts" / "ci"))
        import gate_cmds  # noqa: E402  G65 の並びは scripts/ci/g65.d から作り手（TESTPLAN）が作る（K-376）
        g65 = gate_cmds.commands(ROOT / "scripts" / "ci" / "g65.d", last="python3 scripts/ci/k248_scope_reach_test.py")
        gate = GATE.read_text(encoding="utf-8")
        for cmd in PY_TESTS:
            self.assertIn(cmd, g65)
            self.assertIn(cmd, gate)

    def test_K237_LG_005_every_login_screen_listed(self) -> None:
        """K237-LG-005 被覆：キャンバスとの突き合わせの組（04_design/fidelity.json）の app の道のうち、ログインの要る画面は全部、
        台帳の screens か screens_excluded（理由つき）に在る（新しい画面を足して台帳に無ければ赤）。道の {ticket} は :id と読む"""
        d = load()
        listed = {s["path"] for s in d["screens"]} | {x["path"] for x in d["screens_excluded"]}
        groups = json.loads(FIDELITY.read_text(encoding="utf-8"))["groups"]
        apps = {str(g["app"]).replace("{ticket}", ":id") for g in groups if isinstance(g.get("app"), str)}
        missing = sorted(p for p in apps - PUBLIC_SCREENS if p not in listed)
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
