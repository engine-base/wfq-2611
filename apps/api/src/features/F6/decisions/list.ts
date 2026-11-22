// 決定を読む口（K-390）：listTicketDecisions（GET /api/v1/tickets/:id/decisions）。読むだけ（DB に書かない）。
//   取引は 1 つ（withTenant）・文は 1 つ（app.ticket_decision_list を 1 回）。決めた人の名前は関数の中で引く（行ごとに口から引かない）。
//   200 { data: [決定…], meta: { can_write } }。can_write は呼んだ人が今のメンバーで書けるか（画面 K-397 が「＋ 決定を足す」を出すかに使う）。
//   見られないチケット・消したチケットは関数が null → 404（D-136.2）。読む所で例外 → 503・E-PAGE-003（止める側に倒す・D-136.1）
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { decisionsDown, fromCatalog } from "./errors.js";

interface DecisionList {
  items: unknown[];
  can_write: boolean;
}

export function createListTicketDecisions(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs) => {
    let v: DecisionList | null;
    try {
      v = await withTenant(appPool, a.ctx, async (cl) => {
        const r = await cl.query<{ v: DecisionList | null }>("select app.ticket_decision_list($1) as v", [a.id]);
        return r.rows[0]?.v ?? null;
      });
    } catch (e) {
      return decisionsDown("決定を読む", (e as Error)?.name ?? "Error");
    }
    if (!v) return fromCatalog("E-PAGE-001", 404);
    return { status: 200, body: { data: v.items, meta: { can_write: v.can_write === true } } };
  };
}
