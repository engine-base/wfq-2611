// つながりの答えの形（K-441・D-128.115）。一覧・足す口が同じ形で答える。
//   DB の関数（app.ticket_links_list・app.ticket_link_add）の答えをそのまま通す薄い形。表の写し（TicketLinks）は使わない。
//   鍵はちょうど id・kind・side・other・can_remove・created_at。other は id・number・title・stage・scope・visible。
//   相手が見えないときは番号だけ（id・title・stage・scope は null・visible false）。DB の関数が決めた値を口で足さない・隠さない
import type { Row } from "@kaname/db/repository";

/** つながり 1 件の答え（契約の TicketLink） */
export interface LinkAnswer {
  id: unknown;
  kind: unknown;
  side: unknown;
  other: {
    id: unknown;
    number: unknown;
    title: unknown;
    stage: unknown;
    scope: unknown;
    visible: unknown;
  };
  can_remove: unknown;
  created_at: unknown;
}

const asRow = (v: unknown): Row => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : {});

/** 関数の答えの 1 件を、契約の形（鍵はちょうど決めた物だけ）に */
export function toLink(raw: unknown): LinkAnswer {
  const r = asRow(raw);
  const o = asRow(r["other"]);
  return {
    id: r["id"],
    kind: r["kind"],
    side: r["side"] ?? null,
    other: {
      id: o["id"] ?? null,
      number: o["number"],
      title: o["title"] ?? null,
      stage: o["stage"] ?? null,
      scope: o["scope"] ?? null,
      visible: o["visible"] === true,
    },
    can_remove: r["can_remove"] === true,
    created_at: r["created_at"],
  };
}

/** 子のチケット 1 件（meta.children）。鍵はちょうど id・number・title・stage・scope */
export function toChild(raw: unknown): Row {
  const r = asRow(raw);
  return { id: r["id"], number: r["number"], title: r["title"], stage: r["stage"], scope: r["scope"] };
}
