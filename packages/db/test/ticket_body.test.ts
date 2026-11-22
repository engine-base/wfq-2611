// K-561「DB：本文 1 枚の持ち方」の単体の試験（本物の DB）。名前の頭の行 ID（K561-DB-…）は 11_tickets/K-561.md の表のマスに 1 対 1 で結ぶ。
//   ひな形（ticket_kinds.body_template）・app.ticket_create の本文 1 枚の道（body）・前の道（sections）の行 008・009 は ticket_body_legacy_sections.test.ts・形と上限の守り（app.ticket_body_valid）・別の会社・権限。
//   テストはチケットを作る人が書き、実装する人は変えない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "../src/migrate.js";
import { seedAccessMatrix } from "../src/seeds.js";
import { withTenant, type TenantContext } from "../src/context.js";
import { validateDoc, docToText } from "../../contracts/src/doc.js";

const DB_URL = process.env["DATABASE_URL"]!;
const APP_URL = DB_URL.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const here = dirname(fileURLToPath(import.meta.url));
const admin = new pg.Pool({ connectionString: DB_URL, max: 2 });
let app: pg.Pool;
let S: Awaited<ReturnType<typeof seedAccessMatrix>>;
let boss: TenantContext, staff: TenantContext, other: TenantContext;
let kindA: string;
let kindB: string;

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
const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (...content: unknown[]) => ({ type: "doc", content });
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
  staff = { tenantId: S.tenantA, userId: S.staffA, role: "member" };
  const bossB = await one("select id from members where tenant_id = $1 and display_name = '別会社'", [S.tenantB]);
  other = { tenantId: S.tenantB, userId: bossB, role: "member" };
  await admin.query("update scopes set ticket_prefix = 'BD', next_ticket_no = 1 where id = $1", [S.scopeRootA]);
  kindA = await one("select id from ticket_kinds where tenant_id = $1 and name = 'タスク'", [S.tenantA]);
  kindB = await one("select id from ticket_kinds where tenant_id = $1 and name = 'タスク'", [S.tenantB]);
});
afterAll(async () => {
  await app.end();
  await admin.end();
});

describe("種別のひな形（ticket_kinds.body_template）", () => {
  it("K561-DB-001 会社を作った直後に、既定の 4 種別（タスク・課題・QA・会議）へ製品のひな形が入る（見出し 5・薄い字の説明 5・文書の木の形に合う）", async () => {
    const t = await one(
      "insert into tenants (id, tenant_id, name) select u, u, '会社 c' from gen_random_uuid() u returning id",
    );
    const kinds = (
      await admin.query<{
        name: string;
        body_template: { content: { type: string; attrs: { ghost?: boolean }; content: { text: string }[] }[] };
      }>("select name, body_template from ticket_kinds where tenant_id = $1 and is_builtin order by position", [t])
    ).rows;
    expect(kinds.map((k) => k.name)).toEqual(["タスク", "課題", "QA", "会議"]);
    for (const k of kinds) {
      const nodes = k.body_template.content;
      expect(nodes.length).toBe(10);
      expect(nodes.filter((n) => n.type === "heading").map((n) => n.content[0]!.text)).toEqual([
        "目的",
        "完了の条件",
        "実施事項",
        "前提と制約",
        "参考",
      ]);
      expect(nodes.every((n) => n.attrs.ghost === true)).toBe(true);
      expect(validateDoc(k.body_template).ok).toBe(true);
      expect(docToText(k.body_template as never)).toBe(""); // 薄い字は素の文字に入れない
    }
  });

  it("K561-DB-002 ひな形を入れる関数は、入っている種別を上書きせず、既定でない種別・消した種別にも入れない", async () => {
    const mine = { type: "doc", content: [para("会社が直したひな形")] };
    await admin.query("update ticket_kinds set body_template = $2 where id = $1", [kindA, JSON.stringify(mine)]);
    const custom = await one(
      "insert into ticket_kinds (tenant_id, name, position, is_builtin) values ($1, '会社の種別', 90, false) returning id",
      [S.tenantA],
    );
    const gone = await one(
      "insert into ticket_kinds (tenant_id, name, position, is_builtin, deleted_at) values ($1, '消した既定', 91, true, now()) returning id",
      [S.tenantA],
    );
    await admin.query("select app.ticket_body_template_basics($1)", [S.tenantA]);
    await admin.query("select app.ticket_basics($1)", [S.tenantA]); // 初めの行をもう一度入れても種別は増えず、ひな形も消えない
    const get = async (id: string) =>
      (await admin.query<{ body_template: unknown }>("select body_template from ticket_kinds where id = $1", [id]))
        .rows[0]!.body_template;
    expect(await get(kindA)).toEqual(mine);
    expect(await get(custom)).toBeNull();
    expect(await get(gone)).toBeNull();
    expect(
      Number(
        (
          await admin.query<{ n: string }>(
            "select count(*) n from ticket_kinds where tenant_id = $1 and is_builtin and deleted_at is null",
            [S.tenantA],
          )
        ).rows[0]!.n,
      ),
    ).toBe(4);
    // ひな形が空の既定の種別には入る（前からある会社への入れ直し）
    await admin.query("update ticket_kinds set body_template = null where id = $1", [kindA]);
    await admin.query("select app.ticket_body_template_basics($1)", [S.tenantA]);
    expect(((await get(kindA)) as { content: unknown[] }).content.length).toBe(10);
  });

  it("K561-DB-003 ひな形の形の守り：type が doc でない・content が配列でない・1MB を超える更新は止まる", async () => {
    const tryset = async (v: unknown) => {
      try {
        await admin.query("update ticket_kinds set body_template = $2::jsonb where id = $1", [
          kindA,
          JSON.stringify(v),
        ]);
        return null;
      } catch (e) {
        return String((e as Error).message);
      }
    };
    expect(await tryset({ type: "paragraph", content: [] })).toContain("ticket_kinds_body_template_ok");
    expect(await tryset({ type: "doc", content: "x" })).toContain("ticket_kinds_body_template_ok");
    expect(await tryset({ type: "doc", content: [para("x".repeat(1_048_600))] })).toContain(
      "ticket_kinds_body_template_ok",
    );
    expect(await tryset({ type: "doc", content: [para("ふつう")] })).toBeNull();
  });
});

describe("本文 1 枚の道（app.ticket_create の body）", () => {
  it("K561-DB-004 body を渡して作ると、鍵 body の 1 行（位置 0・版 1・{doc, text}）と版 1 の行が 1 つずつ書かれ、前の区画の行は書かれない", async () => {
    const d = doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "目的" }] },
      para("請求を届ける"),
    );
    const text = "目的\n請求を届ける";
    const r = await create(boss, { body: { doc: d, text } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const rows = await sections(r.id!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ section_key: "body", position: 0, version: 1, body: { doc: d, text } });
    const vs = await versions(r.id!);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ version: 1, body: { doc: d, text } });
  });

  it("K561-DB-005 別の接続（別の文脈）から読み直しても、同じ本文が画面と同じ形で返る（作った答えだけで合格にしない）", async () => {
    const d = doc(para("読み直す"));
    const r = await create(boss, { body: { doc: d, text: "読み直す" } });
    const again = await q<{ section_key: string; body: { text: string }; version: number }>(
      boss,
      "select section_key, body, version from ticket_sections where ticket_id = $1",
      [r.id!],
    );
    expect(again).toEqual([{ section_key: "body", body: { doc: d, text: "読み直す" }, version: 1 }]);
  });

  it("K561-DB-006 本文が空（節 0 個・text 空）でも作れる（必須の区画で止めない）", async () => {
    const r = await create(boss, { body: { doc: doc(), text: "" } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await sections(r.id!)).map((x) => x.section_key)).toEqual(["body"]);
  });

  it("K561-DB-007 body に doc と text 以外の鍵が混ざっても、書かれるのは doc と text だけ", async () => {
    const d = doc(para("余分"));
    const r = await create(boss, { body: { doc: d, text: "余分", extra: "捨てる", sections: { purpose: "x" } } });
    expect(r.ok).toBe(true);
    expect((await sections(r.id!))[0]!.body).toEqual({ doc: d, text: "余分" });
  });
});

describe("前の道（sections）が在っても無くても変わらない物（K-578 の前も後も同じ）", () => {
  it("K561-DB-010 body と sections が両方来たら body だけを書く（区画の行は書かない・必須の区画で止めない）", async () => {
    const d = doc(para("本文だけ"));
    const r = await create(boss, { body: { doc: d, text: "本文だけ" }, sections: { purpose: "捨てる" } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await sections(r.id!)).map((x) => x.section_key)).toEqual(["body"]);
  });

  it("K561-DB-011 kind_sections は触らない（凍結の前も後も）：タスクは 10 行・必須 3 つのまま", async () => {
    const rows = (
      await admin.query<{ n: string; req: string }>(
        "select count(*) n, count(*) filter (where mode = 'required') req from kind_sections where kind_id = $1",
        [kindA],
      )
    ).rows[0]!;
    expect([Number(rows.n), Number(rows.req)]).toEqual([10, 3]);
  });
});

describe("形と上限の守り", () => {
  const cases: [string, unknown][] = [
    ["文字列", "本文"],
    ["doc が無い", { text: "x" }],
    ["text が無い", { doc: doc() }],
    ["text が文字でない", { doc: doc(), text: 1 }],
    ["doc の type が違う", { doc: { type: "paragraph", content: [] }, text: "" }],
    ["doc の content が配列でない", { doc: { type: "doc", content: "x" }, text: "" }],
  ];
  it.each(cases)("K561-DB-012 形が違う本文（%s）は 422 BODY_INVALID で、何も書かれない", async (_n, body) => {
    const before = await ticketCount();
    const r = await create(boss, { body });
    expect(r).toMatchObject({ ok: false, status: 422, code: "BODY_INVALID", field: "body" });
    expect(await ticketCount()).toBe(before);
  });

  it("K561-DB-013 大きさ：節の数に上限は持たない（段落 6,000 個でも通る）／doc の長さ 1,048,576 バイトを超えると止まる／text が 1,048,576 バイトを超えると止まる", async () => {
    const nodes = (n: number) => Array.from({ length: n }, () => ({ type: "paragraph" }));
    const ok = await create(boss, { body: { doc: doc(...nodes(6000)), text: "" } }); // 節の数の上限は無い（大きさは 1MB に収まる）
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    const bigDoc = await create(boss, { body: { doc: doc(para("あ".repeat(400_000))), text: "" } }); // 1.2MB（UTF-8）
    expect(bigDoc).toMatchObject({ ok: false, code: "BODY_INVALID" });
    const bigText = await create(boss, { body: { doc: doc(), text: "a".repeat(1_048_577) } });
    expect(bigText).toMatchObject({ ok: false, code: "BODY_INVALID" });
  });

  it("K561-DB-014 直に入れる道の最後の砦：鍵 body の壊れた行は表の守りで止まり、前の区画の行（{text}）は止まらない", async () => {
    const r = await create(boss, { body: { doc: doc(para("土台")), text: "土台" } });
    const ins = async (key: string, body: unknown) => {
      try {
        await admin.query(
          "insert into ticket_sections (tenant_id, ticket_id, section_key, position, body) values ($1, $2, $3, 5, $4::jsonb)",
          [S.tenantA, r.id!, key, JSON.stringify(body)],
        );
        return null;
      } catch (e) {
        return String((e as Error).message);
      }
    };
    expect(await ins("body", { text: "doc が無い" })).toContain("ticket_sections_body_ok");
    expect(await ins("purpose", { text: "前の形" })).toBeNull();
  });
});

describe("別の会社・権限", () => {
  it("K561-DB-015 別の会社の人は、会社 a の本文の行を読めず、会社 a のグループ・種別を使って作ることもできない（何も書かれない）", async () => {
    const made = await create(boss, { body: { doc: doc(para("会社 a だけ")), text: "会社 a だけ" } });
    expect(await q(other, "select 1 from ticket_sections where ticket_id = $1", [made.id!])).toHaveLength(0);
    const before = await ticketCount();
    const r = await create(other, { body: { doc: doc(para("越境")), text: "越境" } }, S.scopeRootA, kindA);
    expect(r).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    expect(await ticketCount()).toBe(before);
    // 会社 b の種別のひな形は会社 b のもの（会社 a の種別に混ざらない）
    const bKinds = await q<{ id: string }>(other, "select id from ticket_kinds where body_template is not null");
    expect(bKinds.map((k) => k.id)).toContain(kindB);
    expect(bKinds.map((k) => k.id)).not.toContain(kindA);
  });

  it("K561-DB-016 書く権限が無い人（グループの外）が body で作ろうとすると 403 FORBIDDEN で、何も書かれない", async () => {
    const before = await ticketCount();
    const r = await create(staff, { body: { doc: doc(para("権限なし")), text: "権限なし" } });
    expect(r).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN", field: "scope_id" });
    expect(await ticketCount()).toBe(before);
  });

  it("K561-DB-017 失敗 S1 DB に書く：チケットを書いた後、版 1 の行を書く所で落ちたら、取引ごと戻ってチケットも本文の行も残らない", async () => {
    const title = "K561-017-途中で落ちる";
    // この試験の本文の字だけに反応する引き金（ほかの試験の作りを巻き込まない）。終わったら必ず消す
    await admin.query(
      "create or replace function public.k561_boom() returns trigger language plpgsql as $$ begin raise exception 'K561-BOOM'; end $$",
    );
    await admin.query(
      "create trigger k561_boom_t before insert on ticket_section_versions for each row when (new.body->>'text' = 'K561-BOOM') execute function public.k561_boom()",
    );
    try {
      const before = await ticketCount();
      await expect(create(boss, { title, body: { doc: doc(para("K561-BOOM")), text: "K561-BOOM" } })).rejects.toThrow(
        /K561-BOOM/,
      );
      expect(await ticketCount()).toBe(before);
      const left = await admin.query("select 1 from tickets where tenant_id = $1 and title = $2", [S.tenantA, title]);
      expect(left.rowCount).toBe(0);
    } finally {
      await admin.query("drop trigger if exists k561_boom_t on ticket_section_versions");
      await admin.query("drop function if exists public.k561_boom()");
    }
  });
});
