// 分身の部屋の「やったこと」（listCloneActivity）と「育ち具合」（getCloneGrowth）を読む口（K-754）。読むだけで何も書かない。
//   やったこと：問い合わせ（札・期間・続きの鍵・limit）を読んで確かめ、DB の関数 app.clone_activity を 1 回呼ぶ（絞るのも切るのも数えるのも DB の 1 文）。
//   期間は日本の日付で両端を入れる。付けないときは今日を入れた直近 7 日。片方だけなら足りない側は from＝to−6 日・to＝今日。366 日を超える期間は 422（欄 from）。
//   続きの鍵は最後に返した行の at（DB が返した文字のまま・マイクロ秒を落とさない）と id を | でつないで base64url。
//   育ち具合：app.clone_growth を 1 回呼ぶ（K-753 の readOne と同じ形）。
//   断る番号：422（形の誤りだけ・欄つき）・403（今のメンバーでない＝関数が null）・503 E-PAGE-003（ログに例外の種類だけ・題名を出さない）
import type pg from "pg";
import { isUuid } from "@kaname/contracts";
import { withTenant } from "@kaname/db/context";
import { kanameError } from "@kaname/errors";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { invalid } from "../approve-complete/errors.js";
import { readOne } from "./read.js";

export const ACTIVITY_LIMIT_DEFAULT = 50;
const KINDS = new Set(["ran", "made", "stopped"]);
const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** 続きの鍵 */
export interface ActivityKey {
  at: string;
  id: string;
}
export interface ActivityQuery {
  kind: string | null;
  from: string;
  to: string;
  limit: number;
  after: ActivityKey | null;
}

const realDate = (s: string): boolean =>
  DATE_RE.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const dayMs = (s: string): number => Date.parse(`${s}T00:00:00Z`);
const dayOf = (ms: number): string => new Date(ms).toISOString().split("T")[0]!;
const todayJst = (): string => dayOf(Date.now() + JST_MS);

export const encodeCursor = (k: ActivityKey): string => Buffer.from(`${k.at}|${k.id}`, "utf8").toString("base64url");
/** 鍵の文字列を読む。読めない（復号して戻らない・2 つに分かれない・時刻や uuid でない）なら null */
export function decodeCursor(cursor: string): ActivityKey | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) return null;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  if (Buffer.from(text, "utf8").toString("base64url") !== cursor) return null;
  const parts = text.split("|");
  if (parts.length !== 2) return null;
  const [at, id] = parts as [string, string];
  if (!TIME_RE.test(at) || Number.isNaN(Date.parse(at)) || !isUuid(id)) return null;
  return { at, id };
}

/** 問い合わせを読んで確かめる。形の誤りは 422 の答え */
export function parseActivityQuery(q: Record<string, string>): ActivityQuery | HookReply {
  const kind = q["kind"] ?? null;
  if (kind !== null && !KINDS.has(kind)) return invalid("kind", "札は ran・made・stopped のどれかです");
  const rawFrom = q["from"];
  const rawTo = q["to"];
  if (rawFrom !== undefined && !realDate(rawFrom))
    return invalid("from", "日付の形（YYYY-MM-DD）で、暦にある日にしてください");
  if (rawTo !== undefined && !realDate(rawTo))
    return invalid("to", "日付の形（YYYY-MM-DD）で、暦にある日にしてください");
  const to = rawTo ?? todayJst();
  const from = rawFrom ?? dayOf(dayMs(to) - (DEFAULT_DAYS - 1) * DAY_MS);
  if (dayMs(from) > dayMs(to)) return invalid("from", "始まりの日は終わりの日より後にできません");
  if ((dayMs(to) - dayMs(from)) / DAY_MS + 1 > MAX_DAYS) return invalid("from", `期間は ${MAX_DAYS} 日までです`);
  // limit は入口（op.ts）が 1〜200 の整数と確かめ済み。cursor は入口が base64url の形だけ確かめ、中身はここで確かめる
  const limit = q["limit"] ? Number(q["limit"]) : ACTIVITY_LIMIT_DEFAULT;
  const after = q["cursor"] ? decodeCursor(q["cursor"]) : null;
  if (q["cursor"] && !after) return invalid("cursor", "続きの印が不正です");
  return { kind, from, to, limit, after };
}

type Row = { id: string; at: string };
type Activity = { data: Row[]; summary: Record<string, number>; more: boolean };

const isReply = (x: ActivityQuery | HookReply): x is HookReply => "status" in x;
const kindOf = (e: unknown): string => {
  const x = e as { code?: unknown; name?: unknown } | null;
  return typeof x?.code === "string" ? x.code : typeof x?.name === "string" ? x.name : "Error";
};

export async function activityHook(pool: pg.Pool, a: HookArgs): Promise<HookReply> {
  const parsed = parseActivityQuery(a.c.req.query());
  if (isReply(parsed)) return parsed;
  const { kind, from, to, limit, after } = parsed;
  let v: Activity | null;
  try {
    v = await withTenant(
      pool,
      a.ctx,
      async (cl) =>
        (
          await cl.query<{ v: Activity | null }>("select app.clone_activity($1, $2, $3, $4, $5, $6) as v", [
            kind,
            from,
            to,
            limit,
            after?.at ?? null,
            after?.id ?? null,
          ])
        ).rows[0]?.v ?? null,
    );
  } catch (e) {
    console.error(`[clone-room] listCloneActivity の読みで例外：止めた（${kindOf(e)}）`);
    return { status: 503, body: kanameError("E-PAGE-003").toJSON() };
  }
  if (!v) return { status: 403, body: { error: "forbidden", code: "FORBIDDEN" } };
  const last = v.data.at(-1);
  return {
    status: 200,
    body: {
      data: v.data,
      meta: {
        limit,
        ...(v.more && last ? { cursor: encodeCursor({ at: last.at, id: last.id }) } : {}),
        summary: v.summary,
      },
    },
  };
}

export const growthHook = (pool: pg.Pool, a: HookArgs): Promise<HookReply> =>
  readOne(pool, a, "getCloneGrowth", "clone_growth");
