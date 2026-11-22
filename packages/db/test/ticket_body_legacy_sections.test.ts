// K-561「DB：本文 1 枚の持ち方」のうち、前の道（sections）を見る行（K561-DB-008・009）。名前の頭の行 ID は 11_tickets/K-561.md の表のマスに 1 対 1。
//   K-578 が作る関数から区画の道を外すときに、このファイルごと消す（その後の振る舞いは K-578 の試験 K578-API-001 が見る）。
//   本文の試験（ticket_body.test.ts）は、区画の道が在っても無くても通る形にしてある。
//   テストはチケットを作る人が書き、実装する人は変えない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "../src/migrate.js";
import { seedAccessMatrix } from "../src/seeds.js";
import { withTenant, type TenantContext } from "../src/context.js";

const DB_URL = process.env["DATABASE_URL"]!;
const APP_URL = DB_URL.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const here = dirname(fileURLToPath(import.meta.url));
const admin = new pg.Pool({ connectionString: DB_URL, max: 2 });
let app: pg.Pool;
let S: Awaited<ReturnType<typeof seedAccessMatrix>>;
let boss: TenantContext;
let kindA: string;

type Result = {
  ok: boolean;
  status?: number;
  code?: string;
  field?: string;
  id?: string;
  number?: string;
  detail?: string[];
};
const q = async <T = Record<string, unknown>>(ctx: TenantContext, sql: string, p: unknown[] = []) =>
  withTenant(app, ctx, async (c) => (await c.query(sql, p)).rows as T[]);
const one = async (sql: string, p: unknown[] = []) => (await admin.query<{ id: string }>(sql, p)).rows[0]!.id;
const create = async (ctx: TenantContext, extra: Record<string, unknown> = {}, scope = S.scopeRootA, kind = kindA) => {
  const p = {
    scope_id: scope,
    kind_id: kind,
    title: "請求書を送る",
    assignee_member_id: S.bossA,
    due_on: "2030-01-31",
    ...extra,
  };
  const r = await q<{ v: Result }>(ctx, "select app.ticket_create($1::jsonb) as v", [JSON.stringify(p)]);
  return r[0]!.v;
};
const sections = async (ticket: string) =>
  (
    await admin.query<{
      section_key: string;
      position: number;
      version: number;
      body: { doc?: unknown; text?: string };
    }>(
      "select section_key, position, version, body from ticket_sections where ticket_id = $1 order by position, section_key",
      [ticket],
    )
  ).rows;
const versions = async (ticket: string) =>
  (
    await admin.query<{ version: number; body: unknown }>(
      "select version, body from ticket_section_versions where ticket_id = $1",
      [ticket],
    )
  ).rows;
const ticketCount = async () =>
  Number(
    (await admin.query<{ n: string }>("select count(*) as n from tickets where tenant_id = $1", [S.tenantA])).rows[0]!
      .n,
  );

beforeAll(async () => {
  await migrate(DB_URL, join(here, ".."));
  const c = await admin.connect();
  try {
    S = await seedAccessMatrix(c);
  } finally {
    c.release();
  }
  app = new pg.Pool({ connectionString: APP_URL, max: 3 });
  boss = { tenantId: S.tenantA, userId: S.bossA, role: "member" };
  await admin.query("update scopes set ticket_prefix = 'BD', next_ticket_no = 1 where id = $1", [S.scopeRootA]);
  kindA = await one("select id from ticket_kinds where tenant_id = $1 and name = 'タスク'", [S.tenantA]);
});
afterAll(async () => {
  await app.end();
  await admin.end();
});

describe("前の道（sections）は前のまま（K-578 が外す）", () => {
  it("K561-DB-008 sections だけを渡すと、タスクの必須 3 つが区画の行になる（鍵 body の行は無い・版 1）", async () => {
    const r = await create(boss, {
      sections: { purpose: "月末の請求を出す", done: "先方が受け取った", todo: "作る\n送る" },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const rows = await sections(r.id!);
    expect(rows.map((x) => x.section_key)).toEqual(["purpose", "done", "todo"]);
    expect(rows.every((x) => x.version === 1)).toBe(true);
    expect(rows[0]!.body).toEqual({ text: "月末の請求を出す" });
    expect(await versions(r.id!)).toHaveLength(3);
  });

  it("K561-DB-009 body も sections も無い作りは、前のとおり SECTION_REQUIRED（422・何も書かない）", async () => {
    const before = await ticketCount();
    const r = await create(boss, {});
    expect(r).toMatchObject({ ok: false, status: 422, code: "SECTION_REQUIRED", field: "sections" });
    expect(r.detail).toEqual(["purpose", "done", "todo"]);
    expect(await ticketCount()).toBe(before);
  });
});
