// 答えるの種類 distribute（グループ宛て）＝自分が持つ（K-410・D-125.118・D-148.17）。グループ宛ては断れない（409・E-HND-152・DB を引かない）。
//   受ける（accept）は DB の関数 app.handover_claim(渡しの id, null) で、呼んだ人が担当者になる。配った人に知らせの行だけ（メールは無い）
import type { HookReply } from "../../../../contract/deps.js";
import { claimReply, runClaim } from "../claim.js";
import { down, fromCatalog } from "../errors.js";
import { isReply } from "../input.js";
import type { AnswerKind } from "../kinds.js";

export const answerDistributeGroup: AnswerKind = async (c): Promise<HookReply> => {
  const where = "グループ宛てを自分が持つ";
  if (c.input.decision === "decline") return fromCatalog("E-HND-152", 409);
  const v = await runClaim(c.d, c.a, c.handoverId, null, where);
  if (!v) return down(where, "答えが無い");
  if (isReply(v)) return v;
  const r = v;
  if (typeof r.error === "string") return claimReply(r as { error: string }, where);
  if (r.ok !== true || !r.handover) return down(where, "答えの形が違う");
  return { status: 200, body: { data: r.handover } };
};
