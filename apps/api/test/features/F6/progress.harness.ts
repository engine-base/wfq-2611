// 段 7「自分で進める」の口（K-387 段・実績・保留を変える updateTicket／K-388 開き直す／K-389 書き込みと一緒に段を変える）の試験の土台。
//   K-387 が carry: で運ぶ（K-388・K-389 は K-387 の後なので本線に在る）。行（it）の中身は葉ごとの試験のファイルにある。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 土台は apps/api/test/features/fixture.ts（本物の Postgres に migration を全部当てる・偽の画面のログイン）。
//   チケットを作る（K-60）の口 ticketHooks（getTicket）は前から在るので makeFixture に渡す。
//   この段の口（hooks のファイル）は、準備（beforeAll）では読まず、最初の要求の前に 1 回だけ読んで f.hooks に足す（下の useHooks）。
//   切る段の smoke（実装の前に本物の DB で流す）で、まだ無いファイルを準備で読んで準備ごと落とさないため（準備の赤と本体の赤を分ける・answer=8f745003d023）。
//   読み方は c/段4 の K-364 の leaf-hooks.ts と同じ考え（あちらが本線に入ったら、どちらか 1 つにまとめる）。
// チケット・段・実行の記録は DB に直に置く（まだ無い口を準備に使わない）。時刻は眠らずに now() からずらして置く。
import { afterAll, beforeAll } from "vitest";
import { withTenant, type TenantContext } from "@kaname/db/context";
import type pg from "pg";
import type { Hook } from "../../../src/contract/deps.js";
import { ticketHooks } from "../../../src/hooks/tickets.js";
import { makeFixture, type Fixture, type Person } from "../fixture.js";

// ---- 決めた文と言葉（11_tickets/K-387.md・K-388.md の表・errors.d/K-387.json）----
export const CONF_BUSY = "E-CONF-030"; // AI が動いている間と承認待ちの間は、状態を変えられません（㉒）
export const CONF_DONE = "E-CONF-032"; // 完了したチケットは、開き直してから状態を変える
export const CONF_STAGE = "E-CONF-034"; // この状態には、ここから変えられません（段の id で仕組みの段・完了の段を選んだ・409）
export const CONF_HOLD_NEED = "E-CONF-035"; // 段の id で保留の段を選んだのに理由か条件が無い（409）
export const CONF_HOLD_NOT = "E-CONF-036"; // 保留でないのに保留の理由か条件を書こうとした（409）
export const NOT_FOUND = "E-PAGE-001"; // 指した段が無い・別の会社の段・消した段（404）
export const HOLD_NOT_TEXT = "保留にしていないチケットには、保留の理由と再開の条件を書けません";
export const VAL_HOLD_REASON = "E-VAL-041"; // 保留の理由を書いてください（D-125.33・正のモック prog-hold-dialog の欄の下の文）
export const VAL_HOLD_RESUME = "E-VAL-047"; // 再開の条件を書いてください（同じ・欄ごとに番号を分けた）
export const HOLD_REASON_TEXT = "保留の理由を書いてください";
export const HOLD_RESUME_TEXT = "再開の条件を書いてください";
export const VAL_NOT_YET = "E-VAL-018"; // まだ使えない（ほかの欄は段 8 で作る・K-92 と同じやり方）
export const NOT_YET_FIELD = "この欄はまだ変えられません";
export const STAGE_KIND = "ticket.stage_changed"; // 担当者でない人が段を変えたときの受け箱の知らせ（⑦）

export let f: Fixture;
export let T: { tenantId: string; rootScope: string };
export let O: { tenantId: string; rootScope: string };
export let boss: Person; // 担当者（書ける）
export let writer: Person; // 同じグループの書ける人（担当者でない）
export let viewer: Person; // 見るだけの人
export let outsider: Person; // 別の会社の人

export type J = Record<string, unknown> & {
  data?: Record<string, unknown>;
  details?: { field: string; message: string }[];
};
export const json = async (r: Response) => (await r.clone().json()) as J;
export const one = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  (await f.admin.query(sql, p)).rows[0] as R;
export const num = async (sql: string, p: unknown[] = []) => Number((await one<{ n: string }>(sql, p)).n);
export const fields = (j: J) => (j.details ?? []).map((d) => d.field);
export const ctxOf = (p: Person): TenantContext => ({
  tenantId: p.tenantId,
  userId: p.id,
  role: "member",
  stepUpAt: null,
});
/** 行の守りの中（アプリの接続・その人の文脈）で 1 つの値を返す SQL を流す（口を通さない DB の 2 層目の確かめ） */
export const asMember = async <R>(p: Person, sql: string, args: unknown[] = []) =>
  withTenant(f.pool as pg.Pool, ctxOf(p), async (cl) => (await cl.query(sql, args)).rows[0] as R);

/** この段の口を読む。名前は hooks のファイルの名前（拡張子なし）。読むのは最初の要求の前に 1 回だけ */
const LOADERS: Record<string, () => Promise<Record<string, Hook>>> = {
  // K-387 が作る hooks のファイル（updateTicket）。ticketUpdateHooks(appPool) を出す
  "ticket-update": async () => {
    const m = (await import("../../../src/hooks/ticket-update.js")) as {
      ticketUpdateHooks: (p: pg.Pool) => Record<string, Hook>;
    };
    return m.ticketUpdateHooks(f.pool);
  },
};
export function useHooks(names: readonly string[], extra: Record<string, () => Promise<Record<string, Hook>>> = {}) {
  let loading: Promise<void> | null = null;
  const load = async () => {
    for (const n of names) {
      const make = extra[n] ?? LOADERS[n];
      if (!make) throw new Error(`試験の土台が知らない hooks のファイル：${n}`);
      Object.assign(f.hooks, await make());
    }
  };
  const base = f.req;
  f.req = async (method, path, o) => {
    await (loading ??= load());
    return base(method, path, o);
  };
}

/** 土台を立てる（各ファイルの頭で 1 回）。extra は葉が足す hooks のファイルの読み方（K-389 が K-385 の書き込みの口を足す） */
export function setupProgress(
  names: readonly string[] = ["ticket-update"],
  extra: Parameters<typeof useHooks>[1] = {},
) {
  beforeAll(async () => {
    f = await makeFixture([ticketHooks]);
    T = await f.company("K387 の会社", "PG");
    O = await f.company("K387 の別の会社", "PO");
    boss = await f.person(T.tenantId, T.rootScope, { name: "高本", ticketAbility: "edit" });
    writer = await f.person(T.tenantId, T.rootScope, { name: "佐藤", ticketAbility: "edit" });
    viewer = await f.person(T.tenantId, T.rootScope, { name: "見るだけの人", ticketAbility: "view" });
    outsider = await f.person(O.tenantId, O.rootScope, { name: "別の会社の人", ticketAbility: "edit" });
    f.limits["updateTicket"] = 10_000;
    f.limits["getTicket"] = 10_000;
    f.limits["completeTicket"] = 10_000;
    f.limits["createTicketMessage"] = 10_000;
    useHooks(names, extra);
  });
  afterAll(async () => {
    await f?.close();
  });
}

// ---- 種を置く ----
export const stageOf = async (tenant: string, key: string) =>
  (await one<{ id: string }>("select id from ticket_stages where tenant_id = $1 and key = $2", [tenant, key])).id;
export const stageKeyOf = async (ticketId: string) =>
  (
    await one<{ key: string | null }>(
      "select s.key from tickets t join ticket_stages s on s.id = t.stage_id where t.id = $1",
      [ticketId],
    )
  ).key;
/** 会社が足した段（鍵が空・D-128.95）。名前は呼ぶ側が決める */
export const customStage = async (tenant: string, name: string) =>
  (
    await one<{ id: string }>(
      "insert into ticket_stages (tenant_id, key, name, position) values ($1, null, $2, 25) returning id",
      [tenant, name],
    )
  ).id;
export interface Ticket {
  id: string;
  number: string;
  tenant: string;
}
export async function ticket(
  o: { tenant?: string; scope?: string; assignee?: Person | null; stage?: string; title?: string } = {},
): Promise<Ticket> {
  const tenant = o.tenant ?? T.tenantId;
  const kind = (
    await one<{ id: string }>(
      "select id from ticket_kinds where tenant_id = $1 and name = 'タスク' and deleted_at is null",
      [tenant],
    )
  ).id;
  const t = await one<{ id: string; number: string }>(
    `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, assignee_member_id, created_by)
     values ($1, $2, '', $3, $4, $5, $6, $7) returning id, number`,
    [
      tenant,
      o.scope ?? (tenant === T.tenantId ? T.rootScope : O.rootScope),
      kind,
      await stageOf(tenant, o.stage ?? "todo"),
      o.title ?? "見積書を作って送る",
      o.assignee === undefined ? boss.id : (o.assignee?.id ?? null),
      boss.id,
    ],
  );
  return { ...t, tenant };
}
/** 完了の形を DB に直に置く（完了の口 K-165 と同じ列：段 done・completed_at・completed_by） */
export async function doneTicket(o: Parameters<typeof ticket>[0] = {}): Promise<Ticket> {
  const t = await ticket({ ...o, stage: "done" });
  await f.admin.query("update tickets set completed_at = now() - interval '1 hour', completed_by = $2 where id = $1", [
    t.id,
    boss.id,
  ]);
  return t;
}
/** 保留の形を DB に直に置く（理由と再開の条件つき） */
export async function heldTicket(reason = "先方の返事待ち", resume = "先方の返事が来たら"): Promise<Ticket> {
  const t = await ticket({ stage: "hold" });
  await f.admin.query("update tickets set hold_reason = $2, resume_condition = $3 where id = $1", [
    t.id,
    reason,
    resume,
  ]);
  return t;
}
/** 実行の記録（AI の分の時間）を DB に直に置く。分は started_at から finished_at まで。finished が null なら走っている */
export async function run(t: Ticket, o: { minutes?: number; status?: string; finished?: boolean } = {}) {
  const fin = o.finished ?? true;
  await f.admin.query(
    `insert into action_runs (tenant_id, scope_id, ticket_id, phase, status_id, started_at, finished_at, created_by)
     select tenant_id, scope_id, id, 'make', $2, now() - make_interval(mins => $3 + 5), $4::timestamptz, $5 from tickets where id = $1`,
    [
      t.id,
      o.status ?? (fin ? "done" : "running"),
      o.minutes ?? 0,
      fin ? new Date(Date.now() - 5 * 60_000).toISOString() : null,
      boss.id,
    ],
  );
}

// ---- 口を叩く ----
export const patch = (p: Person, ticketId: string, body: unknown, headers: Record<string, string> = {}) =>
  f.req("PATCH", `/tickets/${ticketId}`, { body, headers: { ...p.auth, ...headers } });
export const detail = (p: Person, ticketId: string) => f.req("GET", `/tickets/${ticketId}`, { headers: p.auth });

// ---- 読み直す ----
export const row = (ticketId: string) =>
  one<{
    stage_key: string | null;
    actual_minutes: number | null;
    hold_reason: string | null;
    resume_condition: string | null;
    completed_at: string | null;
    completed_by: string | null;
    updated_by: string | null;
  }>(
    `select s.key as stage_key, t.actual_minutes, t.hold_reason, t.resume_condition, t.completed_at, t.completed_by, t.updated_by
       from tickets t join ticket_stages s on s.id = t.stage_id where t.id = $1`,
    [ticketId],
  );
export const lines = (ticketId: string) =>
  f.admin
    .query<{
      id: string;
      kind: string;
      body: string | null;
      changes: unknown;
      author_member_id: string | null;
      created_by: string | null;
    }>(
      "select id, kind, body, changes, author_member_id, created_by from ticket_messages where ticket_id = $1 and kind = 'change' order by created_at, id",
      [ticketId],
    )
    .then((r) => r.rows);
export const notices = (ticketId: string, kind = STAGE_KIND) =>
  f.admin
    .query<{ member_id: string; payload: Record<string, unknown>; dedupe_key: string | null; channel_id: string }>(
      "select member_id, payload, dedupe_key, channel_id from notifications where event_kind_id = $2 and payload->>'ticket_id' = $1::text order by created_at",
      [ticketId, kind],
    )
    .then((r) => r.rows);
/** その要求で、段・実績・保留・やり取り・知らせが何も変わっていないこと */
export async function snapshot(ticketId: string) {
  return {
    row: await row(ticketId),
    messages: await num("select count(*) as n from ticket_messages where ticket_id = $1", [ticketId]),
    notices: await num("select count(*) as n from notifications where payload->>'ticket_id' = $1::text", [ticketId]),
  };
}

/** この試験の中だけ app.ticket_writable を「この題名のチケットなら例外」に作り替え、終わったら元の定義に戻す（守りの判定の例外 → 503） */
export const breakWritable = async <R>(title: string, body: () => Promise<R>): Promise<R> => {
  const orig = (
    await one<{ def: string }>("select pg_get_functiondef('app.ticket_writable(uuid)'::regprocedure) as def")
  ).def;
  await f.admin
    .query(`create or replace function app.ticket_writable(tid uuid) returns boolean language plpgsql stable security definer set search_path = public, app as $$
    begin
      if exists (select 1 from tickets x where x.id = tid and x.title = '${title}') then
        raise exception 'K387 の試験で守りを壊した';
      end if;
      return exists (
        select 1 from tickets x
        where x.id = tid and x.tenant_id = app.tenant_id()
          and app.ticket_draft_ok(x.draft_import_id, app.user_id())
          and (has_permission(app.user_id(), 'tickets', x.scope_id, 'edit') or x.assignee_member_id = app.user_id())
      );
    end $$`);
  try {
    return await body();
  } finally {
    await f.admin.query(orig);
  }
};
