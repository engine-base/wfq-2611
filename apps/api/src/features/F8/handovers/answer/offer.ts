// 答えるの種類ごとのファイル：申し出に答える（K-408・D-148.12）。渡す＝申し出た人に担当者が替わる（受け箱だけ）・断る＝理由を残して知らせる。
//   申し出は一緒に切り替える物を選ばないので、答えに switch が付いていたら断る（この種類だけの決まり・形の誤りなので番号なしの 422）
import { withTenant } from "@kaname/db/context";
import { down, fromCatalog, invalid, kindOf, replyOf } from "../errors.js";
import type { AnswerKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type OfferAnswer = { ok: true; handover: unknown; mails: MailRow[] } | { error: string; [k: string]: unknown };

export const answerOffer: AnswerKind = async (c) => {
  const where = "申し出に答える";
  if (c.input.switch !== null) return invalid("switch", "申し出に答えるときは一緒に切り替える物を選べません");
  let v: OfferAnswer | null;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: OfferAnswer | null }>("select app.handover_answer_offer($1, $2::jsonb) as v", [
        c.handoverId,
        JSON.stringify(c.input),
      ]);
      return r.rows[0]!.v; // 行が無ければ例外 → 下の catch で止める側に倒す
    });
  } catch (e) {
    return down(where, `例外（${kindOf(e)}）`);
  }
  if (!v) return down(where, "答えが無い");
  if ("error" in v) {
    // 申し出た後に書く権限が外れた人：止まった人と同じ番号（E-HND-006）で、訳だけ変える
    if (v.error === "target" && v["reason"] === "no_offer")
      return fromCatalog("E-HND-006", 409, {
        detail: { 名前: typeof v["名前"] === "string" ? v["名前"] : "", 訳: "申し出られなくなっています" },
      });
    return replyOf(v, where);
  }
  await sendHandoverMails(
    c.d,
    { tenantId: c.a.ctx.tenantId!, userId: c.a.ctx.userId! },
    v.mails,
    `answer-offer:${c.handoverId}`,
  );
  return { status: 200, body: { data: v.handover } };
};
