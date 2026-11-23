// 消す前の下見の口（K-487）：previewTicketDelete（GET /api/v1/tickets/:id/delete-preview）。読むだけ（DB に書かない・外も呼ばない・証跡も書かない）。
//   確認の小窓（K-590）の「一緒に起きること」に出す件数を返す。数えるのは、消していない物だけ。
//   ① 手順 S1：1 つの取引（withTenant）の 1 文で全部数える（スカラーの副問い合わせ＋子・孫は DB の関数 1 回・行ごとに引かない）。
//      そのチケット自身の分（添付・成果物・承認待ち・つながり・走っている実行）は呼んだ人の行の守りの中で数える。
//      子・孫（children・descendants・descendant_*）は定義者の DB の関数 app.ticket_descendant_counts で数える：消す口 K-488 と同じに、見えない子も数える。
//      つながりだけは、見える相手との分（両側が見えるときだけ読める）。
//   ② 消せる人＝作った人か、そのグループで tickets の edit を持つ人（D-125.62・P14）。入口の行の決まりは「見える」だけ（row_rules.mjs）で、
//      作った人か edit かの判定（403・E-DEL-001）は口のこの文が持つ。見えない・別の会社・無い・もう消えた → 404。
//   ③ 失敗したら一部だけを返さず 503・E-PAGE-003。Cache-Control: private, no-store は入口（app.ts）が全部の答えに付ける
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { down, forbidden, notFound, restorableUntil } from "./shared.js";

type CountsFromFunction = {
  ok?: boolean;
  children?: number;
  descendants?: number;
  pending_approvals?: number;
  running_runs?: number;
};
type PreviewRow = {
  deletable: boolean | null;
  d: CountsFromFunction | null;
  attachments: string;
  artifacts: string;
  pending_approvals: string;
  links: string;
  running_runs: string;
};

// 承認待ちは K-163・0095 の「待っている」と同じ式。実行は待っている・動いている・コードを待っている（消すと止まる・D-151.14）。
// つながり：どちら向きでも数える。相手が消えている・消したつながりは数えない（相手の行は呼んだ人に見える物だけ）
const PREVIEW_SQL = `
select (t.created_by = app.user_id() or has_permission(app.user_id(), 'tickets', t.scope_id, 'edit')) as deletable,
       app.ticket_descendant_counts(t.id) as d,
       (select count(*) from attachments x
         where x.owner_type = 'ticket' and x.owner_id = t.id and x.deleted_at is null) as attachments,
       (select count(*) from artifacts f
         where f.deleted_at is null
           and f.source_job_id in (select r.bridge_job_id from action_runs r where r.ticket_id = t.id and r.bridge_job_id is not null)) as artifacts,
       (select count(*) from approvals a
         where a.ticket_id = t.id and a.decision is null and a.withdrawn_at is null and a.deleted_at is null) as pending_approvals,
       (select count(*) from ticket_links l
         where (l.from_ticket_id = t.id or l.to_ticket_id = t.id) and l.deleted_at is null
           and exists (select 1 from tickets o
                        where o.id = case when l.from_ticket_id = t.id then l.to_ticket_id else l.from_ticket_id end
                          and o.deleted_at is null)) as links,
       (select count(*) from action_runs x
         where x.ticket_id = t.id and x.status_id in ('queued', 'running', 'asking') and x.deleted_at is null) as running_runs
  from tickets t
 where t.id = $1 and t.deleted_at is null and app.ticket_visible(t.id)`;

const num = (v: unknown): number => Number(v ?? 0);

export function createPreviewTicketDelete(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    let row: PreviewRow | undefined;
    try {
      row = await withTenant(appPool, a.ctx, async (cl) => (await cl.query<PreviewRow>(PREVIEW_SQL, [a.id])).rows[0]);
    } catch (e) {
      return down("消す前の下見", e);
    }
    // 行が無い（見えない・別の会社・無い・もう消えた）／子・孫の関数が見えないと答えた → 404
    const d = row?.d;
    if (!row || !d || d.ok !== true) return notFound();
    if (row.deletable !== true) return forbidden();
    return {
      status: 200,
      body: {
        data: {
          children: num(d.children),
          descendants: num(d.descendants),
          attachments: num(row.attachments),
          artifacts: num(row.artifacts),
          pending_approvals: num(row.pending_approvals),
          links: num(row.links),
          running_runs: num(row.running_runs),
          descendant_pending_approvals: num(d.pending_approvals),
          descendant_running_runs: num(d.running_runs),
          restorable_until: restorableUntil(new Date()),
        },
      },
    };
  };
}
