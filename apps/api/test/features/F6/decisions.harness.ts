// 段 7「決める」の口（K-390 決定を読む・足す／K-391 改める・取り消す）の試験の土台。
//   K-390 が carry: で運ぶ（K-391 は K-390 の後なので本線に在る）。行（it）の中身は葉ごとの試験のファイルにある。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 土台は apps/api/test/features/fixture.ts。この段の口（hooks のファイル）は準備では読まず、最初の要求の前に 1 回だけ読む
//   （切る段の smoke で、まだ無いファイルを準備で読んで準備ごと落とさないため・answer=8f745003d023）。
//   progress.harness.ts（K-387）と同じ読み方。K-387 と K-390 は同時に作れるよう、土台を分けて持つ（変えるファイルを重ねない）。
// チケット・書き込み・決定の行は DB に直に置く（まだ無い口を準備に使わない）。
import { afterAll, beforeAll } from "vitest";
import { withTenant, type TenantContext } from "@kaname/db/context";
import type pg from "pg";
import type { Hook } from "../../../src/contract/deps.js";
import { makeFixture, type Fixture, type Person } from "../fixture.js";

// ---- 決めた文と言葉（11_tickets/K-390.md・K-391.md の表・errors.d/K-390.json・K-391.json）----
export const VAL_TEXT = "E-VAL-042"; // 決めたことを書いてください
export const VAL_DECIDER = "E-PAGE-001"; // 決めた人が無い・見えない（404・details の文は「決めた人は、この会社のメンバーから選んでください」）
export const VAL_SOURCE = "E-PAGE-001"; // 元の書き込みが無い・見えない（404・details の文は「元の書き込みが見つかりません…」）
export const VAL_CANCEL = "E-VAL-045"; // 取り消す理由を書いてください（K-391）
export const VAL_NOT_YET = "E-CONF-037"; // 今の状態ではできない（取引先のルールにする・段 12 まで・409）
export const CONF_REVISED = "E-CONF-031"; // この決定は、いま別の人が改めました。読み直してから、もう一度お試しください（㉒・K-391）
export const CONF_CANCELLED = "E-CONF-033"; // この決定は、いま別の人が取り消しました（K-391・仮）
export const DECISION_KIND = "ticket.decision"; // 決定を足した・改めた・取り消した知らせ（⑲）
export const CLIENT_RULE_LATER = "取引先の画面ができてから使えます"; // ㉒

export let f: Fixture;
export let T: { tenantId: string; rootScope: string };
export let O: { tenantId: string; rootScope: string };
export let boss: Person; // 担当者（書ける）
export let writer: Person; // 同じグループの書ける人（担当者でない）
export let viewer: Person; // 見るだけの人
export let outsider: Person; // 別の会社の人

export type J = Record<string, unknown> & { data?: unknown; details?: { field: string; message: string }[] };
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
export const asMember = async <R>(p: Person, sql: string, args: unknown[] = []) =>
  withTenant(f.pool as pg.Pool, ctxOf(p), async (cl) => (await cl.query(sql, args)).rows[0] as R);

const LOADERS: Record<string, () => Promise<Record<string, Hook>>> = {
  // K-390 が作る hooks のファイル（listTicketDecisions・createTicketDecision）。ticketDecisionHooks(appPool) を出す
  "ticket-decisions": async () => {
    const m = (await import("../../../src/hooks/ticket-decisions.js")) as {
      ticketDecisionHooks: (p: pg.Pool) => Record<string, Hook>;
    };
    return m.ticketDecisionHooks(f.pool);
  },
};
function useHooks(names: readonly string[], extra: Record<string, () => Promise<Record<string, Hook>>>) {
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

/** 土台を立てる（各ファイルの頭で 1 回）。extra は葉が足す hooks のファイルの読み方（K-391 が改める口を足す） */
export function setupDecisions(
  names: readonly string[] = ["ticket-decisions"],
  extra: Record<string, () => Promise<Record<string, Hook>>> = {},
) {
  beforeAll(async () => {
    f = await makeFixture();
    T = await f.company("K390 の会社", "DC");
    O = await f.company("K390 の別の会社", "DO");
    boss = await f.person(T.tenantId, T.rootScope, { name: "高本", ticketAbility: "edit" });
    writer = await f.person(T.tenantId, T.rootScope, { name: "佐藤", ticketAbility: "edit" });
    viewer = await f.person(T.tenantId, T.rootScope, { name: "見るだけの人", ticketAbility: "view" });
    outsider = await f.person(O.tenantId, O.rootScope, { name: "別の会社の人", ticketAbility: "edit" });
    for (const op of ["listTicketDecisions", "createTicketDecision", "updateTicketDecision"]) f.limits[op] = 10_000;
    useHooks(names, extra);
  });
  afterAll(async () => {
    await f?.close();
  });
}

// ---- 種を置く ----
export interface Ticket {
  id: string;
  number: string;
  tenant: string;
}
export async function ticket(
  o: { tenant?: string; stage?: string; assignee?: Person | null; title?: string } = {},
): Promise<Ticket> {
  const tenant = o.tenant ?? T.tenantId;
  const t = await one<{ id: string; number: string }>(
    `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, assignee_member_id, created_by)
     select $1, $2, '', k.id, s.id, $6, $4, $5
       from ticket_kinds k, ticket_stages s
      where k.tenant_id = $1 and k.name = 'タスク' and k.deleted_at is null and s.tenant_id = $1 and s.key = $3
     returning id, number`,
    [
      tenant,
      tenant === T.tenantId ? T.rootScope : O.rootScope,
      o.stage ?? "doing",
      o.assignee === undefined ? boss.id : (o.assignee?.id ?? null),
      boss.id,
      o.title ?? "見積の条件を決める",
    ],
  );
  return { ...t, tenant };
}
/** やり取りの書き込み（kind post）を直に置く */
export const post = async (t: Ticket, by: Person, body = "支払いは翌月末でよいと先方から") =>
  (
    await one<{ id: string }>(
      "insert into ticket_messages (tenant_id, ticket_id, author_member_id, kind, body, created_by) values ($1, $2, $3, 'post', $4, $3) returning id",
      [t.tenant, t.id, by.id, body],
    )
  ).id;
/** 決定の行を直に置く（K-391 の準備・K-390 の並びの確かめ） */
export const decision = async (
  t: Ticket,
  o: {
    text?: string;
    by?: Person;
    agoMin?: number;
    superseded?: string | null;
    cancelled?: { by: Person; reason: string };
  } = {},
) =>
  (
    await one<{ id: string }>(
      `insert into ticket_decisions (tenant_id, ticket_id, text, decided_by, decided_at, superseded_by_id, cancelled_at, cancelled_by, cancel_reason, created_by)
       values ($1, $2, $3, $4, now() - make_interval(mins => $5), $6, $7, $8, $9, $4) returning id`,
      [
        t.tenant,
        t.id,
        o.text ?? "支払いは翌月末",
        (o.by ?? boss).id,
        o.agoMin ?? 10,
        o.superseded ?? null,
        o.cancelled ? new Date().toISOString() : null,
        o.cancelled?.by.id ?? null,
        o.cancelled?.reason ?? null,
      ],
    )
  ).id;

// ---- 口を叩く ----
export const list = (p: Person, ticketId: string) =>
  f.req("GET", `/tickets/${ticketId}/decisions`, { headers: p.auth });
export const add = (p: Person, ticketId: string, body: unknown, headers: Record<string, string> = {}) =>
  f.req("POST", `/tickets/${ticketId}/decisions`, { body, headers: { ...p.auth, ...headers } });
export const change = (p: Person, decisionId: string, body: unknown) =>
  f.req("PATCH", `/ticket_decisions/${decisionId}`, { body, headers: p.auth });

// ---- 読み直す ----
export const decisionsOf = (ticketId: string) =>
  f.admin
    .query<{
      id: string;
      text: string;
      reason: string | null;
      decided_by: string | null;
      decided_note: string | null;
      source_message_id: string | null;
      superseded_by_id: string | null;
      cancelled_at: string | null;
      cancelled_by: string | null;
      cancel_reason: string | null;
      promoted_to: string;
    }>(
      `select id, text, reason, decided_by, decided_note, source_message_id, superseded_by_id, cancelled_at, cancelled_by, cancel_reason, promoted_to
         from ticket_decisions where ticket_id = $1 order by created_at, id`,
      [ticketId],
    )
    .then((r) => r.rows);
export const changeLines = (ticketId: string) =>
  f.admin
    .query<{ body: string | null; changes: unknown; author_member_id: string | null }>(
      "select body, changes, author_member_id from ticket_messages where ticket_id = $1 and kind = 'change' order by created_at, id",
      [ticketId],
    )
    .then((r) => r.rows);
export const notices = (ticketId: string) =>
  f.admin
    .query<{ member_id: string; payload: Record<string, unknown>; dedupe_key: string | null }>(
      "select member_id, payload, dedupe_key from notifications where event_kind_id = $2 and payload->>'ticket_id' = $1::text order by created_at",
      [ticketId, DECISION_KIND],
    )
    .then((r) => r.rows);
/** その要求で、決定・やり取り・知らせが何も変わっていないこと */
export async function snapshot(ticketId: string) {
  return {
    decisions: await decisionsOf(ticketId),
    messages: await num("select count(*) as n from ticket_messages where ticket_id = $1", [ticketId]),
    notices: await num("select count(*) as n from notifications where payload->>'ticket_id' = $1::text", [ticketId]),
  };
}
export const breakWritable = async <R>(title: string, body: () => Promise<R>): Promise<R> => {
  const orig = (
    await one<{ def: string }>("select pg_get_functiondef('app.ticket_writable(uuid)'::regprocedure) as def")
  ).def;
  await f.admin
    .query(`create or replace function app.ticket_writable(tid uuid) returns boolean language plpgsql stable security definer set search_path = public, app as $$
    begin
      if exists (select 1 from tickets x where x.id = tid and x.title = '${title}') then
        raise exception 'K390 の試験で守りを壊した';
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
