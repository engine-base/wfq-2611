#!/usr/bin/env python3
"""K-195 の試験：CI の台（Linux の VM の元の像）に、試験が要る道具（Google Chrome）を入れる。行 ID は K195-RC-NNN。

  python3 scripts/ci/k195_runner_chrome_test.py

見るのは、元の像を温める命令（ticket-flow.yaml の vm.warm）・台に要る道具の一覧（scripts/ci/runner_tools.json）・
Bridge のログインの確認の試験と実装（弱めていないこと）・CI の定義（v3-gate.yml）。

一覧の形（scripts/ci/runner_tools.json）:
  {"tools": [{"name": "Google Chrome",
              "needed_by": ["apps/bridge/test/login-check.test.ts", …],   試験のファイル（リポジトリの頭からの道）
              "paths": {"linux": ["/opt/google/chrome/chrome", …], "darwin": ["/Applications/Google Chrome.app"]},
              "warm": "<vm.warm の 1 行に当たる正規表現>"}]}

一覧に載せる物＝台の道具が要る試験：試験のファイルで、道具の道（/opt・/usr・/Applications）を existsSync で見るもの。
決まり：そういう試験は必ず process.env の CI を読み、CI で道具が無ければ飛ばさずに throw する（K195-RC-008）。
CI をほかの用（やり直しの回数など）で読むだけの試験は、一覧に載せない。
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import tempfile
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
LIST = ROOT / "scripts" / "ci" / "runner_tools.json"
BRIDGE_TESTS = ["apps/bridge/test/login-check.test.ts", "apps/bridge/test/login-check-2fa.test.ts",
                "apps/bridge/test/k354-credential-bridge.test.ts"]
# 台の道具を見る試験の鍵：道具の道を existsSync に直に渡す／道の並びを some・find などで existsSync に回す
PROBE = re.compile(r"""existsSync\(\s*["']/(?:opt|usr|Applications)/|\[[^\]]*["']/(?:opt|usr|Applications)/[^\]]*\]\s*\.(?:some|find|filter|every)\(""")
# CI で道具が無ければ落とす形：if (process.env の CI && …) の次で throw
CI_THROW = re.compile(r"""if \(process\.env(?:\[["']CI["']\]|\.CI\b)\s*&&[^\n]*\)\s*\n?\s*throw new Error\(""")
FPR = "EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796"   # Google Inc. (Linux Packages Signing Authority)・2026-11-14 に公式の鍵で確かめた
TEST_FILE = re.compile(r"\.(test|spec)\.(m|c)?(ts|tsx|js|jsx)$")
ABS_PATH = re.compile(r'"(/(?:opt|usr|Applications)/[^"]+)"')


def warm_lines() -> list[str]:
    cfg = yaml.safe_load((ROOT / "ticket-flow.yaml").read_text(encoding="utf-8"))
    return [str(w).strip() for w in (cfg.get("vm") or {}).get("warm") or []]


def tools(path: pathlib.Path = LIST) -> list[dict]:
    """一覧を読む。無い・読めない・空は例外（何も見ていないのに緑にしない）"""
    data = json.loads(path.read_text(encoding="utf-8"))
    out = data.get("tools")
    if not isinstance(out, list) or not out:
        raise ValueError("台に要る道具の一覧が空")
    return out


def _tests(root: pathlib.Path) -> list[tuple[str, str]]:
    """版に入っている試験のファイル → [(名前, 中身)]。名前は -z で読む（日本語・空白）"""
    r = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=True)
    out = []
    for name in r.stdout.decode("utf-8").split("\0"):
        if name and TEST_FILE.search(name) and (root / name).is_file():
            out.append((name, (root / name).read_text(encoding="utf-8", errors="replace")))
    return out


def tool_tests(root: pathlib.Path) -> list[str]:
    """台の道具が要る試験（道具の道を existsSync で見る試験）"""
    return sorted(name for name, text in _tests(root) if "existsSync(" in text and PROBE.search(text))


def unregistered(root: pathlib.Path, tool_list: list[dict]) -> list[str]:
    """台の道具が要る試験のうち、一覧のどの道具の needed_by にも無いもの"""
    known = {f for t in tool_list for f in t.get("needed_by") or []}
    return [f for f in tool_tests(root) if f not in known]


def silent_in_ci(root: pathlib.Path) -> list[str]:
    """台の道具が要る試験のうち、CI で道具が無いときに落とす形（CI を読んで throw）を持たないもの＝CI で黙って飛ぶ"""
    texts = dict(_tests(root))
    return [f for f in tool_tests(root) if not CI_THROW.search(texts[f])]


class RunnerChrome(unittest.TestCase):
    def test_K195_RC_001_chrome_in_image(self) -> None:
        """K195-RC-001 元の像を温める命令（vm.warm）に、Google Chrome（stable）を公式の apt の置き場から入れる 1 行がある。
        鍵の指紋を照らしてから signed-by つきで足し（apt が署名を見る）、入れた後に置き場の list を消し、入ったことを同じ行で確かめる"""
        hit = [w for w in warm_lines() if "google-chrome-stable" in w]
        self.assertEqual(len(hit), 1, "Google Chrome を入れる行は 1 行")
        w = hit[0]
        self.assertNotIn(";", w, "前が落ちたら止まる（&& でつなぐ）")
        self.assertNotRegex(w, r"\.deb\b", "落とした包みを直に入れない（apt が署名を見ない）")
        order = [r"https://dl\.google\.com/linux/linux_signing_key\.pub",        # 鍵を取る
                 FPR,                                                             # 指紋を照らす
                 r"signed-by=\S+\] https://dl\.google\.com/linux/chrome/deb/? stable main",   # 置き場を足す
                 r"apt-get update",
                 r"apt-get install -y (?:-\S+ )*google-chrome-stable",
                 r"rm -f /etc/apt/sources\.list\.d/google-chrome\*?\.list",        # 組が毎回外を見に行かない
                 r"google-chrome-stable --version\s*$"]                           # 入らなければ像を作らない
        pos = -1
        for pat in order:
            m = re.compile(pat).search(w, pos + 1)
            self.assertIsNotNone(m, f"この順で要る：{pat}")
            pos = m.start()
        self.assertRegex(w, r"grep -q \S*" + FPR, "指紋が合わなければ止まる（grep -q）")
        self.assertIn("arch=$(dpkg --print-architecture)", w, "台の作りは台に聞く")
        self.assertNotRegex(w, r"arch=(amd64|arm64)", "作りを決め打ちしない")

    def test_K195_RC_002_tests_and_product_not_weakened(self) -> None:
        """K195-RC-002 直し方で試験と製品を弱めない：2 本の試験は CI で Chrome が無ければ読み込みで落ちるまま。
        Bridge は本人の Chrome（channel: "chrome"）で開くまま（chromium に替えない・実行ファイルの道を渡さない）"""
        for f in BRIDGE_TESTS:
            src = (ROOT / f).read_text(encoding="utf-8")
            self.assertRegex(src, r'if \(process\.env\["CI"\] && !HAS_CHROME\)\s*\n\s*throw new Error\(', f"{f}：CI では必ず流す")
            self.assertNotRegex(src, r"skipIf\([^)]*process\.env", f"{f}：CI で飛ばす形にしない")
            self.assertNotIn("chromium", src.split("const HAS_CHROME")[1].split("throw new Error")[0], f"{f}：Chrome の代わりを数えない")
        impl = (ROOT / "apps/bridge/src/login-check.ts").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'channel:\s*"chrome"', impl)), 1)
        self.assertNotIn("executablePath", impl)

    def test_K195_RC_003_every_tool_test_is_listed(self) -> None:
        """K195-RC-003 一覧 ⇔ 試験：台の道具が要る試験（道具の道を existsSync で見る試験）は、どれも一覧のどれかの道具の
        needed_by に載っている。needed_by のファイルは実在し、今も道具の道を見ている。一覧に無い試験を置くと赤"""
        tl = tools()
        self.assertEqual(unregistered(ROOT, tl), [],
                         "台の道具が要る試験が一覧に無い（scripts/ci/runner_tools.json と ticket-flow.yaml の vm.warm に足す）")
        probing = set(tool_tests(ROOT))
        for t in tl:
            self.assertTrue(t.get("name") and t.get("needed_by"), f"名前と needed_by が要る：{t}")
            for f in t["needed_by"]:
                self.assertTrue((ROOT / f).is_file(), f"{t['name']}：needed_by の {f} が無い")
                self.assertIn(f, probing, f"{t['name']}：{f} はもう道具の道を見ていない（一覧から外す）")
        for f in BRIDGE_TESTS:
            self.assertIn(f, {x for t in tl for x in t["needed_by"]})

    def test_K195_RC_004_every_listed_tool_is_warmed(self) -> None:
        """K195-RC-004 一覧 ⇔ 像：一覧の道具はどれも、vm.warm のちょうど 1 行に当たる（一覧に足して像に入れ忘れると赤）。
        一覧が無い・読めない・空なら赤（何も見ていないのに緑にしない）"""
        warm = warm_lines()
        for t in tools():
            pat = t.get("warm") or ""
            self.assertTrue(pat, f"{t.get('name')}：warm（像に入れる行に当たる正規表現）が要る")
            self.assertEqual(len([w for w in warm if re.search(pat, w)]), 1, f"{t['name']}：vm.warm のちょうど 1 行に当たる")
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "一覧.json"
            for bad in ('{"tools": []}', "{}", "{こわれた"):
                p.write_text(bad, encoding="utf-8")
                with self.assertRaises(ValueError, msg=bad):   # JSON の誤りも ValueError
                    tools(p)
            with self.assertRaises(OSError):
                tools(pathlib.Path(d) / "無い.json")

    def test_K195_RC_005_paths_match_what_tests_look_for(self) -> None:
        """K195-RC-005 手元と台の違い：試験が Chrome を探す道（Linux の /opt・/usr/bin と Mac の /Applications）は、
        どれも一覧のその道具の paths に載っている（試験が見ない所に入れて「入れたのに無い」にしない）。
        Linux の道には、公式の包みが置く /opt/google/chrome/chrome がある"""
        for t in tools():
            listed = {p for ps in (t.get("paths") or {}).values() for p in ps}
            self.assertTrue((t.get("paths") or {}).get("linux"), f"{t['name']}：Linux の道が要る（CI の台は Linux）")
            for f in t["needed_by"]:
                looked = set(ABS_PATH.findall((ROOT / f).read_text(encoding="utf-8")))
                self.assertTrue(looked, f"{f}：道具を探す道が読めない")
                self.assertLessEqual(looked, listed, f"{f} が探す道が一覧に無い")
        chrome = next(t for t in tools() if BRIDGE_TESTS[0] in t["needed_by"])
        self.assertIn("/opt/google/chrome/chrome", chrome["paths"]["linux"])
        self.assertIn("/Applications/Google Chrome.app", chrome["paths"]["darwin"])

    def test_K195_RC_006_ci_definition(self) -> None:
        """K195-RC-006 CI の定義：どの組も回ごとに Google Chrome を落とさない（像に入れる。140MB を組ごとに落とさない）。
        この試験は spec の組の G65 の並びで流れる"""
        wf = yaml.safe_load((ROOT / ".github/workflows/v3-gate.yml").read_text(encoding="utf-8"))
        runs = [(j, str(s.get("name", "")), str(s.get("run", ""))) for j, job in wf["jobs"].items() for s in job.get("steps") or []]
        self.assertFalse([(j, n) for j, n, r in runs if re.search(r"google-chrome|playwright install( --with-deps)? chrome\b", r)],
                         "組の中で Chrome を入れない")
        g65 = [r for j, n, r in runs if j == "spec" and n.startswith("G65 ")]
        self.assertEqual(len(g65), 1)
        self.assertIn("python3 scripts/ci/k195_runner_chrome_test.py", g65[0])

    def test_K195_RC_007_japanese_names_and_seeded_miss(self) -> None:
        """K195-RC-007 わざと壊す：作り物のリポジトリに、一覧に無い「台の道具が要る試験」（日本語と空白の名前）を置くと、
        その名前がそのまま見つかる。一覧に足すと 0 件。CI をほかの用で読むだけの試験・道具を見ない試験・試験でないファイルは数えない"""
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            jp, arr = self.seed(root)
            self.assertEqual(tool_tests(root), sorted([jp, arr, "apps/x/test/skip-only.test.ts"]))
            some = [{"name": "a", "needed_by": [arr, "apps/x/test/skip-only.test.ts"]}]
            self.assertEqual(unregistered(root, some), [jp])
            self.assertEqual(unregistered(root, [{"name": "a", "needed_by": some[0]["needed_by"] + [jp]}]), [])

    def test_K195_RC_008_tool_tests_fail_loudly_in_ci(self) -> None:
        """K195-RC-008 台の道具が要る試験は、必ず CI を読んで、CI で道具が無ければ飛ばさずに落ちる（if (process.env の CI && …) throw）。
        本物：今の版に、黙って飛ぶ試験は 0 本。作り物：skipIf だけで飛ぶ試験を置くと、その名前を言う。throw を持つ試験と、
        CI をやり直しの回数に読むだけの試験は言わない"""
        self.assertEqual(silent_in_ci(ROOT), [], "道具が無いと CI で黙って飛ぶ試験がある（CI では throw する）")
        self.assertEqual(tool_tests(ROOT), sorted(BRIDGE_TESTS), "今の版で台の道具を見る試験は 3 本")
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            self.seed(root)
            self.assertEqual(silent_in_ci(root), ["apps/x/test/skip-only.test.ts"])

    @staticmethod
    def seed(root: pathlib.Path) -> tuple[str, str]:
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        jp = "apps/x/test/ログイン の確認.test.ts"
        arr = "apps/x/test/array.test.ts"
        throw = 'if (process.env["CI"] && !HAS)\n  throw new Error("道具が要る");\n'
        files = {
            jp: 'const HAS = existsSync("/Applications/Tool.app");\n' + throw,
            arr: 'const HAS = ["/opt/tool/bin/tool", "/usr/bin/tool"].some((p) =>\n  existsSync(p),\n);\n' + throw.replace('["CI"]', ".CI"),
            "apps/x/test/skip-only.test.ts": 'const HAS = existsSync("/usr/bin/ffmpeg");\nit.skipIf(!HAS)("x", () => {});\n',
            "apps/x/test/dot.spec.ts": "if (process.env.CI) retries = 2;\n",
            "apps/x/test/plain.test.ts": 'it("x", () => { run("/usr/bin/true"); });\n',
            "apps/x/test/data.test.ts": 'it("x", () => { expect(existsSync(join(dir, "a.txt"))).toBe(true); });\n',
            "apps/x/src/env.ts": 'export const has = existsSync("/usr/bin/tool");\n',
        }
        for name, text in files.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
        return jp, arr


if __name__ == "__main__":
    unittest.main(verbosity=2)
