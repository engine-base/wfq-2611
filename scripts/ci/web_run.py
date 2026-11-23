#!/usr/bin/env python3
"""web の組の実ブラウザの試験を流す（K-177）。全部の回は今までの命令、チケットの範囲の回は選んだ試験だけ。

  python3 scripts/ci/web_run.py g48|g59     env：CI_FULL（true/false）・CI_WEB_SPECS（JSON の一覧）・CI_WEB_TASKS（JSON・g48 だけ）

g48：試験を流す → 結果の記録（ci_results.py record）→ 照らす（op_gate.py：全部の回は --all・範囲の回は選んだ試験の持ち主だけ --task）
g59：中間の試験（apps/web/tests/skeleton）。範囲の回は選んだものだけ。どちらも、選んだ物が無ければ何も流さない（0 で終わる）
gate <段>：専用の段の画面の試験（ci_scope.json の web_select.gates・K-238）。全部の回は設定の一覧、範囲の回は CI_WEB_GATES の選んだ試験だけ。
  選ばれていなければ何も流さない（0 で終わる）。g48・g59 は、CI_WEB_GATES に流す物があれば「両方の段が空＝壊れている」にしない
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

WEB = "apps/web/"


def commands(part: str, full: bool, specs: list[str], tasks: list[str]) -> list[list[str]]:
    rel = [s[len(WEB):] if s.startswith(WEB) else s for s in specs]
    if part == "g48":
        if full:
            run = ["pnpm", "--filter", "@kaname/web", "e2e:k"]
            gate = ["--all"]
        else:
            if not rel:
                return []
            run = ["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", *rel]
            gate = [x for sp in specs for x in ("--rows-in", sp)]   # 流した試験に書かれた行だけを照らす（持ち主で決めない・K-177）
        return [run,
                ["python3", "scripts/ci/ci_results.py", "record", "--report", "apps/web/pw-reports/k.json",
                 "--sha", os.environ.get("GITHUB_SHA", ""), "--records", "07_qa/ci-results"],
                ["python3", "scripts/ci/op_gate.py", "--spec", "07_qa/test-specs/k", "--tickets", "11_tickets/tickets.json",
                 *gate, "--pending-from-report"]]
    if part == "g59":
        if not full and not rel:
            return []
        return [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", *(["tests/skeleton"] if full else rel)]]
    raise SystemExit(f"知らない段 {part}（g48・g59）")


def gate_commands(gid: str, full: bool, selected: dict, cfg_tests: list[str], grep: str = "") -> list[list[str]]:
    """専用の段の命令：全部の回は設定の一覧、範囲の回は選んだ試験だけ。無ければ命令 0。
    grep（範囲の回だけ・K-1105）：選んだ組の行と組に属さない行だけを流す Playwright の --grep"""
    specs = cfg_tests if full else list(selected.get(gid) or [])
    rel = [s[len(WEB):] if s.startswith(WEB) else s for s in specs]
    extra = ["--grep", grep] if grep and not full else []
    return [["pnpm", "--filter", "@kaname/web", "exec", "playwright", "test", *rel, *extra]] if rel else []


def group_grep(title: str, ids: list[str]) -> str:
    """組の行の名前の形（例 "K238-VF-003 {id}（"）と組の id → 選んだ組の行と、組に属さない行（形の前の字を含まない行）に当たる式。
    Python の re と JS の RegExp で同じに読める書き方だけを使う"""
    head, _, tail = title.partition("{id}")
    alt = "|".join(_js_escape(i) for i in sorted(ids))
    return f"^(?!.*{_js_escape(head)})|{_js_escape(head)}(?:{alt}){_js_escape(tail)}"


def _js_escape(text: str) -> str:
    """正規表現の記号だけを \\ で消す（JS の u 旗なしの RegExp と Python の re の両方で同じ意味）"""
    return re.sub(r"([.*+?^${}()|\[\]\\/-])", r"\\\1", text)


def gate_grep_from_env(gid: str, env: dict) -> str:
    """範囲の台本の出力 CI_WEB_GATE_GROUPS（{"<段>": [組の id…]}）→ その段の --grep。無い・壊れている・鍵が無い・空なら ""（絞らない）"""
    try:
        got = json.loads(env.get("CI_WEB_GATE_GROUPS") or "{}")
    except json.JSONDecodeError:
        return ""
    ids = got.get(gid) if isinstance(got, dict) else None
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and i for i in ids):
        return ""
    title = (_gate_cfg(gid) or {}).get("group_title") or ""
    return group_grep(title, ids) if "{id}" in title else ""


def _gate_cfg(gid: str) -> dict:
    cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ci_scope.json"), encoding="utf-8"))
    return (((cfg.get("web_select") or {}).get("gates") or {}).get(gid) or {})


def gate_tests(gid: str) -> list[str]:
    return list(_gate_cfg(gid).get("tests") or [])


def gate_selection(gid: str) -> list[str] | None:
    """範囲の回の専用の段の一覧。渡っていない（無い・空・JSON でない・鍵が無い）なら None"""
    raw = os.environ.get("CI_WEB_GATES") or ""
    try:
        got = json.loads(raw) if raw.strip() else None
    except json.JSONDecodeError:
        return None
    if not isinstance(got, dict) or gid not in got:
        return None
    return list(got[gid] or [])


def run_all(cmds: list[list[str]], env: dict) -> int:
    for c in cmds:
        print("$ " + " ".join(c), flush=True)
        r = subprocess.run(c, env=env)
        if r.returncode != 0:
            return r.returncode
    return 0


def env_for(part: str, base: dict) -> dict:
    """報告の置き場（op_gate と ci_results が読む）。組の段の JUnit の置き場（PLAYWRIGHT_JUNIT_OUTPUT_NAME）はそのまま"""
    if part == "g48":
        return {**base, "PW_REPORT": "pw-reports/k.json"}
    return {**base, "PW_REPORT": "pw-reports/skeleton.json", "PLAYWRIGHT_HTML_OUTPUT_DIR": "playwright-report-skeleton"}


def main() -> int:
    part = sys.argv[1] if len(sys.argv) > 1 else ""
    full = os.environ.get("CI_FULL") == "true"
    try:
        gates = json.loads(os.environ.get("CI_WEB_GATES") or "{}")
    except json.JSONDecodeError:
        gates = {}
    gates = gates if isinstance(gates, dict) else {}
    if part == "gate":
        gid = sys.argv[2] if len(sys.argv) > 2 else ""
        cfg_tests = gate_tests(gid)
        if not cfg_tests:
            print(f"★ gate：専用の段 {gid} が ci_scope.json の web_select.gates に無い")
            return 1
        if not full:
            sel = gate_selection(gid)
            if sel is None:
                print(f"★ gate {gid}：範囲の台本の一覧 CI_WEB_GATES が渡っていない（無い・空・JSON でない・段 {gid} の鍵が無い）")
                return 1
            if not sel:
                rest = json.loads(os.environ.get("CI_WEB_SPECS") or "[]") + json.loads(os.environ.get("CI_WEB_OTHER") or "[]")
                # 専用の段が 2 つ以上あるので、ほかの専用の段に流す物が在れば、この段は選ばれなかっただけ（K-379）
                if rest or any(v for k, v in gates.items() if k != gid):
                    print(f"gate {gid}：この回は専用の段 {gid} の画面の試験が選ばれていない（ほかの段だけ流す）")
                    return 0
                print(f"★ gate {gid}：web の組が動いているのに、どの段にも流す画面の試験が無い（範囲の台本の出力が渡っていない）")
                return 1
            gates = {gid: sel}
        return run_all(gate_commands(gid, full, gates, cfg_tests, gate_grep_from_env(gid, dict(os.environ))), dict(os.environ))
    specs = json.loads(os.environ.get("CI_WEB_SPECS") or "[]")
    tasks = json.loads(os.environ.get("CI_WEB_TASKS") or "[]")
    cmds = commands(part, full, specs, tasks)
    if not cmds:
        other = json.loads(os.environ.get("CI_WEB_OTHER") or "[]")
        if other or any(gates.values()):   # もう片方の段（G48／G59）には流す物がある。この段は選ばれなかっただけ
            print(f"{part}：この段に当たる画面の試験は無い（もう片方の段だけ流す）")
            return 0
        # web の組が動いているのに両方の段の一覧が空＝範囲の台本の出力が渡っていない（壊れている）。黙って緑にしない
        print(f"★ {part}：web の組が動いているのに、流す画面の試験の一覧が両方の段で空（範囲の台本の出力 web_g48・web_g59 が渡っていない）")
        return 1
    return run_all(cmds, env_for(part, dict(os.environ)))


if __name__ == "__main__":
    sys.exit(main())
