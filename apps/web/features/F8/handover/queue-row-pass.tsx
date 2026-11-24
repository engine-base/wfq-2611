"use client";
// 承認待ちの 渡された（pass）の行・K-412。表の行は HandoverRow（番号・題名・要約・誰から・返事の期限・断る／受ける）。
//   「受ける」は小窓を通さずその場で送り（D-128.89）、「断る」は断る小窓（decline-dialog.tsx）を開く。口の呼び方・読み直し・知らせは useRowAnswer（queue-card.tsx）。
//   スマホのカード（幅 767 以下）は queue-card.tsx が全部の種類を同じ決まりで描くので、カードの中（useQueueLayout が "card"）では今の物（fallback）をそのまま返す
import type { ReactNode } from "react";
import {
  carryPart,
  handoverFieldsOf,
  reasonPart,
  useQueueLayout,
  useRowAnswer,
} from "@/features/F5/approve-complete/queue-card";
import { jstDay } from "@/features/F5/approve-complete/due";
import type { QueueRow } from "@/features/F5/approve-complete/queue";
import type { RowActs } from "@/features/F5/approve-complete/queue-table";
import { formatMoment } from "./answer";
import { HandoverRow } from "./views";

export interface QueueRowSectionProps {
  row: QueueRow;
  acts: RowActs;
  /** 今の行（children） */
  fallback: ReactNode;
}

/** 表の 1 行（要約は「高本さんから ・ 子チケット 2 件も一緒に ・ 理由：…」。子の所と理由は無ければ出さない） */
function PassTableRow({ row }: { row: QueueRow }) {
  const f = handoverFieldsOf(row);
  const a = useRowAnswer(row);
  const from = row.from_name ?? "";
  const sub = [`${from}さんから`, carryPart(f), reasonPart(row.note)]
    .filter((p): p is string => p !== null)
    .join(" ・ ");
  return (
    <>
      <HandoverRow
        row={{
          id: row.id,
          number: row.ticket_number,
          title: row.title,
          sub,
          from,
          due: formatMoment(f.replyDue),
          ...(row.due_on !== null && row.due_on < jstDay(0) ? { late: true } : {}),
          acts: ["断る", "受ける"],
        }}
        href={`/tickets/${row.ticket_id}`}
        busy={a.busy}
        onAct={(label) => (label === "断る" ? a.openDecline() : a.accept())}
        {...(a.error ? { error: a.error } : {})}
      />
      {a.dialog}
    </>
  );
}

export function QueueRowPass({ row, acts, fallback }: QueueRowSectionProps): ReactNode {
  void acts;
  if (useQueueLayout() === "card") return fallback;
  return <PassTableRow row={row} />;
}
