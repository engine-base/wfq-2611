"use client";
// 配った人・配られた人の帯（distributed・group）・K-415。値は getTicket の今の渡し（handover）だけ（口を足さない）。
//   種類は K-400 の bandKindOf が決める（ここで決めない）。1 回だけの覚え（distributed）も K-400 が持つ。
//   group：見ている人が配った人で、グループ宛てが返事待ち → 「グループ「〇〇」に配り中」と取り消す（確かめ → 取り消す口 → getTicket を読み直す）。
//   distributed：人宛ての決まった配り → 「〇〇さんから配られました」（理由つき・ボタンなし）。
//   グループ宛ての決まった配りで見ている人が持った人なら「担当者になりました」（K-412 の band-recipient.tsx の accepted と同じ字）。
//   配った人（人宛て）には帯を出さない（K-400 の bandKindOf が null を返す）。取り消しの失敗は帯の上の赤い箱（role=alert）で、配り中の帯はそのまま
import { useRef, useState, type ReactNode } from "react";
import { Button, Confirm } from "@/components/k";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { call } from "@/lib/api/call";
import { formatMoment } from "./answer";
import { newKey, surnameOf } from "./pass-dialog";
import type { BandSectionProps, HandoverBandKey, HandoverView } from "./use-handovers";
import { HandoverBand } from "./views";

/** このファイルが本物にした帯の種類（空の区画が保留の帯を譲らせない・slot-dispatch.tsx が見る） */
export const READY: readonly HandoverBandKey[] = ["distributed", "group"];

/** 配り中の帯：取り消す（確かめの小窓 → 口 → 詳細を読み直す）。口の断りは帯の上の赤い字に出し、帯は残す */
function GroupBand({ handover, ticket }: { handover: HandoverView; ticket: BandSectionProps["ticket"] }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const sending = useRef(false);
  const key = useRef<string | null>(null);
  const groupName = handover.to_scope?.name ?? "";

  const withdraw = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setNotice(undefined);
    key.current ??= newKey();
    try {
      const r = await call("withdrawTicketHandover", {
        params: { id: handover.id },
        idempotencyKey: key.current,
        screenId: "tickets",
      });
      if (r.ok) {
        key.current = null;
        setConfirming(false);
        await ticket.reload(); // 今の渡しが「取り消した」に替わる（帯は消える）
        return;
      }
      setConfirming(false);
      if (r.status === 401) return; // 入り直し（共通の扱い）
      setNotice(catalogMessage(errorCodeOf(r)));
    } catch {
      setConfirming(false);
      setNotice(catalogMessage(PAGE_ERROR.offline));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <HandoverBand
        kind="group"
        who={groupName}
        at={formatMoment(handover.created_at)}
        {...(notice ? { notice } : {})}
        acts={
          <Button
            size="sm"
            variant="outlined"
            disabled={!handover.can.withdraw || busy}
            onClick={() => setConfirming(true)}
          >
            取り消す
          </Button>
        }
      />
      <Confirm
        title="配るのを取り消しますか？"
        description={`グループ「${groupName}」に配るのを取り消します。担当者はあなたのままです。`}
        confirmLabel="取り消す"
        open={confirming}
        busy={busy}
        onOpenChange={setConfirming}
        onConfirm={() => void withdraw()}
      />
    </>
  );
}

export function BandDistributed({ handover, kind, ticket }: BandSectionProps): ReactNode {
  if (handover === null) return null;
  if (kind === "group") return <GroupBand handover={handover} ticket={ticket} />;
  if (kind !== "distributed") return null;
  const from = surnameOf(handover.from.display_name);
  const at = formatMoment(handover.decided_at ?? handover.created_at);
  // グループ宛てを持った人（to_scope が在る）は「担当者になりました」・人宛てで配られた人は「配られました」
  if (handover.to_scope !== null) return <HandoverBand kind="accepted" who={from} at={at} />;
  return <HandoverBand kind="distributed" who={from} at={at} reason={handover.reason} />;
}
