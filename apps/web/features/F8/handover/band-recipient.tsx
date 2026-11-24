"use client";
// 渡された人の帯（receiving・accepted・taken・gone）・K-412。値は getTicket の今の渡し（handover）だけ（口を足さない）。
//   種類は K-400 の bandKindOf が決める（ここで決めない）。1 回だけの覚え（accepted・taken）も K-400 が持つ。
//   receiving の「受ける」「断る」は承認待ちの行と同じ口（answer.ts）。受けた後・断った後は ticket.reload()（getTicket を 1 回）で今の渡しを読み直す。
//   受けた直後は小さな知らせを重ねない（帯だけ・D-148.35）。AI が動いている（E-HND-003）は帯の中の橙の知らせ、ほかの断りは赤
import { useState, type ReactNode } from "react";
import { Button, NoticeBox } from "@/components/k";
import { formatMoment, targetOfDetail, useAnswerCall } from "./answer";
import { DeclineFlow } from "./decline-dialog";
import { formatDue, surnameOf } from "./pass-dialog";
import type { BandSectionProps, HandoverBandKey, HandoverView } from "./use-handovers";
import { HandoverBand } from "./views";

/** このファイルが本物にした帯の種類（空の区画が保留の帯を譲らせない・slot-dispatch.tsx が見る） */
export const READY: readonly HandoverBandKey[] = ["receiving", "accepted", "taken", "gone"];

const AI_BUSY = "E-HND-003";
const GONE = "E-HND-005";

const childrenPart = (h: HandoverView): string | null =>
  h.switch.children > 0 ? `子チケット ${h.switch.children} 件も一緒に` : null;

/** 受けた後の帯の 1 行（子の数・グループ） */
function movedLine(h: HandoverView): string {
  const children = h.switch.children > 0 ? `子チケット ${h.switch.children} 件も一緒に移りました` : null;
  const group = h.switch.group ? "グループも移りました" : `グループは${h.ticket_scope.name}のまま`;
  return [children, group].filter((p): p is string => p !== null).join(" ・ ");
}

/** 頼まれています（渡された人・待っている渡し）：断る／受ける */
function ReceivingBand({ handover, ticket }: { handover: HandoverView; ticket: BandSectionProps["ticket"] }) {
  const { busy, send } = useAnswerCall(handover.id, "tickets");
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [declining, setDeclining] = useState(false);
  const from = surnameOf(handover.from.display_name);

  const accept = async () => {
    setNotice(null);
    const out = await send({ decision: "accept" });
    if (out === null) return; // 送っている間の 2 回目
    if (out.ok) return void (await ticket.reload()); // 今の渡しが「受けた」に替わる（帯は 担当者になりました）
    if (out.unauthorized) return; // 入り直し（共通の扱い）
    if (out.code === GONE) return void (await ticket.reload()); // もう決まっていた：今の状態を読み直す
    setNotice({ text: out.text, warn: out.code === AI_BUSY });
  };

  const carry = childrenPart(handover);
  return (
    <>
      {notice ? <NoticeBox tone={notice.warn ? "warn" : "danger"}>{notice.text}</NoticeBox> : null}
      <HandoverBand
        kind="receiving"
        who={from}
        due={formatDue(handover.reply_due)}
        reason={handover.reason}
        {...(handover.ask ? { ask: handover.ask } : {})}
        {...(carry ? { carry } : {})}
        acts={
          <>
            <Button size="sm" variant="outlined" disabled={busy} onClick={() => setDeclining(true)}>
              断る
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void accept()}>
              受ける
            </Button>
          </>
        }
      />
      {declining ? (
        <DeclineFlow
          handoverId={handover.id}
          target={targetOfDetail(ticket.detail)}
          from={from}
          screenId="tickets"
          onClose={() => setDeclining(false)}
          onDone={ticket.reload}
          onStale={ticket.reload}
        />
      ) : null}
    </>
  );
}

export function BandRecipient({ handover, kind, ticket }: BandSectionProps): ReactNode {
  if (handover === null) return null;
  const at = formatMoment(handover.decided_at);
  switch (kind) {
    case "receiving":
      return <ReceivingBand handover={handover} ticket={ticket} />;
    case "accepted":
      return (
        <HandoverBand kind="accepted" who={surnameOf(handover.from.display_name)} at={at} carry={movedLine(handover)} />
      );
    case "taken": {
      // 引き継いだ人：渡した人から見れば受けた相手、申し出の担当者だった人から見れば申し出た人
      const taker = handover.kind === "offer" ? handover.from : handover.to;
      return taker ? <HandoverBand kind="taken" who={surnameOf(taker.display_name)} at={at} /> : null;
    }
    case "gone":
      return <HandoverBand kind="gone" who={surnameOf(handover.from.display_name)} at={at} />;
    default:
      return null;
  }
}
