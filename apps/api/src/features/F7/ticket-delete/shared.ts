// 消す・戻す（段 8・K-487 下見・K-488 消す・K-489 戻す）の 3 つの口が使う小さな共通の部品（K-487 が作り、K-488・K-489 も使う）。
//   消せる人・戻せる期間・断りの形をここ 1 か所にする（口ごとに書き直さない）。ログに本文・人の id を出さない。
import { kanameError } from "@kaname/errors";
import type { HookReply } from "../../../contract/deps.js";

/** 消したチケットを戻せる日数（D-128.84・D-128.116） */
export const RESTORE_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * 戻せる期限（消した時刻の 30 日後）の ISO（UTC）。
 * K-488 の試験 K488-API-001 は、消した時刻（DB の行の時刻をミリ秒に切り捨てた物）の 30 日後を「ミリ秒まで同じ」で比べる。
 * だから Date のミリ秒に足して ISO にするだけにする（四捨五入など別の丸めを入れない）。
 */
export const restorableUntil = (deletedAt: Date): string =>
  new Date(deletedAt.getTime() + RESTORE_DAYS * DAY_MS).toISOString();

/** 消せない人（作った人でも、そのグループで tickets の edit を持つ人でもない）→ 403・E-DEL-001 */
export const forbidden = (): HookReply => ({ status: 403, body: kanameError("E-DEL-001").toJSON() });

/** 見えない・別の会社・無い・もう消えたチケット → 404（有ることも漏らさない・D-129.43） */
export const notFound = (): HookReply => ({ status: 404, body: { error: "not_found", code: "NOT_FOUND" } });

/** Kaname の側で落ちた（DB を読めない・書けない など）→ 503・E-PAGE-003。一部だけの答えは返さない。ログは例外の種類だけ */
export const down = (where: string, e: unknown): HookReply => {
  console.error(`[ticket-delete] ${where}：止める側に倒した（${(e as Error)?.name ?? "Error"}）`);
  return { status: 503, body: kanameError("E-PAGE-003").toJSON() };
};
