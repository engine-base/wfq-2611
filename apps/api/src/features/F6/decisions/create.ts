// 決定を足す口（K-390）：createTicketDecision（POST /api/v1/tickets/:id/decisions）。
//   書くのは関門 C2 の app.ticket_decision_add（決定・やり取りの 1 行・受け箱・証跡を 1 つの処理で・関数の中でもう一度、今のメンバーか・書けるかを確かめる）だけ。
//   体は text・reason・decided_by_member_id・decided_note・source_message_id・promoted_to の 6 つだけを関数へ渡す（書いた人・決めた時刻・改めた先は入れさせない）。
//   字数の上限は置かない・切らない（D-130.1。1 回 1MB の守りは入口）。ログに決めたことの字を出さない。
//   守りの判定で例外 → 503・E-PAGE-003。書く所の DB の失敗も 503・E-PAGE-003（何も残らない）
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { fromCatalog, replyOf } from "./errors.js";

/** 関数に渡す 6 つの欄。送られていない欄は入れない */
export const INPUT_KEYS = [
  "text",
  "reason",
  "decided_by_member_id",
  "decided_note",
  "source_message_id",
  "promoted_to",
] as const;

type Added = { decision?: unknown; message_id?: unknown; error?: unknown };

export function pickInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    INPUT_KEYS.filter((k) => input[k] !== undefined && input[k] !== null).map((k) => [k, input[k]]),
  );
}

export function createCreateTicketDecision(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs) => {
    let r: Added | undefined;
    try {
      r = await withTenant(
        appPool,
        a.ctx,
        async (cl) =>
          (
            await cl.query<{ v: Added }>("select app.ticket_decision_add($1, $2::jsonb) as v", [
              a.id,
              JSON.stringify(pickInput(a.input)),
            ])
          ).rows[0]?.v,
      );
    } catch (e) {
      // 書く所の失敗（1 つの処理なので何も残らない）。中身を返さず、ログは場所と例外の種類だけ
      console.error(`[decisions] 決定を足す：書く所で失敗した（${(e as Error)?.name ?? "Error"}）`);
      return fromCatalog("E-PAGE-003", 503);
    }
    if (!r) return replyOf({ error: "empty" }, "決定を足す");
    if (r.error !== undefined) return replyOf(r, "決定を足す");
    return { status: 201, body: { data: { decision: r.decision, message_id: r.message_id } } };
  };
}
