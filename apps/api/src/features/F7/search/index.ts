// 探す（⌘K の探す欄・K-468）の口 search（GET /api/v1/search）。読むだけ。
//   上限（1 分 120 回）・認証・同意し直しの止め・社内の外枠だけ（取引先・預かりの許可なしの運営は 403）は契約の入口（op.ts）が先に確かめる。口は役で分けない。
//   種類ごとの探し方（kinds.ts の SEARCHERS）を、1 つの取引（withTenant・行の守りの上）の中で 種類の順に呼ぶ。答えは { data } だけ（総数・続きなし・P10）。
//   どれか 1 つの種類が落ちたら全体を 503・E-PAGE-003（部分の答えを出さない）。ログに出すのは場所と種類の名前だけ（題名・探す言葉・字を出さない）
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import { KanameError, kanameError } from "@kaname/errors";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { SEARCHERS, type Kind, type SearchHit } from "./kinds.js";
import { parseSearchQuery } from "./query.js";

function invalid(
  code: "VALIDATION_ERROR" | "E-SRC-001" | "E-SRC-002",
  details: { field: string; message: string }[],
): HookReply {
  if (code === "VALIDATION_ERROR") return { status: 422, body: { error: "validation_failed", code, details } };
  const e = new KanameError(code);
  const field = details[0]?.field ?? "body";
  return {
    status: e.status,
    body: { ...e.toJSON(), field, details: details.map((d) => ({ field: d.field, message: e.entry.message })) },
  };
}

export function createSearch(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a) => {
    const parsed = parseSearchQuery(a.c.req.query());
    if (!parsed.ok) return invalid(parsed.code, parsed.details);
    const { kinds, input } = parsed.value;
    if (!input) return { status: 200, body: { data: [] } };
    let current: Kind | "接続" = "接続";
    try {
      const data = await withTenant(appPool, a.ctx, async (cl) => {
        const out: SearchHit[] = [];
        for (const kind of kinds) {
          current = kind;
          out.push(...(await SEARCHERS[kind](cl, input)));
        }
        return out;
      });
      return { status: 200, body: { data } };
    } catch {
      console.error("[search] 探せなかった", current);
      return { status: 503, body: kanameError("E-PAGE-003").toJSON() };
    }
  };
}
