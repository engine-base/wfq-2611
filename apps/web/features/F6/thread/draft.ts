// 書きかけの字をその端末に残す（K-393・⑮5）。送るまで残し、送れたら消す。字だけを置く（知らせる人・引用は置かない）。
//   置けない・読めない端末（使えない localStorage・容量切れ）では何もしない（書くことは困らない）
const keyOf = (ticketId: string): string => `kaname.thread.draft.${ticketId}`;

export function readDraft(ticketId: string): string {
  try {
    return window.localStorage.getItem(keyOf(ticketId)) ?? "";
  } catch {
    return "";
  }
}

/** 空の字なら消す */
export function writeDraft(ticketId: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(keyOf(ticketId), text);
    else window.localStorage.removeItem(keyOf(ticketId));
  } catch {
    // 置けない端末では残さない（書くことは困らない）
  }
}

export function clearDraft(ticketId: string): void {
  writeDraft(ticketId, "");
}
