// 葉 K-441「つながりを読む・足す・外す口（listTicketLinks・createTicketLink・deleteTicketLink）」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   入口の uuid の行（道の値 :id）3 つ。行 ID は 段 5 の枠（K144-API-5NN）で、K-439 が 539・この葉が 541〜543 を取る（K-440 は updateTicket の uuid の行を K-387 の葉のファイルに任せるので足さない）。
//   口の振る舞い（apps/api/src/hooks/ticket-links.ts の register）は、最初の要求の前に 1 回だけ読む（準備で読まない：実装の前の smoke で、
//   まだ無いファイルを準備で読んで準備ごと落とさない・answer=8f745003d023）。パスは組み立てて読む（無いファイルの静的な import で落とさない）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HookDeps, HookModule } from "../../../../src/hooks/registry.js";
import type { K144Leaf } from "./_base.js";

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "hooks");

export const leaf: K144Leaf = {
  setup: (f) => {
    let loading: Promise<void> | null = null;
    const load = async (): Promise<void> => {
      const m = (await import(join(HOOKS_DIR, "ticket-links.ts"))) as { register: HookModule }; // K-441
      Object.assign(f.hooks, m.register.make({ appPool: f.pool } as unknown as HookDeps));
    };
    const base = f.req;
    f.req = async (method, path, o) => {
      await (loading ??= load());
      return base(method, path, o);
    };
  },
  UUID_PARAM_CASES: [
    ["K144-API-541", "listTicketLinks", "path", "id"], // K-441
    ["K144-API-542", "createTicketLink", "path", "id"], // K-441
    ["K144-API-543", "deleteTicketLink", "path", "id"], // K-441
  ],
  BODIES: {
    createTicketLink: { other_ticket_id: "00000000-0000-4000-8000-0000000000aa", kind: "related" }, // K-441
  },
};
