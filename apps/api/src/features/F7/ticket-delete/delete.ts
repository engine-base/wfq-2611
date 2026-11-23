// チケットを消す口（K-488）：deleteTicket（DELETE /api/v1/tickets/:id?children=&parent_id=&reason=）。
//   消すのは deleted_at を立てるだけ（論理削除・30 日は戻せる・D-128.84）。判定と書き込みは 1 つの DB の関数 app.ticket_delete の 1 取引の中（関門 C2）：
//   作った人か tickets の edit か・子・孫の扱い（move・cascade・detach）・決まっていない承認の取り下げ・走っている AI の止め・証跡 1 枚ごと。
//   口は問い合わせの形を確かめ（input.ts）、関数の答えを断りの番号に写すだけ。関数が例外（権限・DB・証跡の書き込み失敗）なら取引ごと戻り、503・E-PAGE-003。
//   上限・認証・同意し直しの止め・行の決まり（見える）・uuid の形は契約の入口（op.ts）が先に確かめる。Cache-Control: private, no-store は入口が全部の答えに付ける。
//   ログに本文・理由・人の id を出さない。
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import { kanameError } from "@kaname/errors";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { parseDeleteQuery } from "./input.js";
import { down, forbidden, notFound, restorableUntil } from "./shared.js";

type Answer = {
  ok?: boolean;
  code?: string;
  id?: string;
  deleted_count?: number;
  withdrawn_approvals?: number;
  stopped_runs?: number;
  deleted_at?: string;
};

const SQL = "select app.ticket_delete($1, $2, $3, $4) as v";

/** 関数が返した断りの印 → 答え。404・409 には field・details を付けない（在るかを漏らさない） */
const refusal = (code: string | undefined): HookReply => {
  switch (code) {
    case "NOT_FOUND":
      return notFound();
    case "FORBIDDEN":
      return forbidden();
    case "PARENT_NOT_FOUND":
      return { status: 404, body: kanameError("E-DEL-014").toJSON() };
    case "CHILDREN_REQUIRED":
      return { status: 409, body: kanameError("E-DEL-010").toJSON() };
    case "PARENT_INVALID":
      return { status: 409, body: kanameError("E-DEL-011").toJSON() };
    case "TOO_DEEP":
      return { status: 409, body: kanameError("E-DEL-012").toJSON() };
    case "CASCADE_FORBIDDEN":
      return { status: 403, body: kanameError("E-DEL-013").toJSON() };
    default:
      return down("消す（知らない答え）", new Error("unknown answer"));
  }
};

export function createDeleteTicket(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    const parsed = parseDeleteQuery(a.c.req.query());
    if (!parsed.ok)
      return { status: 422, body: { error: "validation_failed", code: "VALIDATION_ERROR", details: parsed.details } };
    const { children, parent, reason } = parsed.value;
    let v: Answer | undefined;
    try {
      v = await withTenant(
        appPool,
        a.ctx,
        async (cl) => (await cl.query<{ v: Answer }>(SQL, [a.id, children, parent, reason])).rows[0]?.v,
      );
    } catch (e) {
      return down("消す", e);
    }
    if (!v || v.ok !== true || !v.deleted_at || !v.id) return refusal(v?.code);
    return {
      status: 200,
      body: {
        data: {
          id: v.id,
          deleted_count: Number(v.deleted_count ?? 0),
          withdrawn_approvals: Number(v.withdrawn_approvals ?? 0),
          stopped_runs: Number(v.stopped_runs ?? 0),
          restorable_until: restorableUntil(new Date(v.deleted_at)),
        },
      },
    };
  };
}
