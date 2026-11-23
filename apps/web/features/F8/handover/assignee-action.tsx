"use client";
// パネルの「担当者」の値（K-411 の pass・K-415 の distribute の入口）。名前に ▾ を付け、押すと相手を選ぶ小窓を開く。
//   この葉（K-400）では今の名前の表示（fallback）をそのまま返す：空の形。担当者がいなければ fallback
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import type { HandoverEntry } from "./use-handovers";

export interface AssigneeActionProps {
  ticket: SlotTicket;
  /** 入口（pass・distribute）。入口が無い人（offer・null）でも、担当者がいれば読むだけ（plain）の欄を描く */
  entry: HandoverEntry | null;
  /** 名前の下の「→ 〇〇（返事待ち）」の〇〇（待っていなければ null） */
  note: string | null;
  /** AI が動いている・承認待ち（渡せない・D-148.6）。▾ は押せる形のまま、小窓に訳を出す */
  blocked: boolean;
  /** 今の名前の表示（children） */
  fallback: ReactNode;
}

export function AssigneeAction(props: AssigneeActionProps): ReactNode {
  return props.fallback;
}
