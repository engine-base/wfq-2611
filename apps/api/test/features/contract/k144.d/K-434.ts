// 葉 K-434「確認項目を読む・足す口（listTestSpecs・createTestSpec）」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   道の uuid（チケットの id）が正しい形でなければ 422・欄 id になる行。正しい uuid では 404 の道を回る（チケットが無いので）。
//   行 ID は段 5 の枠 K144-API-500〜599 のうち 520〜521 を確認項目の口に取った（K-434＝520・521、K-435＝522・523、K-563＝530）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  setup: async (f) => {
    // 確認項目の口は、葉ごとの hooks のファイルの register（K-326）を葉ごとの 1 行が自分の分だけ足す。最初の要求の前に 1 回だけ読む // K-434
    (await import("../../F3/leaf-hooks.js")).leafHooks(f, ["test-specs-create"]); // K-434（読む・足す：K144-API-520・521）
  },
  UUID_PARAM_CASES: [
    ["K144-API-520", "listTestSpecs", "path", "id"], // K-434
    ["K144-API-521", "createTestSpec", "path", "id"], // K-434
  ],
  BODIES: {
    createTestSpec: { title: "宛名を確かめる" }, // K-434
  },
};
