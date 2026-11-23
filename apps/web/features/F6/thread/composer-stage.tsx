"use client";
// 書く欄の「状態 ▾」の入れ物（まだ・K-396 が本物にする）。
//   K-393 が器の口 useComposerStage を「まだ」の形で置く：状態 ▾ は押せない形（読み上げ「状態 変えない（変えられません）」）・保留の欄は無い・
//   送る体に段の欄を足さない。書く器（use-post.ts）は送る前に fields()、422 の段の項目は setErrors、届いたら afterPost と reset、409 なら afterPost だけを呼ぶ
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { StageSelect } from "./views";

export type StageFields = { ok: true; body: Record<string, unknown> } | { ok: false };

export interface ComposerStageState {
  /** 部品の stageSlot に置く物 */
  slot: ReactNode;
  /** 部品の holdSlot に置く物（保留の 2 つの欄） */
  holdSlot: ReactNode | null;
  /** 送る前に段の欄を集める（ok でなければ送らない） */
  fields(): StageFields;
  /** 口が返した段の項目の理由（hold_reason・resume_condition・stage_key） */
  setErrors(fields: Record<string, string>): void;
  /** 書けた・断られた（409）後に詳細を読み直す */
  afterPost(): Promise<void>;
  /** 書けた後に段の選びを戻す */
  reset(): void;
}

const NO_FIELDS: StageFields = { ok: true, body: {} };
const noop = (): void => undefined;
const done = (): Promise<void> => Promise.resolve();

export function useComposerStage(_ticket: SlotTicket): ComposerStageState {
  void _ticket;
  return {
    slot: <StageSelect stage="変えない" locked />,
    holdSlot: null,
    fields: () => NO_FIELDS,
    setErrors: noop,
    afterPost: done,
    reset: noop,
  };
}

export function ComposerStage(_props: { ticket: SlotTicket }): null {
  void _props;
  return null;
}
