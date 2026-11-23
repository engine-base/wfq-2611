"use client";
// 本文の「決定ログ」の区画（K-397）：決定の一覧と「＋ 決定を足す」の小窓を、口のつなぎ（use-decisions.ts）と見た目の部品（views.tsx）で組む。
import { useCallback, useRef } from "react";
import { toViews } from "./to-view";
import { useAddDecision, useDecisions, useReloadAll } from "./use-decisions";
import { useReviseCancel } from "./use-revise";
import { CancelDecisionConfirm, DecisionDialog, DecisionLog, ReviseDialog } from "./views";

export function DecisionsSection({
  ticketId,
  myName,
  label,
  intro,
  onSource,
  onlyWhenAny = false,
}: {
  ticketId: string;
  myName: string;
  label: string;
  intro: string | undefined;
  /** 「元：やり取り … →」を押した（元の書き込みの id） */
  onSource?: (messageId: string) => void;
  /** 区画の行が無いチケット（K-1119）：決定が 1 件も無く、頭の知らせも足す小窓も無い間は何も描かない */
  onlyWhenAny?: boolean;
}) {
  const read = useDecisions(ticketId);
  // 決定にした・改めた・取り消した後は、決定の一覧とやり取りを 1 回ずつ読み直す
  const reload = useReloadAll(ticketId);
  const addRef = useRef<HTMLButtonElement>(null);
  // 小窓を閉じたら焦点を「＋ 決定を足す」に戻す（押したボタンへ）
  const back = useCallback(() => void requestAnimationFrame(() => addRef.current?.focus()), []);
  const add = useAddDecision(ticketId, myName, reload, back);
  const rv = useReviseCancel(ticketId, read.rows, reload);
  if (onlyWhenAny && !(read.rows.length > 0) && !add.sectionNotice && !add.open) return null;
  return (
    <>
      <DecisionLog
        label={label}
        {...(intro ? { intro } : {})}
        items={toViews(read.rows)}
        canWrite={read.canWrite}
        loading={read.status === "loading"}
        failed={read.status === "failed"}
        {...(add.sectionNotice ? { notice: add.sectionNotice } : {})}
        onAdd={add.start}
        onRetry={() => void read.reload()}
        {...(onSource ? { onSource } : {})}
        onRevise={rv.onRevise}
        onCancel={rv.onCancel}
        addRef={addRef}
      />
      <DecisionDialog
        open={add.open}
        by={add.by}
        people={add.people}
        {...(add.peopleFailed ? { peopleFailed: add.peopleFailed } : {})}
        {...(add.notice ? { notice: add.notice } : {})}
        {...(add.errors ? { errors: add.errors } : {})}
        busy={add.busy}
        onCancel={add.cancel}
        onSubmit={(v) => void add.submit(v)}
      />
      <ReviseDialog
        open={rv.revise.open}
        prev={rv.revise.prev}
        conflict={rv.revise.conflict}
        {...(rv.revise.conflictText ? { conflictText: rv.revise.conflictText } : {})}
        {...(rv.revise.notice ? { notice: rv.revise.notice } : {})}
        {...(rv.revise.errors ? { errors: rv.revise.errors } : {})}
        busy={rv.revise.busy}
        onClose={rv.revise.onClose}
        onSubmit={rv.revise.onSubmit}
      />
      <CancelDecisionConfirm
        open={rv.cancel.open}
        text={rv.cancel.text}
        {...(rv.cancel.notice ? { notice: rv.cancel.notice } : {})}
        {...(rv.cancel.errors ? { errors: rv.cancel.errors } : {})}
        busy={rv.cancel.busy}
        onClose={rv.cancel.onClose}
        onSubmit={rv.cancel.onSubmit}
      />
    </>
  );
}
