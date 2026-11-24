// 渡す口の種類 pass＝引き継いでもらう（K-402・D-125.88・D-148.19）。DB の関数 app.handover_pass が 1 取引で渡しの行・知らせの行・証跡を書き、
//   取引の後にメールを 1 通ずつ送る（関門 C6）。理由とお願いはログにもメールにも出さない
import { withTenant } from "@kaname/db/context";
import type { HookReply } from "../../../../contract/deps.js";
import { down, kindOf, replyOf } from "../errors.js";
import type { CreateKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type PassAnswer = {
  ok?: boolean;
  error?: string;
  handover?: { id: string };
  mails?: MailRow[];
  [k: string]: unknown;
} | null;

export const createPass: CreateKind = async (c): Promise<HookReply> => {
  const where = "引き継いでもらう";
  let v: PassAnswer;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: PassAnswer }>("select app.handover_pass($1, $2::jsonb) as v", [
        c.ticketId,
        JSON.stringify(c.input),
      ]);
      return r.rows[0]!.v;
    });
  } catch (e) {
    return down(where, `例外（${kindOf(e)}）`);
  }
  if (typeof v?.error === "string") return replyOf(v as { error: string }, where);
  // 答えの形が違う・会社か人が無い・知らせの表が無い：どれも止める側に倒す（1 つの確かめ）
  const { tenantId, userId } = c.a.ctx;
  if (!v || v.ok !== true || !v.handover || !Array.isArray(v.mails) || !tenantId || !userId)
    return down(where, "答えの形が違う（か会社・人が無い）");
  await sendHandoverMails(c.d, { tenantId, userId }, v.mails, `pass:${v.handover.id}`);
  return { status: 201, body: { data: v.handover } };
};
