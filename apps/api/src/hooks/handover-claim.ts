// 段 9「グループに来たものを引き取る」の足す口（K-410）：claimTicketHandover（POST /ticket_handovers/:id/claim・人を決める）。
//   振る舞いの本体は apps/api/src/features/F8/handovers/claim.ts。上限・道の値の形・入口の行の確かめ（row_rules.mjs）は契約の入口（op.ts）が先に確かめる
import type { Hook } from "../contract/deps.js";
import { claimHandover } from "../features/F8/handovers/claim.js";
import type { HandoverDeps } from "../features/F8/handovers/index.js";
import { defineHooks } from "./registry.js";

export function handoverClaimHooks(d: HandoverDeps): Record<string, Hook> {
  return {
    // 人を決める（グループの人を担当者に決める）。答える人だけ（app.handover_answerer）
    claimTicketHandover: { before: claimHandover(d) },
  };
}

export const register = defineHooks({
  name: "handoverClaimHooks",
  make: (d) =>
    handoverClaimHooks({
      appPool: d.appPool,
      ...(d.mailer ? { mailer: d.mailer } : {}),
      config: { webBaseUrl: d.config.webBaseUrl ?? "" },
    }),
  fuzz: "same",
});
