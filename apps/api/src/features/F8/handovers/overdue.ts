// 返事の期限が過ぎた渡しの知らせを、取引の後に送る部品（K-407・関門 C6・D-148.9）。
//   片付けの DB の関数（app.handover_overdue_sweep）が返したメールの宛てを、K-401 の sendHandoverMails で 1 通ずつ送る。
//   where は「overdue:<渡しの id>」。印は ctx（承認待ちの口が withTenant に渡したのと同じ会社と人）の会社で書く。投げない
import type { HandoverDeps } from "./deps.js";
import { kindOf } from "./errors.js";
import { sendHandoverMails, type MailRow } from "./notify.js";

/** 片付けが返す宛て（K-401 の MailRow がもう渡しの id を持っている） */
export type OverdueMail = MailRow;

export type OverdueDeps = Pick<HandoverDeps, "appPool" | "mailer" | "config">;

export async function sendOverdueMails(
  d: OverdueDeps,
  ctx: { tenantId: string; userId: string },
  mails: OverdueMail[],
): Promise<void> {
  for (const m of mails) {
    try {
      await sendHandoverMails(d, ctx, [m], `overdue:${m.handover_id}`);
    } catch (e) {
      console.error(`[handover] overdue:${m.handover_id}：知らせを送れなかった → ${kindOf(e)}`);
    }
  }
}
