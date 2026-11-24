"use client";
// 渡された人が答える（受ける・断る）口の呼び方と、画面の文の部品（K-412）。承認待ちの行・スマホのカード・詳細の帯・断る小窓が同じものを使う。
//   口は K-403 の answerTicketHandover（PATCH /api/v1/ticket_handovers/:id・頭 Idempotency-Key）。口は 1 回に 1 件だけ送る（答えが来るまで 2 本目を送らない）。
//   押し直しは同じ冪等の鍵（中身が変わったときだけ新しい鍵）。断りの文は正本（errors.json）の 1 件の最初の 1 文
import { useCallback, useRef, useState } from "react";
import { PAGE_ERROR, errorCodeOf, errorText } from "@/components/k/error-of";
import type { SlotDetail } from "@/features/F4/create-ticket/detail-slots";
import { call } from "@/lib/api/call";

const JST_MS = 9 * 3600_000;
const pad = (n: number): string => String(n).padStart(2, "0");

/** 行・カード・帯に出す日時の字（11/23 18:00・日本時間）。読めなければ空 */
export function formatMoment(iso: string | null): string {
  const t = iso === null ? NaN : Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + JST_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 正本の 1 件の最初の 1 文（正本に無い番号は「読み込めませんでした」の文） */
export function sentenceOf(code: string): string {
  try {
    return errorText(code).title;
  } catch {
    return errorText(PAGE_ERROR.loadFailed).title;
  }
}

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** 詳細の答えの「EG-119 問い合わせ…」（小窓の頭の下の対象の行）。読めなければ null */
export function targetOfDetail(detail: SlotDetail): string | null {
  const t = rec(detail["ticket"]);
  const number = t?.["number"];
  const title = t?.["title"];
  return typeof number === "string" && typeof title === "string" ? `${number} ${title}` : null;
}

/** 承認待ちの行の小窓の対象の行（「EG-119 問い合わせ…」） */
export function targetOfRow(row: { ticket_number: string; title: string }): string {
  return `${row.ticket_number} ${row.title}`;
}

/** 答えの中身（受ける・断る）。理由は断るだけ */
export type AnswerBody = { decision: "accept" } | { decision: "decline"; decline_reason: string };

export type Outcome =
  | { ok: true }
  | { ok: false; code: string; text: string; /** 入り直し（共通の扱い・画面は何も出さない） */ unauthorized: boolean };

const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/**
 * 答える口を呼ぶ（1 つの渡しにつき 1 つ）。送っている間は busy で、その間の 2 回目は null を返して送らない。
 * 成功するまで同じ中身は同じ冪等の鍵で送る
 */
export function useAnswerCall(handoverId: string, screenId: "approvals" | "tickets") {
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const last = useRef<{ json: string; key: string } | null>(null);
  const send = useCallback(
    async (body: AnswerBody): Promise<Outcome | null> => {
      if (sending.current) return null;
      sending.current = true;
      setBusy(true);
      const json = JSON.stringify(body);
      if (last.current?.json !== json) last.current = { json, key: newKey() };
      const key = last.current.key;
      try {
        const r = await call("answerTicketHandover", {
          params: { id: handoverId },
          idempotencyKey: key,
          screenId,
          body,
        });
        if (r.ok) {
          last.current = null;
          return { ok: true };
        }
        const code = errorCodeOf(r);
        return { ok: false, code, text: sentenceOf(code), unauthorized: r.status === 401 };
      } catch {
        return { ok: false, code: PAGE_ERROR.offline, text: sentenceOf(PAGE_ERROR.offline), unauthorized: false };
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [handoverId, screenId],
  );
  return { busy, send };
}
