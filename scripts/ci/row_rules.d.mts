// scripts/ci/row_rules.mjs の型（apps/api/src の試験が import するので noImplicitAny の型の確かめが要る・K-441）
export const ROW_WORDS: string[];
export const ID_TABLE: Record<string, string>;
export const ROW_EXEMPT: Record<string, string>;
export const ROW_EXEMPT_FIELDS: Record<string, Record<string, string>>;
export const RULES: Record<string, unknown>;
export const OP_RULES: Record<string, unknown>;
export function rowOf(root: string, e: unknown, word: string): unknown;
export function rulesSource(root: string): string;
