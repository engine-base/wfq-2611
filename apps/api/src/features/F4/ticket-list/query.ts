// チケットの一覧の口（K-92）の問い合わせの確かめと、次の分の鍵（keyset のカーソル）。DB に触らない純粋な関数だけ。
//   問い合わせ：view（mine／all・既定 mine）・q（100 文字まで）・scope_id（uuid）・limit（1〜100・既定 50）・cursor（この口が出した鍵）。
//   絞り込みの欄は欄ごとの表（FILTERS・K-472）：kind_id・stage_id・assignee_id・done。K-473・K-474 は表に 1 行ずつ足す。
//   表に無い欄（LIST_FIELDS のうち FILTERS に無い物＝NOT_YET）は「まだ使えない」で 422・E-VAL-018（黙って無視しない・D-128.152）。sort の列名の形は入口（op.ts）が先に確かめる
//   確かめる順：①まだの欄（422・E-VAL-018）→ ②形の誤り（422・VALIDATION_ERROR）→ ③q の長さ（422・E-VAL-017）→ ④鍵の中身（409・E-LST-001）
import { isUuid } from "@kaname/contracts";

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;
export const Q_MAX = 100;
const CURSOR_MAX = 200; // 入口の鍵の形（op.ts の KEY_CURSOR_OPS・base64url の 1〜200 字）と同じ

export type View = "mine" | "all";
/** 次の分の鍵：mine は [期限（無ければ infinity）, 更新, id]、all は [更新, id] */
export type Cursor =
  { view: "mine"; due: string; updated: string; id: string } | { view: "all"; updated: string; id: string };
/** 欄の値の確かめ（parse）と、where に足す 1 つの条件（sql）。tickets の別名は t。add は値を params に積んで $n を返す。where に使わない欄は sql が null */
export interface FilterDef {
  name: string;
  parse(raw: string): { ok: true; value: unknown } | { ok: false; message: string };
  sql(value: unknown, add: (v: unknown) => string): string | null;
}
export interface ListQuery {
  view: View;
  /** 題名の部分一致の LIKE の形（全角半角・大文字小文字をそろえ、% _ \ を逃がした物）。絞らないときは null */
  titleLike: string | null;
  /** 番号の照合の形（題名の形に加え、ハイフンの種類を - にそろえた物）。絞らないときは null */
  number: string | null;
  scopeId: string | null;
  limit: number;
  cursor: Cursor | null;
  /** 付いている（空でない）絞り込みの欄と値（表の順） */
  filters: readonly { def: FilterDef; value: unknown }[];
}
export interface Issue {
  field: string;
  message: string;
}
export type Parsed =
  | { ok: true; value: ListQuery }
  | { ok: false; code: "VALIDATION_ERROR" | "E-VAL-017" | "E-VAL-018"; details: Issue[] }
  | { ok: false; code: "E-LST-001"; details: [] };

const uuidFilter = (name: string, column: string): FilterDef => ({
  name,
  parse: (raw) => (isUuid(raw) ? { ok: true, value: raw } : { ok: false, message: "uuid" }),
  sql: (value, add) => `t.${column} = ${add(value)}::uuid`,
});
const DONE_STAGE =
  "exists (select 1 from ticket_stages s where s.id = t.stage_id and s.key is not distinct from 'done')";
/** 絞り込みの欄の表（where に使う欄）。付けた欄は全部 AND。K-473・K-474 はここに 1 行ずつ足す */
export const FILTERS: readonly FilterDef[] = [
  uuidFilter("kind_id", "kind_id"),
  uuidFilter("stage_id", "stage_id"),
  uuidFilter("assignee_id", "assignee_member_id"),
  {
    name: "done",
    parse: (raw) =>
      raw === "true" || raw === "false" ? { ok: true, value: raw === "true" } : { ok: false, message: "true か false" },
    sql: (value) => (value ? DONE_STAGE : `not ${DONE_STAGE}`),
  },
];
/** 契約が 12 欄として持つ絞り込みの名前（done は入れない） */
export const LIST_FIELDS = [
  "kind_id",
  "stage_id",
  "assignee_id",
  "due_from",
  "due_to",
  "start_from",
  "start_to",
  "overdue",
  "fire",
  "parent",
  "fields",
  "sort",
] as const;
/** まだ使えない欄（LIST_FIELDS のうち表に無い物）。付けて呼ばれたら 422・E-VAL-018。表に行を足すと縮む */
export const NOT_YET: ReadonlySet<string> = new Set(
  LIST_FIELDS.filter((name) => !FILTERS.some((f) => f.name === name)),
);
const KNOWN = new Set(["view", "q", "scope_id", "limit", "cursor", ...FILTERS.map((f) => f.name)]);
const CURSOR_FORM = /^[A-Za-z0-9_-]+$/;
const DATE = /^(\d{4}-\d{2}-\d{2}|infinity)$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;
const HYPHENS = /[‐‑‒–—―ー−－]/g;

/** 表記ゆらぎ：全角半角（NFKC）・前後の空白・大文字小文字をそろえる（題名の側も SQL で同じ形にして比べる） */
export function normalizeQ(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}
/** LIKE の特別な文字（% _ \）を文字として探すように逃がす（escape '\'） */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
/** 番号の照合の形：ハイフンの種類（‐ ー − など）を - にそろえる。題名には当てない（「サーバー」の ー を変えない） */
export function normalizeNumber(s: string): string {
  return s.replace(HYPHENS, "-");
}

export function encodeCursor(c: Cursor): string {
  const arr = c.view === "mine" ? [c.view, c.due, c.updated, c.id] : [c.view, c.updated, c.id];
  return Buffer.from(JSON.stringify(arr), "utf8").toString("base64url");
}
/** 中身を読む。壊れた物・形の違う物・別の view の鍵は null（形が base64url の 1〜200 字かは入口と parseListQuery が先に見る・読めない鍵は 409・E-LST-001） */
export function decodeCursor(s: string, view: View): Cursor | null {
  let arr: unknown;
  try {
    arr = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr[0] !== view || !arr.every((x) => typeof x === "string")) return null;
  const v = arr as string[];
  if (view === "mine") {
    if (v.length !== 4 || !DATE.test(v[1]!) || !isStamp(v[2]!) || !isUuid(v[3]!)) return null;
    return { view, due: v[1]!, updated: v[2]!, id: v[3]! };
  }
  if (v.length !== 3 || !isStamp(v[1]!) || !isUuid(v[2]!)) return null;
  return { view, updated: v[1]!, id: v[2]! };
}
const isStamp = (s: string) => STAMP.test(s) && !Number.isNaN(Date.parse(s));

/** 問い合わせを確かめる。raw は届いたままの問い合わせ（空の値も含む） */
export function parseListQuery(raw: Record<string, string>): Parsed {
  const notYet = Object.keys(raw).filter((k) => NOT_YET.has(k));
  if (notYet.length)
    return { ok: false, code: "E-VAL-018", details: notYet.map((field) => ({ field, message: "まだ使えない" })) };
  const details: Issue[] = Object.keys(raw)
    .filter((k) => !KNOWN.has(k))
    .map((field) => ({ field, message: "受け付けない問い合わせ" }));
  const viewRaw = raw["view"] ?? "";
  const view: View | null = viewRaw === "" || viewRaw === "mine" ? "mine" : viewRaw === "all" ? "all" : null;
  if (!view) details.push({ field: "view", message: "mine か all" });
  const limitRaw = raw["limit"] ?? "";
  const limit = limitRaw === "" ? LIST_LIMIT_DEFAULT : /^[0-9]{1,4}$/.test(limitRaw) ? Number(limitRaw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX)
    details.push({ field: "limit", message: `1〜${LIST_LIMIT_MAX}` });
  const scopeRaw = raw["scope_id"] ?? "";
  if (scopeRaw !== "" && !isUuid(scopeRaw)) details.push({ field: "scope_id", message: "uuid" });
  const cursorRaw = raw["cursor"] ?? "";
  if (cursorRaw !== "" && (cursorRaw.length > CURSOR_MAX || !CURSOR_FORM.test(cursorRaw)))
    details.push({ field: "cursor", message: "不正" });
  const filters: { def: FilterDef; value: unknown }[] = [];
  for (const def of FILTERS) {
    const v = raw[def.name] ?? "";
    if (v === "") continue;
    const r = def.parse(v);
    if (r.ok) filters.push({ def, value: r.value });
    else details.push({ field: def.name, message: r.message });
  }
  if (details.length) return { ok: false, code: "VALIDATION_ERROR", details };
  const qRaw = raw["q"] ?? "";
  if ([...qRaw].length > Q_MAX)
    return { ok: false, code: "E-VAL-017", details: [{ field: "q", message: `${Q_MAX} 文字まで` }] };
  const cursor = cursorRaw === "" ? null : decodeCursor(cursorRaw, view!);
  if (cursorRaw !== "" && !cursor) return { ok: false, code: "E-LST-001", details: [] };
  const q = normalizeQ(qRaw);
  return {
    ok: true,
    value: {
      view: view!,
      titleLike: q ? `%${escapeLike(q)}%` : null,
      number: q ? normalizeNumber(q) : null,
      scopeId: scopeRaw || null,
      limit,
      cursor,
      filters,
    },
  };
}
