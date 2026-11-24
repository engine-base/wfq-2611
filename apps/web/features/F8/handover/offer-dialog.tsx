"use client";
// 引き継ぎを申し出る小窓の一続き（K-414）。題名の下の「引き継ぐ（申し出る）」（offer-action.tsx）が開く。
//   部品は views.tsx の OfferDialog（題・理由（必須）・注・やめる／申し出る）。値と押す関数を渡すだけ。口は K-408 の createTicketHandover（kind offer）。
//   理由が空なら送らず欄の下に E-HND-007 の文。口の断り（409 別の渡しが待っている・403 申し出られない人・網の切れ）は小窓の上の赤い箱で、書いた理由は残す。
//   押し直しは同じ冪等の鍵（中身が変わったときだけ新しい鍵）。申し出られたら小窓を閉じ、getTicket を読み直す（申し出た人の帯が出る）。
//   開いている間だけ置く（置かれた時が「開いた時」。理由・断りの文は毎回まっさら）
import { useRef, useState } from "react";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { call } from "@/lib/api/call";
import { targetOfDetail } from "./answer";
import { OfferDialog } from "./views";

export interface OfferFlowProps {
  ticket: SlotTicket;
  /** 担当者の姓（「高本」→「担当者（高本さん）が…」） */
  assignee: string;
  /** 閉じる（やめる・× ・Esc・申し出られた後） */
  onClose: () => void;
}

const REASON_EMPTY = "E-HND-007";

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** 答えの detail の値を {名前} に入れる（画面で文を作らない・正本の文の穴埋めだけ） */
const fill = (message: string, detail: Record<string, unknown> | null): string =>
  message.replace(/\{([^}]+)\}/g, (_, k: string) => String(detail?.[k] ?? ""));

const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export function OfferFlow({ ticket, assignee, onClose }: OfferFlowProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const last = useRef<{ reason: string; key: string } | null>(null);

  const submit = async () => {
    if (sending.current) return; // 送っている間の 2 回目
    if (!reason.normalize("NFKC").trim()) {
      setError(catalogMessage(REASON_EMPTY));
      setNotice(undefined);
      return;
    }
    setError(undefined);
    setNotice(undefined);
    sending.current = true;
    setBusy(true);
    // 成功するまで同じ中身は同じ冪等の鍵で送る（網の切れの押し直し）
    const key = last.current?.reason === reason ? last.current.key : newKey();
    last.current = { reason, key };
    try {
      const r = await call("createTicketHandover", {
        params: { id: ticket.id },
        idempotencyKey: key,
        screenId: "tickets",
        body: { kind: "offer", reason },
      });
      if (r.ok) {
        last.current = null;
        onClose();
        await ticket.reload(); // 申し出た人の帯が出る（getTicket の今の渡し）
        return;
      }
      if (r.status === 401) return; // 入り直し（共通の扱い）
      const code = errorCodeOf(r);
      const text = fill(catalogMessage(code), rec(r.body["detail"]));
      if (code === REASON_EMPTY) setError(text);
      else setNotice(text);
    } catch {
      setNotice(catalogMessage(PAGE_ERROR.offline));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const target = targetOfDetail(ticket.detail);
  return (
    <OfferDialog
      open
      assignee={assignee}
      value={reason}
      busy={busy}
      onChange={(v) => {
        setReason(v);
        setError(undefined);
      }}
      onSubmit={() => void submit()}
      onClose={onClose}
      {...(error ? { error } : {})}
      {...(notice ? { notice } : {})}
      {...(target ? { target } : {})}
    />
  );
}
