// 段・実績・保留を変える（K-387）の答え：DB の答えの言葉 → HTTP と errors.json の文。文言はコードに書かず正本（errors.json）から引く。
//   断る番号は役割で分ける（代表の答え answer=f0f290e785a9・03_architecture/共通の決まり.md）：
//     422＝形の誤り（契約に書ける物だけ）／404＝指した物が無い・見えない／409＝今の状態ではできない
//   写し元は F5/approve-complete/errors.ts の fromCatalog・invalid と同じ形（F5 のファイルは触らない）。
//   ログに理由の字・題名を出さない（ログは場所と言葉だけ）
import { kanameError } from "@kaname/errors";
import type { HookReply } from "../../../contract/deps.js";

/** 正本のエラー（欄つき：明細はその欄の正本の文） */
export const fromCatalog = (code: string, status: number, o: { field?: string } = {}): HookReply => {
  const e = kanameError(code);
  return {
    status,
    body: {
      ...e.toJSON(),
      ...(o.field ? { field: o.field, details: [{ field: o.field, message: e.entry.message }] } : {}),
    },
  };
};
/** 入力の形違い（422・欄ごとの文）。入口（op.ts）と同じ形 */
export const invalid = (details: { field: string; message: string }[]): HookReply => ({
  status: 422,
  body: { error: "validation_failed", code: "VALIDATION_ERROR", details },
});
/** 止める側に倒す（fail-closed・503・E-PAGE-003）。ログには場所と言葉の種類だけ */
export const down = (where: string, word: string): HookReply => {
  console.error(`[progress] ${where}：知らない答え（${word}）なので止める側に倒した`);
  return fromCatalog("E-PAGE-003", 503);
};

/** 保留の欄ごとの番号（欄の順＝hold_reason → resume_condition） */
export const HOLD_CODES: Readonly<Record<string, string>> = { hold_reason: "E-VAL-041", resume_condition: "E-VAL-047" };
/** 保留でない行き先（stage_key の todo・doing）に付けた欄の文（形の誤り・422） */
export const HOLD_ONLY_MESSAGE = "保留にするときだけ書けます";
/** stage_id と stage_key の両方（形の誤り・422） */
export const STAGE_BOTH_MESSAGE = "どちらか 1 つにしてください";
/** 実績の値域の外（形の誤り・422） */
export const MINUTES_MESSAGE = "0〜100000 の整数（分）で送ってください";

/** 足りない保留の欄の明細（欄ごとにその欄の正本の文）。code は欄の順で最初に足りない欄の番号 */
export function holdMissing(missing: readonly string[], status: number, code?: string): HookReply {
  const first = HOLD_CODES[missing[0] ?? "hold_reason"]!;
  return {
    status,
    body: {
      ...kanameError(code ?? first).toJSON(),
      details: missing.map((field) => ({ field, message: kanameError(HOLD_CODES[field]!).entry.message })),
    },
  };
}

const fieldsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

/** DB の関数 app.ticket_progress_set の答え { error: <言葉>, fields? } → 答え。知らない言葉は止める側（503）。
 *  sent はこの組に送られた欄（stage_key で選んだときの断りは形の誤り＝前処理と同じ 422・stage_id か段なしは DB の中身で決まる 409） */
export function replyOf(
  r: { error?: unknown; fields?: unknown },
  where: string,
  sent: Readonly<Record<string, unknown>>,
): HookReply {
  const word = String(r.error);
  const fields = fieldsOf(r.fields);
  const byKey = sent["stage_key"] !== undefined;
  if (word === "not_found") return fromCatalog("E-PAGE-001", 404);
  if (word === "not_member" || word === "not_writable")
    return { status: 403, body: { error: "forbidden", code: "FORBIDDEN" } };
  // 指した段が無い・別の会社・消した（404・欄つき）／仕組みの段・完了の段は段の口では移せない（409 E-CONF-034）
  if (word === "stage_missing") return fromCatalog("E-PAGE-001", 404, { field: fields[0] ?? "stage_id" });
  if (word === "stage_fixed") return fromCatalog("E-CONF-034", 409, { field: fields[0] ?? "stage_id" });
  if (word === "stage_both") return invalid([{ field: "stage_key", message: STAGE_BOTH_MESSAGE }]);
  if (word === "busy") return fromCatalog("E-CONF-030", 409);
  if (word === "done") return fromCatalog("E-CONF-032", 409);
  // 保留にするのに理由か条件が足りない：stage_key hold なら形の誤り（422 E-VAL-041・047）、段の id で保留の段を選んだなら 409 E-CONF-035
  if (word === "hold_required" && fields.length) {
    const missing = fields.filter((f) => HOLD_CODES[f]);
    return byKey ? holdMissing(missing, 422) : holdMissing(missing, 409, "E-CONF-035");
  }
  // 保留でないのに保留の欄：stage_key todo・doing なら形の誤り（422）、段の id か段を送らない（保留でないチケットの理由だけ直す）なら 409 E-CONF-036
  if (word === "hold_not_allowed" && fields.length) {
    if (byKey) return invalid(fields.map((field) => ({ field, message: HOLD_ONLY_MESSAGE })));
    const e = kanameError("E-CONF-036");
    return {
      status: 409,
      body: { ...e.toJSON(), details: fields.map((field) => ({ field, message: e.entry.message })) },
    };
  }
  if (word === "bad_minutes") return invalid([{ field: "actual_minutes", message: MINUTES_MESSAGE }]);
  // 守りの判定で例外（guard_failed・D-136.1）。知らない言葉も止める側
  return down(where, word);
}
