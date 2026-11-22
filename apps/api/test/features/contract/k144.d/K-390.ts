// 葉 K-390「決定を読む・足す口（listTicketDecisions・createTicketDecision）」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   行 ID は段 7 の枠 K144-API-700〜799（葉ごと：K-383 700〜701・K-384 710・K-385 720・K-386 730〜732・K-387 740・K-390 750〜751・K-391 760。段 9 は 900 台・本線と段 4 は 001〜072・801〜855 で重ならない）。
//   入口の uuid の行（道の値 :id＝チケット）と、足す口を叩く時の体（必須の欄 text を入れて、正しい uuid では 422 にならない形。無いチケットは 404）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { Hook } from "../../../../src/contract/deps.js";
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  setup: async (f) => {
    // この葉の hooks のファイル（apps/api/src/hooks/ticket-decisions.ts）を土台に足す。読むのは本体の準備の中だけ
    const m = (await import("../../../../src/hooks/ticket-decisions.js")) as {
      ticketDecisionHooks: (p: typeof f.pool) => Record<string, Hook>;
    };
    Object.assign(f.hooks, m.ticketDecisionHooks(f.pool));
  },
  UUID_PARAM_CASES: [
    ["K144-API-750", "listTicketDecisions", "path", "id"], // K-390
    ["K144-API-751", "createTicketDecision", "path", "id"], // K-390
  ],
  BODIES: {
    createTicketDecision: { text: "支払いは翌月末" }, // K-390
  },
};
