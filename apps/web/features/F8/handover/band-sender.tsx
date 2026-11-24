"use client";
// 渡した人の帯（sending・read-failed。渡し中・読めない）・K-411。値は getTicket の今の渡し（handover）だけ（口を足さない）。
//   渡し中の帯のボタン（催促する・取り消す・別の人にする）は K-413 の物：SenderActions の空の形（押せない 3 つ）をそのまま出す。
//   読めない帯は「もう一度読む」で詳細を読み直す（getTicket 1 回・本文と子チケットはそのまま読める・D-148.38）
import type { ReactNode } from "react";
import { Button } from "@/components/k";
import { SenderActions } from "./band-sender-actions";
import { formatDue, surnameOf } from "./pass-dialog";
import type { BandSectionProps, HandoverBandKey } from "./use-handovers";
import { HandoverBand } from "./views";

/** このファイルが本物にした帯の種類（空の区画が保留の帯を譲らせない・slot-dispatch.tsx が見る） */
export const READY: readonly HandoverBandKey[] = ["sending", "read-failed"];

export function BandSender({ handover, kind, ticket }: BandSectionProps): ReactNode {
  if (kind === "read-failed" || handover === null) {
    return (
      <HandoverBand
        kind="read-failed"
        who=""
        acts={
          <Button size="sm" variant="outlined" onClick={() => void ticket.reload()}>
            もう一度読む
          </Button>
        }
      />
    );
  }
  return (
    <HandoverBand
      kind="sending"
      who={handover.to ? surnameOf(handover.to.display_name) : ""}
      due={formatDue(handover.reply_due)}
      reason={handover.reason}
      acts={<SenderActions />}
    />
  );
}
