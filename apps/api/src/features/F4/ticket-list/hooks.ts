// チケットの一覧の口（K-92）：listTickets。読むだけ（口の中で書かない）。
//   見える範囲は行の守り（tickets_read）の上で読み、口でも消したもの（deleted_at）と他の人の下書きを外す（2 重・D-128.158）。
//   mine：担当者が自分（AI に任せているものも）か、自分が承認する（決めていない）もの（D-128.11・D-128.161）。all：見えるもの全部。
//   並び：mine は期限の近い順（無いものは最後）→ 更新の新しい順 → id。all は更新の新しい順 → id。次の分は keyset（読んでいる間に動いても重ならない）。
//   印は期限切れだけ（D-128.159）：日本時間の今日より前の期限で、段が完了でないもの。総数・数は返さない（D-144.3）。
//   絞り込み（K-472）：欄ごとの表 FILTERS（query.ts）が where の条件と値を足す（kind_id・stage_id・assignee_id・done）。全部 AND・値は $10 から
//   select は 1 本（関門 C2・withTenant の接続 1 本）。ログに題名と q を出さない
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import { KanameError } from "@kaname/errors";
import type { Hook, HookArgs, HookReply } from "../../../contract/deps.js";
import { todayJst } from "../create-ticket/input.js";
import { encodeCursor, parseListQuery, type Cursor, type ListQuery } from "./query.js";

interface ListRow {
  id: string;
  number: string;
  title: string;
  kind_id: string;
  kind_name: string;
  stage_id: string;
  stage_name: string;
  stage_key: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  delegated_to_clone: boolean;
  due_on: string | null;
  due_key: string;
  overdue: boolean;
  updated_at: Date;
  updated_key: string;
  parent_ticket_id: string | null;
  depth: number;
}

// $1 mine か・$2 今日（日本時間）・$3 題名の LIKE・$4 番号・$5 グループ・$6 鍵の期限・$7 鍵の更新・$8 鍵の id・$9 読む件数（limit + 1）
// 並び：mine は索引 tickets_list_mine_idx（tenant_id, coalesce(due_on, infinity), updated_at desc, id）、all は tickets_list_all_idx と同じ式にする
//   （式が索引と違うと索引で並べられず、毎回会社のチケットを全部並べ直す）。view ごとに並びの式を変え、続きの条件は同じ式で比べる
const ORDER = {
  mine: "coalesce(t.due_on, 'infinity'::date) asc, t.updated_at desc, t.id asc",
  all: "t.updated_at desc, t.id asc",
} as const;
const OUTER_ORDER = { mine: "p.due_key asc, p.updated_at desc, p.id asc", all: "p.updated_at desc, p.id asc" } as const;

const BASE_PARAMS = 9;
/** 絞り込みの欄の条件を where の最後（order by の前）に足す。conds は表が返した条件（値は $10 から） */
const sqlFor = (view: keyof typeof ORDER, conds: readonly string[]): string => `
with recursive scope_down(id) as (
  select s.id from scopes s where $5::uuid is not null and s.id = $5::uuid
  union all
  select s.id from scopes s join scope_down d on s.parent_id = d.id
),
page as (
  select t.id, t.number, t.title, t.kind_id, t.stage_id, t.assignee_member_id, t.delegated_to_clone, t.due_on,
         coalesce(t.due_on, 'infinity'::date) as due_key, t.updated_at, t.parent_ticket_id
    from tickets t
   where t.tenant_id = app.tenant_id()
     and t.deleted_at is null
     and app.ticket_draft_ok(t.draft_import_id, app.user_id())
     and (not $1::boolean
          or t.assignee_member_id = app.user_id()
          or exists (select 1 from approvals a
                      where a.ticket_id = t.id and a.tenant_id = t.tenant_id and a.approver_member_id = app.user_id()
                        and a.decision is null and a.withdrawn_at is null and a.deleted_at is null))
     and ($3::text is null
          or lower(normalize(t.title, NFKC)) like $3::text escape '\\'
          or lower(t.number) = $4::text)
     and ($5::uuid is null or t.scope_id in (select id from scope_down))
     and ($8::uuid is null
          or ($1::boolean and (coalesce(t.due_on, 'infinity'::date) > $6::date
               or (coalesce(t.due_on, 'infinity'::date) = $6::date
                   and (t.updated_at < $7::timestamptz or (t.updated_at = $7::timestamptz and t.id > $8::uuid)))))
          or (not $1::boolean and (t.updated_at < $7::timestamptz or (t.updated_at = $7::timestamptz and t.id > $8::uuid))))${conds
            .map((c) => `\n     and (${c})`)
            .join("")}
   order by ${ORDER[view]}
   limit $9
)
select p.id, p.number, p.title, k.id as kind_id, k.name as kind_name, s.id as stage_id, s.name as stage_name, s.key as stage_key,
       m.id as assignee_id, m.display_name as assignee_name, p.delegated_to_clone,
       p.due_on::text as due_on, p.due_key::text as due_key,
       (p.due_on is not null and p.due_on < $2::date and s.key is distinct from 'done') as overdue,
       p.updated_at, to_json(p.updated_at) #>> '{}' as updated_key, p.parent_ticket_id,
       (select count(*)::int from (
          with recursive up(id, parent_id, n) as (
            select p.id, p.parent_ticket_id, 1
            union all
            select x.id, x.parent_ticket_id, up.n + 1 from tickets x join up on x.id = up.parent_id where up.n < 5
          ) select 1 from up) a) as depth
  from page p
  join ticket_kinds k on k.id = p.kind_id
  join ticket_stages s on s.id = p.stage_id
  left join members m on m.id = p.assignee_member_id
 order by ${OUTER_ORDER[view]}`;

/** 文と値。表の欄が積んだ値は $10 から（積む順＝番号の順） */
const build = (q: ListQuery, today: string): { text: string; values: unknown[] } => {
  const c: Cursor | null = q.cursor;
  const pushed: unknown[] = [];
  const add = (v: unknown): string => {
    pushed.push(v);
    return `$${BASE_PARAMS + pushed.length}`;
  };
  const conds = q.filters.map((f) => f.def.sql(f.value, add)).filter((x): x is string => x !== null);
  return {
    text: sqlFor(q.view, conds),
    values: [
      q.view === "mine",
      today,
      q.titleLike,
      q.number,
      q.scopeId,
      c?.view === "mine" ? c.due : null,
      c?.updated ?? null,
      c?.id ?? null,
      q.limit + 1,
      ...pushed,
    ],
  };
};

const toItem = (r: ListRow) => ({
  id: r.id,
  number: r.number,
  title: r.title,
  kind: { id: r.kind_id, name: r.kind_name },
  stage: { id: r.stage_id, name: r.stage_name, key: r.stage_key },
  assignee: r.assignee_id ? { id: r.assignee_id, display_name: r.assignee_name ?? "" } : null,
  delegated_to_clone: r.delegated_to_clone,
  due_on: r.due_on,
  overdue: r.overdue,
  updated_at: r.updated_at.toISOString(),
  parent_ticket_id: r.parent_ticket_id,
  depth: r.depth,
});

const nextCursor = (q: ListQuery, last: ListRow): string =>
  encodeCursor(
    q.view === "mine"
      ? { view: "mine", due: last.due_key, updated: last.updated_key, id: last.id }
      : { view: "all", updated: last.updated_key, id: last.id },
  );

/** 形に合うのに今の状態では読めない続きの鍵：409・E-LST-001（欄なし・DB に行かない）。画面は鍵なしで最初から読み直す */
function unreadableCursor(): HookReply {
  const e = new KanameError("E-LST-001");
  return { status: e.status, body: e.toJSON() };
}

function invalid(
  code: "VALIDATION_ERROR" | "E-VAL-017" | "E-VAL-018",
  details: { field: string; message: string }[],
): HookReply {
  if (code === "VALIDATION_ERROR") return { status: 422, body: { error: "validation_failed", code, details } };
  const e = new KanameError(code);
  const field = details[0]?.field ?? "body";
  return {
    status: e.status,
    body: { ...e.toJSON(), field, details: details.map((d) => ({ field: d.field, message: e.entry.message })) },
  };
}

export function createTicketListHooks(appPool: pg.Pool): Record<string, Hook> {
  return {
    listTickets: {
      before: async (a: HookArgs) => {
        const parsed = parseListQuery(a.c.req.query());
        if (!parsed.ok) return parsed.code === "E-LST-001" ? unreadableCursor() : invalid(parsed.code, parsed.details);
        const q = parsed.value;
        const { text, values } = build(q, todayJst());
        const rows = await withTenant(appPool, a.ctx, async (cl) => (await cl.query<ListRow>(text, values)).rows);
        const page = rows.slice(0, q.limit);
        const more = rows.length > q.limit;
        return {
          status: 200,
          body: { data: page.map(toItem), meta: { next_cursor: more ? nextCursor(q, page[page.length - 1]!) : null } },
        };
      },
    },
  };
}
