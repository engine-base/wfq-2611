// つながり（K-441）の契約の口。振る舞いの本体は apps/api/src/features/F4/ticket-links/（流れと操作ごとのフォルダ・D-128.130）。
// ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type pg from "pg";
import type { Hook } from "../contract/deps.js";
import { createTicketLinkHooks } from "../features/F4/ticket-links/hooks.js";
import { defineHooks } from "./registry.js";

export function ticketLinksHooks(appPool: pg.Pool): Record<string, Hook> {
  const h = createTicketLinkHooks(appPool);
  return {
    listTicketLinks: { ...h["listTicketLinks"] },
    createTicketLink: { ...h["createTicketLink"] },
    deleteTicketLink: { ...h["deleteTicketLink"] },
  };
}

export const register = defineHooks({
  name: "ticketLinksHooks",
  make: (d) => ticketLinksHooks(d.appPool),
  fuzz: "same",
});
