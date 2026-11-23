// 決定の一覧（口の答え）を、見た目の部品が描く形に並べ直す純粋な関数（K-397）。時刻は日本時間。口は呼ばない・状態を持たない。
//   並び：生きている → 改められた → 取り消した。その中は決めた日の新しい順（同じ日は口の順）。
//   注：改められた＝「新しい決定：〈字〉 ↑」／改めた＝「MM/DD の決定を改めた」と札／取り消した＝「取り消し MM/DD 〈呼ばれ方〉：〈理由〉」
import { mmddTime } from "@/features/F4/create-ticket/detail-head";
import type { DecisionView } from "./views";

export interface DecisionRow {
  id: string;
  text: string;
  reason: string | null;
  decided_by: { id: string; display_name: string } | null;
  decided_note: string | null;
  decided_at: string;
  source: { id: string; at: string; deleted: boolean } | null;
  revises_id: string | null;
  superseded_by_id: string | null;
  cancelled: { at: string; by: { id: string; display_name: string } | null; reason: string } | null;
}

const ORDER = { live: 0, revised: 1, cancelled: 2 } as const;
const statusOf = (r: DecisionRow): DecisionView["status"] =>
  r.cancelled ? "cancelled" : r.superseded_by_id ? "revised" : "live";
const day = (iso: string): string => mmddTime(iso).slice(0, 5);
/** 表示名の最初の語（呼ばれ方・D-128.58） */
const callName = (name: string | null | undefined): string => (name ?? "").trim().split(/[\s\u3000]+/)[0] ?? "";

export function toViews(rows: readonly DecisionRow[]): DecisionView[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows
    .map((r, i) => ({ r, i, st: statusOf(r) }))
    .sort((a, b) => ORDER[a.st] - ORDER[b.st] || Date.parse(b.r.decided_at) - Date.parse(a.r.decided_at) || a.i - b.i)
    .map(({ r, st }) => view(r, st, byId));
}

function view(r: DecisionRow, status: DecisionView["status"], byId: ReadonlyMap<string, DecisionRow>): DecisionView {
  const name = r.decided_by?.display_name ?? "";
  const head = [day(r.decided_at), name].filter(Boolean).join(" ");
  const by = r.decided_note && name ? `${head}（${r.decided_note}）` : head;
  const next = r.superseded_by_id ? byId.get(r.superseded_by_id) : undefined;
  const prev = r.revises_id ? byId.get(r.revises_id) : undefined;
  const note = r.cancelled
    ? `取り消し ${day(r.cancelled.at)} ${callName(r.cancelled.by?.display_name)}：${r.cancelled.reason}`
    : status === "revised"
      ? `新しい決定：${next?.text ?? ""} ↑`
      : prev
        ? `${day(prev.decided_at)} の決定を改めた`
        : undefined;
  return {
    id: r.id,
    text: r.text,
    by,
    status,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.source && !r.source.deleted
      ? { source: `やり取り ${mmddTime(r.source.at)}`, sourceHref: `#msg-${r.source.id}` }
      : {}),
    ...(r.source?.deleted ? { sourceGone: true } : {}),
    ...(note ? { note } : {}),
    ...(r.revises_id ? { revises: true } : {}),
  };
}
