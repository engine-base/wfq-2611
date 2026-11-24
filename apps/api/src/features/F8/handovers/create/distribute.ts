// 人に配る（createTicketHandover の kind distribute・to_member_id・K-409）。DB の関数 app.handover_distribute を 1 取引で呼び、
//   合意なしなら配ると同時に担当者が替わる（渡しの行・担当者・一緒に切り替え・受け箱の行・証跡を 1 つの取引）。取引が終わってからメールを送る（関門 C6）。
//   共通の断りは K-401 の replyOf、この葉が足す 2 つ（E-HND-130・131）はここで訳す。ログに理由・宛てを出さない
import { withTenant } from "@kaname/db/context";
import type { HookReply } from "../../../../contract/deps.js";
import { down, fromCatalog, kindOf, replyOf } from "../errors.js";
import type { CreateKind } from "../kinds.js";
import { sendHandoverMails, type MailRow } from "../notify.js";

type Answer =
  { ok: true; handover_id: string; handover: unknown; mails: MailRow[] } | { error: string; [k: string]: unknown };

/** この葉が足す断り：閲覧のみ・ゲスト／今の担当者を相手に選んだ（409・K-401 の決めどおり 409 に欄・details は付けない） */
function reply(v: { error: string; [k: string]: unknown }): HookReply {
  if (v.error === "viewer") return fromCatalog("E-HND-130", 409);
  if (v.error === "current") return fromCatalog("E-HND-131", 409);
  return replyOf(v, "人に配る");
}

export const createDistribute: CreateKind = async (c) => {
  let v: Answer | null;
  try {
    v = await withTenant(c.d.appPool, c.a.ctx, async (cl) => {
      const r = await cl.query<{ v: Answer | null }>("select app.handover_distribute($1, $2::jsonb) as v", [
        c.ticketId,
        JSON.stringify(c.input),
      ]);
      return r.rows[0]?.v ?? null;
    });
  } catch (e) {
    return down("人に配る", `例外（${kindOf(e)}）`);
  }
  if (!v) return down("人に配る", "答えが無い");
  if ("error" in v) return reply(v);
  await sendHandoverMails(
    c.d,
    { tenantId: c.a.ctx.tenantId!, userId: c.a.ctx.userId! },
    v.mails ?? [],
    `distribute:${v.handover_id}`,
  );
  return { status: 201, body: { data: v.handover } };
};
