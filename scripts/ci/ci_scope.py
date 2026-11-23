#!/usr/bin/env python3
"""ci_scope.py — チケットの CI の範囲を決める（K-107・D-128.169）。変えたファイル → 依存の地図 → 影響を受ける試験。

  決める（workflow の static の段 G0）:
    python3 scripts/ci/ci_scope.py --base <40 桁の sha> --head HEAD --scope auto|full
        [--rules scripts/ci/ci_scope.json] [--tickets 11_tickets] [--github-output FILE] [--json] [--no-vitest] [--repo .]
      scope の既定は workflow の入力の既定と同じ full（全部）。auto のときだけ絞る。
      終わり方：チケットとの食い違い・試験の無いコード・範囲を決められない理由があれば 1（そのときは --github-output に組を流さない値を書く・K-170）、ほかは 0
  組の中で流す（外から来る値は env の JSON で受け取り、shell を通さずに引数の並びで流す）:
    run-unit --shard <i>   env CI_UNIT_FILES・CI_COVERAGE_ARGS・CI_UNIT_SHARDS
    run-merge              env CI_COVERAGE_ARGS
    run-squawk             env CI_MIGRATION_FILES（空なら何もしない）
    check-count --report <vitest の json>   env CI_UNIT_FILES・CI_FULL（絞った回だけ、決めた試験と流れた試験を比べる）

  K-170（2026-11-11・D-133.7）：scope=auto は全部に倒さない。全部は scope=full（大分類の終わり）だけ。
  止める理由（errors・組は流さない）：requested・base・empty・badpath・ticket・ticket-tests・integration・tool・mismatch
  続ける理由（full_reasons に残し、チケットの範囲で続ける）：ci・lockfile・shared・unmapped・no-declaration
  static と spec だけ（K-156）：決まりの spec（spec.paths・spec.generated のときは generated.json の生成物と作り手）の物は、全部に倒さず組も足さない。
    読む試験・src があれば no_test_path_reads（CS-044）が赤にする（data_links に書く）
    spec.package_paths（K-212）：パッケージの中にあっても組み立てに入らない物（Vercel が読むだけの apps/*/vercel.json など）。
    パッケージの試験を広げず、static と spec だけにする
  画面の組とチケットの一覧（K-156・D-133.5）：jobs.web.ticket_rows のファイル（11_tickets/tickets.json）が変わったら、比べる元と先頭を
    id で比べ、変わった・足した・消した行のチケットが画面を持つ（screens・apps/web の tests）ときだけ web の組。読めないなら流す
  migration の lint（K-156）：scope=full でも比べる元が有効なら migration_files を出す。名前を変えた migration（git の R）も足した物に数える
  DB の範囲（migration・SQL・行の守り・権限）：全部にはせず、database の組＋変えた migration の lint＋DB を使う試験を全部
    答えの db_range（出力 db_range）はこの範囲を触った回だけ真（全部の回も真）。G27 の DB の層はこれで流すかを決める（D-133.6）
  依存の地図：パッケージは pnpm のワークスペース（package.json の workspace:）、試験の import は vitest の Node の口（vitest_related.mjs）
"""
from __future__ import annotations

import argparse
import glob as globmod
import json
import math
import os
import pathlib
import re
import secrets
import subprocess
import sys
from typing import Callable, NamedTuple

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "tickets"))

from ticket_commit_gate import TICKET  # noqa: E402  目録の物（同じものを 2 つ作らない）
from ticket_order_gate import _not_impl, generated_outputs, generator_scripts, is_doc_only  # noqa: E402  _not_impl：実装に数えないコミットの決まりは取り込む順の検査の物をそのまま使う（2 つ持たない・K-192）
from build_index import parse as parse_ticket  # noqa: E402
import fidelity_parts  # noqa: E402
import web_select  # noqa: E402  web の組で流す試験を選ぶ（K-177）

MAX_SHARDS = 6
SHA = re.compile(r"[0-9a-f]{40}")
IMPORT_EXT = (".ts", ".tsx", ".mts", ".mjs", ".js", ".json")
CODE_EXT = (".ts", ".tsx", ".mts", ".mjs", ".js")
HUMAN_EXT = (".md", ".csv", ".html", ".htm", ".txt", ".xlsx", ".pdf", ".svg", ".png")
SCAN_EXT = (".ts", ".tsx", ".mjs")
SKIP_DIRS = {"node_modules", ".next", "dist", "build", "coverage", ".turbo", "out", ".vitest-reports", "playwright-report", "test-results"}
# vitest.config.ts の test.include と同じ（試験のファイルの見分け）
TEST_GLOBS = ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/test/**/*.test.ts"]
WEB_E2E_PREFIX = "apps/web/tests/"   # 実ブラウザの試験（web の組が流す）
WIDE = ("db", "shared", "ci", "lockfile")
READ_MARK = re.compile(r"\b(?:readFileSync|readFile|readdirSync|readdir|createReadStream|statSync|existsSync|spawnSync|spawn|execSync|execFile|execFileSync)\b"
                       r"|(?<![.\w])exec\s*\(|\bfs\.promises\b|(?<![\w.])import\s*\(")
STR_LIT = re.compile(r"""(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1""")
JOIN_CALL = re.compile(r"\b(?:join|resolve)\(([^()]*)\)")


class ToolError(Exception):
    """vitest の辿りが落ちた・答えの形が違う"""


class BaseError(Exception):
    """比べる元が使えない（40 桁の 16 進でない・コミットでない）"""


class Change(NamedTuple):
    status: str
    path: str
    old: str | None


# ---------------------------------------------------------------- 小さな道具
def glob_re(pattern: str) -> re.Pattern:
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("/**", i) and i + 3 == len(pattern):
            out += "(?:/.*)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out + r"\Z", re.S)


def match(path: str, patterns: list[str]) -> bool:
    return any(glob_re(p).match(path) for p in patterns)


def git(repo: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", "-C", repo, "-c", "core.quotePath=false", *args], capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r


def walk_files(repo: str, exts: tuple[str, ...]) -> list[str]:
    """apps/*・packages/* の中のファイル（作業ツリーのまま・作りかけのファイルも見る）"""
    out = []
    for top in ("apps", "packages"):
        base = os.path.join(repo, top)
        if not os.path.isdir(base):
            continue
        for d, dirs, files in os.walk(base):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
            for f in files:
                if f.endswith(exts):
                    out.append(os.path.relpath(os.path.join(d, f), repo).replace(os.sep, "/"))
    return sorted(out)


def test_files(repo: str, under: str | None = None) -> list[str]:
    fs = [f for f in walk_files(repo, (".ts",)) if match(f, TEST_GLOBS)]
    return [f for f in fs if under is None or f.startswith(under.rstrip("/") + "/")]


# ---------------------------------------------------------------- git
def changed_files(repo: str, base: str, head: str) -> list[Change]:
    if not isinstance(base, str) or not SHA.fullmatch(base):
        raise BaseError(f"比べる元が 40 桁の 16 進でない: {base!r}")
    if git(repo, "cat-file", "-e", f"{base}^{{commit}}", check=False).returncode != 0:
        raise BaseError(f"比べる元がコミットでない: {base}")
    raw = git(repo, "diff", "--name-status", "-M", "-z", f"{base}...{head}").stdout.decode("utf-8", "surrogateescape")
    parts = raw.split("\0")
    out, i = [], 0
    while i < len(parts) and parts[i]:
        st = parts[i]
        if st[0] in "RC":
            out.append(Change(st, parts[i + 2], parts[i + 1]))
            i += 3
        else:
            out.append(Change(st, parts[i + 1], None))
            i += 2
    return out


DATE = re.compile(rb"\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?")   # generated_gate.py の DATE と同じ伏せ方（ずれたら K156-CI-062 が赤）


def date_only(repo: str, base: str, head: str, changes: list[Change]) -> list[str]:
    """生成物（generated.json の outputs）で状態が M のうち、比べる元と先頭の中身が日付を伏せると同じもの。
    作り手が今日の日付を書き、取り込みの前に作り直すので、どのチケットでも日付だけ変わる（テスター Q 回 2・K-156）"""
    outs = sorted(generated_outputs(repo))
    found = []
    for c in changes:
        if c.status != "M" or not match(c.path, outs):
            continue
        a = git(repo, "show", f"{base}:{c.path}", check=False)
        b = git(repo, "show", f"{head}:{c.path}", check=False)
        if a.returncode == 0 and b.returncode == 0 and DATE.sub(b"D", a.stdout) == DATE.sub(b"D", b.stdout):
            found.append(c.path)
    return found


def subject_ids(repo: str, base: str, head: str) -> tuple[list[str], list[str]]:
    """base..head のコミットの件名の頭の番号（初めて出た順に 1 回ずつ）と、件名の頭に番号の無いコミットの短い番号（K-210）。
    本文は見ない（No Ticket, No Commit の G55 と同じく件名だけ）。取り込みのコミットは件名でなく親の数（2 つ以上）で見分けて飛ばす"""
    text = git(repo, "log", "--format=%H%x09%P%x09%s", f"{base}..{head}").stdout.decode("utf-8", "replace")
    seen: list[str] = []
    headless: list[str] = []
    for line in text.splitlines():
        sha, _, rest = line.partition("\t")
        parents, _, subj = rest.partition("\t")
        if len(parents.split()) >= 2:
            continue
        m = TICKET.match(subj)
        if not m:
            headless.append(sha[:7])
        elif m.group(0) not in seen:
            seen.append(m.group(0))
    return seen, headless


def ticket_ids(repo: str, base: str, head: str) -> list[str]:
    return subject_ids(repo, base, head)[0]


def history_ids(repo: str, head: str) -> set[str]:
    return set(TICKET.findall(git(repo, "log", "--format=%B", head).stdout.decode("utf-8", "replace")))


def impl_ids(repo: str, head: str, wanted: set[str]) -> set[str]:
    """wanted のうち、実装のコミットが履歴にある番号（K-64）。実装のコミット＝件名がその番号で始まり、文書と進め方の設定だけでないファイルを変えたコミット
    （「実装に数えないファイル」は取り込む順の検査 ticket_order_gate.py と同じ見方。取り込みのコミットは変えたファイルが無いので数えない。
    件名の 2 つ目からの番号は数えない：何枚ものチケットの欄をまとめて直すコミットが、ついでに設定を触っただけで実装に数わるのを防ぐ）。
    本文に番号が出ただけ・チケットや記録の文書だけを変えたコミットは数えない：まだ終わっていない依存を「そろった」と数えると、
    試験の無い中間・統合のチケットがこの回に入り、範囲を決められずに止まる"""
    left, done = set(wanted), set()
    if not left:
        return done
    gen = generated_outputs(repo)
    # git が失敗したら止める（RuntimeError）：浅い写しや読めない head を、黙って「実装なし」にしない（history_ids と同じ向き）
    for line in git(repo, "log", "--format=%H%x09%s", head).stdout.decode("utf-8", "replace").splitlines():
        sha, _, subj = line.partition("\t")
        m = TICKET.match(subj)
        hit = {m.group(0)} & left if m else set()
        if not hit:
            continue
        r = git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-z", sha)
        files = [f for f in r.stdout.decode("utf-8", "replace").split("\0") if f]
        if files and not _not_impl(files, gen):   # 変えたファイルが無い（取り込みのコミット）は数えない
            done |= hit
            left -= hit
            if not left:
                break
    return done


# ---------------------------------------------------------------- ワークスペースの地図
def workspace(repo: str) -> dict[str, dict]:
    """{名前: {"dir": 相対の dir, "deps": {ワークスペースの依存の名前}}}（pnpm の workspace: でつないだもの）"""
    pats, inside = [], False
    p = os.path.join(repo, "pnpm-workspace.yaml")
    for line in (open(p, encoding="utf-8").read().splitlines() if os.path.exists(p) else []):
        if re.match(r"^packages\s*:", line):
            inside = True
            continue
        if inside:
            m = re.match(r"^\s+-\s*['\"]?([^'\"#]+?)['\"]?\s*(?:#.*)?$", line)
            if m:
                pats.append(m.group(1))
            elif line.strip() and not line.startswith((" ", "\t")):
                inside = False
    raw: dict[str, dict] = {}
    for pat in pats:
        for d in sorted(globmod.glob(os.path.join(repo, pat))):
            pj = os.path.join(d, "package.json")
            if not os.path.isfile(pj):
                continue
            j = json.load(open(pj, encoding="utf-8"))
            deps = {}
            for k in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
                deps.update(j.get(k) or {})
            raw[j["name"]] = {"dir": os.path.relpath(d, repo).replace(os.sep, "/"),
                              "deps": {n for n, v in deps.items() if str(v).startswith("workspace:")}}
    for v in raw.values():
        v["deps"] = {n for n in v["deps"] if n in raw}
    return raw


def owner(path: str, ws: dict[str, dict]) -> str | None:
    best = None
    for name, v in ws.items():
        if path.startswith(v["dir"] + "/") and (best is None or len(v["dir"]) > len(ws[best]["dir"])):
            best = name
    return best


def affected(names, ws: dict[str, dict]) -> set[str]:
    """渡したパッケージと、それを辿って使う全部（pnpm --filter "...<名前>" と同じ）"""
    out = set(n for n in names if n in ws)
    grow = True
    while grow:
        grow = False
        for n, v in ws.items():
            if n not in out and v["deps"] & out:
                out.add(n)
                grow = True
    return out


def shared_packages(ws: dict[str, dict], min_dependents: int) -> set[str]:
    return {n for n in ws if len(affected({n}, ws) - {n}) >= min_dependents}


# ---------------------------------------------------------------- 決まり
def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        r = json.load(fh)
    need = {"db": dict, "full": dict, "shared_min_dependents": int, "files_per_shard": int, "affects_required_from": int,
            "coverage_src": dict, "no_test_paths": list, "data_links": list, "reads_ok": dict, "jobs": dict}
    for k, t in need.items():
        if not isinstance(r.get(k), t):
            raise ValueError(f"{path}: {k} が無いか形が違う（{t.__name__}）")
    for k in ("paths", "migrations", "gateway", "markers"):
        if not isinstance(r["db"].get(k), list):
            raise ValueError(f"{path}: db.{k} が無い")
    ml = r["db"].get("migration_list")
    if not (isinstance(ml, dict) and isinstance(ml.get("file"), str) and isinstance(ml.get("entry"), str)):
        raise ValueError(f"{path}: db.migration_list（file・entry）が無い")
    re.compile(ml["entry"])
    if set(r["full"]) - {"ci", "lockfile"} or not all(isinstance(v, list) for v in r["full"].values()):
        raise ValueError(f"{path}: full は ci・lockfile の glob の並びだけ")
    sp = r.get("spec")
    if sp is not None and not (isinstance(sp, dict) and isinstance(sp.get("paths", []), list)
                               and all(isinstance(x, str) for x in sp.get("paths", []))
                               and isinstance(sp.get("package_paths", []), list)
                               and all(isinstance(x, str) for x in sp.get("package_paths", []))
                               and isinstance(sp.get("generated", False), bool)):
        raise ValueError(f"{path}: spec は {{\"paths\": [glob…], \"generated\": true|false, \"package_paths\": [glob…]}}（K-156・K-212）")
    for job, j in r["jobs"].items():
        if not (isinstance(j, dict) and isinstance(j.get("packages"), list) and isinstance(j.get("paths"), list)):
            raise ValueError(f"{path}: jobs.{job} は packages・paths")
        tr = j.get("ticket_rows")
        if tr is not None and not (isinstance(tr, dict) and isinstance(tr.get("file"), str) and isinstance(tr.get("list"), str)):
            raise ValueError(f"{path}: jobs.{job}.ticket_rows は {{\"file\": パス, \"list\": 一覧の鍵}}（K-156）")
    for link in r["data_links"]:
        if not isinstance(link.get("paths"), list) or not (link.get("tests") or link.get("readers")):
            raise ValueError(f"{path}: data_links の 1 つに paths と tests か readers が要る: {link}")
    if r["files_per_shard"] < 1:
        raise ValueError(f"{path}: files_per_shard は 1 以上")
    return _with_generated_gate(r, path)


GENERATED_GATE = "38"   # 生成物が最新か（generated_gate.py）。当たりに目録の生成物を足す（K-210）


def _with_generated_gate(r: dict, path: str) -> dict:
    """gates の 38 に、同じ置き場の generated.json の作り手の outputs を足した新しい設定を返す（目録を写さない・K-210）。
    gates の 38 が無い設定（作りものの試験の設定）はそのまま。目録が無い・壊れているなら止める（黙って足さずに続けない）"""
    gates = r.get("gates")
    if not isinstance(gates, dict) or GENERATED_GATE not in gates:
        return r
    gp = os.path.join(os.path.dirname(os.path.abspath(path)), "generated.json")
    try:
        with open(gp, encoding="utf-8") as fh:
            gen = json.load(fh)
        outs = [o for g in gen["generators"] for o in g["outputs"]]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise ValueError(f"{path}: gates の {GENERATED_GATE} を組み立てる生成物の目録 {gp} が読めない（{e}）") from e
    own = list(gates[GENERATED_GATE])
    merged = own + [o for o in dict.fromkeys(outs) if o not in own]
    return {**r, "gates": {**gates, GENERATED_GATE: merged}}


def human_generated(repo: str) -> list[str]:
    return [g for g in generated_outputs(repo) if g.lower().endswith(HUMAN_EXT)]


def is_spec(path: str, rules: dict, repo: str) -> bool:
    """static と spec の段だけが見る物（K-156）：spec.paths、または spec.generated のとき generated.json の生成物と作り手の台本"""
    sp = rules.get("spec") or {}
    if match(path, sp.get("paths", [])):
        return True
    return bool(sp.get("generated")) and (match(path, sorted(generated_outputs(repo))) or path in generator_scripts(repo))


def root_kind(path: str, rules: dict, repo: str) -> str:
    """どのパッケージにも入らないファイルの種類：db → data → doc → spec → unmapped（jobs の paths はここに数えない）"""
    if match(path, rules["db"]["paths"]):
        return "db"
    if any(match(path, l["paths"]) for l in rules["data_links"]):
        return "data"
    if match(path, rules["no_test_paths"]) or is_doc_only([path], set()):
        return "doc"
    if path.lower().endswith(HUMAN_EXT) and match(path, human_generated(repo)):
        return "doc"
    if is_spec(path, rules, repo):
        return "spec"
    return "unmapped"


# ---------------------------------------------------------------- 読む試験・src の棚卸し
def _read(repo: str, f: str) -> str:
    try:
        return open(os.path.join(repo, f), encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def unmapped_readers(repo: str, rules: dict) -> list[str]:
    """ファイルを読む・子プロセス・動的 import の印を持つのに、data_links にも reads_ok にも無い src と試験"""
    known = set(rules.get("reads_ok", {}))
    for l in rules["data_links"]:
        known |= set(l.get("tests", [])) | set(l.get("readers", []))
    return [f for f in walk_files(repo, SCAN_EXT) if f not in known and READ_MARK.search(_read(repo, f))]


def _norm(p: str) -> str | None:
    p = re.sub(r"\$\{[^}]*\}", "", p).replace("\\", "/")
    parts = [x for x in p.split("/") if x not in ("", ".", "..")]
    if not parts or any(c in "".join(parts) for c in " \t*?<>|\"'") or not re.match(r"^[\w.\-]+$", parts[0]):
        return None
    return "/".join(parts)


def _paths_in(text: str) -> set[str]:
    out: set[str] = set()
    for m in JOIN_CALL.finditer(text):
        lits = [s.group(2) for s in STR_LIT.finditer(m.group(1))]
        if lits:
            n = _norm("/".join(lits))
            if n:
                out.add(n)
    for s in STR_LIT.finditer(text):
        n = _norm(s.group(2))
        if n:
            out.add(n)
    return out


def no_test_path_reads(repo: str, rules: dict) -> list[tuple[str, str]]:
    """試験・src が、試験が読まないと決めた物（root_kind が doc か spec になる物）を指す文字を持つ [(ファイル, 読んだパス)]"""
    web_paths = rules["jobs"].get("web", {}).get("paths", [])
    out = []
    declared: dict[str, set[str]] = {}
    for l in rules["data_links"]:
        for who in list(l.get("tests", [])) + list(l.get("readers", [])):
            declared.setdefault(who, set()).update(l["paths"])
    for f in walk_files(repo, SCAN_EXT):
        found = _paths_in(_read(repo, f))
        for p in sorted(found):
            # join(ROOT, "08_api", "endpoints.json") の "08_api" は読んだパスの一部。読んだ物は全部のパス（同じファイルの文字か、
            #   data_links にこのファイルが読むと書いた物）で見る（入れ子の括弧の join は文字を拾えないため・K-156）
            if any(q.startswith(p + "/") for q in found | declared.get(f, set())):
                continue
            if root_kind(p, rules, repo) not in ("doc", "spec"):
                continue
            # 実ブラウザの試験が jobs.web.paths の物を読むのは、その物を変えると web の組が流れるので赤にしない
            if f.startswith(WEB_E2E_PREFIX) and match(p, web_paths):
                continue
            out.append((f, p))
    return out


def db_tests_by_text(repo: str, rules: dict) -> list[str]:
    marks = [re.compile(m) for m in rules["db"]["markers"]]
    return [f for f in test_files(repo) if any(m.search(_read(repo, f)) for m in marks)]


# ---------------------------------------------------------------- vitest の辿り（本物）
def vitest_list_tests(repo: str) -> Callable[[list[str]], dict]:
    def run(files: list[str]) -> dict:
        try:
            r = subprocess.run(["node", "scripts/ci/vitest_related.mjs", *files], cwd=repo, capture_output=True, text=True, timeout=600)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise ToolError(f"vitest_related.mjs を流せない: {e}")
        if r.returncode != 0:
            raise ToolError(f"vitest_related.mjs が {r.returncode} で終わった: {r.stderr.strip()[-500:]}")
        try:
            return json.loads(r.stdout)
        except ValueError:
            raise ToolError("vitest_related.mjs の答えが JSON でない")
    return run


def check_answer(ans, files: list[str]) -> dict[str, list[str]]:
    if not isinstance(ans, dict) or set(ans) != set(files) or not all(
            isinstance(v, list) and all(isinstance(x, str) for x in v) for v in ans.values()):
        raise ToolError("試験の辿りの答えの形が違う（{ファイル: [試験…]} でない）")
    return ans


# ---------------------------------------------------------------- 決める
def _migration_list_only(repo: str, base: str, head: str, rules: dict, added: set[str], renamed_from: set[str] = frozenset()) -> bool:
    """並びのファイルの変更が、足した migration の名前の行を足しただけか（名前を変えた migration の古い名前の行を消すのは許す・K-156）"""
    ml = rules["db"]["migration_list"]
    entry = re.compile(ml["entry"])
    diff = git(repo, "diff", "-U0", f"{base}...{head}", "--", ml["file"]).stdout.decode("utf-8", "replace")
    names = []
    for line in diff.splitlines():
        if line.startswith(("+++", "---")):
            continue
        if line.startswith("-"):
            m = entry.match(line[1:])
            if not (m and m.group(1) in renamed_from):
                return False
            continue
        if line.startswith("+"):
            m = entry.match(line[1:])
            if not m:
                return False
            names.append(m.group(1))
    return bool(names) and len(names) == len(set(names)) and set(names) == added


def _migrations(changes: list[Change], db: dict) -> tuple[set[str], set[str], list[str]]:
    """(足した・名前を変えた先の migration の名前, 名前を変えた元の名前, lint に渡す migration のパス)。K-156"""
    added = {os.path.basename(c.path) for c in changes if c.status[0] in "AR" and match(c.path, db["migrations"])}
    renamed_from = {os.path.basename(c.old) for c in changes if c.status[0] == "R" and c.old and match(c.path, db["migrations"])}
    files = sorted({c.path for c in changes if not c.status.startswith("D") and match(c.path, db["migrations"])})
    return added, renamed_from, files


def _full_scope_migrations(p: dict, repo: str, base: str, head: str, rules: dict) -> None:
    """全部の回でも、比べる元が有効なら migration の lint に足した migration を渡す（K-156・PM の追加）"""
    try:
        changes = changed_files(repo, base, head)
    except BaseError:
        p["base"] = ""
        return
    db = rules["db"]
    _, _, files = _migrations(changes, db)
    p["migration_files"] = files
    for c in changes:
        for x in [c.path] + ([c.old] if c.old else []):
            if match(x, db["paths"]):
                p["wide_reasons"].append(("db", x))


def _rows_at(repo: str, rev: str, cfg: dict):
    """その版のチケットの一覧の {id: 行}。ファイルが無ければ {}・JSON でない・形が違うなら None"""
    r = git(repo, "show", f"{rev}:{cfg['file']}", check=False)
    if r.returncode != 0:
        return {}
    try:
        rows = json.loads(r.stdout.decode("utf-8"))[cfg["list"]]
        return {str(x["id"]): x for x in rows}
    except (ValueError, KeyError, TypeError):
        return None


def _has_screen(row: dict) -> bool:
    tests = row.get("tests") or []
    return bool(row.get("screens")) or any(str(x).startswith("apps/web/") for x in (tests if isinstance(tests, list) else [tests]))


def web_ticket_rows(repo: str, base: str, head: str, cfg: dict) -> list[str]:
    """チケットの一覧で、変わった・足した・消した行のうち画面を持つチケットの番号（読めないなら ["?"]・D-133.5）"""
    old, new = _rows_at(repo, base, cfg), _rows_at(repo, head, cfg)
    if old is None or new is None:
        return ["?"]
    changed = {k for k in set(old) | set(new) if old.get(k) != new.get(k)}
    return sorted(k for k in changed if _has_screen(new.get(k) or {}) or _has_screen(old.get(k) or {}))


def _read_tickets(tickets_dir: str) -> list[dict]:
    out = []
    for p in sorted(globmod.glob(os.path.join(tickets_dir, "K-*.md"))):
        try:
            out.append(parse_ticket(p))
        except (SystemExit, OSError, ValueError):
            continue
    return out


def _children(tickets: list[dict]) -> dict[str, list[str]]:
    """親の番号 → 子の番号（チケットの頭の欄 parent から）"""
    out: dict[str, list[str]] = {}
    for t in tickets:
        if t.get("parent") and t.get("id"):
            out.setdefault(str(t["parent"]), []).append(str(t["id"]))
    return out


def _family(ids: set[str], kids: dict[str, list[str]]) -> set[str]:
    """ids と、その子・孫の全部（parent の輪があっても 1 度しか見ない）"""
    seen: set[str] = set()
    todo = list(ids)
    while todo:
        k = todo.pop()
        if k not in seen:
            seen.add(k)
            todo += kids.get(k) or []
    return seen


def _dep_done(dep: str, impl: set[str], kids: dict[str, list[str]], _seen: frozenset[str] = frozenset()) -> bool:
    """依存がそろったか：自分の実装のコミットがある（impl）。無ければ、子があって子が全部そろっている（子・孫に分けた親は自分のコミットを持たない）。
    子が 1 つも無いチケットは自分のコミットだけ。parent の輪は、そろっていない扱い"""
    if dep in impl:
        return True
    mine = kids.get(dep) or []
    return bool(mine) and dep not in _seen and all(_dep_done(k, impl, kids, _seen | {dep}) for k in mine)


def _integration(repo: str, tickets_dir: str, tid: str, head: str) -> tuple[list[str], list[str], list[str], dict[str, list[str]]]:
    """このチケットで depends_on がそろう kind: QA のチケット → (番号, 試験のファイル, tests が無い番号, まだそろわない QA の番号 → そろっていない依存)。
    そろった＝依存の実装のコミットが履歴にある（名前が出ただけは数えない・K-192）。履歴とチケットは 1 回だけ読む"""
    ids, files, empty, waiting = [], [], [], {}
    tickets = _read_tickets(tickets_dir)
    qa = [(t, [str(d) for d in t["depends_on"]]) for t in tickets
          if t.get("kind") == "QA" and isinstance(t.get("depends_on"), list) and tid in t["depends_on"]]
    if not qa:
        return ids, files, empty, waiting
    kids = _children(tickets)
    impl = impl_ids(repo, head, _family({d for _, deps in qa for d in deps if d != tid}, kids))
    for t, deps in qa:
        late = [d for d in deps if d != tid and not _dep_done(d, impl, kids)]
        if late:   # 黙って外さない：外した QA と、そろっていない依存を出力に出す
            waiting[str(t["id"])] = late
            continue
        tests = t.get("tests") or []
        got = sorted({os.path.relpath(x, repo).replace(os.sep, "/")
                      for g in (tests if isinstance(tests, list) else [tests])
                      for x in globmod.glob(os.path.join(repo, g), recursive=True) if os.path.isfile(x)})
        ids.append(t["id"])
        if got:
            files += got
        else:
            empty.append(t["id"])
    return ids, sorted(set(files)), empty, waiting


def _ticket_tests(repo: str, tickets_dir: str, tid: str) -> tuple[list[str], list[str]]:
    """チケットの .md の tests:（glob は開く）→ (ファイル, 何にも当たらない glob)。チケットの CI はこれを必ず流す（K-170）"""
    path = os.path.join(tickets_dir, f"{tid}.md")
    if not os.path.isfile(path):
        return [], []
    tests = parse_ticket(path).get("tests") or []
    files, miss = set(), []
    for g in (tests if isinstance(tests, list) else [tests]):
        got = [os.path.relpath(x, repo).replace(os.sep, "/") for x in globmod.glob(os.path.join(repo, g), recursive=True) if os.path.isfile(x)]
        files.update(got)
        if not got:
            miss.append(g)
    return sorted(files), miss


def _num(tid: str) -> int:
    return int(tid.split("-")[1])


def _ticket_check(tickets_dir: str, tid: str, rules: dict, changed: set[str], wide: set[str]) -> tuple[list[str], list[tuple[str, str]]]:
    mism, full = [], []
    path = os.path.join(tickets_dir, f"{tid}.md")
    if not os.path.isfile(path):
        return [f"{tid}：チケットのファイルが無い（{os.path.relpath(path)}）"], [("mismatch", tid)]
    t = parse_ticket(path)
    if "affects" not in t:
        if _num(tid) >= rules["affects_required_from"]:
            return [f"{tid}：影響の範囲（affects）が書いていない（K-{rules['affects_required_from']} から要る）"], [("mismatch", tid)]
        return [], [("no-declaration", tid)]
    aff = t.get("affects")
    aff = set(aff if isinstance(aff, list) else [aff] if aff else [])
    for n in sorted(changed - aff):
        mism.append(f"{n}：変えたのにチケットに無い（{tid} の affects）")
    for n in sorted(aff - changed):
        mism.append(f"{n}：チケットにあるが変わっていない（{tid} の affects）")
    cw = t.get("ci_wide") or []
    cw = set(cw if isinstance(cw, list) else [cw])
    for c in sorted(wide - cw):
        mism.append(f"{c}：範囲を広げる理由があるのにチケットの ci_wide に無い（{tid}）")
    for c in sorted(cw - wide):
        mism.append(f"{c}：チケットの ci_wide にあるが触っていない（{tid}）")
    if mism:
        full.append(("mismatch", tid))
    return mism, full


def _shards(n: int, per: int) -> int:
    return 0 if n == 0 else max(1, min(MAX_SHARDS, math.ceil(n / per)))


# K-170（2026-11-11・決める人「チケットの時はチケットだけ。フォールバックもチケットごと」）：scope=auto は全部に倒さない。
#   範囲を決められない理由は止める（組は流さない）。ほかの理由（CI の設定・部品の版・地図に無い・共通の部品・宣言なし）はチケットの範囲で続ける
STOP_KINDS = {"requested", "base", "empty", "badpath", "ticket", "ticket-tests", "integration", "tool", "mismatch"}


def _stop_plan(p: dict) -> dict:
    return {**p, "mode": "scoped", "jobs": {"unit": False, "database": False, "web": False}, "unit_shards": 0,
            "unit_files": [], "migration_files": [], "coverage_args": ["--coverage.enabled=false"]}


def _full_plan(p: dict) -> dict:
    return {**p, "mode": "full", "jobs": {"unit": True, "database": True, "web": True}, "db_range": True, "unit_shards": MAX_SHARDS,
            "unit_files": [], "coverage_args": []}


def gates_for(changes: list[str], rules: dict, full: bool) -> list[str]:
    """重い検査（決まり gates：番号 → 関係するファイルの glob）のうち、流すもの（K-172）。全部の回は全部"""
    g = rules.get("gates") or {}
    if full:
        return sorted(g, key=int)
    return sorted((k for k, globs in g.items() if any(match(x, globs) for x in changes)), key=int)


def gate_cfg(repo: str, cfg: dict) -> dict:
    """入れた組（04_design/fidelity.json の enrolled: true）が 1 つでもあれば、設定に always_when_enrolled が真の専用の段に always を付けた設定を返す（K-238）。
    画面のコードを後で変えても、web の組が起きる回には突き合わせを流して見た目のずれを止める。入れた組が 0 なら元のまま。
    印の無い段（Bridge の通しの段 73 など）は毎回にしない：チケットの CI では on に当たる変更のときだけ選ぶ（K-379）"""
    path = os.path.join(repo, "04_design", "fidelity.json")
    try:
        groups = json.load(open(path, encoding="utf-8")).get("groups") or [] if os.path.isfile(path) else []
    except (json.JSONDecodeError, AttributeError):
        groups = []   # 形の誤りは G69 の設定の検査が赤にする
    if not any(isinstance(g, dict) and g.get("enrolled") is True for g in groups):
        return cfg
    gates = {k: ({**v, "always": True} if v.get("always_when_enrolled") is True else v) for k, v in (cfg.get("gates") or {}).items()}
    if any(isinstance(v.get("parts"), dict) for v in gates.values()):
        # 部品の対応（K-1105）：組 → 頁が import で辿るファイル・どこかの頁や入口から辿れる物・頁が読むワークスペースの部品の src
        graph = fidelity_parts.Graph(repo)
        files = fidelity_parts.group_files(repo, groups, graph)
        extra = {"group_files": files, "reach": fidelity_parts.reachable(repo, graph), "unsure_auto": fidelity_parts.workspace_src(repo)}
        gates = {k: ({**v, **extra} if isinstance(v.get("parts"), dict) else v) for k, v in gates.items()}
    return {**cfg, "gates": gates}


def _web_pick(repo: str, tickets_dir: str, rules: dict, p: dict, tid: str | list[str]) -> dict:
    """web の組で流す画面の試験（チケットの範囲・K-177）"""
    tk = {}
    for f in sorted(globmod.glob(os.path.join(tickets_dir, "K-*.md"))):
        try:
            t = parse_ticket(f)
        except (SystemExit, OSError, ValueError):
            continue
        lst = lambda v: v if isinstance(v, list) else ([v] if v else [])  # noqa: E731
        tk[t.get("id")] = {"tests": lst(t.get("tests")), "changes": lst(t.get("changes")), "depends_on": lst(t.get("depends_on"))}
    deploy_only = (rules.get("spec") or {}).get("package_paths", [])   # 組み立てに入らない物は画面の試験を選ぶ元にしない（K-212）
    changed = [x for x in [c.path for c in p["changes"]] + [c.old for c in p["changes"] if c.old] if not match(x, deploy_only)]
    return web_select.select(changed, tid, tk, web_select.domain_g48(repo), web_select.domain_g59(repo),
                             web_select.importers(repo), gate_cfg(repo, rules.get("web_select") or {}))


def with_web_selection(p: dict, sel: dict, defer: bool = False) -> dict:
    """選んだ画面の試験を出力に。チケットの範囲の回で 1 本も当たらなければ web の組を流さない（理由つき）。全部の回は今と同じ。
    defer（画面の行を後回しにする回・K-1105）：G48・G59・持ち主を空にし、web_gates は on_defer の段だけ残す。当たれば web_on_defer"""
    if p["mode"] == "full":
        return {**p, "web_g48": [], "web_g59": [], "web_gates": {}, "web_tasks": [], "web_gate_groups": {}, "web_on_defer": False}
    gates = sel.get("gates") or {}
    hit = bool(sel["g48"] or sel["g59"] or any(gates.values()))   # 専用の段の画面の試験も選ぶ先（K-238）
    errs = list(p.get("errors") or [])
    if p["jobs"]["web"] and not hit:   # web の組を流すはずの変更なのに選べない：黙って飛ばさず止める（D-133.7・K-177 レビュー）
        errs.append("web の組を流すはずの変更なのに、流す画面の試験を決められない。チケットの tests: に画面の試験を書くか、"
                    "画面の試験を持つチケットを depends_on に書く（" + "・".join(sel["reasons"]) + "）")
    web = p["jobs"]["web"] and hit
    g48, g59, tasks = sel["g48"], sel["g59"], sel["tasks"]
    on_defer = [g for g in (sel.get("on_defer") or []) if gates.get(g)]
    if defer:   # 止める文は空にする前の一覧で数えた（上）。流すのは on_defer の段だけ
        g48, g59, tasks = [], [], []
        gates = {k: (v if k in on_defer else []) for k, v in gates.items()}
    return {**p, "jobs": {**p["jobs"], "web": web}, "web_g48": g48, "web_g59": g59,
            "web_gates": gates, "web_tasks": tasks, "web_gate_groups": dict(sel.get("gate_groups") or {}),
            "web_on_defer": bool(defer and web and on_defer),
            "errors": errs, "reasons": p.get("reasons", []) + list(sel["reasons"]), "web_reasons": list(sel["reasons"])}


def plan(repo: str, base: str, head: str, scope: str, rules: dict, tickets_dir: str,
         list_tests: Callable[[list[str]], dict], db_tests: Callable[[], list], ticket: str = "", web_input: str = "") -> dict:
    if scope == "ticket":
        scope = "auto"   # K-172：ticket-flow の入口の名前。絞り方は auto と同じ
    p: dict = {"mode": "scoped", "full_reasons": [], "wide_reasons": [], "reasons": [], "spec_only": [], "date_only": [], "web_ticket_rows": [], "base": base if isinstance(base, str) else "",
               "changes": [], "changed_packages": [], "affected": [], "tickets": [], "integration": [], "integration_waiting": {}, "mismatches": [], "errors": [],
               "jobs": {"unit": False, "database": False, "web": False}, "unit_shards": 0, "unit_files": [],
               "migration_files": [], "coverage_args": [], "db_range": False, "gates": [], "py_tests": []}
    full: list[tuple[str, str]] = p["full_reasons"]

    def done() -> dict:
        p["spec_only"] = sorted(set(p["spec_only"]))
        p["reasons"] = ([f"{'全部' if scope == 'full' else ('止める理由' if c in STOP_KINDS else '範囲を広げる理由（全部にはしない）')}：{c}（{d}）" for c, d in full] + [f"範囲を広げる：{c}（{d}）" for c, d in p["wide_reasons"]]
                        + [f"static と spec だけ：{x}" for x in p["spec_only"]]
                        + [f"日付だけ：{x}" for x in p["date_only"]]
                        + ([f"画面の組：画面を持つチケットの行 {'・'.join(p['web_ticket_rows'])}"] if p["web_ticket_rows"] else [])
                        + list(p.get("web_reasons") or []))
        p["gates"] = gates_for([c.path for c in p["changes"]] + [c.old for c in p["changes"] if c.old], rules, full=scope == "full")
        if scope == "full":
            return _full_plan(p)
        stops = [(c, d) for c, d in full if c in STOP_KINDS]
        for c, d in stops:
            p["errors"].append(f"範囲を決められない（{c}：{d}）。全部には倒さず止める")
        return _stop_plan(p) if stops else p

    if scope not in ("auto", "full") or scope == "full":
        full.append(("requested", scope if scope in ("auto", "full") else "決まった形でない scope"))
        _full_scope_migrations(p, repo, base, head, rules)
        return done()
    try:
        changes = changed_files(repo, base, head)
    except BaseError as e:
        p["base"] = ""
        full.append(("base", str(e)))
        return done()
    p["changes"] = changes
    p["date_only"] = date_only(repo, base, head, changes)
    changes = [c for c in changes if c.path not in p["date_only"]]   # 日付だけの生成物は範囲に数えない
    if not p["changes"]:
        full.append(("empty", "変えたファイルが無い"))
        return done()

    ws = workspace(repo)
    shared = shared_packages(ws, rules["shared_min_dependents"])
    db = rules["db"]
    wide: list[tuple[str, str]] = p["wide_reasons"]
    added_mig, renamed_mig, mig_files = _migrations(changes, db)
    changed_pk: set[str] = set()
    code_pk: set[str] = set()
    vitest_in: set[str] = set()          # list_tests に渡すファイル
    whole_pk: set[str] = set()           # 中の試験を全部足すパッケージ（使い手まで）
    direct: set[str] = set()             # そのまま流す試験
    readers: set[str] = set()
    web_direct: set[str] = set()         # data_links の画面の試験（単体の組でなく画面の組で流す・K-248）
    src_live: set[str] = set()           # 変えて残った src（coverage と「試験の無いコード」）
    db_range = False
    any_path = []
    for c in changes:
        paths = [c.path] + ([c.old] if c.old else [])
        any_path += paths
        if any("\n" in x or "\r" in x for x in paths):
            full.append(("badpath", "改行を含むパス"))
        for x in paths:
            gone = x != c.path or c.status.startswith("D")
            pk = owner(x, ws)
            cats = [cat for cat in ("ci", "lockfile") if match(x, rules["full"].get(cat, []))]
            if cats:
                full += [(cat, x) for cat in cats]
                if pk:
                    changed_pk.add(pk)
                    if not gone:
                        whole_pk.add(pk)   # パッケージの中の設定（package.json・tsconfig など）：そのパッケージと使い手まで（D-133.7 ④）
                continue
            for l in rules["data_links"]:
                if match(x, l["paths"]):
                    lt = l.get("tests", [])
                    direct.update(t for t in lt if not t.startswith(WEB_E2E_PREFIX))
                    web_direct.update(t for t in lt if t.startswith(WEB_E2E_PREFIX))
                    readers.update(l.get("readers", []))
            if match(x, (rules.get("spec") or {}).get("package_paths", [])):
                p["spec_only"].append(x)   # パッケージの中でも組み立てに入らない物：パッケージの試験を広げない（K-212）
                continue
            if match(x, db["paths"]):
                db_range = True
                wide.append(("db", x))
                if pk:
                    changed_pk.add(pk)
                continue
            if x == db["migration_list"]["file"] and not gone and c.status == "M" and _migration_list_only(repo, base, head, rules, added_mig, renamed_mig):
                db_range = True
                wide.append(("db", x))
                if pk:
                    changed_pk.add(pk)
                continue
            if pk:
                changed_pk.add(pk)
                code_pk.add(pk)
                if pk in shared:
                    full.append(("shared", x))
                    wide.append(("shared", x))
                vitest_in.add(x)
                if gone or not x.endswith(IMPORT_EXT):
                    whole_pk.add(pk)
                if not gone and match(x, TEST_GLOBS):
                    direct.add(x)
                if not gone and match(x, rules["coverage_src"]["include"]) and not match(x, rules["coverage_src"].get("exclude", [])):
                    src_live.add(x)
                continue
            kind = root_kind(x, rules, repo)
            if kind == "unmapped":
                full.append(("unmapped", x))
            elif kind == "spec":
                p["spec_only"].append(x)
    for cat, x in full:
        if cat in ("ci", "lockfile") and (cat, x) not in wide:
            wide.append((cat, x))
    p["changed_packages"] = sorted(changed_pk)
    aff = affected(code_pk, ws)
    p["affected"] = sorted(aff)
    p["db_range"] = db_range   # G27 の DB の層は DB の範囲を触った回だけ（全部の回は _full_plan が真にする・D-133.6）
    if db_range:
        p["migration_files"] = mig_files

    # チケット
    ids, headless = subject_ids(repo, base, head)
    p["tickets"] = ids
    if headless:
        full.append(("ticket", f"件名の頭に番号の無いコミット {'・'.join(headless)}（取り込みでないコミットは件名の頭にチケットの番号を書く）"))
    if len(ids) != 1:
        full.append(("ticket", f"コミットのチケットの番号が {len(ids)} 個（{', '.join(ids) or 'なし'}）"))
    elif ticket and ids != [ticket]:
        full.append(("ticket", f"入力のチケット {ticket} とコミットのチケットの番号 {ids[0]} が違う"))
    else:
        mism, fr = _ticket_check(tickets_dir, ids[0], rules, changed_pk, {c for c, _ in wide})
        p["mismatches"] = mism
        full += fr
        integ, itests, empty, p["integration_waiting"] = _integration(repo, tickets_dir, ids[0], head)
        p["integration"] = integ
        for e in empty:
            full.append(("integration", f"{e} の tests が無い（何にも当たらない）"))
        direct.update(itests)

    if any(c in STOP_KINDS for c, _ in full):
        return done()
    if len(ids) == 1:
        tt, miss = _ticket_tests(repo, tickets_dir, ids[0])
        for g in miss:
            full.append(("ticket-tests", f"{ids[0]} の tests: の {g} が何にも当たらない"))
        if miss:
            return done()
        direct.update(t for t in tt if match(t, TEST_GLOBS))   # .py などは spec の組が流す
        p["py_tests"] = sorted(t for t in tt if t.endswith(".py"))   # spec の組が junit_unittest.py で流す（K-172）
        p["ticket_web_tests"] = [t for t in tt if t.startswith(WEB_E2E_PREFIX)]   # 画面の試験は web の組が流す（K170-CS-014）

    # 試験を決める
    try:
        vin = sorted(vitest_in | readers)
        rel = check_answer(list_tests(vin), vin) if vin else {}
        dbt = list(db_tests()) if db_range else []
    except ToolError as e:
        full.append(("tool", str(e)))
        return done()
    files = set(direct) | {t for v in rel.values() for t in v} | set(dbt)
    for pk in affected(whole_pk, ws):
        files.update(test_files(repo, ws[pk]["dir"]))
    p["unit_files"] = sorted(files)
    p["unit_shards"] = _shards(len(files), rules["files_per_shard"])

    # 試験の無いコード（どの受け方でもよい）
    data_tested = [l["paths"] for l in rules["data_links"] if l.get("tests")]
    for s in sorted(src_live):
        if rel.get(s):
            continue
        if any(match(s, ps) for ps in data_tested) or itests:
            continue
        if db_range and dbt and match(s, db["gateway"]):
            continue
        p["errors"].append(f"試験の無いコード：{s}（import・data_links・中間と統合・DB を使う試験のどれにも受ける試験が無い）")
    p["coverage_args"] = [f"--coverage.include={s}" for s in sorted(src_live)] or ["--coverage.enabled=false"]

    jd, jw = rules["jobs"].get("database", {}), rules["jobs"].get("web", {})
    jaff = aff | affected(whole_pk, ws)   # 組も、パッケージの中の設定・消したファイルの使い手まで（K-170 Q #4）
    tr = jw.get("ticket_rows")
    if tr and tr["file"] in any_path:
        p["web_ticket_rows"] = web_ticket_rows(repo, base, head, tr)
    web_dom = set(web_select.domain_g48(repo)) | set(web_select.domain_g59(repo)) if web_direct else set()
    web_direct &= web_dom   # 画面の試験の一覧（G48・G59）に無い物は流せない：組を起こさず止めもしない（K-248）
    p["jobs"] = {"unit": bool(files),
                 "database": db_range or bool(jaff & set(jd.get("packages", []))) or any(match(x, jd.get("paths", [])) for x in any_path),
                 "web": bool(jaff & set(jw.get("packages", []))) or any(match(x, jw.get("paths", [])) for x in any_path)
                 or bool(p["web_ticket_rows"])
                 or any(f.startswith(WEB_E2E_PREFIX) for f in itests)
                 or bool(p.get("ticket_web_tests"))
                 or bool(web_direct)}
    if not p["jobs"]["unit"]:
        p["unit_shards"] = 0
    if p["jobs"]["web"] and (web_select.domain_g48(repo) or web_select.domain_g59(repo)):   # 画面の試験があるリポジトリだけ
        sel = _web_pick(repo, tickets_dir, rules, p, list(ids))
        g48 = set(web_select.domain_g48(repo))
        sel = {**sel, "g48": sorted(set(sel["g48"]) | (web_direct & g48)), "g59": sorted(set(sel["g59"]) | (web_direct - g48))}
        p = with_web_selection(p, sel, defer=web_input == "defer")
    # 専用の段の設定の誤り（試験が無い・段の命令が無い・G48／G59 と重なる）は止める。画面の試験があるリポジトリだけ（K-238）
    if web_select.domain_g48(repo) or web_select.domain_g59(repo):
        p["errors"] = list(p.get("errors") or []) + web_select.check_gates(repo, rules.get("web_select") or {})
    return done()


# ---------------------------------------------------------------- 組の中で流す命令（引数の並び）
THRESH0 = [f"--coverage.thresholds.{k}=0" for k in ("lines", "branches", "functions", "statements")]
REPORTS = ".vitest-reports"


def unit_argv(files: list[str], shard: int, shards: int, coverage: list[str]) -> list[str]:
    return ["pnpm", "exec", "vitest", "run", *files, "--passWithNoTests", "--coverage", f"--shard={shard}/{shards}",
            "--reporter=default", "--reporter=blob", f"--outputFile.blob={REPORTS}/blob-{shard}-{shards}.json",
            "--coverage.reporter=text-summary", "--reporter=junit", f"--outputFile.junit=junit/unit-{shard}.xml", *THRESH0, *coverage]


def rebase_blob_roots(reports: pathlib.Path | str, cwd: str) -> list[str]:
    """各 blob の根を、まとめる組の根に置き換える（K-172）。

    同じ台に runner がいくつもあると、単体の試験の組とまとめる組の置き場の根が違う
    （…/engine-base-Kaname/_work/… と …-Kaname-2/_work/…）。vitest の blob は試験ファイルと coverage の絶対パスを持つので、
    そのままでは --merge-reports が「No test files found」で落ちる。各組が試験の前に書いた root-<組>.txt の根を、今の根に置き換える。
    根の書き置きが無い blob は置き換えられないので誤りとして返す（vitest を呼ばずに赤）。
    誤りが無ければ書き置きを置き場から消す（vitest は置き場の全部のファイルを blob として読み、書き置きで落ちる）。"""
    rep = pathlib.Path(reports)
    errs: list[str] = []
    plan: list[tuple[pathlib.Path, str]] = []
    for blob in sorted(rep.glob("blob-*-*.json")):   # 先に全部を確かめる（誤りが 1 つでもあれば何も変えない）
        shard = blob.stem.split("-")[1]
        rf = rep / f"root-{shard}.txt"
        if not rf.exists():
            errs.append(f"{blob.name}：根の書き置き {rf.name} が無い（置き場が違う runner の結果をまとめられない）")
            continue
        plan.append((blob, rf.read_text(encoding="utf-8").strip()))
    if errs:
        return errs
    for blob, root in plan:
        if root and root != cwd:
            blob.write_text(blob.read_text(encoding="utf-8").replace(root, cwd), encoding="utf-8")
    for rf in rep.glob("root-*.txt"):   # blob の無い書き置きも含めて消す（vitest は置き場の全部のファイルを結果として読む）
        rf.unlink()
    return errs


def merge_argv(coverage: list[str]) -> list[str]:
    return ["pnpm", "exec", "vitest", "run", f"--merge-reports={REPORTS}", "--coverage", "--reporter=default", "--reporter=json",
            f"--outputFile.json={REPORTS}/merged.json", *coverage]


def squawk_argv(files: list[str]) -> list[str] | None:
    return ["pnpm", "exec", "squawk", *files] if files else None


def squawk_plan(files: list[str], base: str) -> tuple[list[str] | None, str]:
    """migration の lint の命令と、流さないときの文（比べる元が無い回と、変えた migration が無い回を言い分ける・K-156）"""
    argv = squawk_argv(files)
    if argv:
        return argv, f"migration の lint：{len(files)} 本（比べる元 {base[:10] or 'なし'}）"
    if not (isinstance(base, str) and SHA.fullmatch(base)):
        return None, "migration の lint：比べる元が無いので流さない（全部の回・GitHub で手で押した回）"
    return None, f"migration の lint：変えた migration が無い（比べる元 {base[:10]}）"


def count_check(report: dict, expected: list[str] | None, root: str) -> list[str]:
    if expected is None:
        return []
    ran = set()
    for r in report.get("testResults", []) or []:
        n = str(r.get("name", ""))
        ran.add(os.path.relpath(n, root).replace(os.sep, "/") if os.path.isabs(n) else n)
    want = set(expected)
    errs = []
    if not ran:
        errs.append("流れた試験が 0 本（決めた試験は %d 本）" % len(want))
    errs += [f"決めたのに流れなかった試験：{f}" for f in sorted(want - ran)]
    errs += [f"決めていないのに流れた試験：{f}" for f in sorted(ran - want)]
    return errs


# ---------------------------------------------------------------- 入口
def _env_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    try:
        v = json.loads(raw) if raw else []
    except ValueError:
        raise SystemExit(f"★ {name} が JSON でない")
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise SystemExit(f"★ {name} が文字の並びでない")
    return v


def gh_output(path: str, values: dict[str, str]) -> None:
    with open(path, "a", encoding="utf-8") as f:
        for k, v in values.items():
            while True:
                d = "EOF_" + secrets.token_hex(12)
                if d not in v:
                    break
            f.write(f"{k}<<{d}\n{v}\n{d}\n")


def outputs(p: dict) -> dict[str, str]:
    j = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731
    return {"full": "true" if p["mode"] == "full" else "false", "unit": str(p["jobs"]["unit"]).lower(),
            "database": str(p["jobs"]["database"]).lower(), "web": str(p["jobs"]["web"]).lower(),
            "db_range": "true" if p.get("db_range") else "false",
            "unit_shards": str(p["unit_shards"]), "unit_files": j(p["unit_files"]), "migration_files": j(p["migration_files"]),
            "coverage_args": j(p["coverage_args"]), "base": p["base"] if SHA.fullmatch(p.get("base") or "") else "",
            "reasons": j(p["reasons"] + p["mismatches"] + p["errors"]),
            "gates": "," + ",".join(p.get("gates") or []) + ",", "py_tests": j(p.get("py_tests") or []),
            "web_g48": j(p.get("web_g48") or []), "web_g59": j(p.get("web_g59") or []),
            "web_gates": j(p.get("web_gates") or {}), "web_tasks": j(p.get("web_tasks") or []),
            "web_gate_groups": j(p.get("web_gate_groups") or {}), "web_on_defer": "true" if p.get("web_on_defer") else "false"}


def decide_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="ci_scope.py")
    ap.add_argument("--repo", default=None)
    ap.add_argument("--base", default="")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--scope", default="full")
    ap.add_argument("--ticket", default="")
    ap.add_argument("--rules", default=None)
    ap.add_argument("--tickets", default=None)
    ap.add_argument("--github-output", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-vitest", action="store_true")
    # 画面の行を後回しにする回（CI の入力 web・K-1105）。空は入力が無い回（push）
    ap.add_argument("--web", default="", choices=["", "run", "defer"])
    return ap


def _decide(argv: list[str]) -> int:
    a = decide_parser().parse_args(argv)
    repo = os.path.abspath(a.repo or git(os.getcwd(), "rev-parse", "--show-toplevel").stdout.decode().strip())
    rules = load_rules(a.rules or os.path.join(repo, "scripts", "ci", "ci_scope.json"))
    tickets = a.tickets or os.path.join(repo, "11_tickets")
    if a.no_vitest:
        lt = lambda files: {f: [] for f in files}  # noqa: E731
        dbt = lambda: db_tests_by_text(repo, rules)  # noqa: E731
    else:
        lt = vitest_list_tests(repo)

        def dbt() -> list[str]:
            # .json は渡さない（vitest は package.json を forceRerunTriggers として全部の試験を返す）
            gw = [f for f in walk_files(repo, CODE_EXT) if match(f, rules["db"]["gateway"])]
            got = check_answer(lt(gw), gw) if gw else {}
            return sorted({t for v in got.values() for t in v} | set(db_tests_by_text(repo, rules)))
    p = plan(repo, a.base, a.head, a.scope, rules, tickets, lt, dbt, ticket=a.ticket, web_input=a.web)
    red = bool(p["mismatches"] or p["errors"])
    out = _stop_plan(p) if red else p   # K-170：赤でも全部に倒さず、組を流さない
    if a.github_output:
        gh_output(a.github_output, outputs(out))
    show = {**out, "changes": [c._asdict() for c in p["changes"]]}
    if a.json:
        print(json.dumps(show, ensure_ascii=False, indent=1))
    else:
        print(f"チケットの CI の範囲：{'全部' if out['mode'] == 'full' else '絞る'}（scope={a.scope}・base={p['base'][:10] or 'なし'}）")
        for r in p["reasons"]:
            print("  " + r)
        print(f"  組：{', '.join(k for k, v in out['jobs'].items() if v) or 'static・spec だけ'}・unit の組 {out['unit_shards']}・試験 {len(out['unit_files']) or ('全部' if out['mode'] == 'full' else 0)} 本"
              + (f"・migration の lint {len(out['migration_files'])} 本" if out["migration_files"] else ""))
        for q, late in sorted(p["integration_waiting"].items()):
            print(f"  この回に足さない中間・統合の試験：{q}（依存の実装がまだ履歴に無い：{', '.join(late)}）")
        for m in p["mismatches"]:
            print("  ★ 食い違い：" + m)
        for e in p["errors"]:
            print("  ★ " + e)
    return 1 if red else 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv[0] if argv else ""
    if cmd == "run-unit":
        ap = argparse.ArgumentParser(prog="ci_scope.py run-unit")
        ap.add_argument("--shard", type=int, required=True)
        a = ap.parse_args(argv[1:])
        shards_raw = os.environ.get("CI_UNIT_SHARDS", "")
        if not shards_raw.isdigit() or not 1 <= a.shard <= int(shards_raw):
            raise SystemExit(f"★ CI_UNIT_SHARDS（{shards_raw!r}）と --shard {a.shard} が合わない")
        argv2 = unit_argv(_env_list("CI_UNIT_FILES"), a.shard, int(shards_raw), _env_list("CI_COVERAGE_ARGS"))
        rep = pathlib.Path(REPORTS)
        rep.mkdir(parents=True, exist_ok=True)
        (rep / f"root-{a.shard}.txt").write_text(os.getcwd() + "\n", encoding="utf-8")   # まとめる組が根を置き換える（K-172）
        return subprocess.run(argv2).returncode
    if cmd == "run-merge":
        errs = rebase_blob_roots(REPORTS, os.getcwd())
        if errs:
            for e in errs:
                print("★ " + e)
            return 1
        return subprocess.run(merge_argv(_env_list("CI_COVERAGE_ARGS"))).returncode
    if cmd == "run-squawk":
        sq, msg = squawk_plan(_env_list("CI_MIGRATION_FILES"), os.environ.get("CI_BASE", ""))
        print(msg)
        if sq is None:
            return 0
        return subprocess.run(sq).returncode
    if cmd == "check-count":
        ap = argparse.ArgumentParser(prog="ci_scope.py check-count")
        ap.add_argument("--report", required=True)
        a = ap.parse_args(argv[1:])
        if os.environ.get("CI_FULL") == "true":
            print("流れた数の突き合わせ：全部の回なので見ない")
            return 0
        expected = _env_list("CI_UNIT_FILES")
        try:
            rep = json.load(open(a.report, encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"★ vitest の報告が読めない: {e}")
            return 1
        errs = count_check(rep, expected, os.getcwd())
        for e in errs:
            print("★ " + e)
        if not errs:
            print(f"流れた数の突き合わせ：決めた {len(expected)} 本が全部流れた")
        return 1 if errs else 0
    return _decide(argv)


if __name__ == "__main__":
    sys.exit(main())
