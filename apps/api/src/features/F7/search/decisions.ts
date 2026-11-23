// 決定の探し方（K-470・D-127.4・D-151.8・D-151.18・D-125.40・D-125.63・D-130.1・D-136.2・D-128.158）：
//   決めたことと理由の部分一致で当たる（全角半角・大文字小文字をそろえて比べる）。出すのは生きている決定だけ
//   （改められた決定・取り消した決定は出さない＝今の決まりを引く探す）。見えるチケットの決定だけ：
//   行の守り（ticket_decisions_ticket_read）の上で読み、口の文でも app.ticket_visible と消したチケットを外す（2 重）。
//   並び：決めた時刻の新しい順 → id の小さい順。上位 limit 件は SQL の limit で切る（入力を .slice で切らない）。select は 1 本。
//   ログに決めたこと・理由・探す言葉を出さない
import type { SearchHit, Searcher } from "./kinds.js";

// $1 LIKE の形（決めたことと理由）・$2 件数。title は空白・改行を 1 つの空白にして 80 字まで（見せ方だけ・決定そのものは切らない・D-130.1）
const SQL = `
select d.id, d.ticket_id, t.number, t.title as ticket_title,
       left(btrim(regexp_replace(d.text, '\\s+', ' ', 'g')), 80) as title
  from ticket_decisions d
  join tickets t on t.id = d.ticket_id
 where d.tenant_id = app.tenant_id()
   and d.deleted_at is null
   and d.superseded_by_id is null
   and d.cancelled_at is null
   and t.deleted_at is null
   and app.ticket_visible(t.id)
   and (lower(normalize(d.text, NFKC)) like $1::text escape '\\'
        or lower(normalize(coalesce(d.reason, ''), NFKC)) like $1::text escape '\\')
 order by d.decided_at desc, d.id asc
 limit $2`;

interface Row {
  id: string;
  ticket_id: string;
  number: string;
  ticket_title: string;
  title: string;
}

export const searchDecisions: Searcher = async (cl, input) => {
  const rows = (await cl.query<Row>(SQL, [input.titleLike, input.limit])).rows;
  return rows.map((r): SearchHit => ({
    kind: "decision",
    id: r.id,
    title: r.title,
    snippet: `${r.number}・${r.ticket_title}`,
    url: `/tickets/${r.ticket_id}#sec-decisions`,
  }));
};
