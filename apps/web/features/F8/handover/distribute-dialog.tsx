"use client";
// 配る小窓の一続き（K-415・口は K-409・K-410 の createTicketHandover の distribute）。部品は views.tsx の DistributeDialog（題「配る」・配る相手か配るグループ・
//   理由（必須）・お願い・注）をそのまま使い、値と動きを渡すだけ。理由・お願いは親（pass-dialog.tsx の PassFlow）が持つので、「変える」で相手を選び直しても残る。
//   口は押したとき 1 回だけ（答えを待つ間は押せない・押し直しは同じ中身なら同じ冪等の鍵）。人へ配ると合意なしですぐ担当者が替わり（D-148.16）、
//   グループへ配ると決まるまで担当者は配った人のまま（D-148.17）。どちらも書いたあとは getTicket を読み直して描く（答えでは描かない）。
//   断りは答えの code の文を小窓の上の赤い箱に出す（E-HND-007 だけは理由の欄の下）。書いた中身は消さない
import { useEffect, useRef, useState } from "react";
import { useNotify } from "@/components/k";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { call } from "@/lib/api/call";
import { fill, newKey, rec } from "./pass-dialog";
import { DistributeDialog } from "./views";

/** 配る先（人かグループ）。done は配れたあとの小さな知らせの文（「鈴木さんに配りました」・「受託開発に配りました」） */
export interface DistributeDest {
  kind: "member" | "group";
  id: string;
  name: string;
  done: string;
}

export interface DistributeFlowProps {
  ticket: SlotTicket;
  open: boolean;
  dest: DistributeDest;
  reason: string;
  ask: string;
  /** 理由・お願いを打ったとき（親が持つ） */
  onChange: (patch: { reason?: string; ask?: string }) => void;
  /** 「変える」（相手を選ぶ小窓に戻る） */
  onChangeTo: () => void;
  /** 閉じる（やめる・× ・Esc・配れた後） */
  onClose: () => void;
  /** 配れた（201・詳細を読み直した後） */
  onDone?: () => void;
  /** 頭の下の対象の行（「EG-119 問い合わせ…」）。読めなければ省く */
  target?: string;
}

const REASON_EMPTY = "E-HND-007";

export function DistributeFlow({
  ticket,
  open,
  dest,
  reason,
  ask,
  onChange,
  onChangeTo,
  onClose,
  onDone,
  target,
}: DistributeFlowProps) {
  const notify = useNotify();
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const last = useRef<{ json: string; key: string } | null>(null);

  // 開くたび・相手を替えるたびに、前の断りの文は消す（書いた理由は親が持つので残る）
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setNotice(undefined);
  }, [open, dest.kind, dest.id]);

  const submit = async () => {
    if (sending.current) return;
    if (!reason.normalize("NFKC").trim()) {
      setError(catalogMessage(REASON_EMPTY));
      setNotice(undefined);
      return;
    }
    setError(undefined);
    setNotice(undefined);
    const body = {
      kind: "distribute",
      ...(dest.kind === "group" ? { to_scope_id: dest.id } : { to_member_id: dest.id }),
      reason,
      ...(ask.trim() === "" ? {} : { ask }),
    };
    const json = JSON.stringify(body);
    if (last.current?.json !== json) last.current = { json, key: newKey() };
    sending.current = true;
    setBusy(true);
    try {
      const r = await call("createTicketHandover", {
        params: { id: ticket.id },
        idempotencyKey: last.current.key,
        screenId: "tickets",
        body,
      });
      if (r.ok) {
        last.current = null;
        onClose();
        notify(dest.done);
        await ticket.reload();
        return onDone?.();
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

  return (
    <DistributeDialog
      open={open}
      to={dest.name}
      toGroup={dest.kind === "group"}
      reason={reason}
      ask={ask}
      busy={busy}
      onChange={(patch) => {
        if (patch.reason !== undefined) setError(undefined);
        onChange(patch);
      }}
      onChangeTo={onChangeTo}
      onSubmit={() => void submit()}
      onClose={onClose}
      {...(error ? { error } : {})}
      {...(notice ? { notice } : {})}
      {...(target ? { target } : {})}
    />
  );
}
