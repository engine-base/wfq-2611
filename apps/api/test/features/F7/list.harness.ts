// 段 8「一覧の絞り込みと数」の口（K-472 受け皿と人・段・種別・完了／K-473 期限・開始日・期限切れ・炎・親・並び・見せる欄／K-474 一覧の上の数の札）の試験の共通の土台。
//   行（it）は葉ごとのファイル list-filters.test.ts（K-472）・list-ranges.test.ts（K-473）・list-counts.test.ts（K-474）にある。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 組み立ては K-92 の試験（apps/api/test/features/F4/ticket-list.test.ts）と同じ：本物の Postgres（migration を全部当てる）・本物の口の入口（createApp と契約の op）・
//   チケットを作る口と一覧の口（ticketHooks）。画面のログインだけは偽（Bearer に会社・人・役を書く）。チケットは作る口（K-60）で作り、並びの値は管理の接続で直す。
//   口の振る舞いは ticketHooks（listTickets は apps/api/src/features/F4/ticket-list/ が作る・K-472〜K-474 が直す）で、新しい hooks のファイルは足さない。
import { expect } from "vitest";
import { ticketHooks } from "../../../src/hooks/tickets.js";
import { makeFixture, type Fixture, type Person } from "../fixture.js";

export type { Fixture, Person } from "../fixture.js";

/** 一覧の 1 件（K-92 の 12 の鍵。見せる欄 fields を付けたときは足した鍵も入る） */
export interface Item {
  id: string;
  number: string;
  title: string;
  kind: { id: string; name: string };
  stage: { id: string; name: string; key: string };
  assignee: { id: string; display_name: string } | null;
  delegated_to_clone: boolean;
  due_on: string | null;
  overdue: boolean;
  updated_at: string;
  parent_ticket_id: string | null;
  depth: number;
  [extra: string]: unknown;
}
export interface Counts {
  overdue: number;
  today: number;
  assigned: number;
  ai: number;
  approve: number;
}
export interface Page {
  data: Item[];
  meta: { next_cursor: string | null; counts?: Counts };
}
export interface World {
  tenantId: string;
  root: string;
  me: Person;
  mate: Person;
  task: { id: string; sections: { key: string; mode: string }[] };
  kinds: { id: string; name: string }[];
}

export async function setupList(): Promise<Fixture> {
  const f = await makeFixture([ticketHooks]);
  f.limits["createTicket"] = 10_000;
  f.limits["listTickets"] = 10_000; // 1 分 120 回の上限は K-92 の試験だけで確かめる
  return f;
}

const asJson = async (r: Response) => (await r.json()) as Record<string, unknown>;

/** 日本時間の日付（base は時刻 ms）。days 日ずらす */
export const jst = (days = 0, base = Date.now()) =>
  new Date(base + 9 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);

/** 会社を 1 つ作り、チケットを書ける人を 2 人（高本・山田）置く。prefix は番号の頭 */
export async function makeWorld(f: Fixture, prefix = "EG"): Promise<World> {
  const c = await f.company(`一覧の試験の会社 ${Math.random().toString(36).slice(2, 7)}`, prefix);
  const me = await f.person(c.tenantId, c.rootScope, { name: "高本", ticketAbility: "edit" });
  const mate = await f.person(c.tenantId, c.rootScope, { name: "山田", ticketAbility: "edit" });
  const kinds = (await asJson(await f.req("GET", "/ticket_kinds", { headers: me.auth })))["data"] as {
    id: string;
    name: string;
    sections: { key: string; mode: string }[];
  }[];
  return {
    tenantId: c.tenantId,
    root: c.rootScope,
    me,
    mate,
    task: kinds.find((k) => k.name === "タスク")!,
    kinds: kinds.map((k) => ({ id: k.id, name: k.name })),
  };
}

/** 作る口でチケットを 1 件作る（担当者・グループ・親・期限は選べる）。返すのは id と番号 */
export async function make(
  f: Fixture,
  w: World,
  o: { title?: string; by?: Person; assignee?: Person; scope?: string; parent?: string; due?: string } = {},
): Promise<{ id: string; number: string }> {
  const by = o.by ?? w.me;
  const sections = Object.fromEntries(
    w.task.sections.filter((s) => s.mode === "required").map((s) => [s.key, "書いた"]),
  );
  const r = await f.req("POST", "/tickets", {
    body: {
      scope_id: o.scope ?? w.root,
      kind_id: w.task.id,
      title: o.title ?? "請求書を送る",
      assignee_member_id: (o.assignee ?? w.me).id,
      due_on: o.due ?? jst(3),
      sections,
      ...(o.parent ? { parent_ticket_id: o.parent } : {}),
    },
    headers: by.auth,
  });
  expect(r.status, await r.clone().text()).toBe(201);
  const d = (await asJson(r))["data"] as { id: string; number: string };
  return { id: d.id, number: d.number };
}

/** 管理の接続でチケットの列を直す（期限・更新・開始日・段・種別・取引先・任せた・消した など）。
 *  tickets には updated_at をいつも今の時刻にする引き金（app.set_updated_at）があるので、引き金を止めた 1 つのトランザクションで書き、
 *  書いた updated_at が本当に入ったことを読み直して確かめる */
export async function setCols(f: Fixture, id: string, cols: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(cols);
  const c = await f.admin.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    await c.query(`update tickets set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [
      id,
      ...keys.map((k) => cols[k]),
    ]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  if ("updated_at" in cols) {
    const got = (await f.admin.query<{ u: Date }>("select updated_at as u from tickets where id = $1", [id])).rows[0]!
      .u;
    expect(got.toISOString(), "書いた updated_at が入っていない").toBe(
      new Date(String(cols["updated_at"])).toISOString(),
    );
  }
}
export async function setStage(f: Fixture, id: string, key: string): Promise<string> {
  await f.admin.query(
    "update tickets t set stage_id = s.id from ticket_stages s where t.id = $1 and s.tenant_id = t.tenant_id and s.key = $2",
    [id, key],
  );
  return (await f.admin.query<{ s: string }>("select stage_id as s from tickets where id = $1", [id])).rows[0]!.s;
}

/** 根の下に置かないグループ（根の権限で下のグループまで見えると「グループの外」にならない）を 1 つ作る */
export async function outsideGroup(f: Fixture, w: World, name = "経理", prefix = "KR"): Promise<string> {
  return (
    await f.admin.query<{ id: string }>(
      "insert into scopes (tenant_id, name, ticket_prefix) values ($1, $2, $3) returning id",
      [w.tenantId, name, prefix],
    )
  ).rows[0]!.id;
}

/** 承認の行を 1 つ入れる（まだ決めていない）。承認する人はグループの外の人でもよい */
export async function addApproval(
  f: Fixture,
  w: World,
  ticketId: string,
  approver: Person,
  scopeId: string,
  requester = w.me,
): Promise<string> {
  return (
    await f.admin.query<{ id: string }>(
      "insert into approvals (tenant_id, scope_id, ticket_id, approver_member_id, requested_by) values ($1, $2, $3, $4, $5) returning id",
      [w.tenantId, scopeId, ticketId, approver.id, requester.id],
    )
  ).rows[0]!.id;
}

export const list = (f: Fixture, who: Person, q = "", headers: Record<string, string> = {}) =>
  f.req("GET", `/tickets${q ? `?${q}` : ""}`, { headers: { ...who.auth, ...headers } });
export async function listOk(f: Fixture, who: Person, q = ""): Promise<Page> {
  const r = await list(f, who, q);
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as Page;
}
export const ids = (p: Page) => p.data.map((x) => x.id);
/** 次の分を最後まで読んで、全部の id を並びのまま返す */
export async function readAll(f: Fixture, who: Person, q: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    const p: Page = await listOk(f, who, `${q}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...ids(p));
    cursor = p.meta.next_cursor;
    if (!cursor) return out;
  }
  throw new Error("次の分が終わらない");
}
/** 続きの鍵が形に合うのに今の状態では読めないときの答え（K-472・K-473）：409・E-LST-001・欄（field・details）なし */
export async function expectUnreadableCursor(r: Response, label: string): Promise<void> {
  expect(r.status, label).toBe(409);
  const body = (await r.json()) as { code?: string; field?: unknown; details?: unknown };
  expect(body.code, label).toBe("E-LST-001");
  expect(body.field, label).toBeUndefined();
  expect(body.details, label).toBeUndefined();
}
/** 422 の答えの欄の名前の並び（details の field） */
export async function fieldsOf(r: Response): Promise<string[]> {
  return (((await r.json()) as { details?: { field: string }[] }).details ?? []).map((d) => d.field);
}
