// 合意ありで配られたものに答える（answerTicketHandover の kind distribute・人宛て・K-409）。受ける＝担当者が替わる・配った人に受け箱の行、
//   断る＝理由つき・配った人に受け箱の行とメール（理由は書かない）。DB の関数 app.handover_answer_distribute を 1 取引で呼び、取引が終わってからメールを送る（関門 C6）
import { withTenant } from "@kaname/db/context";
import { down, kindOf, replyOf } from "../errors.js";
import type { AnswerKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type Answer =
  { ok: true; handover_id: string; handover: unknown; mails: MailRow[] } | { error: string; [k: string]: unknown };

export const answerDistribute: AnswerKind = async (c) => {
  let v: Answer | null;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: Answer | null }>("select app.handover_answer_distribute($1, $2::jsonb) as v", [
        c.handoverId,
        JSON.stringify(c.input),
      ]);
      return r.rows[0]?.v ?? null;
    });
  } catch (e) {
    return down("配ったものに答える", `例外（${kindOf(e)}）`);
  }
  if (!v) return down("配ったものに答える", "答えが無い");
  if ("error" in v) return replyOf(v, "配ったものに答える");
  await sendHandoverMails(
    c.d,
    { tenantId: c.a.ctx.tenantId!, userId: c.a.ctx.userId! },
    v.mails ?? [],
    `answer-distribute:${c.handoverId}`,
  );
  return { status: 200, body: { data: v.handover } };
};
