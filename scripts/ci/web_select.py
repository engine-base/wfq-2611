#!/usr/bin/env python3
"""web の組（実ブラウザの試験）で、チケットの範囲の回に流す試験を選ぶ（K-177）。

決まり（D-133.7）：チケットの CI はチケットの範囲だけ・全部は大分類の終わりだけ。画面の試験のファイルはどれも 1 つのチケットが持つ
（test_owner_gate）。チケットは depends_on と changes（作ったファイル）を持つ。これで流す試験を決める：
  1. チケット自身の画面の試験
  2. depends_on のチケットの画面の試験（依存の依存はたどらない：そこは大分類の終わりの全部で見る）
  3. 変えた画面の試験のファイル・変えた試験の共通部品（apps/web/tests の spec でない物）を直に・間に挟んで読み込む試験
  4. 変えたファイルを changes に持つチケットの画面の試験（みんなが書き足す一覧のファイル＝cfg.registry は除く）
  5. 画面の試験の設定（cfg.all_on）を変えたら全部
選ぶ先は 3 つ：G48（apps/web/package.json の e2e:k の一覧）と G59（apps/web/tests/skeleton）と、専用の段の画面の試験（cfg.gates・K-238）。
専用の段は {"<段>": {"tests": [試験], "on": [変えたらその段を起こすファイル]}}。選び方は上の 1〜5 と同じに、on に当たるファイルを足したもの。
G48・G59 の答えは専用の段の設定の有無で変わらない。どの選ぶ先にも無い試験は選ばない。
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import shlex

WEB = "apps/web/"
TESTS = "apps/web/tests/"
SKELETON = "apps/web/tests/skeleton/"


def _match(path: str, pat: str) -> bool:
    if "**" in pat:
        rx = "^" + re.escape(pat).replace(r"\*\*/", "(.*/)?").replace(r"\*\*", ".*").replace(r"\*", "[^/]*") + "$"
        return re.match(rx, path) is not None
    return fnmatch.fnmatchcase(path, pat) and (pat.count("/") == path.count("/") or "*" not in pat)


def _any(path: str, pats: list[str]) -> bool:
    return any(_match(path, p) for p in pats)


def select(changed: list[str], ticket: str, tickets: dict, g48: list[str], g59: list[str],
           importers: dict[str, set[str]], cfg: dict) -> dict:
    d48, d59 = set(g48), set(g59)
    dom = d48 | d59
    pick: set[str] = set()
    why: list[str] = []
    every = False
    infra = False   # 試験の設定・試験の置き場の物で全部に倒れた（部品の対応を持つ段も全部・K-1105）
    own, tst = cfg.get("web_own") or ["apps/web/app/**"], cfg.get("web_tests") or ["apps/web/tests/**"]
    tests_of = lambda tid: {x for x in (tickets.get(tid) or {}).get("tests") or [] if x in dom}  # noqa: E731

    def built_by(f: str) -> set[str]:
        return {x for tid, t in tickets.items() if any(f == c or _match(f, c) for c in t.get("changes") or []) for x in tests_of(tid)}

    for tid in ([ticket] if isinstance(ticket, str) else list(ticket or [])):   # 範囲のチケットが複数でも全部（K-177 レビュー）
        pick |= tests_of(tid)
        for d in (tickets.get(tid) or {}).get("depends_on") or []:
            pick |= tests_of(d)
    for f in changed:
        if _any(f, cfg.get("all_on") or []):
            every = infra = True
            why.append(f"web：画面の試験の設定 {f} を変えた（全部に効く）")
        elif f in dom:
            pick.add(f)
        elif _any(f, tst):
            if f in importers:
                pick |= set(importers[f]) & dom
            elif not f.endswith(".spec.ts"):
                every = infra = True
                why.append(f"web：試験の置き場の {f} はどの試験も読み込まない（設定と同じく全部に効く）")
        elif _any(f, own):
            hit = built_by(f)
            if hit:
                pick |= hit
            else:
                every = True
                why.append(f"web：画面のコード {f} を作ったチケットの試験に当たらない（黙って飛ばさず全部）")
        elif f.startswith(WEB):
            every = True
            why.append(f"web：共通の画面のコード {f}（どの画面が使うか決められないので全部）")
        elif not _any(f, cfg.get("registry") or []):
            pick |= built_by(f)
    if every:
        pick |= dom
    r48, r59 = sorted(pick & d48), sorted(pick & d59)
    gates, groups = gate_picks(changed, ticket, tickets, importers, cfg, every, infra)
    on_defer = sorted(g for g, v in gates.items() if v and ((cfg.get("gates") or {}).get(g) or {}).get("on_defer") is True)
    owners = sorted({tid for tid, t in tickets.items() for x in t.get("tests") or [] if x in r48}, key=lambda s: int(s.split("-")[1]))
    if not r48 and not r59 and not any(gates.values()):
        why.append("web：チケット・依存・変えたファイルのどれにも当たる画面の試験が無い（大分類の終わりの全部で見る）")
    return {"g48": r48, "g59": r59, "gates": gates, "gate_groups": groups, "on_defer": on_defer, "tasks": owners, "reasons": why}


def gate_picks(changed: list[str], ticket: str | list[str], tickets: dict, importers: dict[str, set[str]], cfg: dict,
               every: bool, infra: bool = False) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """専用の段ごとに選んだ画面の試験（設定の段は、選ばなくても空の一覧で鍵を持つ）と、組を絞った段の組の一覧（K-1105）。
    部品の対応（parts と ci_scope.gate_cfg が付ける group_files）を持つ段は、前からの全部の道に当たれば全部、当たらなければ
    変えた部品を頁が読む組だけ（頁の無い組は部品を変えれば入る）。対応を持たない段は前からのまま（every・always で全部）"""
    out: dict[str, list[str]] = {}
    groups: dict[str, list[str]] = {}
    tids = [ticket] if isinstance(ticket, str) else list(ticket or [])
    registry = cfg.get("registry") or []
    for gid, g in (cfg.get("gates") or {}).items():
        mine = set(g.get("tests") or [])
        mapped = isinstance(g.get("group_files"), dict) and isinstance(g.get("parts"), dict)
        whole = infra if mapped else (every or bool(g.get("always")))   # always：入れた組があるとき（ci_scope.gate_cfg が付ける・K-238）
        hit = set(mine) if whole else set()
        for tid in tids:
            for t in [tid, *((tickets.get(tid) or {}).get("depends_on") or [])]:
                hit |= set((tickets.get(t) or {}).get("tests") or []) & mine
        for f in changed:
            if f in mine or _any(f, g.get("on") or []):
                hit |= mine if f not in mine else {f}
            hit |= set(importers.get(f, ())) & mine
            if not _any(f, registry):
                hit |= {x for t in tickets.values() if any(f == c or _match(f, c) for c in t.get("changes") or [])
                        for x in t.get("tests") or [] if x in mine}
        if mapped and not hit:
            picked = part_groups(changed, g)
            if picked is None:
                hit = set(mine)
            elif picked:
                hit, groups[gid] = set(mine), picked
        out[gid] = sorted(hit)
    return out, groups


def part_groups(changed: list[str], g: dict) -> list[str] | None:
    """変えたファイル → 組（K-1105）。None は全部（トークン・決められない物）、[] は当たらない"""
    parts = g.get("parts") or {}
    files: dict = g.get("group_files") or {}
    reach = set(g.get("reach") or [])
    unsure = list(parts.get("unsure") or []) + list(g.get("unsure_auto") or [])
    picked: set[str] = set()
    for f in changed:
        if _any(f, parts.get("all_on") or []) or _any(f, unsure):
            return None
        if not _any(f, parts.get("parts") or []) or _any(f, parts.get("skip") or []):
            continue
        if f not in reach and not any(v and f in v for v in files.values()):
            return None   # どの頁・入口からも辿れない画面の物（fs で読む文面など）：決められない
        picked |= {k for k, v in files.items() if v is None or f in v}
    return sorted(picked)


WORKFLOW = ".github/workflows/v3-gate.yml"


def check_gates(repo: str, cfg: dict) -> list[str]:
    """専用の段の設定の赤：試験が実ファイルとして無い・段の命令（web_run.py gate <段>）が workflow に無い・試験が G48・G59 の一覧にも在る"""
    errs = []
    wf_path = os.path.join(repo, WORKFLOW)
    wf = open(wf_path, encoding="utf-8").read() if os.path.isfile(wf_path) else ""
    d48, d59 = set(domain_g48(repo)), set(domain_g59(repo))
    for gid, g in (cfg.get("gates") or {}).items():
        if not re.search(rf"web_run\.py gate {re.escape(gid)}(\s|$)", wf):
            errs.append(f"専用の段 G{gid} を流す段（web_run.py gate {gid}）が {WORKFLOW} に無い（選んでも誰も流さない）")
        for t in g.get("tests") or []:
            for name, dom in (("G48", d48), ("G59", d59)):
                if t in dom:
                    errs.append(f"専用の段 G{gid} の画面の試験 {t} が {name} の一覧にも在る（2 回流れる）")
        tests = g.get("tests") or []
        if not tests:
            errs.append(f"専用の段 G{gid} に画面の試験が 1 つも無い（ci_scope.json の web_select.gates）")
        errs += [f"専用の段 G{gid} の画面の試験 {t} が無い（ci_scope.json の web_select.gates）"
                 for t in tests if not os.path.isfile(os.path.join(repo, t))]
    return errs


def domain_g48(repo: str) -> list[str]:
    """G48 の一覧：apps/web/package.json の e2e:k の「playwright test」の後の引数（ファイルか置き場）を開いた spec"""
    path = os.path.join(repo, WEB, "package.json")
    if not os.path.isfile(path):
        return []   # 画面の試験の一覧が無いリポジトリ（選ぶ物が無い）
    pkg = json.load(open(path, encoding="utf-8"))
    args = shlex.split((pkg.get("scripts") or {}).get("e2e:k", ""))
    args = args[args.index("test") + 1:] if "test" in args else []
    out: set[str] = set()
    for a in args:
        if a.startswith("-"):
            continue
        p = os.path.join(repo, WEB, a)
        if os.path.isfile(p):
            out.add(os.path.relpath(p, repo).replace(os.sep, "/"))
        elif os.path.isdir(p):
            for dp, _, fs in os.walk(p):
                out |= {os.path.relpath(os.path.join(dp, f), repo).replace(os.sep, "/") for f in fs if f.endswith(".spec.ts")}
    return sorted(out)


def domain_g59(repo: str) -> list[str]:
    root = os.path.join(repo, SKELETON)
    return sorted(os.path.relpath(os.path.join(dp, f), repo).replace(os.sep, "/")
                  for dp, _, fs in os.walk(root) for f in fs if f.endswith(".spec.ts")) if os.path.isdir(root) else []


IMPORT = re.compile(r"""(?:import|export)[^'"]*?from\s*['"](\.{1,2}/[^'"]+)['"]|import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)""")


def importers(repo: str) -> dict[str, set[str]]:
    """apps/web/tests の spec でない物 → それを直に・間に挟んで読み込む spec"""
    root = os.path.join(repo, TESTS)
    files = [os.path.relpath(os.path.join(dp, f), repo).replace(os.sep, "/")
             for dp, _, fs in os.walk(root) for f in fs if f.endswith((".ts", ".tsx", ".mjs", ".js"))]
    deps: dict[str, set[str]] = {}
    for f in files:
        src = open(os.path.join(repo, f), encoding="utf-8", errors="replace").read()
        for m in IMPORT.finditer(src):
            rel = m.group(1) or m.group(2)
            base = os.path.normpath(os.path.join(os.path.dirname(f), rel)).replace(os.sep, "/")
            for cand in (base, base + ".ts", base + ".tsx", base + ".js", base + "/index.ts"):
                if cand in files:
                    deps.setdefault(f, set()).add(cand)
                    break
    specs = [f for f in files if f.endswith(".spec.ts")]
    out: dict[str, set[str]] = {}
    for s in specs:
        seen, stack = set(), list(deps.get(s, ()))
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            stack.extend(deps.get(x, ()))
        for x in seen:
            out.setdefault(x, set()).add(s)
    return out
