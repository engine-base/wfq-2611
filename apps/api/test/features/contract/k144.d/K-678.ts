// 葉 K-678 が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   入口の uuid の行：この葉が作る口（updateKnowledgeFolder・deleteKnowledgeFolder）の道の値 id が uuid でなければ、口の振る舞いに入る前に 422（欄 id・理由 uuid）。
//   切る段では K-675 の葉のファイルが 12 本をまとめて持っていたのを、口を作る葉ごとに分けた（行 ID と中身は同じ・2026-11-23 PM の決め：
//   作っていない口の行を置くと契約の形の検査 SHAPE-017 が赤）。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  UUID_PARAM_CASES: [
    ["K144-API-103", "updateKnowledgeFolder", "path", "id"], // K-678
    ["K144-API-104", "deleteKnowledgeFolder", "path", "id"], // K-678
  ],
  BODIES: {
    updateKnowledgeFolder: { name: "名前" }, // K-678
  },
};
