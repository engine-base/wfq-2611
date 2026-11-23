"use client";
// 書く欄の入れ物（K-392 が受ける物を広げ、中身は K-393 が作る）。この葉では誰も描かない。
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import type { PersonRow, QuoteRef, TimelineItem } from "./to-items";

export interface TalkComposerProps {
  ticket: SlotTicket;
  /** そのチケットを見られる人（@ の候補・知らせる人の既定と候補） */
  people: PersonRow[];
  /** 引用している書き込み（無ければ null） */
  quote: QuoteRef | null;
  onClearQuote: () => void;
  /** 書けたとき、答えの 1 行を一覧に足す */
  onPosted: (item: TimelineItem) => void;
}

export function TalkComposer(_props: TalkComposerProps): null {
  void _props;
  return null;
}
