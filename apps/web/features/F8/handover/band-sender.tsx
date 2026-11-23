"use client";
// 渡した人の帯（sending・read-failed。渡し中・読めない）・K-411。この葉（K-400）では何も出さない：空の形（props の形だけ決める）。
//   本物にする葉は、このファイルの帯の部品を書き、出せる種類を READY に足すだけ（slot-dispatch.tsx・use-handovers.ts は触らない）
import type { ReactNode } from "react";
import type { BandSectionProps, HandoverBandKey } from "./use-handovers";

/** このファイルが本物にした帯の種類（空の区画が保留の帯を譲らせない・slot-dispatch.tsx が見る） */
export const READY: readonly HandoverBandKey[] = [];

export function BandSender(props: BandSectionProps): ReactNode {
  void props;
  return null;
}
