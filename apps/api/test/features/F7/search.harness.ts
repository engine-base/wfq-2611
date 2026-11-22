// 段 8「探す」の口（K-468 口の置き場とチケット・K-469 自分の会話・K-470 決定とナレッジ）の試験の共通の土台。
//   行（it）は葉ごとのファイル search-tickets.test.ts（K-468）・search-conversations.test.ts（K-469）・search-decisions.test.ts（K-470）にある。
//   土台は各ファイルの頭で setupSearch() を 1 回呼ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 組み立ては K-60・K-92 の土台（apps/api/test/features/fixture.ts）と同じ：本物の Postgres（migration を全部当てる）・本物の口の入口（createApp と契約の op）・
//   チケットを作る口（ticketHooks）・探す口（hooks のファイル apps/api/src/hooks/search.ts の register・K-326）。画面のログインだけは偽（Bearer に会社・人・役を書く）。
//   探す口の読み込みは、試験の本体（it の中）の最初の要求で 1 回だけする（leafHooks）。実装の前（切る段の smoke）に、まだ無いファイルを
//   準備（beforeAll）で読んで準備ごと落とさないため（準備の赤と本体の赤を分ける・answer=8f745003d023）。
//
// 試験が決める振る舞いの差し込み口（実装が守る名前）:
//   apps/api/src/hooks/search.ts：export function searchHooks(d: Pick<HookDeps, "appPool">): Record<string, Hook>（キーは search）と
//     export const register = defineHooks({ name: "searchHooks", make: (d) => searchHooks(d), fuzz: "same" })
//   apps/api/src/features/F7/search/kinds.ts：export const KINDS（["ticket", "decision", "conversation", "knowledge"] の順）・
//     export const SEARCHERS: Record<Kind, Searcher>（種類ごとの探し方の置き場。試験が 1 つの種類を例外に差し替えて 503 を確かめる）
import { expect } from "vitest";
import { ticketHooks } from "../../../src/hooks/tickets.js";
import { leafHooks } from "../F3/leaf-hooks.js";
import { makeFixture, type Fixture, type Person } from "../fixture.js";

export type { Fixture, Person } from "../fixture.js";

/** 探すの 1 件（契約の SearchHit・鍵は 5 つ） */
export interface Hit {
  kind: string;
  id: string;
  title: string;
  snippet: string;
  url: string;
}
export interface World {
  tenantId: string;
  root: string;
  me: Person;
  mate: Person;
  task: { id: string; sections: { key: string; mode: string }[] };
}
export interface SearchKit {
  f: Fixture;
  /** 探す口を土台に足す（最初の要求の前に 1 回・要求のたびに呼んでよい） */
  ready: () => Promise<void>;
}

export async function setupSearch(): Promise<SearchKit> {
  const f = await makeFixture([ticketHooks]);
  f.limits["createTicket"] = 10_000;
  f.limits["search"] = 10_000; // 1 分 120 回の上限は 429 の行だけで確かめる
  const ready = leafHooks(f, ["search"]);
  return { f, ready };
}

const asJson = async (r: Response) => (await r.json()) as Record<string, unknown>;

/** 会社を 1 つ作り、チケットを書ける人を 2 人（高本・山田）置く。prefix は番号の頭 */
export async function makeWorld(f: Fixture, prefix = "EG"): Promise<World> {
  const c = await f.company(`探す試験の会社 ${Math.random().toString(36).slice(2, 7)}`, prefix);
  const me = await f.person(c.tenantId, c.rootScope, { name: "高本", ticketAbility: "edit" });
  const mate = await f.person(c.tenantId, c.rootScope, { name: "山田", ticketAbility: "edit" });
  const kinds = (await asJson(await f.req("GET", "/ticket_kinds", { headers: me.auth })))["data"] as {
    id: string;
    name: string;
    sections: { key: string; mode: string }[];
  }[];
  return { tenantId: c.tenantId, root: c.rootScope, me, mate, task: kinds.find((k) => k.name === "タスク")! };
}

/** 作る口でチケットを 1 件作る（題名・担当者・グループは選べる）。返すのは id と番号 */
export async function makeTicket(
  f: Fixture,
  w: World,
  o: { title?: string; by?: Person; assignee?: Person; scope?: string } = {},
): Promise<{ id: string; number: string; title: string }> {
  const by = o.by ?? w.me;
  const title = o.title ?? "請求書を送る";
  const sections = Object.fromEntries(
    w.task.sections.filter((s) => s.mode === "required").map((s) => [s.key, "書いた"]),
  );
  const jst = new Date(Date.now() + 9 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 10);
  const r = await f.req("POST", "/tickets", {
    body: {
      scope_id: o.scope ?? w.root,
      kind_id: w.task.id,
      title,
      assignee_member_id: (o.assignee ?? w.me).id,
      due_on: jst,
      sections,
    },
    headers: by.auth,
  });
  expect(r.status, await r.clone().text()).toBe(201);
  const d = (await asJson(r))["data"] as { id: string; number: string };
  return { id: d.id, number: d.number, title };
}

/** 管理の接続で列を直す（更新の時刻・消した・下書き など）。updated_at には引き金（app.set_updated_at）があるので、
 *  引き金を止めた 1 つのトランザクションで書き、書いた updated_at が本当に入ったことを読み直して確かめる */
export async function setRow(f: Fixture, table: string, id: string, cols: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(cols);
  const c = await f.admin.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    await c.query(`update ${table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [
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
    const got = (await f.admin.query<{ u: Date }>(`select updated_at as u from ${table} where id = $1`, [id])).rows[0]!
      .u;
    expect(got.toISOString(), "書いた updated_at が入っていない").toBe(
      new Date(String(cols["updated_at"])).toISOString(),
    );
  }
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

/** 探す口を叩く。query は `q=...&kinds=...` の形（q は encodeURIComponent で渡す） */
export const search = (f: Fixture, who: Person, query = "", headers: Record<string, string> = {}) =>
  f.req("GET", `/search${query ? `?${query}` : ""}`, { headers: { ...who.auth, ...headers } });
export const qs = (q: string, extra = "") => `q=${encodeURIComponent(q)}${extra ? `&${extra}` : ""}`;
/** 200 の答えの data（1 件の鍵と並びを返す） */
export async function searchOk(f: Fixture, who: Person, query = ""): Promise<Hit[]> {
  const r = await search(f, who, query);
  expect(r.status, await r.clone().text()).toBe(200);
  return ((await r.json()) as { data: Hit[] }).data;
}
export const ids = (h: Hit[]) => h.map((x) => x.id);
export const kindsOf = (h: Hit[]) => h.map((x) => x.kind);

/** 全角にそろえる（! から ~ までの半角を全角に） */
export const wide = (s: string) => s.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
