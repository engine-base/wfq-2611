// 段 5「確認項目の口」（K-434 読む・足す／K-435 チェックを付ける・外す・直す・外す）の試験の共通の土台（2026-11-21 の作り直し）。
//   行（it）は葉ごとのファイル test-spec-create.test.ts（K-434）・test-spec-update.test.ts（K-435）にある。
//   土台は各ファイルの頭で setupSpecs([自分の hooks のファイル名]) を 1 回呼ぶ（K-435 は K-434 のこの土台を使う）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 組み立ては K-60・K-92 の土台（apps/api/test/features/fixture.ts の makeFixture）と同じ：本物の Postgres（migration を全部当てる）・本物の口の入口。
//   画面のログインだけは偽（Bearer に会社・人・役を書く）。チケットは DB に直に入れる（チケットを作る口 createTicket は K-437 が作り直すので、
//   この土台は作る口に依らない。準備は行の守りの外・admin）。
//   確認項目の口の振る舞いは葉ごとの hooks のファイル apps/api/src/hooks/test-specs-*.ts の register（K-326）。最初の要求のときに 1 回だけ読む
//   （準備で読まない：実装の前の smoke で、まだ無いファイルを準備で読んで準備ごと落とさない・answer=8f745003d023）。
//
// 試験が決める口の形（契約は 05_flow/screen_api.py と 05_flow/screen_api.d/K-434.py・K-435.py で作る）:
//   listTestSpecs    GET   /api/v1/tickets/:id/test-specs   200 { data: SpecItem[], meta: { count, limit, can_edit } }
//   createTestSpec   POST  /api/v1/tickets/:id/test-specs   201 { data: SpecItem }（体は { title } だけ）
//   updateTestSpec   PATCH /api/v1/test_specs/:id           200 { data: SpecItem }（K-435）
//   deleteTestSpec   DELETE /api/v1/test_specs/:id          200 { data: SpecItem }（K-435）
//   SpecItem = { id, title, checked, position, source, version }（position は作った順の 1 から。source は manual・knowledge・ai。version は行の版で、直す口に送る）
//   チェック＝checked_at が入っている状態（付けた人は checked_by_member_id か checked_by_ai）。check_kind・judge_type・params・off_reason は使わない（列は残す）
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, vi } from "vitest";
import type { HookDeps, HookModule } from "../../../src/hooks/registry.js";
import { makeFixture, type Fixture, type Person } from "../fixture.js";

/** 口の振る舞いの在りか。葉ごとのファイル test-specs-*.ts（まだ入っていない葉の物は無い） */
const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "hooks");

export type { Person };
export type Json = Record<string, unknown> & { data?: unknown; meta?: Record<string, unknown> };

export interface SpecRow {
  id: string;
  tenant_id: string;
  ticket_id: string;
  check_kind: string | null;
  title: string;
  version: number;
  checked_at: string | null;
  checked_by_member_id: string | null;
  checked_by_ai: boolean;
  source: string;
  source_ref_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
}

/** やり取りの 1 行（ticket_messages） */
export interface MessageRow {
  id: string;
  kind: string;
  author_member_id: string | null;
  body: string | null;
  changes: { field: string; from: unknown; to: unknown }[] | null;
}

/** 試験の会社 1 つ分（ほかの試験の会社を混ぜない） */
export interface World {
  tenantId: string;
  rootScope: string;
  /** 種別「タスク」の id */
  kindId: string;
  /** チケットを書ける人（グループの edit） */
  writer: Person;
  /** 読むだけの人（グループの view・担当者でない） */
  viewer: Person;
  /** そのグループを見る力が無い人（チケットが見えない） */
  stranger: Person;
}

export interface SeedOpts {
  title?: string;
  /** 直に入れる物（口を通さない）。check_kind は使わない列なので既定は null */
  check_kind?: string | null;
  /** チェックを付けた形で入れる（人＝by か書く人・AI＝checked_by_ai） */
  checked?: "member" | "ai";
  source?: string;
  source_ref_id?: string;
  deleted?: boolean;
  by?: Person;
}

export interface SpecHarness {
  readonly f: Fixture;
  /** 契約の口を叩く（path は /api/v1 から）。体は JSON にする */
  call: (
    who: Person | null,
    method: string,
    path: string,
    o?: { body?: unknown; headers?: Record<string, string> },
  ) => Promise<Response>;
  json: (r: Response) => Promise<Json>;
  /** 1 分あたりの上限を差し替える（口の名前）。既定は試験が混ざらない大きさ */
  limit: (op: string, perMinute: number) => void;
  world: (label: string) => Promise<World>;
  /** チケットを DB に直に 1 件入れる（段は未着手）。担当者は書く人 */
  ticket: (w: World, o?: { by?: Person; title?: string }) => Promise<{ id: string; number: string }>;
  /** テスト仕様の行を DB に直に入れる（行の守りの外）。返すのは行 */
  seed: (ticketId: string, o?: SeedOpts) => Promise<SpecRow>;
  /** 行を DB から直に読む（消した行も） */
  row: (id: string) => Promise<SpecRow | undefined>;
  /** チケットの行を全部（消した行も）作った順に */
  rows: (ticketId: string) => Promise<SpecRow[]>;
  /** チケットを完了にする（段 done・完了の時刻と人を入れる） */
  finish: (ticketId: string) => Promise<void>;
  /** チケットを消す（deleted_at を入れる） */
  removeTicket: (ticketId: string) => Promise<void>;
  /** チケットのやり取りの変更の行（kind change）を作った順に */
  messages: (ticketId: string) => Promise<MessageRow[]>;
  /** 人の名前（app.member_name）。やり取りの文の頭に出る */
  name: (p: Person) => Promise<string>;
  /** 数を 1 つ返す SQL（列の名前は n）を、行の守りの外で流す */
  count: (sql: string, p?: unknown[]) => Promise<number>;
  /** 証跡（audit_events）の数 */
  audits: (tenantId: string, action: string, targetId?: string) => Promise<number>;
  /** その会社のその操作の証跡を書くとき、DB を失敗させる引き金を入れる。返す関数で外す（finally で必ず呼ぶ） */
  breakAudit: (tenantId: string, action: string) => Promise<() => Promise<void>>;
  /** fn の間の console の出力を貯めて返す */
  captureLogs: (fn: () => Promise<void>) => Promise<string>;
  /** その関数の文が行のロックを待っている間（待ちの印が出るまで）を待つ。固定の待ちでなく、待ちの印を条件に調べ直す */
  untilLockWaiter: (fn: string) => Promise<void>;
}

/** 404・409 の答えの体は error と code だけ（field・details・detail を付けない＝在るかを漏らさない・控え帳 2026-11-21 01:15 K-385） */
export const bareKeys = (j: Record<string, unknown>): string[] => Object.keys(j).sort();
export const BARE = ["code", "error"];

export const OPS = ["listTestSpecs", "createTestSpec", "updateTestSpec", "deleteTestSpec"] as const;

/** 各試験のファイルの頭で 1 回呼ぶ。files は自分の葉の hooks のファイル名（拡張子なし）。例 ["test-specs-create"] */
export function setupSpecs(files: readonly string[]): SpecHarness {
  let f: Fixture;
  let loading: Promise<void> | null = null;
  /** テスト仕様の口の振る舞いを読み込む（h.call の頭で 1 回だけ。会社・人・チケットの準備には使わない） */
  const ready = (): Promise<void> =>
    (loading ??= (async () => {
      for (const file of files) {
        const m = (await import(join(HOOKS_DIR, `${file}.ts`))) as { register: HookModule };
        // テスト仕様の口が使う材料は appPool だけ（ほかの欄は使わない）
        Object.assign(f.hooks, m.register.make({ appPool: f.pool } as unknown as HookDeps));
      }
    })());

  beforeAll(async () => {
    f = await makeFixture([]);
    for (const op of OPS) f.limits[op] = 100_000;
  }, 60_000);

  afterAll(async () => {
    await f?.close();
  });

  const one = async (sql: string, p: unknown[]) => (await f.admin.query<{ id: string }>(sql, p)).rows[0]!.id;
  const COLS =
    "id, tenant_id, ticket_id, check_kind, title, version, checked_at, checked_by_member_id, checked_by_ai, source, source_ref_id, created_by, updated_by, deleted_at";

  const h: SpecHarness = {
    get f() {
      return f;
    },
    call: async (who, method, path, o = {}) => {
      await ready();
      return f.req(method, path, {
        headers: { ...(who ? who.auth : {}), ...(o.headers ?? {}) },
        ...(o.body === undefined ? {} : { body: o.body }),
      });
    },
    json: async (r) => (await r.json()) as Json,
    limit: (op, perMinute) => {
      f.limits[op] = perMinute;
    },
    world: async (label) => {
      const c = await f.company(`${label} ${Math.random().toString(36).slice(2, 7)}`, "EG");
      const writer = await f.person(c.tenantId, c.rootScope, { name: "高本", ticketAbility: "edit" });
      const viewer = await f.person(c.tenantId, c.rootScope, { name: "山田", ticketAbility: "view" });
      // 見えない人は、根の下の別のグループの席に置く（根の席の人は権限が無くても根のチケットが見える＝visible_scopes は席のグループとその下を見せる。2026-11-22 K-434・K-563 の作る段で出た誤り）
      const otherScope = await one(
        "insert into scopes (tenant_id, name, ticket_prefix, parent_id) values ($1, '別のグループ', 'OT', $2) returning id",
        [c.tenantId, c.rootScope],
      );
      const stranger = await f.person(c.tenantId, otherScope, { name: "見えない人", ticketAbility: null });
      const kindId = await one(
        "select id from ticket_kinds where tenant_id = $1 and name = 'タスク' and deleted_at is null",
        [c.tenantId],
      );
      return {
        tenantId: c.tenantId,
        rootScope: c.rootScope,
        kindId,
        writer,
        viewer,
        stranger,
      };
    },
    ticket: async (w, o = {}) => {
      const jst = new Date(Date.now() + 9 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 10);
      const stage = await one(
        "select id from ticket_stages where tenant_id = $1 and key = 'todo' and deleted_at is null",
        [w.tenantId],
      );
      const r = await f.admin.query<{ id: string; number: string }>(
        `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, assignee_member_id, due_on, created_by, updated_by)
         values ($1, $2, '', $3, $4, $5, $6, $7, $8, $8) returning id, number`,
        [w.tenantId, w.rootScope, w.kindId, stage, o.title ?? "請求書を送る", w.writer.id, jst, (o.by ?? w.writer).id],
      );
      return { id: r.rows[0]!.id, number: r.rows[0]!.number };
    },
    seed: async (ticketId, o = {}) => {
      const t = (
        await f.admin.query<{ tenant_id: string; assignee_member_id: string }>(
          "select tenant_id, assignee_member_id from tickets where id = $1",
          [ticketId],
        )
      ).rows[0]!;
      const who = (o.by?.id ?? t.assignee_member_id) as string;
      const id = await one(
        `insert into test_specs (tenant_id, ticket_id, check_kind, title, source, source_ref_id, checked_at, checked_by_member_id, checked_by_ai, created_by, updated_by, deleted_at)
         values ($1, $2, $3, $4, coalesce($5, 'manual'), $6, $7, $8, $9, $10, $10, $11) returning id`,
        [
          t.tenant_id,
          ticketId,
          o.check_kind === undefined ? null : o.check_kind,
          o.title ?? `確認 ${randomUUID().slice(0, 8)}`,
          o.source ?? null,
          o.source_ref_id ?? null,
          o.checked ? new Date().toISOString() : null,
          o.checked === "member" ? who : null,
          o.checked === "ai",
          who,
          o.deleted ? new Date().toISOString() : null,
        ],
      );
      return (await h.row(id))!;
    },
    row: async (id) => (await f.admin.query<SpecRow>(`select ${COLS} from test_specs where id = $1`, [id])).rows[0],
    rows: async (ticketId) =>
      (
        await f.admin.query<SpecRow>(`select ${COLS} from test_specs where ticket_id = $1 order by created_at, id`, [
          ticketId,
        ])
      ).rows,
    finish: async (ticketId) => {
      await f.admin.query(
        `update tickets t set stage_id = s.id, completed_at = now(), completed_by = t.assignee_member_id
           from ticket_stages s where t.id = $1 and s.tenant_id = t.tenant_id and s.key = 'done'`,
        [ticketId],
      );
    },
    removeTicket: async (ticketId) => {
      await f.admin.query("update tickets set deleted_at = now() where id = $1", [ticketId]);
    },
    messages: async (ticketId) =>
      (
        await f.admin.query<MessageRow>(
          "select id, kind, author_member_id, body, changes from ticket_messages where ticket_id = $1 and kind = 'change' order by created_at, id",
          [ticketId],
        )
      ).rows,
    name: async (p) => (await f.admin.query<{ n: string }>("select app.member_name($1) as n", [p.id])).rows[0]!.n,
    count: async (sql, p = []) => Number((await f.admin.query<{ n: string }>(sql, p)).rows[0]!.n),
    audits: async (tenantId, action, targetId) =>
      Number(
        (
          await f.admin.query<{ n: string }>(
            `select count(*) as n from audit_events where tenant_id = $1 and action = $2 ${targetId ? "and target_id = $3" : ""}`,
            targetId ? [tenantId, action, targetId] : [tenantId, action],
          )
        ).rows[0]!.n,
      ),
    breakAudit: async (tenantId, action) => {
      const name = `k434_break_${Math.random().toString(36).slice(2, 9)}`;
      await f.admin.query(
        "create or replace function public.k434_break() returns trigger language plpgsql as $$ begin raise exception 'k434 試験が起こした失敗'; end $$",
      );
      await f.admin.query(
        `create trigger ${name} before insert on audit_events for each row
           when (new.tenant_id = '${tenantId}'::uuid and new.action = '${action}') execute function public.k434_break()`,
      );
      return async () => {
        await f.admin.query(`drop trigger if exists ${name} on audit_events`);
      };
    },
    captureLogs: async (fn) => {
      const out: string[] = [];
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
        vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))),
      );
      try {
        await fn();
      } finally {
        for (const s of spies) s.mockRestore();
      }
      return out.join("\n");
    },
    untilLockWaiter: async (fn) => {
      await vi.waitFor(
        async () => {
          const n = await h.count(
            "select count(*) as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1",
            [`%${fn}%`],
          );
          expect(n, `${fn} がロックを待つのを待っている`).toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 25 },
      );
    },
  };
  return h;
}
