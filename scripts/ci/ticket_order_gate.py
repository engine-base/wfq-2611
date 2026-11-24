#!/usr/bin/env python3
"""取り込む順（K-94・D-128.147・ai-driven-process.md 原則 11）：枝の先頭に、チケットの depends_on の葉の実装が入っている。

  python3 scripts/ci/ticket_order_gate.py             START..HEAD を、枝の先頭の depends_on で見る
  python3 scripts/ci/ticket_order_gate.py --selftest  依存が枝に無い・枝の外にだけある写しが赤、後で依存を取り込んだ写しが緑になるか

裁くのは枝の先頭だけ（K-1154・代表の決め answer=ee72b1756f5d・2026-11-24「入れるときだけ見る」）：
  START..rev の実装のコミットか取り込みのコミットの件名に持ち主として出るチケットごとに、rev（枝の先頭）の版の
  11_tickets/tickets.json の depends_on の 1 つずつが、START..rev のどれかの実装のコミットか取り込みのコミットの件名（満たす側は件名の全部の番号）に
  在れば緑。コミットの順（依存より前か後か）は見ない。依存より先に実装を始めた葉が、後で依存の枝を取り込めば緑になる（K-711 の ecc6788c6d の形）。
  依存の実装が枝に無いまま入れようとしたら赤（入れる順は守る）。各コミットの版の tickets.json は読まない
  （前の「コミットごとに、そのコミットの版の depends_on で祖先を見る」形・K-159 と、「外して戻した依存」の覚えは K-1154 で消した）。
持ち主（依存を裁かれる側）は owners_of だけ：頭に番号が並んでいれば頭の番号、並んでいなければ件名の全部の番号（K-309）。
取り込みのコミット（親 2 つ以上）は実装に数えないが、件名の持ち主は裁き、件名の番号は満たす側に数える（K-643）。
チケットの stage は決め手にしない。枝の外（hold/…）の実装は START..rev に無いので数えない。
ただし決まりを始めた START より前に作られたチケット（START..HEAD のどのコミットにも番号が出てこず、stage が
確認中・完了のもの）は、番号の付いたコミットが無いので「決まりの前に入った」として通し、そのことを出す。
人の準備（担当が人・完了）と、子が全部済んだ親（--base-ref を渡せば分かれ目と枝の中の版で子だった物も数える・K-210）も満たす。
文書だけのコミット（変えたファイルが全部、文書と生成物の置き場に入る）は見ない。進め方の設定（ai-team.yaml）も、この検査の中だけ
実装に数えない（PM の判断 2026-11-10・K-159）。共有の is_doc_only（ci_scope.py も使う）には入れない。
rev の一覧・stage・生成物の一覧（scripts/ci/generated.json）は作業場所でなく rev の版から読む。rev の一覧が読めなければ止める。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile

START = "2fc247a62ee2c34dd400118e301514c00b922777"  # ticket_commit_gate.py と同じ起点（No Ticket, No Commit を始めた時点）
TICKET = re.compile(r"\bK-\d+\b")
# 実装の持ち主：件名の頭に番号を並べた件名（「K-1 K-2 feat: …」）は、頭の番号だけ。件名の中に出てくるほかのチケットの番号は持ち主にしない
#   （本線の cccf8b2c「K-304 fix: …K-309 まで閉じる」が K-309 の実装と数えられ、K-309 の G56 が赤になった・K-309・PM の決め 2026-11-18）。
#   頭に番号が並んでいない件名（「fix: K-5 …」「K-1〜K-3 docs:」「K-1: fix」など）は、前のまま件名の全部の番号を持ち主にする（裁かないコミットを作らない）。
#   持ち主は「依存を裁かれる側」だけに使う。「依存を満たす側」は前のまま件名の全部の番号で数える（狭めると、前に入った取り込みが過去にさかのぼって赤になる）
SUBJECT_HEAD = re.compile(r"^(?:K-\d+[\s,・]+)+")


def owners_of(subj: str) -> set[str]:
    """実装の持ち主の番号。頭に番号が並んでいれば頭の番号だけ、並んでいなければ件名の全部の番号"""
    m = SUBJECT_HEAD.match(subj + " ")
    return set(TICKET.findall(m.group(0) if m else subj))
DOC_PREFIXES = ("01_hearing/", "11_tickets/", "07_qa/test-plan/", "README.md")
DOC_PATTERNS = (re.compile(r"^07_qa/test-specs/.+\.md$"), re.compile(r"^03_architecture/catalog\.[a-z]+$"),
                re.compile(r"^08_api/[^/]+\.md$"))
DONE_STAGES = {"確認中", "完了"}
# 人がする準備のチケット（担当が役でなく人・アカウントや外のサービスの準備で、実装のコミットを持たない・正本 §6.1）は、
#   stage が完了なら依存として満たす（K-133 が K-78〔staging の Supabase を作る・高本さん〕に依存して赤になった・2026-11-10）。
#   担当が役（実装・作る など）のチケットは、今までどおり実装のコミットを求める
ROLE_ASSIGNEES = {"実装", "作る", "精査", "テスター", "PM", "TS", "CS", "R", "Q"}
TICKETS_JSON = "11_tickets/tickets.json"
GENERATED_JSON = "scripts/ci/generated.json"
PROCESS_CONFIG = ("ai-team.yaml",)   # この検査の中だけ実装に数えない（K-159）。is_doc_only には入れない


def git(*args: str, cwd: str | None = None) -> str:
    r = subprocess.run(["git", "-c", "core.quotePath=false", *args], capture_output=True, text=True, cwd=cwd)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()[:200]}")
    return r.stdout


def generated_outputs(root: str) -> set[str]:
    """作業場所の生成物の一覧（ci_scope.py が使う）。この検査は版から読む（_generated_of）"""
    p = os.path.join(root, "scripts", "ci", "generated.json")
    try:
        d = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {o for g in d.get("generators", []) for o in g.get("outputs", [])}


SCRIPT_EXT = (".py", ".mjs", ".js", ".sh")


def generator_scripts(root: str) -> set[str]:
    """generated.json の作り手の台本（run を && で分け、cd <dir> を追い、台本の拡張子で終わる語のうち在るファイル・根からの相対）。K-156"""
    p = os.path.join(root, "scripts", "ci", "generated.json")
    try:
        d = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    out: set[str] = set()
    for g in d.get("generators", []):
        cwd = ""
        for part in str(g.get("run", "")).split("&&"):
            words = part.split()
            if len(words) >= 2 and words[0] == "cd":
                cwd = os.path.normpath(os.path.join(cwd, words[1]))
                continue
            for w in words:
                if w.endswith(SCRIPT_EXT):
                    rel = os.path.normpath(os.path.join(cwd, w)).replace(os.sep, "/")
                    if os.path.isfile(os.path.join(root, rel)):
                        out.add(rel)
    return out


def _generated_of(raw: bytes | None) -> set[str]:
    try:
        d = json.loads(raw.decode("utf-8")) if raw is not None else {}
    except (ValueError, UnicodeDecodeError):
        return set()
    return {o for g in (d.get("generators", []) if isinstance(d, dict) else []) for o in g.get("outputs", [])}


# 作り手（scripts/tickets/build_index.py・字下げ 1）の形の tickets.json：頭と終わりが決まった文字で、チケットの間は「},\n  {」
_LIST_HEAD = b'{\n "tickets": [\n'
_LIST_TAIL = b"\n ]\n}"
_LIST_SEP = b"},\n  {"
_BAD = object()   # 読めないかけらの印


def _ticket_list_fast(raw: bytes, chunks: dict[bytes, object]) -> list | None:
    """作り手の形なら、チケット 1 つずつの文字を読み解いて覚え（chunks）、版が変わっても同じ文字は読み直さない（K-341）。
    元の文字＝頭 + 「,\n  」でつないだ各かけら + 終わり（どれも ASCII）なので、どのかけらも UTF-8 として読めて 1 つの JSON の値として
    読めれば、全体を decode("utf-8") して json.loads した "tickets" と同じ並びになる（切り方を誤ったかけらは読めない）。
    形が違う・読めないかけらがあれば None（全体を読む前の道に戻る）"""
    body = raw.rstrip(b" \t\n\r")
    if not (body.startswith(_LIST_HEAD) and body.endswith(_LIST_TAIL)):
        return None
    parts = body[len(_LIST_HEAD):len(body) - len(_LIST_TAIL)].split(_LIST_SEP)
    out = []
    last = len(parts) - 1
    for i, part in enumerate(parts):
        key = (b"{" if i else b"") + part + (b"}" if i < last else b"")
        v = chunks.get(key, _BAD)
        if v is _BAD and key not in chunks:
            try:
                v = json.loads(key.decode("utf-8"))
            except ValueError:   # UnicodeDecodeError も含む
                v = _BAD
            chunks[key] = v
        if v is _BAD:
            return None
        out.append(v)
    return out


def _tickets_of(raw: bytes | None, chunks: dict[bytes, object] | None = None) -> dict[str, dict] | None:
    """tickets.json の中身 → {番号: チケット}。無い・JSON でない・"tickets" が無いなら None。
    chunks（かけらの覚え）を渡すと、作り手の形の版はかけらごとに読む（答えは同じ・K-341）"""
    if raw is None:
        return None
    ts = _ticket_list_fast(raw, chunks) if chunks is not None else None
    if ts is not None:
        return {t["id"]: t for t in ts if isinstance(t, dict) and "id" in t}
    try:
        d = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    ts = d.get("tickets") if isinstance(d, dict) else None
    if not isinstance(ts, list):
        return None
    return {t["id"]: t for t in ts if isinstance(t, dict) and "id" in t}


def read_versions(root: str, specs: list[str], dedupe: bool = False) -> dict[str, bytes | None]:
    """["<rev>:<path>", …] → 中身（無ければ None）。git cat-file --batch を 1 回だけ流す。
    dedupe=True は先に git cat-file --batch-check で中身の印を聞き、同じ中身は 1 回だけ読む（同じ bytes を返す・git は 2 回・K-341）"""
    if not specs:
        return {}
    if dedupe:
        r = subprocess.run(["git", "cat-file", "--batch-check"], input="".join(s + "\n" for s in specs).encode("utf-8"),
                           capture_output=True, cwd=root)
        if r.returncode != 0:
            raise RuntimeError(f"git cat-file --batch-check: {r.stderr.decode('utf-8', 'replace').strip()[:200]}")
        ids: dict[str, str | None] = {}
        for s, line in zip(specs, r.stdout.decode("utf-8", "replace").split("\n")):
            parts = line.split(" ")
            ids[s] = parts[0] if len(parts) == 3 and parts[2].isdigit() else None
        blobs = read_versions(root, list(dict.fromkeys(i for i in ids.values() if i)))
        return {s: (blobs[i] if i else None) for s, i in ids.items()}
    # 頼む名前は一時ファイルから渡し、答えは 1 回の read で受ける（大きな答えを細かく待つより速い・K-341）
    with tempfile.TemporaryFile() as inp, tempfile.TemporaryFile() as err:
        inp.write("".join(s + "\n" for s in specs).encode("utf-8"))
        inp.seek(0)
        p = subprocess.Popen(["git", "cat-file", "--batch"], stdin=inp, stdout=subprocess.PIPE, stderr=err, cwd=root)
        buf = p.stdout.read()
        p.stdout.close()
        if p.wait() != 0:
            err.seek(0)
            raise RuntimeError(f"git cat-file --batch: {err.read().decode('utf-8', 'replace').strip()[:200]}")
    out: dict[str, bytes | None] = {}
    pos = 0
    for s in specs:
        nl = buf.index(b"\n", pos)
        head = buf[pos:nl].decode("utf-8", "replace")
        pos = nl + 1
        parts = head.split(" ")
        if len(parts) == 3 and parts[2].isdigit():
            size = int(parts[2])
            out[s] = buf[pos:pos + size]
            pos += size + 1
        else:   # "<名前> missing"・"ambiguous" など
            out[s] = None
    return out


def is_doc_only(files: list[str], gen: set[str]) -> bool:
    def doc(f: str) -> bool:
        return f.startswith(DOC_PREFIXES) or any(p.match(f) for p in DOC_PATTERNS) or f in gen
    return bool(files) and all(doc(f) for f in files)


def _not_impl(files: list[str], gen: set[str]) -> bool:
    """この検査で実装に数えないコミット：文書だけ、または文書と進め方の設定（ai-team.yaml）だけ"""
    rest = [f for f in files if f not in PROCESS_CONFIG]
    return bool(files) and (not rest or is_doc_only(rest, gen))


class BaseError(RuntimeError):
    """比べる元が空・読めない（K-210）"""


def _family_versions(root: str, head_sha: str, base: str) -> list[str]:
    """子を数える版：比べる元と枝の先頭の分かれ目（merge-base）と、そこから枝の先頭までのコミット（K-210）"""
    if not base.strip():
        raise BaseError("比べる元（--base-ref）が空。範囲の段の出力 base を渡す")
    try:
        base_sha = git("rev-parse", "--verify", f"{base}^{{commit}}", cwd=root).strip()
        mb = git("merge-base", base_sha, head_sha, cwd=root).strip()
    except RuntimeError as e:
        raise BaseError(f"比べる元 {base[:40]} が読めない（{e}）") from e
    return [mb] + git("rev-list", f"{mb}..{head_sha}", cwd=root).split()


def check(root: str, rev: str = "HEAD", start: str = START, base: str | None = None) -> tuple[list[str], list[str], int]:
    """戻り値：(赤の理由, 決まりの前に入ったとして通した依存, 見た実装のコミットの数)。
    base（比べる元）を渡すと、子を分かれ目の版と枝の中の版から和で数える（外した子を数え続ける・K-210）。渡さなければ枝の先頭の版だけ"""
    head_sha = git("rev-parse", "--verify", f"{rev}^{{commit}}", cwd=root).strip()
    family_at = _family_versions(root, head_sha, base) if base is not None else []
    log = commit_log(root, start, head_sha)
    rows = [(sha, subj) for sha, subj, _, _ in log]
    at_rev = read_versions(root, [f"{head_sha}:{TICKETS_JSON}", f"{head_sha}:{GENERATED_JSON}"])
    tickets = _tickets_of(at_rev[f"{head_sha}:{TICKETS_JSON}"])
    if tickets is None:
        raise RuntimeError(f"{head_sha[:10]}（枝の先頭）の版の {TICKETS_JSON} が無いか読めない（JSON でない・\"tickets\" が無い）。読めなければ止める")
    gen = _generated_of(at_rev[f"{head_sha}:{GENERATED_JSON}"])
    mentioned = {k for _, s in rows for k in TICKET.findall(s)}
    impl: list[tuple[str, set[str]]] = []  # 実装のコミット（古い順）と、依存を裁く番号（持ち主・owners_of）
    credit: dict[str, set[str]] = {}       # 依存を満たす側に数える番号（件名の全部の番号・前と同じ。満たす側を狭めて過去の取り込みを赤にしない）
    merge_owners: set[str] = set()         # 取り込みの件名の持ち主：コミットごとには裁かないが、枝の先頭の検査には入れる（中身を取り込みの中だけに持つチケットが外れないように）
    merges: list[str] = []                 # 取り込みのコミット：実装に数えず裁かないが、依存を満たす側には数える（K-643）
    for sha, subj, files, parents in log:
        # 親が 2 つ以上＝取り込みのコミット（ほかの枝の物を持ち込むだけ・変えたファイルは空）。そのチケットの実装に数えず、依存を裁かない（K-643）。
        # ぶつかりを直した中身は取り込みの後の自分の番号の親 1 つのコミットで出るので、数え漏れにならない。
        # ただし依存を満たす側には前と同じに数える（件名の番号。狭めて、取り込みの件名にだけ番号がある過去の依存を赤にしない）
        if len(parents) >= 2:
            if not _not_impl(files, gen):
                credit[sha] = set(TICKET.findall(subj))
                merges.append(sha)
                merge_owners |= owners_of(subj)
        elif not _not_impl(files, gen):
            impl.append((sha, owners_of(subj)))
            credit[sha] = set(TICKET.findall(subj))
    # 起点が読めることだけ確かめる（浅い写し・違うリポジトリなら止める）。各コミットの版の tickets.json は読まない（K-1154）
    git("rev-parse", "--verify", f"{start}^{{commit}}", cwd=root)

    def legacy_ok(dep: str) -> bool:
        return dep not in mentioned and tickets.get(dep, {}).get("stage") in DONE_STAGES

    def human_prep_ok(dep: str) -> bool:
        t = tickets.get(dep, {})
        who = str(t.get("assignee") or "").strip()
        return t.get("stage") == "完了" and bool(who) and who not in ROLE_ASSIGNEES

    # 子を持つ親（parent でほかのチケットに指される・実装は持たない）は、子が全部済んでいれば依存として満たす
    #   （正本 §2「子を持つ親は実装を持たず、孫が全部取り込まれたら完了」。K-65 が K-37〔staging をそろえる親〕に依存して赤になった・2026-11-15）。
    #   子の済み方は依存と同じ決まり（実装のコミットが祖先にある・決まりの前に入った・人の準備で完了・子が全部済んだ親）で、緩めない
    #   base を渡した回は、分かれ目の版と枝の中の版に一度でも parent として載っていた子を数える（枝で parent を外しても親を満たさない・K-210）。
    #   起点を START にしない：本線で済む前に消した子・付け替えた子で、親が永久に満たせなくなるため
    children: dict[str, set[str]] = {}
    chunks: dict[bytes, object] = {}   # チケット 1 つずつの文字 → 読み解いた値（版をまたいで使い回す・K-341）
    fam_raw = read_versions(root, [f"{c}:{TICKETS_JSON}" for c in family_at], dedupe=True) if family_at else {}
    for ver in [tickets] + [_tickets_of(r, chunks) or {} for r in dict.fromkeys(v for v in fam_raw.values() if v is not None)]:
        for kid, tk in ver.items():
            if tk.get("parent"):
                children.setdefault(str(tk["parent"]), set()).add(kid)

    def satisfied(dep: str, has_impl, guard: frozenset[str] = frozenset()) -> str | None:
        if has_impl(dep):
            return "impl"
        if legacy_ok(dep):
            return "決まりの前に入った"
        if human_prep_ok(dep):
            return "人の準備で完了"
        kids = sorted(children.get(dep, ()))
        if kids and dep not in guard and all(satisfied(k, has_impl, guard | {dep}) for k in kids):
            return "子が全部済んだ親"
        return None

    # 裁くのは枝の先頭だけ（K-1154・代表の決め answer=ee72b1756f5d）：依存の実装が START..rev のどこかに在れば緑。コミットの順は見ない
    bad, legacy = [], []
    in_branch = {x for c in [c for c, _ in impl] + merges for x in credit[c]}   # 満たす側：実装と取り込みのコミットの件名の全部の番号

    def has_impl_head(x: str) -> bool:
        return x in in_branch

    for tid in sorted({k for _, ids in impl for k in ids} | merge_owners):
        for dep in tickets.get(tid, {}).get("depends_on") or []:
            why = satisfied(dep, has_impl_head)
            if why == "impl":
                continue
            if why:
                legacy.append(f"{dep}（{tid} の依存・{why}）")
                continue
            bad.append(f"{head_sha[:10]} 枝の先頭：{tid} は {dep} に依存するが、{dep} の実装がまだ枝に入っていない（枝の先頭の depends_on）")
    return bad, sorted(set(legacy)), len(impl)


def commit_log(root: str, start: str, head_sha: str) -> list[tuple[str, str, list[str], list[str]]]:
    """start..head_sha のコミットを git log --reverse の順に (sha, 件名, 変えたファイル, 親) で返す。git を 1 回だけ呼ぶ（K-341）。
    変えたファイルは 1 本ずつの git diff-tree --no-commit-id --name-only -r --root と同じ：名前の付け替えを見ない（消した名前と足した名前）・
    取り込みのコミットは空・根は全部・名前の書き方（core.quotePath=false の引用）も同じ"""
    out = git("-c", "log.showSignature=false", "log", "--reverse", "--no-renames", "--root", "--diff-merges=off", "--name-only",
              "--format=%x00%H%x09%P%x09%s", f"{start}..{head_sha}", cwd=root)
    rows: list[tuple[str, str, list[str], list[str]]] = []
    for chunk in out.split("\x00")[1:]:
        head, _, body = chunk.partition("\n")
        sha, parents, subj = head.split("\t", 2)
        rows.append((sha, subj, [f for f in body.splitlines() if f], parents.split()))
    return rows


def _ancestor_bits(log: list[tuple[str, str, list[str], list[str]]]) -> tuple[dict[str, int], dict[str, int]]:
    """一覧の番号と、コミットごとの「先祖（自分を含む）の番号のビット」。範囲の外の親は見ない
    （範囲の 2 つのコミットの間の道は範囲の中だけを通る：途中が START の先祖なら、端も START の先祖で範囲に無い）"""
    pos = {sha: i for i, (sha, _, _, _) in enumerate(log)}
    parents = {sha: [p for p in ps if p in pos] for sha, _, _, ps in log}
    bits: dict[str, int] = {}
    for root_sha in pos:
        stack = [root_sha]
        while stack:
            c = stack[-1]
            if c in bits:
                stack.pop()
                continue
            todo = [p for p in parents[c] if p not in bits]
            if todo:
                stack.extend(todo)
                continue
            b = 1 << pos[c]
            for p in parents[c]:
                b |= bits[p]
            bits[c] = b
            stack.pop()
    return pos, bits


def ancestry(log: list[tuple[str, str, list[str], list[str]]]):
    """commit_log の一覧から「a は b の先祖か（同じも真）」を答える関数。git merge-base --is-ancestor a b と同じ答え（一覧の中の組）"""
    pos, bits = _ancestor_bits(log)
    return lambda a, b: a in pos and b in bits and bool(bits[b] >> pos[a] & 1)


def is_ancestor(a: str, b: str, root: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", a, b], cwd=root).returncode == 0


def selftest() -> int:
    """写しのリポジトリを作り、赤になるべき形（依存が枝に無い・枝の外・済んでいない子の親）が赤、緑になるべき形（依存が先・決まりの前・人の準備・後で依存を取り込んだ K-711 の形）が緑になるかを見る。"""
    with tempfile.TemporaryDirectory() as d:
        def run(*a: str) -> None:
            subprocess.run(["git", *a], cwd=d, check=True, capture_output=True,
                           env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
                                "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"})

        def commit(msg: str, path: str, text: str) -> None:
            os.makedirs(os.path.dirname(os.path.join(d, path)) or d, exist_ok=True)
            open(os.path.join(d, path), "w").write(text)
            run("add", "-A")
            run("commit", "-qm", msg)

        def tickets(ts: dict[str, dict]) -> None:
            os.makedirs(os.path.join(d, "11_tickets"), exist_ok=True)
            json.dump({"tickets": [{"id": k, **v} for k, v in ts.items()]}, open(os.path.join(d, "11_tickets", "tickets.json"), "w"))

        run("init", "-q")
        tickets({"K-1": {"depends_on": [], "stage": "未着手"}, "K-2": {"depends_on": ["K-1"], "stage": "未着手"},
                 "K-3": {"depends_on": ["K-2"], "stage": "未着手"}, "K-9": {"depends_on": [], "stage": "完了"},
                 "K-4": {"depends_on": ["K-9"], "stage": "未着手"}})
        commit("K-0 base", "README.md", "x")
        start = git("rev-parse", "HEAD", cwd=d).strip()
        commit("K-3 docs: チケットを切る", "11_tickets/K-3.md", "x")          # 文書だけ：依存が未完了でも見ない
        commit("K-2 feat: 先に作ってしまう", "apps/a.ts", "a")                  # 赤：K-1 がまだ
        bad1, _, _ = check(d, "HEAD", start)
        run("checkout", "-q", "-b", "hold", start)
        commit("K-1 feat: 枝の外で作る", "apps/b.ts", "b")                      # 枝の外
        run("checkout", "-q", "-")
        bad2, _, _ = check(d, "HEAD", start)                                     # 赤のまま（枝の外は祖先でない）
        run("checkout", "-q", "-b", "good", start)
        commit("K-1 feat: 依存を先に", "apps/b.ts", "b")
        commit("K-2 feat: 後から", "apps/a.ts", "a")
        commit("K-4 feat: 決まりの前に入った依存", "apps/c.ts", "c")
        bad3, legacy3, n3 = check(d, "HEAD", start)
        # 人の準備（担当が人・完了・文書のコミットだけ）は通す。担当が役で完了でも実装のコミットが無ければ赤（K-133・2026-11-10）
        run("checkout", "-q", "-b", "prep", start)
        tickets({"K-1": {"depends_on": [], "stage": "未着手"}, "K-8": {"depends_on": [], "stage": "完了", "assignee": "高本さん"},
                 "K-7": {"depends_on": [], "stage": "完了", "assignee": "実装"},
                 "K-5": {"depends_on": ["K-8"], "stage": "未着手"}, "K-6": {"depends_on": ["K-7"], "stage": "未着手"}})
        commit("K-1 K-7 K-8 docs: 一覧", "11_tickets/K-8.md", "x")
        commit("K-5 feat: 人の準備に依存", "apps/d.ts", "d")
        commit("K-6 feat: 役のチケットに依存", "apps/e.ts", "e")
        bad4, legacy4, _ = check(d, "HEAD", start)
        # 子を持つ親（実装は持たない）は、子が全部済めば依存として満たす。子が 1 つでも済んでいなければ赤（K-65・2026-11-15）
        run("checkout", "-q", "-b", "parent", start)
        tickets({"K-1": {"depends_on": [], "stage": "未着手", "assignee": "実装", "parent": "K-20"},
                 "K-8": {"depends_on": [], "stage": "完了", "assignee": "高本さん", "parent": "K-20"},
                 "K-20": {"depends_on": [], "stage": "未着手", "assignee": "代表・実装"},
                 "K-21": {"depends_on": [], "stage": "未着手", "assignee": "実装", "parent": "K-22"},
                 "K-22": {"depends_on": [], "stage": "未着手", "assignee": "代表・実装"},
                 "K-5": {"depends_on": ["K-20"], "stage": "未着手"}, "K-6": {"depends_on": ["K-22"], "stage": "未着手"}})
        commit("K-1 K-8 K-20 K-21 K-22 docs: 一覧", "11_tickets/K-20.md", "x")
        commit("K-1 feat: 子の実装", "apps/b.ts", "b")
        commit("K-5 feat: 子が全部済んだ親に依存", "apps/d.ts", "d")
        commit("K-6 feat: 子が済んでいない親に依存", "apps/e.ts", "e")
        bad5, legacy5, _ = check(d, "HEAD", start)
        ok_parent = (not any("K-5" in b for b in bad5) and any("K-6 は K-22" in b for b in bad5)
                     and "K-20（K-5 の依存・子が全部済んだ親）" in legacy5)
        # 外した子（K-210）：分かれ目の版で子だった K-21（実装なし）の parent を枝で外しても、比べる元を渡せば親 K-22 は満たさない
        run("checkout", "-q", "-b", "unparent", start)
        fam = {"K-21": {"depends_on": [], "stage": "未着手", "assignee": "実装", "parent": "K-22"},
               "K-22": {"depends_on": [], "stage": "未着手", "assignee": "代表・実装"},
               "K-6": {"depends_on": ["K-22"], "stage": "未着手"}}
        tickets(fam)
        commit("K-21 K-22 docs: 一覧", "11_tickets/K-22.md", "x")
        fork = git("rev-parse", "HEAD", cwd=d).strip()
        tickets({**fam, "K-21": {k: v for k, v in fam["K-21"].items() if k != "parent"}})
        commit("K-21 docs: 親を外す", "11_tickets/K-21.md", "x")
        commit("K-6 feat: 親に依存", "apps/e.ts", "e")
        bad6, _, _ = check(d, "HEAD", start, base=fork)
        ok_parent = ok_parent and any("K-6 は K-22" in b for b in bad6)
        # K-711 の形（K-1154）：依存の実装より先に試験と実装をコミットし、後で依存の枝を取り込む → 緑（枝の先頭だけで見る）
        run("checkout", "-q", "-b", "late", start)
        commit("K-2 test: チケットと試験", "scripts/ci/k2_test.py", "t")
        commit("K-2 feat: 依存より先に作る", "apps/a.ts", "a")
        run("checkout", "-q", "-b", "t/K-1", start)
        commit("K-1 feat: 依存を作る", "apps/b.ts", "b")
        run("checkout", "-q", "late")
        run("merge", "-q", "--no-ff", "-m", "K-2 merge: t/K-1 を取り込む", "t/K-1")
        bad7, _, n7 = check(d, "HEAD", start)
        ok_parent = ok_parent and not bad7 and n7 == 3
        ok = ok_parent and (len(bad1) == 1 and "K-2 は K-1" in bad1[0] and len(bad2) == 1 and not bad3 and n3 == 3
              and legacy3 == ["K-9（K-4 の依存・決まりの前に入った）"]
              and any("K-6 は K-7" in b for b in bad4) and not any("K-5" in b for b in bad4)
              and "K-8（K-5 の依存・人の準備で完了）" in legacy4)
        print("selftest ok" if ok else f"selftest NG: {bad1} / {bad2} / {bad3} / {legacy3} / {bad5} / {legacy5} / {bad6} / {bad7}")
        return 0 if ok else 1


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    root = git("rev-parse", "--show-toplevel").strip()
    args = sys.argv[1:]

    def opt(name: str) -> str | None:
        return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else ("" if name in args else None)
    start = opt("--start") or START
    try:
        bad, legacy, n = check(root, "HEAD", start, base=opt("--base-ref"))
    except RuntimeError as e:
        print(f"★ FAIL {e}")
        return 1
    for x in bad:
        print(f"  ★ {x}")
    if legacy:
        print(f"  （番号の付いたコミットが無いが stage が確認中・完了なので、決まりの前に入ったとして通した依存：{'・'.join(legacy)}）")
    print(f"実装のコミット {n} 本・順の違反 {len(bad)} 件")
    print("PASS — どの実装も、依存のチケットの実装が先に枝に入っている" if not bad
          else "FAIL — 依存がまだ枝に入っていないチケットの実装がある（取り込むのは依存の順に 1 本ずつ・K-94）")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
