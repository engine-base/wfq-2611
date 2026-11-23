// 消す前の下見（K-487）の契約の口。振る舞いの本体は apps/api/src/features/F7/ticket-delete/preview.ts。
//   消す口（K-488）・戻す口（K-489）は、それぞれの葉が自分の hooks のファイルを作る（このファイルに足さない）。
//   ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type { Hook } from "../contract/deps.js";
import { createPreviewTicketDelete } from "../features/F7/ticket-delete/preview.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function ticketDeletePreviewHooks(d: HookDeps): Record<string, Hook> {
  return {
    previewTicketDelete: { before: createPreviewTicketDelete(d.appPool) },
  };
}

export const register = defineHooks({
  name: "ticketDeletePreviewHooks",
  make: (d) => ticketDeletePreviewHooks(d),
  fuzz: "same",
});
