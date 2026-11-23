// 段・保留・実績の口の失敗の知らせと「送っている間」の共有の器（チケットの id ごとに 1 つ）。
//   段の札（StageSlot）・実績（ActualTimeSlot）・帯（HoldBandSlot）は別々の差し込み口なので、ここで分け合う。
//   知らせは帯ではない：HoldBandSlot が帯の入れ物の中（F5 の帯の後）に描く。react の useSyncExternalStore で読む
import { useSyncExternalStore } from "react";

export interface ProgressState {
  readonly notice: string | null;
  readonly busy: boolean;
}
const EMPTY: ProgressState = { notice: null, busy: false };
const states = new Map<string, ProgressState>();
const listeners = new Set<() => void>();

function update(id: string, patch: Partial<ProgressState>): void {
  const prev = states.get(id) ?? EMPTY;
  const next: ProgressState = { ...prev, ...patch };
  if (next.notice === prev.notice && next.busy === prev.busy) return;
  if (next.notice === null && !next.busy) states.delete(id);
  else states.set(id, next);
  for (const l of listeners) l();
}

export const setNotice = (id: string, notice: string | null): void => update(id, { notice });
export const setBusy = (id: string, busy: boolean): void => update(id, { busy });
/** 画面を離れたとき（知らせを次のチケットの画面に持ち越さない） */
export const clearProgressState = (id: string): void => update(id, { notice: null, busy: false });

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useProgressState(id: string): ProgressState {
  return useSyncExternalStore(
    subscribe,
    () => states.get(id) ?? EMPTY,
    () => EMPTY,
  );
}
