// 探す口（K-468）の問い合わせの確かめ。DB に触らない純粋な関数だけ。契約の問い合わせの欄（05_flow/screen_api.d/K-468.py の QUERY_RANGES）と同じ決まり。
//   q      ：送られたままの文字で 100 文字まで（前後の空白も数える・全角も 1 文字・正規化で伸びる字も送られた字の数）。探すときは全角半角・大文字小文字・前後の空白をそろえる
//   kinds  ：ticket・decision・conversation・knowledge の小文字の名前を空白なしでコンマでつないだ形（空は全部・同じ名前の重なりは 1 つに）。そろえずに一字一句で見る
//   limit  ：種類ごとの上限 1〜5（既定 5）。cursor：形だけ（数字 1〜9 桁・付けても答えは変わらない）
//   確かめる順は ①名前・limit・cursor → ②kinds → ③q（q が空でも kinds の誤りは 422）
import { Q_MAX, escapeLike, normalizeNumber, normalizeQ } from "../../F4/ticket-list/query.js";
import { KINDS, type Kind, type SearchInput } from "./kinds.js";

export const LIMIT_DEFAULT = 5;
export const LIMIT_MAX = 5;
const KNOWN = new Set(["q", "kinds", "limit", "cursor"]);

export interface Issue {
  field: string;
  message: string;
}
export interface SearchQuery {
  /** 探す種類（KINDS の順・重ならない） */
  kinds: Kind[];
  /** 探す言葉が空（空・空白だけ・無い）なら null（探さない） */
  input: SearchInput | null;
}
export type Parsed =
  | { ok: true; value: SearchQuery }
  | { ok: false; code: "VALIDATION_ERROR" | "E-SRC-001" | "E-SRC-002"; details: Issue[] };

/** kinds を一字一句で見る。形に合わなければ null */
function parseKinds(raw: string): Kind[] | null {
  if (raw === "") return [...KINDS];
  const names = raw.split(",");
  if (!names.every((n) => (KINDS as readonly string[]).includes(n))) return null;
  return KINDS.filter((k) => names.includes(k));
}

/** 問い合わせを確かめる。raw は届いたままの問い合わせ（空の値も含む） */
export function parseSearchQuery(raw: Record<string, string>): Parsed {
  const details: Issue[] = Object.keys(raw)
    .filter((k) => !KNOWN.has(k))
    .map((field) => ({ field, message: "受け付けない問い合わせ" }));
  const limitRaw = raw["limit"] ?? "";
  const limit = limitRaw === "" ? LIMIT_DEFAULT : /^[0-9]{1,4}$/.test(limitRaw) ? Number(limitRaw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
    details.push({ field: "limit", message: `1〜${LIMIT_MAX}` });
  const cursorRaw = raw["cursor"] ?? "";
  if (cursorRaw !== "" && !/^[0-9]{1,9}$/.test(cursorRaw)) details.push({ field: "cursor", message: "不正" });
  if (details.length) return { ok: false, code: "VALIDATION_ERROR", details };
  const kinds = parseKinds(raw["kinds"] ?? "");
  if (!kinds) return { ok: false, code: "E-SRC-002", details: [{ field: "kinds", message: "種類の形" }] };
  const qRaw = raw["q"] ?? "";
  if ([...qRaw].length > Q_MAX)
    return { ok: false, code: "E-SRC-001", details: [{ field: "q", message: `${Q_MAX} 文字まで` }] };
  const q = normalizeQ(qRaw);
  if (q === "") return { ok: true, value: { kinds, input: null } };
  return {
    ok: true,
    value: { kinds, input: { q, titleLike: `%${escapeLike(q)}%`, number: normalizeNumber(q), limit } },
  };
}
