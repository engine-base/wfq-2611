"use client";
// 断る小窓の一続き（K-412）。承認待ちの行・スマホのカードの「断る」と、詳細の帯の「断る」が同じものを開く。
//   部品は views.tsx の DeclineDialog（題「断る」・断る理由（必須）・注・やめる／断る）。値と動きを渡すだけ。
//   理由が空なら送らず欄の下に E-HND-007 の文。口の断りは小窓の上の NoticeBox で、書いた理由は残す（E-HND-007 だけは欄の下）。
//   「もう決まっていた」（E-HND-005）は小窓の上に出したまま、閉じたあとに onStale で一覧か詳細を読み直す（開いたままの小窓の下で行が消えないように）。
//   開いている間だけ置く（置かれた時が「開いた時」。理由・断りの文は毎回まっさら）
import { useRef, useState } from "react";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { useAnswerCall } from "./answer";
import { DeclineDialog } from "./views";

export interface DeclineFlowProps {
  /** 渡しの id（答える口の道） */
  handoverId: string;
  /** 頭の下の対象の行（「EG-119 問い合わせ…」）。読めなければ省く */
  target: string | null;
  /** 理由が届く人の姓（「高本」→「高本さんに届き…」） */
  from: string;
  screenId: "approvals" | "tickets";
  /** 閉じる（やめる・× ・Esc・断れた後） */
  onClose: () => void;
  /** 断れた（小窓を閉じた後の読み直し。行・帯が消える） */
  onDone: () => Promise<unknown> | void;
  /** もう決まっていた（小窓を閉じた後の読み直し） */
  onStale: () => Promise<unknown> | void;
}

const REASON_EMPTY = "E-HND-007";
const GONE = "E-HND-005";

export function DeclineFlow({ handoverId, target, from, screenId, onClose, onDone, onStale }: DeclineFlowProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy, send } = useAnswerCall(handoverId, screenId);
  const stale = useRef(false);

  const close = () => {
    if (stale.current) void onStale();
    onClose();
  };

  const submit = async () => {
    if (!reason.normalize("NFKC").trim()) {
      setError(catalogMessage(REASON_EMPTY));
      setNotice(undefined);
      return;
    }
    setError(undefined);
    setNotice(undefined);
    const out = await send({ decision: "decline", decline_reason: reason });
    if (out === null) return; // 送っている間の 2 回目
    if (out.ok) {
      onClose();
      await onDone();
      return;
    }
    if (out.unauthorized) return; // 入り直し（共通の扱い）
    if (out.code === REASON_EMPTY) return setError(out.text);
    if (out.code === GONE) stale.current = true;
    setNotice(out.text);
  };

  return (
    <DeclineDialog
      open
      from={from}
      value={reason}
      busy={busy}
      onChange={(v) => {
        setReason(v);
        setError(undefined);
      }}
      onSubmit={() => void submit()}
      onClose={close}
      {...(error ? { error } : {})}
      {...(notice ? { notice } : {})}
      {...(target ? { target } : {})}
    />
  );
}
