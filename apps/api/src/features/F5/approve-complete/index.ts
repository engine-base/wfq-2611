// 承認して完了する（K-63 の孫 K-161〜K-166）の契約の口の振る舞い。apps/api/src/server.ts の contract.hooks に足す。
//   K-161：読む口（listApprovalQueue・getApproval・queue.ts）。K-162：承認（approveApproval・decide.ts）。
//   K-163：差し戻し（returnApproval・decide.ts）。K-165：完了（completeTicket・complete.ts）。
//   K-166：完了の知らせの宛先と失敗の記録・守りの例外と知らない言葉の 503・終わっていない子の明細（complete.ts・errors.ts）
import type pg from "pg";
import type { Hook } from "../../../contract/deps.js";
import { completeHooks, type CompleteOptions } from "./complete.js";
import { decideHooks } from "./decide.js";
import { queueHooks, type OverdueMailOptions } from "./queue.js";

/** K-407：承認待ちの口は、渡した人が開いたとき期限切れの知らせのメールを送る（mailer・webBaseUrl が無ければ送れない扱い） */
export function approveHooks(pool: pg.Pool, o: CompleteOptions & OverdueMailOptions = {}): Record<string, Hook> {
  return {
    ...queueHooks(pool, {
      ...(o.mailer ? { mailer: o.mailer } : {}),
      ...(o.webBaseUrl ? { webBaseUrl: o.webBaseUrl } : {}),
    }),
    ...decideHooks(pool),
    ...completeHooks(pool, o),
  };
}
