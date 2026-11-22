// 本文の版を読む・版に戻す・項目の変更を比べる契約の口（K-433）。振る舞いの本体は apps/api/src/features/F4/versions/。
//   本文を書き終える口（updateTicketBody）は K-432 の ticket-body.ts が持つ（このファイルに足さない）
import type pg from "pg";
import type { Hook } from "../contract/deps.js";
import { createListTicketItemChanges } from "../features/F4/versions/item-changes.js";
import { createListTicketVersions } from "../features/F4/versions/list.js";
import { createRestoreTicketVersion } from "../features/F4/versions/restore.js";
import { defineHooks } from "./registry.js";

export function ticketVersionHooks(appPool: pg.Pool): Record<string, Hook> {
  return {
    listTicketVersions: { before: createListTicketVersions(appPool) },
    restoreTicketVersion: { before: createRestoreTicketVersion(appPool) },
    listTicketItemChanges: { before: createListTicketItemChanges(appPool) },
  };
}

export const register = defineHooks({
  name: "ticketVersionHooks",
  make: (d) => ticketVersionHooks(d.appPool),
  fuzz: "same",
});
