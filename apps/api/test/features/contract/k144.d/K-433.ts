// 葉 K-433「版を読む・戻す口と、項目の変更を比べる口」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   行 ID は段 5 の枠 K144-API-500〜599（K-432 が 500・この葉が 510〜512）。
//   入口の uuid の行（道の値 :id）と、その口を叩く時の体。体は正しい uuid で 422 にならない形（無いチケットは口の確かめで 404）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  setup: async (f) => {
    // 段 5 の版・項目の変更の口は apps/api/src/hooks/ticket-versions.ts の register（K-326）。最初の要求の前に 1 回だけ読む（準備で読まない・answer=8f745003d023）。
    //   正しい uuid は無い行なので 404 の道を回る
    let loading: Promise<void> | null = null;
    const load = async (): Promise<void> => {
      const m = (await import("../../../../src/hooks/ticket-versions.js")) as {
        register: { make: (d: unknown) => Record<string, unknown> };
      };
      Object.assign(f.hooks, m.register.make({ appPool: f.pool }));
    };
    const base = f.req;
    f.req = async (method, path, o) => {
      await (loading ??= load());
      return base(method, path, o);
    };
  },
  UUID_PARAM_CASES: [
    ["K144-API-510", "listTicketVersions", "path", "id"], // K-433
    ["K144-API-511", "restoreTicketVersion", "path", "id"], // K-433
    ["K144-API-512", "listTicketItemChanges", "path", "id"], // K-433
  ],
  BODIES: {
    restoreTicketVersion: { current_version: 1 }, // K-433
  },
};
