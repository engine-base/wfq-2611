// つながりの口（K-441）の DB の答えの言葉 → HTTP と errors.json の文。文言はコードに書かず正本（errors.json）から引く。
//   404（見えない・無い・消した・別の会社）と 409（E-LNK-001〜003）には field・details・detail を付けない（在るかを漏らさない・控え帳 2026-11-21）。
//   403 は FORBIDDEN。足すとき、相手に書けないときだけ欄 other_ticket_id を付ける（足す側 :id に書けないのは入口の 403・欄なし）。
//   知らない言葉・関数の例外は 503・E-PAGE-003（止める側に倒す）。ログは場所と例外の種類だけ（題名・番号を出さない）
import { kanameError } from "@kaname/errors";
import type { HookReply } from "../../../contract/deps.js";

/** 正本のエラーを、欄なし・detail なしの形で。status は正本の class から決まる物を、404・503 は呼ぶ側が決める */
const bare = (status: number, code: string): HookReply => {
  const j = kanameError(code).toJSON();
  return {
    status,
    body: {
      error: j.error,
      code: j.code,
      message: j.message,
      action: j.action,
      undo: j.undo,
      support_code: j.support_code,
    },
  };
};

/** 無い・見えない・消した・別の会社（在るかを漏らさない） */
export const notFound = (): HookReply => bare(404, "E-PAGE-001");

const WRITE_MESSAGE: Record<string, string> = {
  other_ticket_id: "つなぐ相手のチケットには書けません",
};

/** 書けない・会社の人でない（403・FORBIDDEN）。書けなかった欄が分かれば付ける */
export const forbidden = (field?: string): HookReply => ({
  status: 403,
  body: {
    error: "forbidden",
    code: "FORBIDDEN",
    ...(field ? { field, details: [{ field, message: WRITE_MESSAGE[field] ?? "書けません" }] } : {}),
  },
});

/** 入力の形違い（422・欄つき）。入口（op.ts）と同じ形 */
export const invalid = (details: { field: string; message: string }[]): HookReply => ({
  status: 422,
  body: { error: "validation_failed", code: "VALIDATION_ERROR", details },
});

/** 止める側に倒す（503・E-PAGE-003）。ログには場所と言葉の種類だけ */
export const down = (where: string, word: string): HookReply => {
  console.error(`[ticket-links] ${where}：${word}なので止める側に倒した`);
  return bare(503, "E-PAGE-003");
};

/** 足す・外すに共通の言葉：見えない・無い（404）・書けない・会社の人でない（403）。当てはまらなければ null */
function commonReply(word: string, field: unknown): HookReply | null {
  if (word === "not_found" || word === "gone") return notFound();
  if (word === "not_writable") return forbidden(typeof field === "string" ? field : undefined);
  if (word === "not_member") return forbidden();
  return null;
}

/** 足す口の DB の関数の答え { error[, field] } → 答え（409 の 3 つを持つ）。知らない言葉は止める側（言葉は記録にだけ残し、答えに出さない） */
export function replyOfAdd(r: { error?: unknown; field?: unknown }, where: string): HookReply {
  const word = String(r.error);
  const common = commonReply(word, r.field);
  if (common) return common;
  if (word === "same") return bare(409, "E-LNK-001");
  if (word === "duplicate") return bare(409, "E-LNK-002");
  if (word === "cycle") return bare(409, "E-LNK-003");
  return down(where, `知らない答え（${word}）`);
}

/** 外す口の DB の関数の答え { error } → 答え（409 は無い）。知らない言葉は止める側 */
export function replyOfRemove(r: { error?: unknown }, where: string): HookReply {
  const word = String(r.error);
  return commonReply(word, undefined) ?? down(where, `知らない答え（${word}）`);
}
