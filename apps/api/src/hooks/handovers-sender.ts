// 段 9「渡す・配る」の渡した人の口（K-406）：取り消す・催促する。振る舞いの本体は apps/api/src/features/F8/handovers/。
//   K-401 の hooks/handovers.ts はこの 2 口を登録しない。上限・道の値の形・入口の行の確かめ（row_rules.mjs）は契約の入口が先に確かめる
import type { Hook } from "../contract/deps.js";
import type { HandoverDeps } from "../features/F8/handovers/index.js";
import { remindHandover } from "../features/F8/handovers/remind.js";
import { withdrawHandover } from "../features/F8/handovers/withdraw.js";
import { defineHooks } from "./registry.js";

export function handoverSenderHooks(d: HandoverDeps): Record<string, Hook> {
  return {
    // 取り消す（待っている渡しを取り消す・申し出の取り下げ・グループ宛ての取り消しも同じ口）
    withdrawTicketHandover: { before: withdrawHandover(d) },
    // 催促する（人宛ての渡しを 1 日 1 回まで）
    remindTicketHandover: { before: remindHandover(d) },
  };
}

export const register = defineHooks({
  name: "handoverSenderHooks",
  make: (d) =>
    handoverSenderHooks({
      appPool: d.appPool,
      ...(d.mailer ? { mailer: d.mailer } : {}),
      config: { webBaseUrl: d.config.webBaseUrl ?? "" },
    }),
  fuzz: "same",
});
