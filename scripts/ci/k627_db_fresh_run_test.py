#!/usr/bin/env python3
"""K-627 の試験：spec-sync の L（層の棚卸し G21）の DB の層が、手元の古い kaname_test（migration が 0075 で止まった残り物）で
偽の赤にならないよう、手元では使い捨ての DB を作って試験を流し、終わったら必ず捨てる。CI では渡された DB をそのまま使う。

  python3 scripts/ci/k627_db_fresh_run_test.py      行 ID は K627-FRESH-NNN（11_tickets/K-627.md の行の表と 1 対 1）

決まり（scripts/ci/db_fresh_run.mjs）：
  ・使い方：node scripts/ci/db_fresh_run.mjs [--dry-run | --list-tmp] -- <命令…>
  ・DATABASE_URL が env に在れば（CI の容れ物・手元で自分で渡した時）、何も作らずその DB のまま命令を流す
  ・無ければ、管理者の接続（DATABASE_URL_ADMIN の道を /postgres に替えた物。無ければ postgres://postgres:postgres@127.0.0.1:55433/postgres）で
    `kaname_tmp_<英数 8 字>` を作り、DATABASE_URL をそれにして命令を流し、命令が終わったら成功でも失敗でも DB を捨てる（命令の終わりの値をそのまま返す）
  ・DB の作成（手順 1）に失敗したら命令を流さず終わりの値 1。捨てる（手順 3）に失敗したら名前を標準エラーに出して終わりの値 1（DB は kaname_tmp_ の名前で残る）
  ・--dry-run は DB に触らず、選んだ DB の名前と命令を出すだけ。--list-tmp は残っている kaname_tmp_ の DB の名前を 1 行ずつ出す
  ・手元の kaname_dev・kaname_test には一切書かない・消さない（名前が kaname_tmp_ で始まらない DB は捨てない）
  ・層の検査（spec-dependencies.yaml の packages/db/migrations/*.sql の行）は、この道具の中で vitest を流す。ci:rls-enabled・ci:no-vendor-sql は今のまま残す
  ・packages/db/test/repository.test.ts は、DB の名前が kaname_test でなくても「表が無い」の試験が通る（名前を決め打ちしない）
テストはチケットを切る人が書き、実装する人は変えない（D-128.125）
"""
from __future__ import annotations

import os
import pathlib
import re
import subprocess
import unittest

import yaml

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RUN = ROOT / "scripts" / "ci" / "db_fresh_run.mjs"
LAYER = "packages/db/migrations/*.sql"
ECHO = ["python3", "-c", "import os;print(os.environ.get('DATABASE_URL',''))"]


def run(args: list[str], env_drop: tuple[str, ...] = (), env_add: dict | None = None, timeout: int = 300) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in env_drop}
    env.update(env_add or {})
    return subprocess.run(["node", str(RUN), *args], capture_output=True, text=True, cwd=ROOT, env=env, timeout=timeout)


class FreshRunTest(unittest.TestCase):
    def test_K627_FRESH_001_given_database_url_is_used_as_is_and_nothing_is_created(self) -> None:
        r = run(["--dry-run", "--", *ECHO], env_add={"DATABASE_URL": "postgres://u:p@host:1/given_db"})
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        self.assertIn("given_db", r.stdout)
        self.assertNotIn("kaname_tmp_", r.stdout)

    def test_K627_FRESH_002_without_it_a_throwaway_name_is_chosen(self) -> None:
        r = run(["--dry-run", "--", *ECHO], env_drop=("DATABASE_URL",))
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        self.assertRegex(r.stdout, r"kaname_tmp_[A-Za-z0-9]{8}\b")

    def test_K627_FRESH_003_the_throwaway_name_differs_every_call(self) -> None:
        names = {re.search(r"kaname_tmp_[A-Za-z0-9]{8}", run(["--dry-run", "--", *ECHO], env_drop=("DATABASE_URL",)).stdout).group(0)  # type: ignore[union-attr]
                 for _ in range(3)}
        self.assertEqual(len(names), 3)

    def test_K627_FRESH_004_the_throwaway_db_is_made_given_to_the_command_and_dropped_after(self) -> None:
        r = run(["--", *ECHO], env_drop=("DATABASE_URL",))
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        name = re.search(r"/(kaname_tmp_[A-Za-z0-9]{8})\s*$", r.stdout.strip())
        self.assertTrue(name, f"命令に渡された DATABASE_URL が使い捨ての名前でない: {r.stdout!r}")
        after = run(["--list-tmp"], env_drop=("DATABASE_URL",)).stdout.split()
        self.assertNotIn(name.group(1), after, "使い捨ての DB が残った")  # type: ignore[union-attr]

    def test_K627_FRESH_005_the_command_exit_code_is_returned_and_the_db_is_dropped_on_failure(self) -> None:
        r = run(["--", "python3", "-c", "import os,sys;print(os.environ['DATABASE_URL']);sys.exit(7)"], env_drop=("DATABASE_URL",))
        self.assertEqual(r.returncode, 7)
        name = re.search(r"/(kaname_tmp_[A-Za-z0-9]{8})\s*$", r.stdout.strip())
        self.assertTrue(name, r.stdout)
        self.assertNotIn(name.group(1), run(["--list-tmp"], env_drop=("DATABASE_URL",)).stdout.split())  # type: ignore[union-attr]

    def test_K627_FRESH_006_never_touches_dev_or_test_databases(self) -> None:
        src = RUN.read_text(encoding="utf-8")
        self.assertRegex(src, r"startsWith\(\s*[\"']kaname_tmp_[\"']\s*\)|\^kaname_tmp_|kaname_tmp_\[")  # 捨てる前に名前を見る
        self.assertNotRegex(src, r"drop database[^\n]*kaname_(dev|test)\b")

    def test_K627_FRESH_007_layer_check_runs_vitest_inside_the_tool_and_keeps_the_other_two(self) -> None:
        rows = yaml.safe_load((ROOT / "spec-dependencies.yaml").read_text(encoding="utf-8"))["layer_checks"]
        row = next(r for r in rows if r.get("file") == LAYER)
        c = str(row["check"])
        self.assertIn("ci:rls-enabled", c)
        self.assertIn("ci:no-vendor-sql", c)
        self.assertRegex(c, r"db_fresh_run\.mjs\s+--\s+pnpm exec vitest run packages/db/test")
        self.assertTrue(row.get("db"), "db: true を外さない（DB の範囲を触った回だけ流す・D-133.6）")

    def test_K627_FRESH_008_repository_test_does_not_hard_code_the_database_name(self) -> None:
        src = (ROOT / "packages/db/test/repository.test.ts").read_text(encoding="utf-8")
        self.assertNotIn("kaname_test$", src)
        self.assertRegex(src, r'replace\(/\\/\[\^/\?\]\+\$/,\s*"/postgres"\)')

    def test_K627_FRESH_009_repository_test_passes_on_a_throwaway_database(self) -> None:
        # 使い捨ての名前（kaname_tmp_…）の DB でも「表が無いと落ちる」の試験が通る（今は名前が kaname_test でないと 1 本赤）
        r = run(["--", "pnpm", "exec", "vitest", "run", "packages/db/test/repository.test.ts", "--no-file-parallelism", "--reporter=dot"],
                env_drop=("DATABASE_URL",), timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-800:])

    def test_K627_FRESH_011_a_drop_that_fails_is_reported_and_leaves_only_a_tmp_name(self) -> None:
        # 手順 3 の失敗：命令が DB を「雛形の DB」にして捨てられなくする → 終わりの値 1・名前を標準エラーに出す・kaname_tmp_ の名前で残る
        pgdir = str(ROOT / "packages" / "db" / "node_modules")
        sabotage = ("const pg=require('pg');(async()=>{const u=process.env.DATABASE_URL;const n=u.split('/').pop();"
                    "const c=new pg.Client({connectionString:u.replace(/\\/[^/]+$/,'/postgres')});await c.connect();"
                    "console.log(n);await c.query('alter database \"'+n+'\" is_template true');await c.end()})()")
        r = run(["--", "node", "-e", sabotage], env_drop=("DATABASE_URL",), env_add={"NODE_PATH": pgdir})
        name = re.search(r"(kaname_tmp_[A-Za-z0-9]{8})", r.stdout)
        self.assertTrue(name, r.stdout + r.stderr[-300:])
        try:
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr[-300:])
            self.assertIn(name.group(1), r.stderr)  # type: ignore[union-attr]
            self.assertIn(name.group(1), run(["--list-tmp"], env_drop=("DATABASE_URL",)).stdout.split())  # type: ignore[union-attr]
        finally:  # 後片付け：雛形の印を外して捨てる（自分で作った残り物だけ）
            fix = ("const pg=require('pg');(async()=>{const n=process.argv[1];if(!n.startsWith('kaname_tmp_'))process.exit(2);"
                   "const a=process.env.DATABASE_URL_ADMIN||'postgres://postgres:postgres@127.0.0.1:55433/postgres';"
                   "const c=new pg.Client({connectionString:a.replace(/\\/[^/?]+$/,'/postgres')});await c.connect();"
                   "await c.query('alter database \"'+n+'\" is_template false');await c.query('drop database \"'+n+'\" with (force)');await c.end()})()")
            subprocess.run(["node", "-e", fix, name.group(1)], env={**os.environ, "NODE_PATH": pgdir}, cwd=ROOT, capture_output=True)  # type: ignore[union-attr]

    def test_K627_FRESH_012_unreachable_admin_database_stops_before_the_command(self) -> None:
        # 手順 1 の失敗：管理 DB につなげない → 命令は流れない・終わりの値 1・何も作らない
        r = run(["--", "python3", "-c", "print('RAN')"], env_drop=("DATABASE_URL",),
                env_add={"DATABASE_URL_ADMIN": "postgres://postgres:postgres@127.0.0.1:1/postgres"})
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr[-300:])
        self.assertNotIn("RAN", r.stdout)
        self.assertNotRegex(r.stdout, r"kaname_tmp_")

    def test_K627_FRESH_010_g65_place_holds_this_test_exactly_once(self) -> None:
        hits = [p.name for p in (ROOT / "scripts/ci/g65.d").glob("*.txt") if "k627_db_fresh_run_test.py" in p.read_text(encoding="utf-8")]
        self.assertEqual(hits, ["K-627.txt"])


if __name__ == "__main__":
    unittest.main()
