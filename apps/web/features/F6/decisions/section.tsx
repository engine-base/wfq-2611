"use client";
// 本文の「決定ログ」の区画（K-397）：決定の一覧と「＋ 決定を足す」の小窓を、口のつなぎ（use-decisions.ts）と見た目の部品（views.tsx）で組む。
import { useCallback, useRef } from "react";
import { toViews } from "./to-view";
import { useAddDecision, useDecisions } from "./use-decisions";
import { DecisionDialog, DecisionLog } from "./views";

export function DecisionsSection({
  ticketId,
  myName,
  label,
  intro,
}: {
  ticketId: string;
  myName: string;
  label: string;
  intro: string | undefined;
}) {
  const read = useDecisions(ticketId);
  const addRef = useRef<HTMLButtonElement>(null);
  // 小窓を閉じたら焦点を「＋ 決定を足す」に戻す（押したボタンへ）
  const back = useCallback(() => void requestAnimationFrame(() => addRef.current?.focus()), []);
  const add = useAddDecision(ticketId, myName, read.reload, back);
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
    </>
  );
}
