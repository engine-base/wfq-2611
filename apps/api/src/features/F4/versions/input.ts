// 版を読む・戻す口と、項目の変更を比べる口（K-433）の入力の形の確かめ。
//   道の :v・問い合わせの from・to は ^[1-9][0-9]{0,8}$ の数字だけ。違う形（0・負・小数・文字・先頭が 0）も無い版・無い点も 404・E-PAGE-001
//   （形で 422 にしない。問い合わせの値域を契約に書く仕組みは使わない・道の :v と同じ扱い）。
//   戻す入力は current_version（今見ている本文の版）だけ。契約（restoreTicketVersion）が先に断る物の重ねで、最後の砦でもある
export interface Detail {
  field: string;
  message: string;
}

const POINT = /^[1-9][0-9]{0,8}$/;

/** 版・点の番号。無ければ null・数字の形でなければ "bad"（口は 404・E-PAGE-001 で DB を呼ばない） */
export function pickPoint(raw: string | undefined | null): number | null | "bad" {
  if (raw === undefined || raw === null) return null;
  return POINT.test(raw) ? Number(raw) : "bad";
}

export type RestoreChecked = { ok: true; current: number } | { ok: false; details: Detail[] };

export function checkRestore(input: Record<string, unknown>): RestoreChecked {
  const v = input["current_version"];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    return {
      ok: false,
      details: [{ field: "current_version", message: "今見ている版は 1 以上の整数で送ってください" }],
    };
  return { ok: true, current: v };
}
