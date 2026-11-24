"use client";
// 承認待ちの 申し出（offer）の行・K-414。表の行は HandoverRow（番号・題名・要約・誰から・期限は空・断る／渡す）。
//   スマホのカード（幅 767 以下・useQueueLayout が "card"）は QueueCardMobile（モック f8-offer-answer と同じ：中身は 1 行の要約・期限の行なし）。
//   「渡す」は小窓を通さずその場で送り、答えが来たら承認待ちを読み直して小さな知らせ「〇〇さんに渡しました」を出す（D-148.30）。
//   「断る」は断る小窓（K-412 の useRowAnswer が持つ decline-dialog.tsx）。もう決まっていた（E-HND-005）は一覧を読み直して知らせ、
//   AI が動いている（E-HND-003）などは行（カード）の中の赤い字に出して行を残す
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNotify } from "@/components/k";
import { queueKey, type QueueRow } from "@/features/F5/approve-complete/queue";
import { useQueueLayout, useRowAnswer } from "@/features/F5/approve-complete/queue-card";
import type { RowActs } from "@/features/F5/approve-complete/queue-table";
import { useAnswerCall } from "./answer";
import { HandoverRow, QueueCardMobile, type QueueCardView } from "./views";

export interface QueueRowSectionProps {
  row: QueueRow;
  acts: RowActs;
  /** 今の行（children） */
  fallback: ReactNode;
}

const GONE = "E-HND-005";
const ACTS = ["断る", "渡す"] as const;

/** 行・カードの中身の 1 行（「鈴木さんが引き継ぎを申し出ています ・ 理由：…」。理由が無ければ理由の所は出さない） */
const summaryOf = (row: QueueRow): string =>
  `${row.from_name ?? ""}さんが引き継ぎを申し出ています${row.note ? ` ・ 理由：${row.note}` : ""}`;

/** 申し出に答える流れ（渡す＝その場で送る・断る＝断る小窓）。表の行とカードで共通 */
function useOfferAnswer(row: QueueRow) {
  const qc = useQueryClient();
  const notify = useNotify();
  const decline = useRowAnswer(row); // 断る小窓の開け閉めと送りだけを使う（渡すはここで持つ：知らせの文が違う）
  const { busy, send } = useAnswerCall(row.id, "approvals");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: queueKey });

  const give = async () => {
    setError(null);
    const out = await send({ decision: "accept" });
    if (out === null) return; // 送っている間の 2 回目
    if (out.ok) {
      await refresh(); // 行が消え、数が減る
      notify(`${row.from_name ?? ""}さんに渡しました`);
      return;
    }
    if (out.unauthorized) return; // 入り直し（共通の扱い）
    if (out.code === GONE) {
      // もう決まっていた（別のタブで先に答えた・取り消された）：読み直して行を消し、訳を知らせる
      await refresh();
      notify(out.text, { type: "error" });
      return;
    }
    setError(out.text); // AI が動いている（E-HND-003）・送れない など：行に残し、行の中に出す
  };

  return {
    busy: busy || decline.busy,
    error,
    onAct: (label: string) => (label === ACTS[0] ? decline.openDecline() : void give()),
    dialog: decline.dialog,
  };
}

/** 表の 1 行 */
function OfferTableRow({ row }: { row: QueueRow }) {
  const a = useOfferAnswer(row);
  return (
    <>
      <HandoverRow
        row={{
          id: row.id,
          number: row.ticket_number,
          title: row.title,
          sub: summaryOf(row),
          from: row.from_name ?? "",
          due: "", // 申し出に返事の期限は無い（D-148.12）
          acts: ACTS,
        }}
        href={`/tickets/${row.ticket_id}`}
        busy={a.busy}
        onAct={a.onAct}
        {...(a.error ? { error: a.error } : {})}
      />
      {a.dialog}
    </>
  );
}

/** スマホの 1 枚のカード */
function OfferCard({ row }: { row: QueueRow }) {
  const a = useOfferAnswer(row);
  const card: QueueCardView = {
    id: row.id,
    number: row.ticket_number,
    meta: `渡された ・ ${row.from_name ?? ""}さんから`,
    title: row.title,
    sub: summaryOf(row),
    acts: ACTS,
  };
  return (
    <>
      <QueueCardMobile
        card={card}
        href={`/tickets/${row.ticket_id}`}
        busy={a.busy}
        onAct={a.onAct}
        {...(a.error ? { error: a.error } : {})}
      />
      {a.dialog}
    </>
  );
}

export function QueueRowOffer({ row, acts, fallback }: QueueRowSectionProps): ReactNode {
  void acts;
  void fallback;
  return useQueueLayout() === "card" ? <OfferCard row={row} /> : <OfferTableRow row={row} />;
}
