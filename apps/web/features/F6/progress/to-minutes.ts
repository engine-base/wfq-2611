// 実績の入力（時間と分の字）→ 分（純粋な関数）。字を NFKC で直し前後の空白を除いてから、0 以上の整数か・分は 0〜59 かを見る。空は 0。
//   上限（100000 分）は画面で持たない（口が 422 で断る・K-387）。合わなければ口を呼ばずに欄の下に正本の文（TIME_ERROR_ID）
export const TIME_ERROR_ID = "E-VAL-046";
const MINUTES_PER_HOUR = 60;
const DIGITS = /^\d+$/;

export type ToMinutes = { ok: true; minutes: number } | { ok: false };

function part(text: string): number | null {
  const s = text.normalize("NFKC").trim();
  if (s === "") return 0;
  if (!DIGITS.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function toMinutes(hours: string, minutes: string): ToMinutes {
  const h = part(hours);
  const m = part(minutes);
  if (h === null || m === null || m >= MINUTES_PER_HOUR) return { ok: false };
  const total = h * MINUTES_PER_HOUR + m;
  return Number.isSafeInteger(total) ? { ok: true, minutes: total } : { ok: false };
}
