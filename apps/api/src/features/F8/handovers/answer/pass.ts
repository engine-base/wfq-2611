// 答える口の種類 pass（受ける・断る・K-403）。DB の関数 app.handover_answer_pass が行・担当者・知らせの行・証跡を 1 取引で書き、
//   口は言葉を HTTP にする（言葉の表は errors.ts の replyOf の 1 か所）。断るときだけ、取引の後に渡した人へメールを 1 通送る（関門 C6）
import { withTenant } from "@kaname/db/context";
import type { HookReply } from "../../../../contract/deps.js";
import { down, invalid, kindOf, replyOf } from "../errors.js";
import type { AnswerKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type PassAnswer = {
  ok?: boolean;
  error?: string;
  handover?: Record<string, unknown>;
  mails?: MailRow[];
  [k: string]: unknown;
} | null;

const WHERE = "答える pass";

export const answerPass: AnswerKind = async (c): Promise<HookReply> => {
  // 種類 pass の答えでは switch を受けない（渡した人が小窓で決めた物を使う）。DB の中身で決まる断りではなく入力の種類の誤りなので、番号なしの 422（E-HND-011 は 409・ワークスペースの決まりと合わない場合）
  if (c.input.switch !== null)
    return invalid("switch", "引き継いでもらうの答えでは切り替えるものを選べません（渡した人が決めた物を使います）");
  let v: PassAnswer;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: PassAnswer }>("select app.handover_answer_pass($1, $2::jsonb) as v", [
        c.handoverId,
        JSON.stringify({ decision: c.input.decision, decline_reason: c.input.decline_reason }),
      ]);
      return r.rows[0]?.v ?? null;
    });
  } catch (e) {
    return down(WHERE, `例外（${kindOf(e)}）`);
  }
  if (!v) return down(WHERE, "答えが無い");
  if (typeof v.error === "string") return replyOf(v as { error: string }, WHERE);
  if (v.ok !== true || !v.handover) return down(WHERE, "答えの形が違う");
  const { tenantId, userId } = c.a.ctx;
  if (tenantId && userId)
    await sendHandoverMails(c.d, { tenantId, userId }, v.mails ?? [], `answer-pass:${c.handoverId}`);
  return { status: 200, body: { data: v.handover } };
};
