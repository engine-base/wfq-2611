// 決定を読む・足す口（K-390）の契約の口。振る舞いの本体は apps/api/src/features/F6/decisions/。
//   改める・取り消す口（updateTicketDecision）は K-391 が自分の hooks のファイルを作る（このファイルに足さない）
import type pg from "pg";
import type { Hook } from "../contract/deps.js";
import { createCreateTicketDecision } from "../features/F6/decisions/create.js";
import { createListTicketDecisions } from "../features/F6/decisions/list.js";
import { defineHooks } from "./registry.js";

export function ticketDecisionHooks(appPool: pg.Pool): Record<string, Hook> {
  return {
    listTicketDecisions: { before: createListTicketDecisions(appPool) },
    createTicketDecision: { before: createCreateTicketDecision(appPool) },
  };
}

export const register = defineHooks({
  name: "ticketDecisionHooks",
  make: (d) => ticketDecisionHooks(d.appPool),
  fuzz: "same",
});
