// 催促する口（remindTicketHandover・POST /ticket_handovers/:id/remind・入口の行の言葉は渡した人だけ・K-406・D-148.8・D-148.19）。
//   ① 取引：app.handover_remind（状態・種類・今日（日本の日付）の催促済みを見て、催促した時刻・受け箱の行・証跡を書く）
//   ② 取引の後：K-401 の部品でメールを送り、送れた／送れなかったの印を知らせの行に書く（投げない）
//   メールが送れなくても 201（meta.mail が failed）。受け箱の行と催促した時刻は残る（1 日 1 回の決まりのまま）
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import type { HandoverDeps } from "./deps.js";
import { down, kindOf } from "./errors.js";
import { sendHandoverMails, type MailRow } from "./notify.js";
import { refusal, type SenderAnswer } from "./withdraw.js";

export function remindHandover(d: HandoverDeps) {
  return async (a: HookArgs): Promise<HookReply> => {
    let v: SenderAnswer;
    try {
      v = await withTenant(d.appPool, a.ctx, async (cl) => {
        const r = await cl.query<{ v: SenderAnswer }>("select app.handover_remind($1) as v", [a.id ?? ""]);
        return r.rows[0]?.v ?? null;
      });
    } catch (e) {
      return down("催促する", `例外（${kindOf(e)}）`);
    }
    const no = refusal(v, "催促する");
    if (no) return no;
    const id = String(v?.["id"] ?? "");
    const mails = Array.isArray(v?.["mails"]) ? (v?.["mails"] as MailRow[]) : [];
    const r = await sendHandoverMails(
      d,
      { tenantId: a.ctx.tenantId ?? "", userId: a.ctx.userId ?? "" },
      mails,
      `remind:${id}`,
    );
    const mail = mails.length > 0 && r.failed.length === 0 ? "sent" : "failed";
    return { status: 201, body: { data: { id, reminded_at: v?.["reminded_at"] }, meta: { mail } } };
  };
}
