// 保留の確かめと文（純粋な関数・口を呼ばない・react を読まない）。保留の小窓（views.tsx の HoldDialog）と、
//   書く欄の保留の欄（K-396）の両方がこの 2 つだけを使う（同じ確かめを 2 つ作らない）。文は正本（errors.json）から引く：
//   E-VAL-041「保留の理由を書いてください」・E-VAL-047「再開の条件を書いてください」
//   空かの決め方：字を NFKC で直し前後の空白（全角も）を除いて見る。送る字は元の字の前後の空白を除いただけ（中の字・NFKC で直した字は送らない）
import { errorText } from "@/components/k/error-of";

export interface HoldErrors {
  reason?: string;
  resume?: string;
}

export type HoldCheck =
  { ok: true; body: { hold_reason: string; resume_condition: string } } | { ok: false; errors: HoldErrors };

const REASON_ID = "E-VAL-041";
const RESUME_ID = "E-VAL-047";
const isBlank = (s: string): boolean => s.normalize("NFKC").trim() === "";

/** 口を呼ぶ前の確かめ。足りない欄ごとに正本の文 */
export function checkHold(reason: string, resume: string): HoldCheck {
  const errors: HoldErrors = {
    ...(isBlank(reason) ? { reason: errorText(REASON_ID).entry.message } : {}),
    ...(isBlank(resume) ? { resume: errorText(RESUME_ID).entry.message } : {}),
  };
  if (errors.reason !== undefined || errors.resume !== undefined) return { ok: false, errors };
  return { ok: true, body: { hold_reason: reason.trim(), resume_condition: resume.trim() } };
}

/** 口の 422 の明細（欄 hold_reason・resume_condition）→ 欄の下の文（口の文。無ければ正本の文） */
export function holdErrorsOf(details: unknown): HoldErrors {
  if (!Array.isArray(details)) return {};
  const pick = (field: string, id: string): string | undefined => {
    const d = (details as { field?: unknown; message?: unknown }[]).find((x) => x?.field === field);
    if (!d) return undefined;
    return typeof d.message === "string" && d.message !== "" ? d.message : errorText(id).entry.message;
  };
  const reason = pick("hold_reason", REASON_ID);
  const resume = pick("resume_condition", RESUME_ID);
  return { ...(reason !== undefined ? { reason } : {}), ...(resume !== undefined ? { resume } : {}) };
}
