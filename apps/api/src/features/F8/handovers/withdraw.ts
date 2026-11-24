// 取り消す口（withdrawTicketHandover・POST /ticket_handovers/:id/withdraw・入口の行の言葉は渡した人だけ・K-406・D-148.5・D-148.19）。
//   1 取引・文 1 つ（app.handover_withdraw）で、待っている渡しを withdrawn にし、相手に受け箱の行（メールは出さない）と証跡を書く。
//   渡した人の判定は入口の行の決まりと DB の関数の中の 2 層。DB に書くのが失敗したら取引ごと戻り、止める側（503・E-PAGE-003）
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import type { HandoverDeps } from "./deps.js";
import { down, fromCatalog, kindOf, notFound } from "./errors.js";

/** DB の関数（app.handover_withdraw・app.handover_remind）の答え */
export type SenderAnswer = { ok?: boolean; status?: number; code?: string; [k: string]: unknown } | null;

/** 断る答え（無い 404・渡した人でない 403・もう決まった／今日もう催促した／催促できない種類 409）。通る答えなら null。催促する口も使う */
export function refusal(v: SenderAnswer, where: string): HookReply | null {
  if (v?.ok === true) return null;
  if (v?.ok === false) {
    if (v.status === 404) return notFound();
    if (v.status === 403) return fromCatalog("E-HND-002", 403);
    if (v.status === 409 && typeof v.code === "string") return fromCatalog(v.code, 409);
  }
  return down(where, "知らない答え");
}

export function withdrawHandover(d: HandoverDeps) {
  return async (a: HookArgs): Promise<HookReply> => {
    let v: SenderAnswer;
    try {
      v = await withTenant(d.appPool, a.ctx, async (cl) => {
        const r = await cl.query<{ v: SenderAnswer }>("select app.handover_withdraw($1) as v", [a.id ?? ""]);
        return r.rows[0]?.v ?? null;
      });
    } catch (e) {
      return down("取り消す", `例外（${kindOf(e)}）`);
    }
    const no = refusal(v, "取り消す");
    if (no) return no;
    return { status: 201, body: { data: { id: v?.["id"], state: v?.["state"], decided_at: v?.["decided_at"] } } };
  };
}
