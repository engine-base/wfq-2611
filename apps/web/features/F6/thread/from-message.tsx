"use client";
// 書き込みから決定にする入口の入れ物（K-392 が受ける物を広げ、中身は K-398 が作る）。
//   この葉では押せない形（決定の元なら「✓ 決定にした」）を返す。null を返すとモックの「決定にする」の字が消えて見た目の突き合わせが合わない。
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import type { TimelineItem } from "./to-items";
import { DecideAct, type PostView } from "./views";

export function FromMessageAction(props: { ticket: SlotTicket; item: TimelineItem; post: PostView }): ReactNode {
  return <DecideAct decided={props.post.decided ?? false} disabled />;
}
