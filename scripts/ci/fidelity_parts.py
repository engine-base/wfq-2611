#!/usr/bin/env python3
"""キャンバスの突き合わせ（G70）の組 → その組の頁が import で辿って読むファイル（K-1105）。

組（04_design/fidelity.json の groups）の app の道から頁（apps/web/app の下の page.tsx）を見つけ、頁と、根から頁までの
layout・template・loading・error・not-found を入口にして、import を辿った物（部品・CSS）を集める。手で並べない。
  ・頁の道：括弧の区切り（(work)）は数えない。組の字の段は同じ字の段の頁を先に探し、無ければ動く段 [x]・[...x]・[[...x]] に当たる。
    組の {y} は動く段にだけ当たる。問い（?…）は外す
  ・import：import … from・export … from・import "…"・import("…")・require("…")・CSS の @import。道は相対と別名 @/（apps/web/）
  ・パッケージ名の import は辿らない（ワークスペースの部品は workspace_src が別に出す。決められない物として全部に倒す）
頁が見つからない組・app の道が無い組は None（決められない）。
"""
from __future__ import annotations

import json
import os
import re

WEB = "apps/web/"
APP = "apps/web/app/"
SEGMENT_FILES = ("layout", "template", "loading", "error", "not-found")
ENTRY_FILES = (*SEGMENT_FILES, "page", "route", "default", "global-error")
EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".css")
SKIP_DIRS = {"node_modules", ".next", ".next-prod", "tests", "test"}

IMPORT = re.compile(
    r"""(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]"""     # import … from "x"・export … from "x"
    r"""|import\s*['"]([^'"]+)['"]"""                                 # import "x"（副作用・CSS）
    r"""|import\(\s*['"]([^'"]+)['"]\s*\)"""                          # import("x")
    r"""|require\(\s*['"]([^'"]+)['"]\s*\)"""                         # require("x")
    r"""|@import\s+(?:url\()?\s*['"]([^'"]+)['"]""")                  # CSS の @import "x"・@import url("x")


def _json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        v = json.load(f)
    return v if isinstance(v, dict) else {}


def _files(repo: str) -> set[str]:
    out: set[str] = set()
    root = os.path.join(repo, WEB)
    for dp, dns, fs in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for f in fs:
            out.add(os.path.relpath(os.path.join(dp, f), repo).replace(os.sep, "/"))
    return out


def _resolve(src: str, spec: str, files: set[str]) -> str | None:
    if spec.startswith("@/"):
        base = WEB + spec[2:]
    elif spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(src), spec)).replace(os.sep, "/")
    else:
        return None   # パッケージ名（node_modules・ワークスペース）は辿らない
    for cand in (base, *(base + e for e in EXTS), *(f"{base}/index{e}" for e in EXTS)):
        if cand in files:
            return cand
    return None


class Graph:
    """apps/web の中の import の地図（ファイルごとに 1 回だけ読む）"""

    def __init__(self, repo: str) -> None:
        self.repo = repo
        self.files = _files(repo)
        self._deps: dict[str, set[str]] = {}

    def deps(self, f: str) -> set[str]:
        if f not in self._deps:
            got: set[str] = set()
            if f.endswith(EXTS):
                with open(os.path.join(self.repo, f), encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
                for m in IMPORT.finditer(text):
                    spec = next(g for g in m.groups() if g)
                    r = _resolve(f, spec, self.files)
                    if r:
                        got.add(r)
            self._deps[f] = got
        return self._deps[f]

    def closure(self, entries: list[str]) -> set[str]:
        seen: set[str] = set()
        stack = [e for e in entries if e in self.files]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            stack.extend(self.deps(x) - seen)
        return seen


def _route(page: str) -> list[str]:
    """apps/web/app/(work)/tickets/[id]/page.tsx → ["tickets", "[id]"]（括弧の区切り・並びの段 @x は数えない）"""
    parts = page[len(APP):].split("/")[:-1]
    return [p for p in parts if not (p.startswith("(") and p.endswith(")")) and not p.startswith("@")]


def _dynamic(seg: str) -> bool:
    return seg.startswith("[") and seg.endswith("]")


def _catch_all(seg: str) -> bool:
    return seg.startswith("[...") or seg.startswith("[[...")


def _score(route: list[str], want: list[str]) -> int | None:
    """組の道 want に頁の道 route が当たれば、字で当たった段の数（多いほど先）。当たらなければ None"""
    hit = 0
    for i, seg in enumerate(route):
        if _catch_all(seg):
            if len(want) > i or seg.startswith("[[..."):
                return hit
            return None
        if i >= len(want):
            return None
        w = want[i]
        if w.startswith("{") and w.endswith("}"):
            if not _dynamic(seg):
                return None
        elif seg == w:
            hit += 1
        elif not _dynamic(seg):
            return None
    return hit if len(route) == len(want) else None


def pages(g: Graph) -> list[str]:
    return sorted(f for f in g.files if f.startswith(APP) and os.path.basename(f).split(".")[0] == "page" and f.endswith(EXTS))


def page_for(g: Graph, app: str) -> str | None:
    """組の app の道 → 頁。字の段で多く当たる頁が先。無ければ None"""
    want = [s for s in app.split("?", 1)[0].split("#", 1)[0].strip("/").split("/") if s]
    best: tuple[int, str] | None = None
    for p in pages(g):
        sc = _score(_route(p), want)
        if sc is not None and (best is None or sc > best[0]):
            best = (sc, p)
    return best[1] if best else None


def entries_for(g: Graph, page: str) -> list[str]:
    """頁と、根から頁までの段の layout・template・loading・error・not-found"""
    out = [page]
    d = os.path.dirname(page)
    while True:
        out += [f for f in (f"{d}/{n}{e}" for n in SEGMENT_FILES for e in EXTS) if f in g.files]
        if d + "/" == APP or not d.startswith(APP.rstrip("/")):
            break
        d = os.path.dirname(d)
    return out


def all_entries(g: Graph) -> list[str]:
    """どの頁・入口（app の下の頁・layout・route など・middleware）"""
    out = [f for f in g.files if f.startswith(APP) and os.path.basename(f).split(".")[0] in ENTRY_FILES and f.endswith(EXTS)]
    out += [f for f in (WEB + "middleware" + e for e in EXTS) if f in g.files]
    return sorted(out)


def group_files(repo: str, groups: list[dict], graph: Graph | None = None) -> dict[str, list[str] | None]:
    """入れた組ごとに、頁が読むファイル（名前の順）。頁が見つからない組・app の道が無い組は None"""
    g = graph or Graph(repo)
    out: dict[str, list[str] | None] = {}
    for grp in groups:
        if not isinstance(grp, dict) or grp.get("enrolled") is not True or not grp.get("id"):
            continue
        app = grp.get("app")
        page = page_for(g, app) if isinstance(app, str) and app.startswith("/") else None
        out[grp["id"]] = sorted(g.closure(entries_for(g, page))) if page else None
    return out


def reachable(repo: str, graph: Graph | None = None) -> list[str]:
    """どれかの頁・入口から辿れる apps/web のファイル"""
    g = graph or Graph(repo)
    return sorted(g.closure(all_entries(g)))


def workspace_src(repo: str) -> list[str]:
    """apps/web/package.json の workspace: の部品の置き場の src（glob）。頁が読むワークスペースのパッケージ"""
    path = os.path.join(repo, WEB, "package.json")
    try:
        pkg = _json(path)
    except (OSError, json.JSONDecodeError):
        return []
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    want = {k for k, v in deps.items() if isinstance(v, str) and v.startswith("workspace:")}
    out = []
    for top in ("packages", "apps"):
        root = os.path.join(repo, top)
        for d in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            pj = os.path.join(root, d, "package.json")
            try:
                name = _json(pj).get("name")
            except (OSError, json.JSONDecodeError):
                continue
            if name in want:
                out.append(f"{top}/{d}/src/**")
    return out
