// 渡す口の種類 distribute（to_scope_id が在る）＝グループに配る（K-410・D-125.92・D-148.17・D-148.19）。DB の関数 app.handover_distribute_group が 1 取引で
//   渡しの行・担当者を配った人に・知らせの行・証跡を書き、取引の後にグループで権限を持つ人へメールを 1 通ずつ送る（関門 C6）。理由とお願いはログにもメールにも出さない
import { withTenant } from "@kaname/db/context";
import type { HookReply } from "../../../../contract/deps.js";
import { down, kindOf, replyOf } from "../errors.js";
import type { CreateKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type GroupAnswer = {
  ok?: boolean;
  error?: string;
  handover_id?: string;
  handover?: Record<string, unknown>;
  mails?: MailRow[];
  [k: string]: unknown;
} | null;

export const createDistributeGroup: CreateKind = async (c): Promise<HookReply> => {
  const where = "グループに配る";
  let v: GroupAnswer;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: GroupAnswer }>("select app.handover_distribute_group($1, $2::jsonb) as v", [
        c.ticketId,
        JSON.stringify(c.input),
      ]);
      return r.rows[0]?.v ?? null;
    });
  } catch (e) {
    return down(where, `例外（${kindOf(e)}）`);
  }
  if (!v) return down(where, "答えが無い");
  if (typeof v.error === "string") return replyOf(v as { error: string }, where);
  if (v.ok !== true || !v.handover || !v.handover_id) return down(where, "答えの形が違う");
  await sendHandoverMails(
    c.d,
    { tenantId: c.a.ctx.tenantId!, userId: c.a.ctx.userId! },
    v.mails ?? [],
    `distribute-group:${v.handover_id}`,
  );
  return { status: 201, body: { data: v.handover } };
};
