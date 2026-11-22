// 確認項目を読む口（K-434・契約の口 listTestSpecs・GET /api/v1/tickets/:id/test-specs）。読むだけ（DB に書かない・外も呼ばない）。
//   答え 200 { data: SpecItem[]（作った順・消した行は出さない）, meta: { count, limit, can_edit } }・Cache-Control: private, no-store。
//   can_edit は「書けて、完了していない」（画面は役の名前でなくこれで出し分ける）。完了後・読むだけの人も読める（can_edit false）。
//   無い・消されたチケットは 404（入口が見えない人・別の会社・無い id を先に 404 にする。ここは入口では見える物の消されたチケットの二重の守り）。
//   取引は 1 つ（withTenant）・文は 2 つ。cursor・limit・並べ替えは受けず作った順に返す（上限 500 行・超えたら切ってログに 1 行）。ログに題名を出さない
import type pg from "pg";
import { withTenant, type TenantContext } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { kindOf, notFound, unavailable } from "./reply.js";
import { toSpecItem, type SpecItem } from "./shape.js";

/** 一覧で返す行の上限 */
export const LIST_MAX = 500;

/** ① チケットが生きているか・完了しているか・書けるか（行の守りの中で読む。見えなければ 0 行） */
const TICKET_SQL = `select (t.deleted_at is null) as live,
       (t.completed_at is not null or coalesce(s.key = 'done', false)) as done,
       app.ticket_writable(t.id) as writable
  from tickets t left join ticket_stages s on s.id = t.stage_id
 where t.id = $1`;
/** ② 項目（口の文でも同じ条件で絞る・二重の守り） */
const SPECS_SQL = `select app.test_spec_item(id) as v from test_specs
 where tenant_id = app.tenant_id() and ticket_id = $1 and deleted_at is null
 order by created_at, id
 limit $2`;

type Loaded = { found: false } | { found: true; rows: SpecItem[]; canEdit: boolean };

export function createListTestSpecs(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  /** 1 つの取引で、チケットの状態と項目を読む */
  const load = (ctx: TenantContext, id: string): Promise<Loaded> =>
    withTenant(appPool, ctx, async (cl): Promise<Loaded> => {
      const t = (await cl.query<{ live: boolean; done: boolean; writable: boolean }>(TICKET_SQL, [id])).rows[0];
      if (!t || !t.live) return { found: false };
      const rows = (await cl.query<{ v: SpecItem }>(SPECS_SQL, [id, LIST_MAX + 1])).rows.map((r) => r.v);
      return { found: true, rows, canEdit: t.writable === true && !t.done };
    });

  return async (a: HookArgs): Promise<HookReply> => {
    const id = a.id!;
    let out: Loaded;
    try {
      out = await load(a.ctx, id);
    } catch (e) {
      console.error(`[test-spec] 読めなかった（${id}・${kindOf(e)}）`);
      return unavailable();
    }
    if (!out.found) return notFound();
    if (out.rows.length > LIST_MAX) console.warn(`[test-spec] 一覧を ${LIST_MAX} 行で切った`);
    const data = out.rows.filter((_, i) => i < LIST_MAX).map(toSpecItem); // 501 行目は捨てる
    return {
      status: 200,
      body: { data, meta: { count: data.length, limit: LIST_MAX, can_edit: out.canEdit } },
    };
  };
}
