"use client";
// 渡し中の帯の右のボタン（催促する・取り消す・別の人にする）と、期限切れ・断られた帯（渡した人・K-413）。
//   この葉（K-400）では帯そのものは何も出さない。ボタンは K-411 が渡し中の帯を出した時から、キャンバスに在る物を隠さない形
//   （押せない・title「まだ使えません」）で出す（D-145.9）。押せる形にするのは K-413（このファイルの SenderActions を直す）
import type { ReactNode } from "react";
import { Button } from "@/components/k";
import type { BandSectionProps, HandoverBandKey } from "./use-handovers";

/** このファイルが本物にした帯の種類（K-413 が overdue・declined を足す） */
export const READY: readonly HandoverBandKey[] = [];

/** まだ使えない物：在るが押せない（aria-disabled・Tab で止まらない・押しても何もしない） */
const INERT = { "aria-disabled": true, tabIndex: -1, title: "まだ使えません" } as const;

/** 渡し中の帯のボタン。overdue は期限切れの帯の並び（催促が主） */
export function SenderActions({ overdue = false }: { overdue?: boolean }): ReactNode {
  return overdue ? (
    <>
      <Button size="sm" variant="outlined" {...INERT}>
        取り消す
      </Button>
      <Button size="sm" variant="outlined" {...INERT}>
        別の人にする
      </Button>
      <Button size="sm" {...INERT}>
        催促する
      </Button>
    </>
  ) : (
    <>
      <Button size="sm" variant="outlined" {...INERT}>
        催促する
      </Button>
      <Button size="sm" variant="outlined" {...INERT}>
        取り消す
      </Button>
      <Button size="sm" variant="outlined" {...INERT}>
        別の人にする
      </Button>
    </>
  );
}

/** 期限切れ・断られた帯（渡した人）。この葉では何も出さない */
export function SenderFollowBand(props: BandSectionProps): ReactNode {
  void props;
  return null;
}
