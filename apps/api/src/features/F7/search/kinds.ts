// 探す口（K-468）の種類と、種類ごとの探し方の置き場。
//   種類ごとの探し方は tickets.ts・decisions.ts・conversations.ts・knowledge.ts の 4 つ。K-469（会話）と K-470（決定・ナレッジ）は
//   自分のファイルの中身だけを本物にする（この kinds.ts・query.ts・index.ts・hooks のファイルは触らない）
import type pg from "pg";
import { searchConversations } from "./conversations.js";
import { searchDecisions } from "./decisions.js";
import { searchKnowledge } from "./knowledge.js";
import { searchTickets } from "./tickets.js";

/** 種類の順（答えの並びもこの順：チケット → 決定 → 会話 → ナレッジ） */
export const KINDS = ["ticket", "decision", "conversation", "knowledge"] as const;
export type Kind = (typeof KINDS)[number];

/** 答えの 1 件（契約の SearchHit・鍵は 5 つ） */
export interface SearchHit {
  kind: Kind;
  id: string;
  title: string;
  snippet: string;
  url: string;
}
export interface SearchInput {
  /** そろえた探す言葉（全角半角・前後の空白・大文字小文字をそろえた形） */
  q: string;
  /** 題名の LIKE の形（% で挟み、% _ \ を逃がした物） */
  titleLike: string;
  /** 番号の照合の形（ハイフンの種類を - にそろえた物） */
  number: string;
  /** 種類ごとの上限（1〜5） */
  limit: number;
}
/** 種類ごとの探し方。行の守りの中の接続（withTenant）で読む。種類の中の並びと上位 limit 件は探し方が決める */
export type Searcher = (cl: pg.PoolClient, input: SearchInput) => Promise<SearchHit[]>;

/** 凍らせない：呼ぶ側は呼ぶ時に SEARCHERS[kind] を引く（試験が 1 つを例外に差し替えて 503 を確かめる） */
export const SEARCHERS: Record<Kind, Searcher> = {
  ticket: searchTickets,
  decision: searchDecisions,
  conversation: searchConversations,
  knowledge: searchKnowledge,
};
