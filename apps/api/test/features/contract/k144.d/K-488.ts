// 葉 K-488「消す口（deleteTicket）」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   道の値 id と、問い合わせの移し先 parent_id（*_id は正式な uuid・D-129.42）の 2 行。移し先の行の ID は、K-598（試験の葉・k144 の行を持たない）の空き 898 を借りた。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  setup: async (f) => {
    // 段 8 の消す口は、葉ごとの hooks のファイルを最初の要求のときに 1 回だけ読む（準備で読まない）// K-488
    const { leafHooks } = await import("../../F3/leaf-hooks.js");
    leafHooks(f, ["ticket-delete"]); // K-488（消す：K144-API-888・898）
  },
  UUID_PARAM_CASES: [
    ["K144-API-888", "deleteTicket", "path", "id"], // K-488
    ["K144-API-898", "deleteTicket", "query", "parent_id"], // K-488
  ],
};
