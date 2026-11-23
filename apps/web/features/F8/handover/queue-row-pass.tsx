"use client";
// 承認待ちの 渡された（pass）の行・K-412。この葉（K-400）では今の行（fallback）をそのまま返す：空の形。
//   スマホのカード（幅 767 以下）は K-412 の features/F5/approve-complete/queue-card.tsx が全部の種類を描く（ここでは足さない）
import type { ReactNode } from "react";
import type { QueueRow } from "@/features/F5/approve-complete/queue";
import type { RowActs } from "@/features/F5/approve-complete/queue-table";

export interface QueueRowSectionProps {
  row: QueueRow;
  acts: RowActs;
  /** 今の行（children） */
  fallback: ReactNode;
}

export function QueueRowPass(props: QueueRowSectionProps): ReactNode {
  return props.fallback;
}
