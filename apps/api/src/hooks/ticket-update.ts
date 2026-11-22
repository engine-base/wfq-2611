// チケットを直す口（updateTicket・K-387）の契約の口。振る舞いの本体は apps/api/src/features/ticket-update/（欄ごとの処理の表）と
//   欄の組（K-387：段・実績・保留＝features/F6/progress/）。ほかの欄は段 8（K-67）が組を足すまで 422 E-VAL-018。
// ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type pg from "pg";
import type { Hook } from "../contract/deps.js";
import { ticketUpdateHooks as make } from "../features/ticket-update/update.js";
import { defineHooks } from "./registry.js";

export function ticketUpdateHooks(appPool: pg.Pool): Record<string, Hook> {
  const h = make(appPool);
  return {
    updateTicket: { ...h["updateTicket"] },
  };
}

export const register = defineHooks({
  name: "ticketUpdateHooks",
  make: (d) => ticketUpdateHooks(d.appPool),
  fuzz: "same",
});
