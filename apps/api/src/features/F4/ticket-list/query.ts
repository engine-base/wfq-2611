// チケットの一覧の口（K-92）の問い合わせの確かめと、次の分の鍵（keyset のカーソル）。DB に触らない純粋な関数だけ。
//   問い合わせ：view（mine／all・既定 mine）・q（100 文字まで）・scope_id（uuid）・limit（1〜100・既定 50）・cursor（この口が出した鍵）。
//   絞り込みの欄は欄ごとの表（FILTERS・K-472・K-473）：kind_id・stage_id・assignee_id・done・日付の範囲 4 欄・overdue・fire・parent・due・delegated・approving。
//   並びの表（SORTS）と見せる欄（FIELD_KEYS）の値の確かめもここ（sort・fields は where に足さない欄）。K-474 は数の札を足す。
//   表に無い欄（LIST_FIELDS のうち FILTERS に無い物＝NOT_YET）は「まだ使えない」で 422・E-VAL-018（黙って無視しない・D-128.152）。sort の列名の形は入口（op.ts）が先に確かめる
//   確かめる順：①まだの欄（422・E-VAL-018）→ ②形の誤り（422・VALIDATION_ERROR）→ ③q の長さ（422・E-VAL-017）→ ④鍵の中身（409・E-LST-001）
import { isUuid } from "@kaname/contracts";

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;
export const Q_MAX = 100;
const CURSOR_MAX = 200; // 入口の鍵の形（op.ts の KEY_CURSOR_OPS・base64url の 1〜200 字）と同じ

export type View = "mine" | "all";
export const SORT_KEYS = ["due_on", "start_on", "updated_at", "created_at"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
/** 並びの表の 1 行。expr は並びの主の値の式（tickets は t・固定の字だけで、問い合わせの字は入れない）。
 *  date は日の無いものが最後になる（infinity）近い順、stamp は新しい順。tieUpdated は主の値が同じとき更新の新しい順を挟むか（updated_at が主なら挟まない）。最後は id */
export interface SortDef {
  expr: string;
  dir: "asc" | "desc";
  kind: "date" | "stamp";
  tieUpdated: boolean;
}
export const SORTS: Readonly<Record<SortKey, SortDef>> = {
  due_on: { expr: "coalesce(t.due_on, 'infinity'::date)", dir: "asc", kind: "date", tieUpdated: true },
  start_on: { expr: "coalesce(t.start_on, 'infinity'::date)", dir: "asc", kind: "date", tieUpdated: true },
  updated_at: { expr: "t.updated_at", dir: "desc", kind: "stamp", tieUpdated: false },
  created_at: { expr: "t.created_at", dir: "desc", kind: "stamp", tieUpdated: true },
};
/** 並びを付けないときの並び（view ごと・K-92 のまま）：mine は期限の近い順、all は更新の新しい順 */
export const DEFAULT_SORT: Readonly<Record<View, SortKey>> = { mine: "due_on", all: "updated_at" };
/** 見せる欄（fields）で足せる 1 件の鍵の名前（空白なし・小文字のまま受ける） */
export const FIELD_KEYS = ["start_on", "priority", "estimate_minutes", "actual_minutes", "scope"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
/** 次の分の鍵：[view, sort, …並びの値, id]。並びの値は date の並びが [日付か infinity, 更新]・updated_at が [更新]・created_at が [作成, 更新] */
export interface Cursor {
  view: View;
  sort: SortKey;
  vals: readonly string[];
  id: string;
}
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
  /** 並び（付けなければ view の既定） */
  sort: SortKey;
  /** 1 件の鍵に足す欄（付けなければ空） */
  fields: readonly FieldKey[];
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
const parseBool: FilterDef["parse"] = (raw) =>
  raw === "true" || raw === "false" ? { ok: true, value: raw === "true" } : { ok: false, message: "true か false" };
/** true は条件そのもの、false はその否定（条件が null でも否定が拾う：not coalesce） */
const boolFilter = (name: string, cond: string): FilterDef => ({
  name,
  parse: parseBool,
  sql: (value) => (value ? cond : `not coalesce(${cond}, false)`),
});
const DATE_FORM = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** 暦に実在する YYYY-MM-DD（年 0001〜9999・契約の format: date と同じ決まり） */
export function isCalendarDate(s: string): boolean {
  const m = DATE_FORM.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= (mo === 2 && isLeap(y) ? 29 : DAYS[mo - 1]!);
}
/** 期限・開始日の範囲の 1 欄（両端を含む・日の無いチケットは null との比べで偽になり出ない） */
const dateFilter = (name: string, column: string, op: ">=" | "<="): FilterDef => ({
  name,
  parse: (raw) => (isCalendarDate(raw) ? { ok: true, value: raw } : { ok: false, message: "YYYY-MM-DD（暦にある日）" }),
  sql: (value, add) => `t.${column} ${op} ${add(value)}::date`,
});
const DONE_STAGE =
  "exists (select 1 from ticket_stages s where s.id = t.stage_id and s.key is not distinct from 'done')";
/** 炎（期限切れ）：期限が日本時間の今日（$2）より前で、段が完了でない。overdue と fire はここを読む（期限間近を足すのは F9 の後・ここだけ広げる） */
export const IS_FIRE =
  "(t.due_on is not null and t.due_on < $2::date and exists (select 1 from ticket_stages s where s.id = t.stage_id and s.key is distinct from 'done'))";
/** 自分が AI に任せているもの（担当が自分で任せた旗）。K-474 の数 ai と同じ集まり */
export const DELEGATED_SQL = "(t.assignee_member_id = app.user_id() and t.delegated_to_clone)";
/** 自分が承認する決めていないもの（取り下げ・行を消したものは除く）。K-474 の数 approve と同じ集まり */
export const APPROVING_SQL =
  "exists (select 1 from approvals a where a.ticket_id = t.id and a.tenant_id = t.tenant_id and a.approver_member_id = app.user_id() and a.decision is null and a.withdrawn_at is null and a.deleted_at is null)";
/** 絞り込みの欄の表（where に使う欄と、sort・fields のように値だけ確かめる欄）。付けた欄は全部 AND */
export const FILTERS: readonly FilterDef[] = [
  uuidFilter("kind_id", "kind_id"),
  uuidFilter("stage_id", "stage_id"),
  uuidFilter("assignee_id", "assignee_member_id"),
  {
    name: "done",
    parse: parseBool,
    sql: (value) => (value ? DONE_STAGE : `not ${DONE_STAGE}`),
  },
  dateFilter("due_from", "due_on", ">="),
  dateFilter("due_to", "due_on", "<="),
  dateFilter("start_from", "start_on", ">="),
  dateFilter("start_to", "start_on", "<="),
  boolFilter("overdue", IS_FIRE),
  boolFilter("fire", IS_FIRE),
  {
    name: "parent",
    parse: (raw) =>
      raw === "none" || raw === "any" || isUuid(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: "none・any・uuid" },
    sql: (value, add) => {
      if (value === "none") return "t.parent_ticket_id is null";
      if (value === "any") return "t.parent_ticket_id is not null";
      const id = add(value);
      return `t.parent_ticket_id = ${id}::uuid and app.ticket_visible(${id}::uuid)`; // 親が見えるときだけ子を出す（見えない親の存在を答えない）
    },
  },
  {
    name: "sort",
    parse: (raw) =>
      (SORT_KEYS as readonly string[]).includes(raw)
        ? { ok: true, value: raw as SortKey }
        : { ok: false, message: SORT_KEYS.join("・") },
    sql: () => null,
  },
  {
    name: "fields",
    parse: (raw) => {
      const parts = raw.split(",");
      return parts.every((p) => (FIELD_KEYS as readonly string[]).includes(p))
        ? { ok: true, value: FIELD_KEYS.filter((k) => parts.includes(k)) }
        : { ok: false, message: FIELD_KEYS.join("・") };
    },
    sql: () => null,
  },
  {
    name: "due",
    parse: (raw) => (raw === "none" ? { ok: true, value: raw } : { ok: false, message: "none" }),
    sql: () => "t.due_on is null",
  },
  boolFilter("delegated", DELEGATED_SQL),
  boolFilter("approving", APPROVING_SQL),
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
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2})(?::(\d{2}))?)$/;
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
  return Buffer.from(JSON.stringify([c.view, c.sort, ...c.vals, c.id]), "utf8").toString("base64url");
}
/** 鍵の並びの値の種類（並びの表から）：主の値（date か stamp）と、同じ値のときの更新の時刻 */
const cursorParts = (def: SortDef): readonly ("date" | "stamp")[] => [
  def.kind,
  ...(def.tieUpdated ? (["stamp"] as const) : []),
];
/** 中身を読む。壊れた物・形の違う物・別の view や別の sort の鍵・古い形（sort の無い鍵）は null（形が base64url の 1〜200 字かは入口と parseListQuery が先に見る・読めない鍵は 409・E-LST-001） */
export function decodeCursor(s: string, view: View, sort: SortKey): Cursor | null {
  let arr: unknown;
  try {
    arr = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) return null;
  const v = arr as string[];
  const parts = cursorParts(SORTS[sort]);
  if (v.length !== parts.length + 3 || v[0] !== view || v[1] !== sort) return null;
  const vals = v.slice(2, -1);
  const id = v[v.length - 1]!;
  if (!isUuid(id) || !parts.every((kind, i) => (kind === "date" ? isDateKey(vals[i]!) : isStamp(vals[i]!))))
    return null;
  return { view, sort, vals, id };
}
const isDateKey = (s: string) => s === "infinity" || isCalendarDate(s);
/** 実在する時刻（暦・時分秒・時差の範囲まで見る。DB に渡して落ちる形を通さない） */
function isStamp(s: string): boolean {
  const m = STAMP.exec(s);
  if (!m) return false;
  const [h, mi, se, oh, om] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
  return (
    isCalendarDate(m[1]!) &&
    h! <= 23 &&
    mi! <= 59 &&
    se! <= 59 &&
    oh! <= 15 &&
    om! <= 59 &&
    !Number.isNaN(Date.parse(s))
  );
}

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
  const sort = (filters.find((f) => f.def.name === "sort")?.value as SortKey | undefined) ?? DEFAULT_SORT[view!];
  const fields = (filters.find((f) => f.def.name === "fields")?.value as readonly FieldKey[] | undefined) ?? [];
  const cursor = cursorRaw === "" ? null : decodeCursor(cursorRaw, view!, sort);
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
      sort,
      fields,
    },
  };
}
