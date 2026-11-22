// K-441「つながりを読む・足す・外す口（listTicketLinks・createTicketLink・deleteTicketLink）と、複製の口が呼ぶ派生元の関数」の単体の試験（口と DB・本物の Postgres）。
// テストの名前の頭の行 ID（K441-API-…）は 11_tickets/K-441.md の行の表に 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 試験が決める口の形（契約は 05_flow/screen_api.d/K-441.py で作る）:
//   listTicketLinks   GET    /api/v1/tickets/:id/links   200 { data: Link[] }（派生元が先・上限 200）
//   createTicketLink  POST   /api/v1/tickets/:id/links   body { other_ticket_id, kind: "related" | "derived_from" }  201 { data: Link }
//   deleteTicketLink  DELETE /api/v1/ticket_links/:id    200 { data: { id } }（論理削除）
//   Link = { id, kind, side: "derived" | "source" | null, other: { id, number, title, stage: {id,key,name}, scope: {id,name}, visible }, can_remove, created_at }
//          相手が見えないときは other = { id: null, number, title: null, stage: null, scope: null, visible: false }
//   断る：道の id のチケットが見えない・無い・消した・別の会社は入口の 404（NOT_FOUND・欄なし）、足す・外すで書けないのは入口の 403（FORBIDDEN・欄なし）。
//        相手（other_ticket_id）が見えない・無い・別の会社・外すときのつながりの行の見えない・外した行は口の 404（E-PAGE-001・欄なし）。相手に書けないのは口の 403（欄 other_ticket_id）。
//        409 E-LNK-001（自分自身）・E-LNK-002（もうつながっている）・E-LNK-003（派生元が輪）／503 E-PAGE-003
// DB の関数（packages/db/migrations/20261122094100_ticket_links.sql）:
//   app.ticket_link_derive(p_ticket uuid, p_source uuid) returns jsonb  … 複製（K-438）が呼ぶ。{ok, id, created} か {error: gone|same|cycle|duplicate}
//
// 口の振る舞いの読み込み（apps/api/src/hooks/ticket-links.ts の register）は、試験の本体（it の中）の ready() で 1 回だけする。
//   実装の前（切る段の smoke）に、まだ無いファイルを準備で読んで準備ごと落とさないため（準備の赤と本体の赤を分ける・answer=8f745003d023）。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HookDeps, HookModule } from "../../../src/hooks/registry.js";
import { makeFixture, type Fixture, type Person } from "../fixture.js";

let f: Fixture;
const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "hooks");
let loaded = false;
async function ready(): Promise<void> {
  if (loaded) return;
  const m = (await import(join(HOOKS_DIR, "ticket-links.ts"))) as { register: HookModule };
  Object.assign(f.hooks, m.register.make({ appPool: f.pool } as unknown as HookDeps));
  loaded = true;
}

beforeAll(async () => {
  f = await makeFixture([]);
}, 60_000);
afterAll(async () => {
  await f?.close();
});

type Json = Record<string, unknown>;
const asJson = async (r: Response): Promise<Json> => (await r.json()) as Json;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sorted = (o: object): string[] => Object.keys(o).sort();
/** 404・409 の答えは field・details・detail を付けない（在るかを漏らさない・控え帳 2026-11-21 01:15・20:50） */
const bare = (j: Json): void => {
  for (const k of ["field", "details", "detail"]) expect(Object.keys(j), `${k} を付けない`).not.toContain(k);
};
const NO_SUCH = "00000000-0000-4000-8000-0000000000aa";

interface Link {
  id: string;
  kind: string;
  side: string | null;
  can_remove: boolean;
  created_at: string;
  other: {
    id: string | null;
    number: string;
    title: string | null;
    stage: { id: string; key: string | null; name: string } | null;
    scope: { id: string; name: string } | null;
    visible: boolean;
  };
}
interface World {
  tenantId: string;
  root: string;
  g1: string;
  g2: string;
  /** 全体に書ける（全部見える） */
  boss: Person;
  /** g1 に書ける（g2 は見えない） */
  e1: Person;
  /** g2 に書ける（g1 は見えない） */
  e2: Person;
  /** g1 を読むだけ */
  viewer: Person;
}

async function world(): Promise<World> {
  await ready();
  const c = await f.company(`K441 の会社 ${Math.random().toString(36).slice(2, 7)}`, "LK");
  const grp = async (name: string, prefix: string): Promise<string> =>
    (
      await f.admin.query<{ id: string }>(
        "insert into scopes (tenant_id, name, ticket_prefix, parent_id) values ($1, $2, $3, $4) returning id",
        [c.tenantId, name, prefix, c.rootScope],
      )
    ).rows[0]!.id;
  const g1 = await grp("営業", "LA");
  const g2 = await grp("受託開発", "LB");
  const boss = await f.person(c.tenantId, c.rootScope, { name: "高本", ticketAbility: "edit" });
  const e1 = await f.person(c.tenantId, g1, { name: "営業の人", ticketAbility: "edit" });
  const e2 = await f.person(c.tenantId, g2, { name: "開発の人", ticketAbility: "edit" });
  const viewer = await f.person(c.tenantId, g1, { name: "読むだけの人", ticketAbility: "view" });
  return { tenantId: c.tenantId, root: c.rootScope, g1, g2, boss, e1, e2, viewer };
}

/** チケットを管理の接続で直に入れる（行の守りの外）。number は引き金が付ける */
async function mk(
  w: World,
  scope: string,
  title = "つなぐチケット",
  parent: string | null = null,
): Promise<{ id: string; number: string }> {
  const r = await f.admin.query<{ id: string; number: string }>(
    `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, due_on, parent_ticket_id)
     select $1, $2, 'pending', (select id from ticket_kinds where tenant_id = $1 and name = 'タスク'),
            (select id from ticket_stages where tenant_id = $1 and key = 'todo'), $3, current_date + 7, $4
     returning id, number`,
    [w.tenantId, scope, title, parent],
  );
  return r.rows[0]!;
}
/** つながりを管理の接続で直に入れる */
async function link(w: World, from: string, to: string, kind: "related" | "derived_from"): Promise<string> {
  return (
    await f.admin.query<{ id: string }>(
      "insert into ticket_links (tenant_id, from_ticket_id, to_ticket_id, kind) values ($1, $2, $3, $4) returning id",
      [w.tenantId, from, to, kind],
    )
  ).rows[0]!.id;
}
const rows = async (from: string, to: string): Promise<Json[]> =>
  (
    await f.admin.query(
      "select * from ticket_links where (from_ticket_id = $1 and to_ticket_id = $2) or (from_ticket_id = $2 and to_ticket_id = $1)",
      [from, to],
    )
  ).rows as Json[];
const live = async (from: string, to: string): Promise<Json[]> =>
  (await rows(from, to)).filter((r) => !r["deleted_at"]);
const audits = async (action: string, tenantId: string): Promise<Json[]> =>
  (
    await f.admin.query("select * from audit_events where tenant_id = $1 and action = $2 order by occurred_at", [
      tenantId,
      action,
    ])
  ).rows as Json[];

const list = (who: Person, id: string) => f.req("GET", `/tickets/${id}/links`, { headers: who.auth });
const add = (who: Person, id: string, body: unknown) =>
  f.req("POST", `/tickets/${id}/links`, { headers: who.auth, body });
const rm = (who: Person, id: string) => f.req("DELETE", `/ticket_links/${id}`, { headers: who.auth });
async function listOk(who: Person, id: string): Promise<Link[]> {
  const r = await list(who, id);
  expect(r.status, await r.clone().text()).toBe(200);
  return (await asJson(r))["data"] as Link[];
}
async function addOk(who: Person, id: string, other: string, kind: "related" | "derived_from"): Promise<Link> {
  const r = await add(who, id, { other_ticket_id: other, kind });
  expect(r.status, await r.clone().text()).toBe(201);
  return (await asJson(r))["data"] as Link;
}

/** 証跡を書く所だけを、その会社・その action のときに落とす引き金（ほかの会社・ほかの試験に当たらない） */
async function failingAudit(tenantId: string, action: string, body: () => Promise<void>): Promise<void> {
  const name = `k441_fail_${Math.random().toString(36).slice(2, 8)}`;
  await f.admin.query(
    `create function public.${name}() returns trigger language plpgsql as $$ begin raise exception 'K-441 の試験でわざと落とした'; end $$`,
  );
  await f.admin.query(
    `create trigger ${name} before insert on audit_events for each row
       when (new.tenant_id = '${tenantId}' and new.action = '${action}') execute function public.${name}()`,
  );
  try {
    await body();
  } finally {
    await f.admin.query(`drop trigger if exists ${name} on audit_events`);
    await f.admin.query(`drop function if exists public.${name}()`);
  }
}
/** 複製の呼び先 app.ticket_link_derive は誰にも execute を渡さない（security definer の関数の中から呼ぶ）。
 *  試験は管理の接続で、要求の文脈と同じ設定（app.tenant_id・app.user_id・app.role）を入れた 1 つの取引の中で呼ぶ */
async function derive(w: World, who: Person, ticket: string, source: string): Promise<Json> {
  const cl = await f.admin.connect();
  try {
    await cl.query("begin");
    await cl.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', 'member', true)",
      [w.tenantId, who.id],
    );
    const v = (await cl.query<{ v: Json }>("select app.ticket_link_derive($1::uuid, $2::uuid) as v", [ticket, source]))
      .rows[0]!.v;
    await cl.query("commit");
    return v;
  } catch (e) {
    await cl.query("rollback");
    throw e;
  } finally {
    cl.release();
  }
}

describe("K-441 つながりの口", () => {
  it("K441-API-001 一覧：関連 1・派生元 1（両方見える）→ 派生元が先・side つき・鍵の形", async () => {
    const w = await world();
    const a = await mk(w, w.g1, "中心のチケット");
    const rel = await mk(w, w.g1, "関連のチケット");
    const src = await mk(w, w.g1, "元のチケット");
    await link(w, a.id, rel.id, "related");
    await link(w, a.id, src.id, "derived_from");
    const r = await list(w.boss, a.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    const body = await asJson(r);
    const data = body["data"] as Link[];
    expect(data.length).toBe(2);
    expect(data.map((l) => l.kind)).toEqual(["derived_from", "related"]);
    expect(data.map((l) => l.side)).toEqual(["derived", null]);
    for (const l of data) {
      expect(sorted(l)).toEqual(["can_remove", "created_at", "id", "kind", "other", "side"]);
      expect(sorted(l.other)).toEqual(["id", "number", "scope", "stage", "title", "visible"]);
      expect(l.other.visible).toBe(true);
    }
    expect(data[0]!.other).toMatchObject({ id: src.id, number: src.number, title: "元のチケット" });
    expect(sorted(data[0]!.other.stage!)).toEqual(["id", "key", "name"]);
    expect(sorted(data[0]!.other.scope!)).toEqual(["id", "name"]);
    expect(data[0]!.other.scope!.id).toBe(w.g1);
    expect(data[1]!.other).toMatchObject({ id: rel.id, title: "関連のチケット" });
    expect(body["meta"]).toEqual({ limit: 200, children: [] });
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(2);
  });

  it("K441-API-002 一覧：相手が別グループで見えない → 番号だけ（題名・段・グループ・id は出さない）", async () => {
    const w = await world();
    const a = await mk(w, w.g1, "見える側");
    const hidden = await mk(w, w.g2, "秘密の題名ナイショ");
    const open = await mk(w, w.g1, "見える相手");
    await link(w, a.id, hidden.id, "related");
    await link(w, a.id, open.id, "related");
    const r = await list(w.e1, a.id);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("秘密の題名ナイショ");
    const data = (JSON.parse(text) as { data: Link[] }).data;
    expect(data.length).toBe(2);
    const h = data.find((l) => l.other.number === hidden.number)!;
    expect(h.other).toEqual({ id: null, number: hidden.number, title: null, stage: null, scope: null, visible: false });
    const o = data.find((l) => l.other.number === open.number)!;
    expect(o.other).toMatchObject({ id: open.id, title: "見える相手", visible: true });
  });

  it("K441-API-003 一覧：相手が消されたチケット・外した行は出ない（相手を戻すと出る）", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const gone = await mk(w, w.g1);
    const out = await mk(w, w.g1);
    const keep = await mk(w, w.g1);
    await link(w, a.id, gone.id, "related");
    const removed = await link(w, a.id, out.id, "related");
    await link(w, a.id, keep.id, "related");
    await f.admin.query("update ticket_links set deleted_at = now() where id = $1", [removed]);
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    expect((await listOk(w.boss, a.id)).map((l) => l.other.number)).toEqual([keep.number]);
    await f.admin.query("update tickets set deleted_at = null where id = $1", [gone.id]);
    expect((await listOk(w.boss, a.id)).map((l) => l.other.number).sort()).toEqual([gone.number, keep.number].sort());
  });

  it("K441-API-004 一覧：見えないチケット・別の会社・消したチケット・無い uuid は入口の 404（NOT_FOUND・欄なし）", async () => {
    const w = await world();
    const other = await world();
    const hiddenTicket = await mk(w, w.g2);
    const deleted = await mk(w, w.g1);
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [deleted.id]);
    const foreign = await mk(other, other.g1);
    const results: Response[] = [
      await list(w.e1, hiddenTicket.id),
      await list(w.boss, foreign.id),
      await list(w.boss, deleted.id),
      await list(w.boss, NO_SUCH),
    ];
    for (const r of results) {
      expect(r.status).toBe(404);
      {
        const b = await asJson(r);
        expect(b["code"]).toBe("NOT_FOUND");
        bare(b);
      }
    }
  });

  it("K441-API-005 足す：関連 → 201・DB の行 1・証跡 1・相手側の一覧にも出る・やり取りと受け箱は増えない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const msgs0 = (
      await f.admin.query("select count(*)::int as n from ticket_messages where tenant_id = $1", [w.tenantId])
    ).rows[0].n;
    const note0 = (
      await f.admin.query("select count(*)::int as n from notifications where tenant_id = $1", [w.tenantId])
    ).rows[0].n;
    const r = await add(w.boss, a.id, { other_ticket_id: b.id, kind: "related" });
    expect(r.status, await r.clone().text()).toBe(201);
    const l = (await asJson(r))["data"] as Link;
    expect(sorted(l)).toEqual(["can_remove", "created_at", "id", "kind", "other", "side"]);
    expect(l).toMatchObject({ kind: "related", side: null, can_remove: true });
    expect(l.other).toMatchObject({ id: b.id, number: b.number, visible: true });
    const got = await rows(a.id, b.id);
    expect(got.length).toBe(1);
    expect(got[0]).toMatchObject({
      id: l.id,
      from_ticket_id: a.id,
      to_ticket_id: b.id,
      kind: "related",
      tenant_id: w.tenantId,
    });
    const au = await audits("ticket_link.create", w.tenantId);
    expect(au.length).toBe(1);
    expect(au[0]!["target_id"]).toBe(l.id);
    expect(sorted(au[0]!["payload"] as object)).toEqual(["kind", "ticket_id", "other_ticket_id"].sort());
    expect((await listOk(w.boss, b.id)).map((x) => [x.id, x.side, x.other.id])).toEqual([[l.id, null, a.id]]);
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_messages where tenant_id = $1", [w.tenantId])).rows[0]
        .n,
    ).toBe(msgs0);
    expect(
      (await f.admin.query("select count(*)::int as n from notifications where tenant_id = $1", [w.tenantId])).rows[0]
        .n,
    ).toBe(note0);
  });

  it("K441-API-006 足す：派生元 → :id 側は derived・相手側は source・DB は from＝:id・to＝相手", async () => {
    const w = await world();
    const copy = await mk(w, w.g1, "複製した側");
    const origin = await mk(w, w.g1, "元の側");
    const l = await addOk(w.boss, copy.id, origin.id, "derived_from");
    expect(l).toMatchObject({ kind: "derived_from", side: "derived" });
    const got = await rows(copy.id, origin.id);
    expect(got[0]).toMatchObject({ from_ticket_id: copy.id, to_ticket_id: origin.id, kind: "derived_from" });
    expect((await listOk(w.boss, copy.id)).map((x) => x.side)).toEqual(["derived"]);
    expect((await listOk(w.boss, origin.id)).map((x) => [x.side, x.other.id])).toEqual([["source", copy.id]]);
  });

  it("K441-API-007 足す：もうつながっている（関連の同じ向き・逆向き・派生元の同じ向き）→ 409・E-LNK-002・行は増えない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const c = await mk(w, w.g1);
    await link(w, a.id, b.id, "related");
    await link(w, a.id, c.id, "derived_from");
    const cases: [string, string, "related" | "derived_from"][] = [
      [a.id, b.id, "related"],
      [b.id, a.id, "related"],
      [a.id, c.id, "derived_from"],
    ];
    for (const [id, other, kind] of cases) {
      const r = await add(w.boss, id, { other_ticket_id: other, kind });
      expect(r.status, `${kind}`).toBe(409);
      {
        const b = await asJson(r);
        expect(b["code"]).toBe("E-LNK-002");
        bare(b);
      }
    }
    expect((await rows(a.id, b.id)).length).toBe(1);
    expect((await rows(a.id, c.id)).length).toBe(1);
  });

  it("K441-API-008 足す：外した後に同じ組へ（関連は逆向きでも）→ 201・同じ行が生き返る・id は前のまま", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const first = await addOk(w.boss, a.id, b.id, "related");
    expect((await rm(w.boss, first.id)).status).toBe(200);
    expect((await live(a.id, b.id)).length).toBe(0);
    const again = await addOk(w.boss, b.id, a.id, "related");
    expect(again.id).toBe(first.id);
    const got = await rows(a.id, b.id);
    expect(got.length).toBe(1);
    expect(got[0]!["deleted_at"]).toBeNull();
    expect(got[0]).toMatchObject({ from_ticket_id: b.id, to_ticket_id: a.id });
    expect((await listOk(w.boss, a.id)).length).toBe(1);
  });

  it("K441-API-009 足す：自分自身 → 409・E-LNK-001・行は増えない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    for (const kind of ["related", "derived_from"] as const) {
      const r = await add(w.boss, a.id, { other_ticket_id: a.id, kind });
      expect(r.status).toBe(409);
      {
        const b = await asJson(r);
        expect(b["code"]).toBe("E-LNK-001");
        bare(b);
      }
    }
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(0);
  });

  it("K441-API-010 足す：足す側（:id）が無い・消した・別の会社・見えない→入口の 404（NOT_FOUND）／相手が無い・消した・別の会社・自分に見えない→口の 404（E-PAGE-001）・どちらも欄なし", async () => {
    const w = await world();
    const other = await world();
    const a = await mk(w, w.g1);
    const deleted = await mk(w, w.g1);
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [deleted.id]);
    const foreign = await mk(other, other.g1);
    const hidden = await mk(w, w.g2);
    // 足す側（道の :id）：入口の行の確かめが止める（見えない・無い・消した・別の会社は同じ答え）
    for (const side of [NO_SUCH, deleted.id, foreign.id, hidden.id]) {
      const r = await add(w.e1, side, { other_ticket_id: a.id, kind: "related" });
      const j = await asJson(r);
      expect(r.status, side).toBe(404);
      expect(j["code"], side).toBe("NOT_FOUND");
      bare(j);
    }
    for (const target of [NO_SUCH, deleted.id, foreign.id, hidden.id]) {
      const r = await add(w.e1, a.id, { other_ticket_id: target, kind: "related" });
      const j = await asJson(r);
      expect(r.status, target).toBe(404);
      expect(j["code"]).toBe("E-PAGE-001");
      bare(j);
    }
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(0);
  });

  it("K441-API-011 足す：:id に書けない人→入口の 403（欄なし）・相手に書けない人→403（欄 other_ticket_id）・行は増えない", async () => {
    const w = await world();
    const mine = await mk(w, w.g1);
    const sameGroup = await mk(w, w.g1);
    const r1 = await add(w.viewer, mine.id, { other_ticket_id: sameGroup.id, kind: "related" });
    expect(r1.status).toBe(403);
    bare(await asJson(r1));
    // 相手は見えるが書けない：営業の人（g1 に書ける）に、別グループ「閲覧グループ」を読むだけ（view）で見せ、そこのチケットを相手にする
    const viewerOnlyScope = await f.admin
      .query<{ id: string }>(
        "insert into scopes (tenant_id, name, ticket_prefix, parent_id) values ($1, '閲覧グループ', 'LV', $2) returning id",
        [w.tenantId, w.root],
      )
      .then((x) => x.rows[0]!.id);
    await f.admin.query(
      "insert into permissions (tenant_id, grantee_member_id, target_kind_id, scope_id, ability_id) values ($1, $2, 'tickets', $3, 'view')",
      [w.tenantId, w.e1.id, viewerOnlyScope],
    );
    const readOnlyTicket = await mk(w, viewerOnlyScope);
    const r2 = await add(w.e1, mine.id, { other_ticket_id: readOnlyTicket.id, kind: "related" });
    expect(r2.status, await r2.clone().text()).toBe(403);
    expect(JSON.stringify(await asJson(r2))).toContain("other_ticket_id");
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(0);
  });

  it("K441-API-012 足す：派生元の輪（B←A のとき A←B／C←B←A の鎖で A←C）→ 409・E-LNK-003・行は増えない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const c = await mk(w, w.g1);
    await link(w, b.id, a.id, "derived_from"); // B の派生元は A
    const r1 = await add(w.boss, a.id, { other_ticket_id: b.id, kind: "derived_from" });
    expect(r1.status).toBe(409);
    {
      const b = await asJson(r1);
      expect(b["code"]).toBe("E-LNK-003");
      bare(b);
    }
    await link(w, c.id, b.id, "derived_from"); // C の派生元は B（C←B←A）
    const r2 = await add(w.boss, a.id, { other_ticket_id: c.id, kind: "derived_from" });
    expect(r2.status).toBe(409);
    {
      const b = await asJson(r2);
      expect(b["code"]).toBe("E-LNK-003");
      bare(b);
    }
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(2);
    // 関連は輪にならない：同じ組を関連で足すのは通る（別の kind）
    expect((await add(w.boss, a.id, { other_ticket_id: b.id, kind: "related" })).status).toBe(201);
  });

  it("K441-API-013 足す：kind が知らない値・欠け・other_ticket_id が uuid でない・欠け・知らない欄・NUL → 422・行は増えない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const bad: [unknown, string][] = [
      [{ other_ticket_id: b.id, kind: "parent" }, "kind"],
      [{ other_ticket_id: b.id }, "kind"],
      [{ other_ticket_id: "not-a-uuid", kind: "related" }, "other_ticket_id"],
      [{ kind: "related" }, "other_ticket_id"],
      [{ other_ticket_id: b.id, kind: "related", from_ticket_id: a.id }, "from_ticket_id"],
      [{ other_ticket_id: b.id, kind: "rel\u0000ated" }, "kind"],
    ];
    for (const [body, field] of bad) {
      const r = await add(w.boss, a.id, body);
      const j = await asJson(r);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(JSON.stringify(j)).toContain(field);
    }
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(0);
  });

  it("K441-API-014 足す：同じ組を同時に 2 本／関連を A→B と B→A で同時に → 201 と 409 が 1 つずつ・行は 1 つ・証跡も 1 行", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const same = await Promise.all([
      add(w.boss, a.id, { other_ticket_id: b.id, kind: "derived_from" }),
      add(w.boss, a.id, { other_ticket_id: b.id, kind: "derived_from" }),
    ]);
    expect(same.map((r) => r.status).sort()).toEqual([201, 409]);
    const c = await mk(w, w.g1);
    const d = await mk(w, w.g1);
    const both = await Promise.all([
      add(w.boss, c.id, { other_ticket_id: d.id, kind: "related" }),
      add(w.boss, d.id, { other_ticket_id: c.id, kind: "related" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = both.find((r) => r.status === 409)!;
    {
      const b = await asJson(lost);
      expect(b["code"]).toBe("E-LNK-002");
      bare(b);
    }
    expect((await live(a.id, b.id)).length).toBe(1);
    expect((await live(c.id, d.id)).length).toBe(1);
    expect((await audits("ticket_link.create", w.tenantId)).length).toBe(2);
  });

  it("K441-API-015 外す：両方に書ける人 → 200 {id}・行は deleted_at つきで残る・両方の一覧から消える・証跡 1 行", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const l = await addOk(w.boss, a.id, b.id, "related");
    const r = await rm(w.boss, l.id);
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await asJson(r))["data"]).toEqual({ id: l.id });
    const got = await rows(a.id, b.id);
    expect(got.length).toBe(1);
    expect(got[0]!["deleted_at"]).not.toBeNull();
    expect(await listOk(w.boss, a.id)).toEqual([]);
    expect(await listOk(w.boss, b.id)).toEqual([]);
    const au = await audits("ticket_link.delete", w.tenantId);
    expect(au.length).toBe(1);
    expect(au[0]!["target_id"]).toBe(l.id);
  });

  it("K441-API-016 外す：片方にしか書けない人（相手は別グループで見えない）→ 200・行は消える", async () => {
    const w = await world();
    const mine = await mk(w, w.g1);
    const theirs = await mk(w, w.g2);
    const id = await link(w, mine.id, theirs.id, "related");
    const r = await rm(w.e1, id);
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await live(mine.id, theirs.id)).length).toBe(0);
  });

  it("K441-API-017 外す：両端に書けないが見える人→403／どちらも見えない人→404／別の会社→404・行は変わらない", async () => {
    const w = await world();
    const other = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const id = await link(w, a.id, b.id, "related");
    const r403 = await rm(w.viewer, id);
    expect(r403.status).toBe(403);
    const r404 = await rm(w.e2, id); // 開発グループの人には g1 の 2 枚とも見えない
    expect(r404.status).toBe(404);
    {
      const b = await asJson(r404);
      expect(b["code"]).toBe("E-PAGE-001");
      bare(b);
    }
    const rOther = await rm(other.boss, id);
    expect(rOther.status).toBe(404);
    {
      const b = await asJson(rOther);
      expect(b["code"]).toBe("E-PAGE-001");
      bare(b);
    }
    expect((await live(a.id, b.id)).length).toBe(1);
    expect((await audits("ticket_link.delete", w.tenantId)).length).toBe(0);
  });

  it("K441-API-018 外す：外した行をもう一度・無い uuid → 404・E-PAGE-001", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const l = await addOk(w.boss, a.id, b.id, "related");
    expect((await rm(w.boss, l.id)).status).toBe(200);
    for (const id of [l.id, NO_SUCH]) {
      const r = await rm(w.boss, id);
      expect(r.status).toBe(404);
      {
        const b = await asJson(r);
        expect(b["code"]).toBe("E-PAGE-001");
        bare(b);
      }
    }
  });

  it("K441-API-019 失敗（手順 S1）：足すときに証跡を書く所で DB が落ちる → 503・E-PAGE-003・行も証跡も残らない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    await failingAudit(w.tenantId, "ticket_link.create", async () => {
      const r = await add(w.boss, a.id, { other_ticket_id: b.id, kind: "related" });
      const text = await r.text();
      expect(r.status).toBe(503);
      expect(JSON.parse(text).code).toBe("E-PAGE-003");
      expect(text).not.toContain("わざと落とした");
    });
    expect((await rows(a.id, b.id)).length).toBe(0);
    expect((await audits("ticket_link.create", w.tenantId)).length).toBe(0);
    // 落とす仕掛けを外せば、同じ要求が通る
    expect((await add(w.boss, a.id, { other_ticket_id: b.id, kind: "related" })).status).toBe(201);
  });

  it("K441-API-020 失敗（手順 S2）：外すときに証跡を書く所で DB が落ちる → 503・E-PAGE-003・行は生きたまま・証跡も増えない", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const l = await addOk(w.boss, a.id, b.id, "related");
    await failingAudit(w.tenantId, "ticket_link.delete", async () => {
      const r = await rm(w.boss, l.id);
      expect(r.status).toBe(503);
      expect((await asJson(r))["code"]).toBe("E-PAGE-003");
    });
    expect((await live(a.id, b.id)).length).toBe(1);
    expect((await audits("ticket_link.delete", w.tenantId)).length).toBe(0);
  });

  it("K441-API-021 一覧：つながりが 201 本のチケット → 200 件（上限）・派生元が先・201 本目は出ない", async () => {
    const w = await world();
    const a = await mk(w, w.g1, "たくさんつながる");
    await f.admin.query(
      `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, due_on)
       select $1, $2, 'pending', (select id from ticket_kinds where tenant_id = $1 and name = 'タスク'),
              (select id from ticket_stages where tenant_id = $1 and key = 'todo'), '相手 ' || g, current_date + 7
         from generate_series(1, 201) g`,
      [w.tenantId, w.g1],
    );
    await f.admin.query(
      `insert into ticket_links (tenant_id, from_ticket_id, to_ticket_id, kind, created_at)
       select $1, $2, t.id, case when t.title = '相手 201' then 'derived_from' else 'related' end, now() + (row_number() over (order by t.title)) * interval '1 second'
         from tickets t where t.tenant_id = $1 and t.title like '相手 %'`,
      [w.tenantId, a.id],
    );
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where from_ticket_id = $1", [a.id])).rows[0].n,
    ).toBe(201);
    const data = await listOk(w.boss, a.id);
    expect(data.length).toBe(200);
    expect(data[0]!.kind).toBe("derived_from");
    expect(data.slice(1).every((l) => l.kind === "related")).toBe(true);
    const times = data.slice(1).map((l) => Date.parse(l.created_at));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  }, 60_000);

  it("K441-API-022 3 本をログインなしで叩く → どれも 401", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    const l = await link(w, a.id, b.id, "related");
    expect((await f.req("GET", `/tickets/${a.id}/links`)).status).toBe(401);
    expect(
      (await f.req("POST", `/tickets/${a.id}/links`, { body: { other_ticket_id: b.id, kind: "related" } })).status,
    ).toBe(401);
    expect((await f.req("DELETE", `/ticket_links/${l}`)).status).toBe(401);
    expect((await live(a.id, b.id)).length).toBe(1);
  });

  it("K441-API-023 3 本それぞれ、1 分の上限を超えて叩く → 429・retry_after_sec は 1〜60 の整数・行は上限の分だけ", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const others = [await mk(w, w.g1), await mk(w, w.g1), await mk(w, w.g1)];
    const ops: Record<string, () => Promise<Response>> = {
      listTicketLinks: () => f.req("GET", `/tickets/${a.id}/links`, { headers: w.boss.auth, ip: "198.51.100.41" }),
      createTicketLink: () =>
        f.req("POST", `/tickets/${a.id}/links`, {
          headers: w.boss.auth,
          ip: "198.51.100.42",
          body: { other_ticket_id: others.shift()?.id ?? NO_SUCH, kind: "related" },
        }),
      deleteTicketLink: () =>
        f.req("DELETE", `/ticket_links/${NO_SUCH}`, { headers: w.boss.auth, ip: "198.51.100.43" }),
    };
    const saved: Record<string, number | undefined> = {};
    try {
      for (const op of Object.keys(ops)) {
        saved[op] = f.limits[op];
        f.limits[op] = 2;
        await ops[op]!();
        await ops[op]!();
        const third = await ops[op]!();
        expect(third.status, op).toBe(429);
        const sec = ((await asJson(third))["retry_after_sec"] ?? 0) as number;
        expect(Number.isInteger(sec) && sec >= 1 && sec <= 60, op).toBe(true);
      }
    } finally {
      for (const op of Object.keys(saved)) {
        if (saved[op] === undefined) delete f.limits[op];
        else f.limits[op] = saved[op]!;
      }
    }
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where from_ticket_id = $1", [a.id])).rows[0].n,
    ).toBe(2);
  });

  it("K441-API-024 複製の呼び先 app.ticket_link_derive：元が見える・まだつながっていない → {ok, id, created: true}・派生元の行", async () => {
    const w = await world();
    const origin = await mk(w, w.g1);
    const copy = await mk(w, w.g1);
    const v = await derive(w, w.boss, copy.id, origin.id);
    expect(v).toMatchObject({ ok: true, created: true });
    expect(String(v["id"])).toMatch(UUID);
    const got = await rows(copy.id, origin.id);
    expect(got.length).toBe(1);
    expect(got[0]).toMatchObject({
      id: v["id"],
      from_ticket_id: copy.id,
      to_ticket_id: origin.id,
      kind: "derived_from",
    });
    expect((await audits("ticket_link.create", w.tenantId)).length).toBe(0);
  });

  it("K441-API-025 app.ticket_link_derive を同じ組で 2 回／外した行がある → 2 回目は {error: duplicate}・外した行がある組は {ok, created: false} で同じ id（行が生き返る）・行は増えない", async () => {
    const w = await world();
    const origin = await mk(w, w.g1);
    const copy = await mk(w, w.g1);
    const first = await derive(w, w.boss, copy.id, origin.id);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(await derive(w, w.boss, copy.id, origin.id)).toMatchObject({ error: "duplicate" });
    expect((await rows(copy.id, origin.id)).length).toBe(1);
    await f.admin.query("update ticket_links set deleted_at = now() where id = $1", [first["id"]]);
    const third = await derive(w, w.boss, copy.id, origin.id);
    expect(third).toMatchObject({ ok: true, created: false, id: first["id"] });
    const got = await rows(copy.id, origin.id);
    expect(got.length).toBe(1);
    expect(got[0]!["deleted_at"]).toBeNull();
  });

  it("K441-API-026 app.ticket_link_derive が断る：自分自身・別の会社の元・見えない元・消した元・輪になる元 → error と行は増えない", async () => {
    const w = await world();
    const other = await world();
    const copy = await mk(w, w.g1);
    const foreign = await mk(other, other.g1);
    const hidden = await mk(w, w.g2);
    const deleted = await mk(w, w.g1);
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [deleted.id]);
    expect(await derive(w, w.boss, copy.id, copy.id)).toMatchObject({ error: "same" });
    expect(await derive(w, w.boss, copy.id, foreign.id)).toMatchObject({ error: "gone" });
    expect(await derive(w, w.e1, copy.id, hidden.id)).toMatchObject({ error: "gone" });
    expect(await derive(w, w.boss, copy.id, deleted.id)).toMatchObject({ error: "gone" });
    const origin = await mk(w, w.g1);
    await link(w, origin.id, copy.id, "derived_from"); // origin の派生元が copy
    expect(await derive(w, w.boss, copy.id, origin.id)).toMatchObject({ error: "cycle" });
    expect(
      (await f.admin.query("select count(*)::int as n from ticket_links where tenant_id = $1", [w.tenantId])).rows[0].n,
    ).toBe(1);
  });

  it("K441-API-027 一覧の can_remove：書ける人は true・読むだけの人（相手も見える）は false", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    await link(w, a.id, b.id, "related");
    expect((await listOk(w.e1, a.id)).map((l) => l.can_remove)).toEqual([true]);
    expect((await listOk(w.viewer, a.id)).map((l) => l.can_remove)).toEqual([false]);
  });

  it("K441-API-028 失敗（手順 S3・読む）：一覧を読むときに DB へつなげない → 503・E-PAGE-003・例外の文が出ない／つなげる状態に戻せば 200", async () => {
    const w = await world();
    const a = await mk(w, w.g1);
    const b = await mk(w, w.g1);
    await link(w, a.id, b.id, "related");
    const m = (await import(join(HOOKS_DIR, "ticket-links.ts"))) as { register: HookModule };
    // つなげない接続の入れ物で作った hooks に差し替える（読む手順は書かないので、引き金は使えない）
    const broken = {
      connect: async () => {
        throw new Error("K-441 の試験でわざとつなげない");
      },
    } as unknown as pg.Pool;
    const saved = f.hooks["listTicketLinks"]!;
    f.hooks["listTicketLinks"] = m.register.make({ appPool: broken } as unknown as HookDeps)["listTicketLinks"]!;
    try {
      const r = await list(w.boss, a.id);
      const text = await r.text();
      expect(r.status).toBe(503);
      expect(JSON.parse(text).code).toBe("E-PAGE-003");
      expect(text).not.toContain("わざとつなげない");
    } finally {
      f.hooks["listTicketLinks"] = saved;
    }
    expect((await listOk(w.boss, a.id)).length).toBe(1);
    expect((await live(a.id, b.id)).length).toBe(1);
  });

  it("K441-API-029 一覧の子（meta.children）：見える子 2・見えない子 1・消した子 1・別のチケットの子 1 → 見える 2 つだけ（作った順）・親の行は入らない・子が無いチケットは []", async () => {
    const w = await world();
    const grand = await mk(w, w.g1, "親の親");
    const a = await mk(w, w.g1, "中心のチケット", grand.id);
    const c1 = await mk(w, w.g1, "見える子 1", a.id);
    const c2 = await mk(w, w.g1, "見える子 2", a.id);
    const hidden = await mk(w, w.g2, "秘密の子ナイショ", a.id);
    const gone = await mk(w, w.g1, "消した子ナイショ", a.id);
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    const stranger = await mk(w, w.g1, "別のチケットの子ナイショ", grand.id);
    const r = await list(w.e1, a.id);
    const text = await r.text();
    expect(r.status, text).toBe(200);
    for (const ng of [
      "秘密の子ナイショ",
      "消した子ナイショ",
      "別のチケットの子ナイショ",
      hidden.number,
      gone.number,
      stranger.number,
      "親の親",
    ])
      expect(text, ng).not.toContain(ng);
    const j = JSON.parse(text) as { data: Link[]; meta: { limit: number; children: Json[] } };
    expect(j.meta.children.map((c) => c["id"])).toEqual([c1.id, c2.id]);
    for (const c of j.meta.children) {
      expect(sorted(c)).toEqual(["id", "number", "scope", "stage", "title"]);
      expect(sorted(c["stage"] as object)).toEqual(["id", "key", "name"]);
      expect(sorted(c["scope"] as object)).toEqual(["id", "name"]);
    }
    expect(j.meta.children[0]).toMatchObject({ number: c1.number, title: "見える子 1" });
    expect(j.meta.children[0]!["scope"]).toMatchObject({ id: w.g1 });
    expect(j.data).toEqual([]);
    const lonely = await mk(w, w.g1, "子の無いチケット");
    expect((await asJson(await list(w.boss, lonely.id)))["meta"]).toEqual({ limit: 200, children: [] });
  });

  it("K441-API-030 一覧の子：子が 201 つあるチケット → meta.children は 200 件（上限）・作った順・201 つ目は出ない・DB の行は変わらない", async () => {
    const w = await world();
    const a = await mk(w, w.g1, "たくさんの子の親");
    await f.admin.query(
      `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, due_on, parent_ticket_id, created_at)
       select $1, $2, 'pending', (select id from ticket_kinds where tenant_id = $1 and name = 'タスク'),
              (select id from ticket_stages where tenant_id = $1 and key = 'todo'), '子 ' || lpad(g::text, 3, '0'), current_date + 7, $3,
              now() + g * interval '1 second'
         from generate_series(1, 201) g`,
      [w.tenantId, w.g1, a.id],
    );
    const j = (await asJson(await list(w.boss, a.id)))["meta"] as { children: { title: string }[] };
    expect(j.children.length).toBe(200);
    expect(j.children[0]!.title).toBe("子 001");
    expect(j.children[199]!.title).toBe("子 200");
    expect(
      (await f.admin.query("select count(*)::int as n from tickets where parent_ticket_id = $1", [a.id])).rows[0].n,
    ).toBe(201);
  }, 60_000);
});
