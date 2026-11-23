// jsonb に入らない字（対にならないサロゲート）を U+FFFD にする（F6 の書く口が共通で使う・K-387 の口の置き換えと同じ決め）。
//   Postgres は対にならないサロゲートを jsonb に入れられず例外にする（口が 503 になる）ので、入口を通った字を口で整えてから渡す。
//   NUL は入口の前処理が 422 にするのでここへ来ない
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const wellFormed = (s: string): string => s.replace(LONE_SURROGATE, "\uFFFD");

/** 文字のときだけ整える（ほかの型はそのまま） */
export const cleanString = (v: unknown): unknown => (typeof v === "string" ? wellFormed(v) : v);
