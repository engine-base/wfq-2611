// 葉 K-410「グループに配る・グループに来たものを引き取る」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   足す口 claimTicketHandover（POST /ticket_handovers/:id/claim）の道の値 id が uuid でなければ 422（入口の共通の形の確かめ・K-144）。
//   口の振る舞いは葉の hooks のファイル apps/api/src/hooks/handover-claim.ts の register（K-326）。最初の要求の前に 1 回だけ読む
//   （準備で読まない：実装の前の smoke で、まだ無いファイルを準備で読んで準備ごと落とさない・answer=8f745003d023）。
//   行の番号 K144-API-910 は段 9 の切る段で置いた番号（本体と置き場の最大は 855。段 9 のほかの葉と重ならないよう、まとめ役が番号を確かめる）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepository } from "@kaname/db/repository";
import type { HookDeps, HookModule } from "../../../../src/hooks/registry.js";
import type { K144Leaf } from "./_base.js";

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "hooks");

export const leaf: K144Leaf = {
  setup: (f) => {
    let loading: Promise<void> | null = null;
    const load = async (): Promise<void> => {
      const d = {
        appPool: f.pool,
        repo: await createRepository(f.pool),
        config: { env: "test", webBaseUrl: "http://localhost:3000", opsEmail: "ops@example.com" },
      } as unknown as HookDeps;
      const m = (await import(join(HOOKS_DIR, "handover-claim.ts"))) as { register: HookModule };
      Object.assign(f.hooks, m.register.make(d));
    };
    const base = f.req;
    f.req = async (method, path, o) => {
      await (loading ??= load());
      return base(method, path, o);
    };
  },
  UUID_PARAM_CASES: [
    ["K144-API-910", "claimTicketHandover", "path", "id"], // K-410
  ],
  BODIES: {
    claimTicketHandover: { member_id: "0193c5a0-0000-7000-8000-0000000a4100" }, // K-410（人を決める・member_id は必須の uuid）
  },
};
