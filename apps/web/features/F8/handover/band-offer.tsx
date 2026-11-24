"use client";
// 申し出の帯（offered・offering・offer-accepted・offer-declined）・K-414。値は getTicket の今の渡し（handover）だけ（口を足さない）。
//   種類は K-400 の bandKindOf が決める（ここで決めない）。1 回だけの覚え（offer-accepted・offer-declined）も K-400 が持つ。
//   offered（担当者が見る）の「渡す」「断る」は承認待ちの行と同じ口（answer.ts）。offering（申し出た人が見る）の「取り消す」は K-406 の口
//   （確かめの小窓は出さない・D-148.45）。答えた後・取り消した後は ticket.reload()（getTicket を 1 回）で今の渡しを読み直す。
//   AI が動いている（E-HND-003）は帯の上の橙の知らせ、ほかの断りは赤
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, NoticeBox } from "@/components/k";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { call } from "@/lib/api/call";
import { formatMoment, targetOfDetail, useAnswerCall } from "./answer";
import { DeclineFlow } from "./decline-dialog";
import { surnameOf } from "./pass-dialog";
import type { BandSectionProps, HandoverBandKey, HandoverView } from "./use-handovers";
import { HandoverBand } from "./views";

/** このファイルが本物にした帯の種類（空の区画が保留の帯を譲らせない・slot-dispatch.tsx が見る） */
export const READY: readonly HandoverBandKey[] = ["offered", "offering", "offer-accepted", "offer-declined"];

const AI_BUSY = "E-HND-003";
const GONE = "E-HND-005";

const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/** 担当者（申し出の相手）の姓。読めなければ空 */
const assigneeName = (h: HandoverView): string => (h.to ? surnameOf(h.to.display_name) : "");

/** 申し出が来ています（担当者が見る・待っている申し出）：断る／渡す */
function OfferedBand({ handover, ticket }: { handover: HandoverView; ticket: BandSectionProps["ticket"] }) {
  const { busy, send } = useAnswerCall(handover.id, "tickets");
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [declining, setDeclining] = useState(false);
  const from = surnameOf(handover.from.display_name);

  const give = async () => {
    setNotice(null);
    const out = await send({ decision: "accept" });
    if (out === null) return; // 送っている間の 2 回目
    if (out.ok) return void (await ticket.reload()); // 今の渡しが「受けた」に替わる（帯は 引き継ぎました）
    if (out.unauthorized) return; // 入り直し（共通の扱い）
    if (out.code === GONE) return void (await ticket.reload()); // もう決まっていた：今の状態を読み直す
    setNotice({ text: out.text, warn: out.code === AI_BUSY });
  };

  return (
    <>
      {notice ? <NoticeBox tone={notice.warn ? "warn" : "danger"}>{notice.text}</NoticeBox> : null}
      <HandoverBand
        kind="offered"
        who={from}
        at={formatMoment(handover.created_at)}
        reason={handover.reason}
        acts={
          <>
            <Button size="sm" variant="outlined" disabled={busy} onClick={() => setDeclining(true)}>
              断る
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void give()}>
              渡す
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

/** 申し出を取り消す口（K-406）。送っている間の 2 回目は送らず、成功するまで同じ冪等の鍵で送る */
function useWithdraw(handoverId: string, reload: () => Promise<unknown> | void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const key = useRef<string | null>(null);
  const run = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    key.current ??= newKey();
    try {
      const r = await call("withdrawTicketHandover", {
        params: { id: handoverId },
        idempotencyKey: key.current,
        screenId: "tickets",
        body: {},
      });
      if (r.ok) {
        key.current = null;
        await reload(); // 申し出の帯が消え、入口が戻る
        return;
      }
      if (r.status === 401) return; // 入り直し（共通の扱い）
      const code = errorCodeOf(r);
      if (code === GONE) return void (await reload()); // もう決まっていた：今の状態を読み直す
      setError(catalogMessage(code)); // 503 など：帯はそのまま・上に赤い字
    } catch {
      setError(catalogMessage(PAGE_ERROR.offline));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [handoverId, reload]);
  return { busy, error, run };
}

/** 申し出ています（申し出た人が見る・待っている申し出）：取り消す */
function OfferingBand({ handover, ticket }: { handover: HandoverView; ticket: BandSectionProps["ticket"] }) {
  const w = useWithdraw(handover.id, ticket.reload);
  return (
    <HandoverBand
      kind="offering"
      who={assigneeName(handover)}
      at={formatMoment(handover.created_at)}
      reason={handover.reason}
      {...(w.error ? { notice: w.error } : {})}
      acts={
        <Button size="sm" variant="outlined" disabled={w.busy} onClick={() => void w.run()}>
          取り消す
        </Button>
      }
    />
  );
}

export function BandOffer({ handover, kind, ticket }: BandSectionProps): ReactNode {
  if (handover === null || handover.kind !== "offer") return null;
  const at = formatMoment(handover.decided_at);
  switch (kind) {
    case "offered":
      return <OfferedBand handover={handover} ticket={ticket} />;
    case "offering":
      return <OfferingBand handover={handover} ticket={ticket} />;
    case "offer-accepted":
      return <HandoverBand kind="offer-accepted" who={assigneeName(handover)} at={at} />;
    case "offer-declined":
      return (
        <HandoverBand
          kind="offer-declined"
          who={assigneeName(handover)}
          at={at}
          reason={handover.decline_reason ?? ""}
        />
      );
    default:
      return null;
  }
}
