// チケットの探し方（K-468・D-151.8・D-128.157・D-128.158）：題名の一部か番号で当たる。
//   見える範囲は行の守り（tickets_read）の上で読み、口の文でも消したもの（deleted_at）と他の人の下書きを外す（2 重）。
//   並び：番号が一致したものが先 → 更新の新しい順 → id の小さい順。上位 limit 件は SQL の limit で切る。select は 1 本。ログに題名と q を出さない
import type { SearchHit, Searcher } from "./kinds.js";

// $1 題名の LIKE・$2 番号・$3 件数
const SQL = `
select t.id, t.number, t.title, s.name as stage_name
  from tickets t
  join ticket_stages s on s.id = t.stage_id
 where t.tenant_id = app.tenant_id()
   and t.deleted_at is null
   and app.ticket_draft_ok(t.draft_import_id, app.user_id())
   and (lower(normalize(t.title, NFKC)) like $1::text escape '\\'
        or lower(t.number) = $2::text)
 order by (lower(t.number) = $2::text) desc, t.updated_at desc, t.id asc
 limit $3`;

interface Row {
  id: string;
  number: string;
  title: string;
  stage_name: string;
}

export const searchTickets: Searcher = async (cl, input) => {
  const rows = (await cl.query<Row>(SQL, [input.titleLike, input.number, input.limit])).rows;
  return rows.map((r): SearchHit => ({
    kind: "ticket",
    id: r.id,
    title: r.title,
    snippet: `${r.number}・${r.stage_name}`,
    url: `/tickets/${r.id}`,
  }));
};
