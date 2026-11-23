"use client";
// 1 つの書き込みを描く入れ物（K-392 が受ける物を広げ、「…」・☆・直す・消すの中身は K-394 が作る）。
//   この葉では部品 views.tsx の Post をそのまま返す（飛び先の id は msg-<書き込みの id>）。
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import type { PersonRow, TimelineItem } from "./to-items";
import { Post, type PostView } from "./views";

export interface MessageMenuProps {
  ticket: SlotTicket;
  item: TimelineItem;
  post: PostView;
  /** そのチケットを見られる人（直す欄の @ の候補） */
  people: PersonRow[];
  /** 「引用」を押したとき */
  onQuote: () => void;
  /** 「決定にする」の置き場 */
  decideSlot: ReactNode;
}

export function MessageMenu({ item, post, onQuote, decideSlot }: MessageMenuProps): ReactNode {
  return <Post post={post} onQuote={onQuote} decideSlot={decideSlot} anchorId={`msg-${item.id}`} />;
}
