// K-1106「DB が失敗したときの答えを 503 E-PAGE-003 にそろえる」の単体の試験（口・本物の DB・偽の画面のログイン）。
//   行 ID（K1106-API-…）は 11_tickets/K-1106.md の表と 1 対 1。hooks を試験の中だけ差し替える（K-234 と同じ土台）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withTenant } from "@kaname/db/context";
import { CATALOG } from "@kaname/errors";
import { ticketHooks } from "../src/hooks/tickets.js";
import type { Hook } from "../src/contract/deps.js";
import { makeFixture, type Fixture, type Person } from "./features/fixture.js";

let f: Fixture;
let writer: Person;

beforeAll(async () => {
  f = await makeFixture([ticketHooks]);
  const T = await f.company("K1106 の会社", "KD");
  writer = await f.person(T.tenantId, T.rootScope, { name: "読む人", ticketAbility: "edit" });
}, 60_000);
afterAll(async () => {
  await f?.close();
});

const OP = "listTicketKinds";
const checkedOut = () => f.pool.totalCount - f.pool.idleCount;

/** hooks を試験の中だけ差し替え、口を 1 回叩く（終わったら戻す）。ログは黙らせる */
async function callWith(h: Hook): Promise<{ status: number; text: string }> {
  const keep: Hook | undefined = f.hooks[OP];
  f.hooks[OP] = h;
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const r = await f.req("GET", "/ticket_kinds", { headers: writer.auth });
    return { status: r.status, text: await r.text() };
  } finally {
    spy.mockRestore();
    if (keep) f.hooks[OP] = keep;
    else delete f.hooks[OP];
  }
}
const body = (text: string) => JSON.parse(text) as Record<string, unknown>;

describe("K-1106 契約の口の中の DB の失敗は 503 E-PAGE-003", () => {
  it("K1106-API-001 口の中の問い合わせが DB に断られる（1 / 0）：503・E-PAGE-003・unavailable・正本の文・DB の文を出さない", async () => {
    const r = await callWith({
      before: async (a) => withTenant(f.pool, a.ctx, async (c) => (await c.query("select 1 / 0 as v")).rows[0]),
    });
    expect(r.status, r.text).toBe(503);
    const b = body(r.text);
    expect(b["code"]).toBe("E-PAGE-003");
    expect(b["error"]).toBe("unavailable");
    expect(b["message"]).toBe(CATALOG["E-PAGE-003"]!.message);
    expect(r.text).not.toContain("division");
    expect(r.text).not.toContain("22012");
  });

  it("K1106-API-002 口の中で DB に繋がらない（ECONNREFUSED）：503・E-PAGE-003", async () => {
    const r = await callWith({
      before: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
          code: "ECONNREFUSED",
          errno: -61,
          syscall: "connect",
        });
      },
    });
    expect(r.status, r.text).toBe(503);
    expect(body(r.text)["code"]).toBe("E-PAGE-003");
  });

  it("K1106-API-003 口の中で接続の取得が時間切れ（timeout exceeded when trying to connect）：503・E-PAGE-003", async () => {
    const r = await callWith({
      before: async () => {
        throw new Error("timeout exceeded when trying to connect");
      },
    });
    expect(r.status, r.text).toBe(503);
    expect(body(r.text)["code"]).toBe("E-PAGE-003");
  });

  it("K1106-API-009 口の中で DB との接続が切れた（Connection terminated unexpectedly）：503・E-PAGE-003", async () => {
    const r = await callWith({
      before: async () => {
        throw new Error("Connection terminated unexpectedly");
      },
    });
    expect(r.status, r.text).toBe(503);
    expect(body(r.text)["code"]).toBe("E-PAGE-003");
  });

  it("K1106-API-004 口の中で DB でない例外（TypeError）：500・code null（onError のまま）", async () => {
    const r = await callWith({
      before: async () => {
        throw new TypeError("x is not a function");
      },
    });
    expect(r.status, r.text).toBe(500);
    expect(body(r.text)["code"]).toBeNull();
  });

  it("K1106-API-005 口の中で入力が DB の決まりに合わない（'x'::uuid・22P02）：422・VALIDATION_ERROR（503 にしない）", async () => {
    const r = await callWith({
      before: async (a) => withTenant(f.pool, a.ctx, async (c) => (await c.query("select 'x'::uuid as v")).rows[0]),
    });
    expect(r.status, r.text).toBe(422);
    expect(body(r.text)["code"]).toBe("VALIDATION_ERROR");
  });

  it("K1106-API-006 503 の直後に差し替えを戻して同じ口：200・借りたままの接続 0", async () => {
    const r1 = await callWith({
      before: async (a) => withTenant(f.pool, a.ctx, async (c) => (await c.query("select 1 / 0 as v")).rows[0]),
    });
    expect(r1.status, r1.text).toBe(503);
    expect(checkedOut()).toBe(0);
    const r2 = await f.req("GET", "/ticket_kinds", { headers: writer.auth });
    expect(r2.status, await r2.clone().text()).toBe(200);
    expect(checkedOut()).toBe(0);
  });
});

// ---------------------------------------------------------------- 静的（本線のコードと契約の元に 500 が残っていない）
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** 持ち主が別の葉（K-566・K-440）と、やらないこと（K-1106 の md）の物 */
const NOT_MINE = [
  "apps/api/src/features/F5/approve-complete/complete.ts",
  "apps/api/src/features/ticket-update/update.ts",
  "apps/api/src/features/F1/admin-recovery/index.ts",
  "apps/api/src/features/F1/verify-email/index.ts",
];

describe("K-1106 500 の残り", () => {
  it("K1106-API-007 本線の口のコードに E-PAGE-003 を 500 で返す書き方が無い（別の葉の物・やらないことを除く）", () => {
    const src = join(ROOT, "apps/api/src");
    const files = (readdirSync(src, { recursive: true }) as string[])
      .filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p))
      .map((p) => `apps/api/src/${p.split("\\").join("/")}`)
      .filter((p) => !NOT_MINE.includes(p));
    expect(files.length).toBeGreaterThan(50);
    const bad = /\(500, "E-PAGE-003"|"E-PAGE-003", 500\)|fromCatalog\(500|status: 500,/;
    const hits = files.flatMap((p) =>
      readFileSync(join(ROOT, p), "utf8")
        .split("\n")
        .map((line, i) => ({ p, n: i + 1, line }))
        .filter((x) => bad.test(x.line))
        .map((x) => `${x.p}:${x.n}: ${x.line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("K1106-API-008 契約の元 screen_api.py：7 口の DB の失敗の行は 503・unavailable・EARS に「503 と」。500 の行と文は、やらないことの 2 口（頼みを書く DB・確定の途中で DB か認証）の物だけ", () => {
    const lines = readFileSync(join(ROOT, "05_flow/screen_api.py"), "utf8").split("\n");
    const MINE = [
      "ロックを見る DB かセッションを写す所が落ちたなら",
      "セッションを写す所が落ちたなら",
      "同意を書く DB が落ちたなら",
      "今の版を読む DB が落ちたなら",
      "稼働状況を読む DB が落ちたなら",
      "端末を切る所かパスワードを変える所で落ちたなら",
      "規約の版を読む DB か申し込みを書く DB が落ちたなら",
    ];
    for (const m of MINE) {
      const i = lines.findIndex((l) => l.includes(`IF ${m}、Kaname は`));
      expect(i, m).toBeGreaterThan(1);
      expect(lines[i], m).toContain("503 と E-PAGE-003");
      const status = lines[i - 2]!;
      expect(status, m).toContain('"status": 503');
      expect(status, m).toContain('"error": "unavailable"');
    }
    const statusLines = lines.map((l, i) => ({ l, i })).filter((x) => /"status": 500\b/.test(x.l));
    const ears = lines.filter((l) => /500 と E-PAGE-003/.test(l));
    const allowed = [/頼みを書く DB が落ちたなら/, /確定の途中で DB か認証が落ちたなら/];
    expect(ears.filter((l) => !allowed.some((a) => a.test(l)))).toEqual([]);
    expect(ears).toHaveLength(2);
    expect(statusLines).toHaveLength(2);
    for (const x of statusLines) {
      const next = lines.slice(x.i, x.i + 4).join("\n");
      expect(
        allowed.some((a) => a.test(next)),
        next,
      ).toBe(true);
    }
  });
});
