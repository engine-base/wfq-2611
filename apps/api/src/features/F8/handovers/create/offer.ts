// 渡すの種類ごとのファイル：申し出る（K-408・D-148.12）。DB の関数 app.handover_offer が 1 取引で
//   渡しの行・担当者の受け箱の行・証跡を書き、メールの宛てを返す。メールは取引の後に出す（関門 C6・失敗しても 201 のまま）
import { withTenant } from "@kaname/db/context";
import { down, kindOf, replyOf } from "../errors.js";
import type { CreateKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type OfferAnswer = { ok: true; handover: unknown; mails: MailRow[] } | { error: string; [k: string]: unknown };

export const createOffer: CreateKind = async (c) => {
  const where = "申し出る";
  let v: OfferAnswer | null;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: OfferAnswer | null }>("select app.handover_offer($1, $2::jsonb) as v", [
        c.ticketId,
        JSON.stringify(c.input),
      ]);
      return r.rows[0]!.v; // 行が無ければ例外 → 下の catch で止める側に倒す
    });
  } catch (e) {
    return down(where, `例外（${kindOf(e)}）`);
  }
  if (!v) return down(where, "答えが無い");
  if ("error" in v) return replyOf(v, where);
  const handover = v.handover as { id: string };
  await sendHandoverMails(
    c.d,
    { tenantId: c.a.ctx.tenantId!, userId: c.a.ctx.userId! },
    v.mails,
    `offer:${handover.id}`,
  );
  return { status: 201, body: { data: v.handover } };
};
