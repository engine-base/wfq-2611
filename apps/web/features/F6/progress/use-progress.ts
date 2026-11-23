"use client";
// 段・保留・実績を変える口 updateTicket を 1 回呼び、答えを画面の扱いに直す（口と読み直しはここだけ・slot.tsx には口を書かない）。
//   同じチケットで答えが来るまで 2 本目は送らない（押せない形・同じ押しの 2 回目は捨てる）。
//   200 → 詳細を 1 回読み直す（ticket.reload＝詳細と同じ問い合わせの器）。
//   422 の欄の断り（保留の理由・再開の条件・actual_minutes）→ 呼んだ側が入力の下に出す（details）。ほかの断りは知らせの器（notice.ts）に口の文。
//   409・403・404 → 知らせて詳細を読み直し、入力は閉じる。503・網の切れ → 知らせて入力は開いたまま。401 は共通の扱い（入り直し・戻る先にこのチケット）
import { useCallback } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { messageOf } from "@/features/F5/approve-complete/message";
import { call, type CallErr } from "@/lib/api/call";
import { setBusy, setNotice, useProgressState } from "./notice";

export type UpdateBody =
  | { stage_key: "todo" | "doing" }
  | { stage_key: "hold"; hold_reason: string; resume_condition: string }
  | { actual_minutes: number };

export interface Sent {
  /** 200 で受けた */
  ok: boolean;
  /** 同じチケットの前の送りが終わっていないので送らなかった */
  skipped: boolean;
  /** 入力・小窓を閉じてよいか（200・409・403・404） */
  close: boolean;
  /** 422 の欄ごとの理由 [{ field, message }]（欄の断りが無ければ空） */
  details: { field: string; message: string }[];
}

const SKIPPED: Sent = { ok: false, skipped: true, close: false, details: [] };
const FIELDS = new Set(["hold_reason", "resume_condition", "actual_minutes"]);
const CLOSING = new Set([403, 404, 409]);
const inflight = new Set<string>();

/** 網の切れ（fetch が投げた）を、口が答えられなかったときと同じ形にする（messageOf が E-PAGE-007 の文に直す） */
const NETWORK_ERR: CallErr = {
  ok: false,
  status: 0,
  kind: "failed",
  code: "NETWORK",
  message: null,
  fields: {},
  retryAfterSec: null,
  body: {},
};

async function callUpdate(id: string, body: UpdateBody) {
  try {
    return await call("updateTicket", { params: { id }, body, screenId: "tickets" });
  } catch {
    return NETWORK_ERR;
  }
}

export async function updateProgress(ticket: Pick<SlotTicket, "id" | "reload">, body: UpdateBody): Promise<Sent> {
  const { id } = ticket;
  if (inflight.has(id)) return SKIPPED;
  inflight.add(id);
  setBusy(id, true);
  setNotice(id, null);
  try {
    const r = await callUpdate(id, body);
    if (r.ok) {
      await ticket.reload();
      return { ok: true, skipped: false, close: true, details: [] };
    }
    if (r.status === 401) return { ok: false, skipped: false, close: false, details: [] }; // 入り直しは共通の扱い
    const details = Object.entries(r.fields)
      .filter(([field]) => FIELDS.has(field))
      .map(([field, message]) => ({ field, message }));
    if (r.status === 422 && details.length) return { ok: false, skipped: false, close: false, details };
    setNotice(id, messageOf(r));
    const close = CLOSING.has(r.status);
    if (close) await ticket.reload();
    return { ok: false, skipped: false, close, details: [] };
  } finally {
    inflight.delete(id);
    setBusy(id, false);
  }
}

/** 差し込み口の先が使う入れ物：送っている間か・今の知らせ・送る */
export function useProgress(ticket: Pick<SlotTicket, "id" | "reload">) {
  const { busy, notice } = useProgressState(ticket.id);
  const { id, reload } = ticket;
  const send = useCallback((body: UpdateBody) => updateProgress({ id, reload }, body), [id, reload]);
  return { busy, notice, send };
}
