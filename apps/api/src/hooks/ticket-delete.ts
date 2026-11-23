// チケットを消す（K-488）の契約の口 deleteTicket。振る舞いの本体は apps/api/src/features/F7/ticket-delete/delete.ts。
//   下見（K-487）・戻す（K-489）は、それぞれの葉が自分の hooks のファイルを持つ（このファイルに足さない）。
//   ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type { Hook } from "../contract/deps.js";
import { createDeleteTicket } from "../features/F7/ticket-delete/delete.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function ticketDeleteHooks(d: HookDeps): Record<string, Hook> {
  return {
    deleteTicket: { before: createDeleteTicket(d.appPool) },
  };
}

export const register = defineHooks({
  name: "ticketDeleteHooks",
  make: (d) => ticketDeleteHooks(d),
  fuzz: "same",
});
