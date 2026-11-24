// グループに配られた渡しを引き取る（K-410・D-125.118・D-148.19）。自分が持つ（answer/distribute-group.ts）と人を決める（claimTicketHandover）が同じ DB の関数
//   app.handover_claim を呼ぶ。言葉は K-401 の replyOf に、この葉の 3 つ（claim_missing＝無い人・別の会社の人・抜けた人は 404、claim_group・claim_state は 409）を足して返す。ログに人の名前・メールを出さない
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import type { HandoverDeps } from "./deps.js";
import { isUuid } from "@kaname/contracts";
import { down, fromCatalog, invalid, kindOf, notFound, replyOf } from "./errors.js";
import { isReply } from "./input.js";
import { sendHandoverMails, type MailRow } from "./notify.js";

export type ClaimAnswer = {
  ok?: boolean;
  error?: string;
  handover_id?: string;
  handover?: Record<string, unknown>;
  assignee_member_id?: string;
  mails?: MailRow[];
  [k: string]: unknown;
} | null;

/** 引き取る DB の関数の答え → 断る答え（ok でなければ）。この葉の言葉は claim_missing（404）・E-HND-150・151 */
export function claimReply(v: { error: string; [k: string]: unknown }, where: string): HookReply {
  // 無い人・別の会社の人は見えない物：在らない id と同じ 404 E-PAGE-001（欄なし・控え帳 2026-11-20 16:51）
  if (v.error === "claim_missing") return notFound();
  if (v.error === "claim_group") return fromCatalog("E-HND-150", 409);
  if (v.error === "claim_state") return fromCatalog("E-HND-151", 409);
  return replyOf(v, where);
}

/** DB の関数 app.handover_claim を 1 取引で呼ぶ。人宛ての渡し（関数が 42501）は 403・E-HND-002、ほかの例外は 503・E-PAGE-003 */
export async function runClaim(
  d: HandoverDeps,
  a: HookArgs,
  handoverId: string,
  memberId: string | null,
  where: string,
): Promise<ClaimAnswer | HookReply> {
  try {
    return await withTenant(d.appPool, a.ctx, async (cl) => {
      const r = await cl.query<{ v: ClaimAnswer }>("select app.handover_claim($1, $2) as v", [handoverId, memberId]);
      return r.rows[0]?.v ?? null;
    });
  } catch (e) {
    if (kindOf(e) === "42501") return fromCatalog("E-HND-002", 403);
    return down(where, `例外（${kindOf(e)}）`);
  }
}

/** 人を決める口（claimTicketHandover・POST /ticket_handovers/:id/claim）：入力 { member_id: uuid }（必須・strict） */
export function claimHandover(d: HandoverDeps) {
  const where = "人を決める";
  return async (a: HookArgs): Promise<HookReply> => {
    const input = a.input as Record<string, unknown> | null;
    const extra = Object.keys(input ?? {}).filter((k) => k !== "member_id");
    if (extra.length > 0) return invalid(extra[0]!, "知らない欄です");
    const memberId = input?.["member_id"];
    if (typeof memberId !== "string" || !isUuid(memberId))
      return invalid("member_id", "人の id（uuid）を入れてください");
    const handoverId = a.id ?? "";
    const v = await runClaim(d, a, handoverId, memberId.toLowerCase(), where);
    if (isReply(v)) return v;
    if (!v) return down(where, "答えが無い");
    if (typeof v.error === "string") return claimReply(v as { error: string }, where);
    if (v.ok !== true || !v.handover_id || !v.assignee_member_id) return down(where, "答えの形が違う");
    await sendHandoverMails(
      d,
      { tenantId: a.ctx.tenantId!, userId: a.ctx.userId! },
      v.mails ?? [],
      `claim:${handoverId}`,
    );
    const h = v.handover ?? {};
    return {
      status: 200,
      body: {
        data: {
          id: v.handover_id,
          state: h["state"] ?? "accepted",
          ticket_id: h["ticket_id"],
          assignee_member_id: v.assignee_member_id,
        },
      },
    };
  };
}
