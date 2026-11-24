// 葉 K-406「渡した人が取り消す・催促する（withdrawTicketHandover・remindTicketHandover）」の葉のファイル（置き方は README.md・K-378）。
//   入口の uuid の行：道の値 id が uuid でなければ、口の振る舞いに入る前に 422（欄 id・理由 uuid）。体は空の形（strict）。
//   口の振る舞い（hooks）は、この葉の hooks のファイル apps/api/src/hooks/handovers-sender.ts の register を準備で 1 回だけ動的 import で足す
//   （この葉が入った木にだけ在るファイル。範囲の地図は ci_scope.d/K-406.json の reads_ok）。メールは送らない（正しい uuid の道は 404 で口に入らない）。
//   行 ID は葉ごとの枠（K-401 900〜902・K-405 950・K-406 960〜961・K-410 910。新しい葉は 9N0 から）。この葉は K144-API-960・961。本線の contract/ に同じ番号は無い。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { HookDeps, HookModule } from "../../../../src/hooks/registry.js";
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  setup: async (f) => {
    const mod = (await import("../../../../src/hooks/handovers-sender.js")) as { register: HookModule };
    Object.assign(
      f.hooks,
      mod.register.make({ appPool: f.pool, config: { webBaseUrl: "http://localhost:3000" } } as unknown as HookDeps),
    );
  },
  UUID_PARAM_CASES: [
    ["K144-API-960", "withdrawTicketHandover", "path", "id"],
    ["K144-API-961", "remindTicketHandover", "path", "id"],
  ],
  BODIES: {
    withdrawTicketHandover: {},
    remindTicketHandover: {},
  },
};
