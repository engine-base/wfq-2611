// やり取りに書き込む口（K-385）の契約の口。振る舞いの本体は apps/api/src/features/F6/thread/post.ts。
//   読む（K-383）・最後に開いた時刻（K-384）・直す・消す・☆（K-386）は、それぞれの葉が自分の hooks のファイルを作る
import type pg from "pg";
import type { Hook } from "../contract/deps.js";
import { createPostTicketMessage, inputPost } from "../features/F6/thread/post.js";
import { defineHooks } from "./registry.js";

export function ticketMessagePostHooks(appPool: pg.Pool): Record<string, Hook> {
  return {
    createTicketMessage: { input: inputPost, before: createPostTicketMessage(appPool) },
  };
}

export const register = defineHooks({
  name: "ticketMessagePostHooks",
  make: (d) => ticketMessagePostHooks(d.appPool),
  fuzz: "same",
});
