// K-468「探す口の置き場とチケット」の単体の試験（口・本物の DB）。名前の頭の行 ID（K468-API-…）は 11_tickets/K-468.md の行の表と 1 対 1。
// 口：GET /api/v1/search（search）。問い合わせ q（100 文字まで）・kinds（ticket・decision・conversation・knowledge をコンマで）・limit（種類ごとの上限 1〜5・既定 5）・cursor（形だけ）。
//   答え：{ data: [{ kind, id, title, snippet, url }] }（総数・続きを返さない）。並びは 種類の順（チケット → 決定 → 会話 → ナレッジ）→ 種類の中の順。
// この葉が本物にするのはチケットだけ。決定・会話・ナレッジの探し方は空の形（0 件）で置く（K-469・K-470 が自分のファイルだけ本物にする）。
//   だからこの試験は、ほかの種類が空かどうかではなく「会社にそのデータが無いから 0 件」の形でだけ確かめる（K-469・K-470 が入っても変わらない）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ids,
  kindsOf,
  makeTicket,
  makeWorld,
  outsideGroup,
  qs,
  search,
  searchOk,
  setRow,
  setupSearch,
  wide,
  type Hit,
  type SearchKit,
  type World,
} from "./search.harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "..", "src");
let k: SearchKit;
const f = () => k.f;
const world = (prefix = "EG") => makeWorld(f(), prefix);
const make = (w: World, o: Parameters<typeof makeTicket>[2] = {}) => makeTicket(f(), w, o);
const ok = (who: Parameters<typeof searchOk>[1], q = "") => searchOk(f(), who, q);
const json = async (r: Response) => (await r.json()) as Record<string, unknown> & { details?: { field: string }[] };

beforeAll(async () => {
  k = await setupSearch();
}, 60_000);
afterAll(async () => {
  await k?.f.close();
});

describe("K-468 探す口：チケットの探し方と答えの形", () => {
  it("K468-API-001 0 件：200・body は { data: [] } だけ（meta も総数も無い）・Cache-Control に private と no-store", async () => {
    const w = await world();
    await make(w, { title: "別の題名" });
    const r = await search(f(), w.me, qs("見つからない言葉"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: [] });
    const cache = r.headers.get("cache-control") ?? "";
    expect(cache).toContain("private");
    expect(cache).toContain("no-store");
  });

  it("K468-API-002 題名の一部で当たる：1 件の鍵はちょうど 5 つ・kind ticket・title は題名・snippet は「番号・段の名前」・url は /tickets/<id>。更新の新しい順", async () => {
    const w = await world();
    const a = await make(w, { title: "セイコー様 請求書" });
    const b = await make(w, { title: "請求書を送る" });
    await make(w, { title: "別の件" });
    await setRow(f(), "tickets", a.id, { updated_at: "2026-11-01T00:00:00Z" });
    await setRow(f(), "tickets", b.id, { updated_at: "2026-11-05T00:00:00Z" });
    const h = await ok(w.me, qs("請求書"));
    expect(ids(h)).toEqual([b.id, a.id]);
    for (const x of h) expect(Object.keys(x).sort()).toEqual(["id", "kind", "snippet", "title", "url"]);
    const stage = (
      await f().admin.query<{ n: string }>(
        "select s.name as n from tickets t join ticket_stages s on s.id = t.stage_id where t.id = $1",
        [b.id],
      )
    ).rows[0]!.n;
    expect(h[0]).toEqual({
      kind: "ticket",
      id: b.id,
      title: "請求書を送る",
      snippet: `${b.number}・${stage}`,
      url: `/tickets/${b.id}`,
    });
  });

  it("K468-API-003 番号で当たる：半角・全角・ハイフンの種類・大文字小文字・前後の空白はどれも同じ 1 件。番号の一部（頭の英字だけ）は番号では当たらない", async () => {
    const w = await world();
    const t = await make(w, { title: "見積を出す" });
    await make(w, { title: "別の件" });
    const [head, num] = t.number.split("-") as [string, string];
    for (const q of [
      t.number,
      `${head}‐${num}`,
      `${head}ー${num}`,
      `${head}−${num}`,
      wide(t.number.toLowerCase()),
      `  ${t.number}  `,
    ])
      expect(ids(await ok(w.me, qs(q))), q).toEqual([t.id]);
    expect(
      ids(await ok(w.me, qs(head.toLowerCase()))),
      "頭の英字だけは番号の一致にならない（題名に無ければ 0 件）",
    ).toEqual([]);
  });

  it("K468-API-004 題名の表記ゆらぎ：全角の英字の題名は半角の小文字で、「サーバー」は「サーバーの移行」に当たる（ハイフンのそろえは番号だけで、題名の「ー」は変えない）", async () => {
    const w = await world();
    const long = await make(w, { title: "サーバーの移行" });
    const wideApi = await make(w, { title: "ＡＰＩの件" });
    expect(ids(await ok(w.me, qs("サーバー")))).toEqual([long.id]);
    expect(ids(await ok(w.me, qs("api")))).toEqual([wideApi.id]);
    expect(ids(await ok(w.me, qs(" ＡＰＩ ")))).toEqual([wideApi.id]);
  });

  it("K468-API-005 q の % ・ _ ・ \\ は文字として探す（ワイルドカードにしない）", async () => {
    const w = await world();
    const pct = await make(w, { title: "割引 10% の件" });
    await make(w, { title: "割引 10 の件" });
    const under = await make(w, { title: "a_b の件" });
    await make(w, { title: "axb の件" });
    const slash = await make(w, { title: "c\\d の件" });
    expect(ids(await ok(w.me, qs("10%")))).toEqual([pct.id]);
    expect(ids(await ok(w.me, qs("a_b")))).toEqual([under.id]);
    expect(ids(await ok(w.me, qs("c\\d")))).toEqual([slash.id]);
    expect(ids(await ok(w.me, qs("%")))).toEqual([pct.id]);
  });

  it("K468-API-006 q が無い・空・空白だけ：200・data は空（全部を返さない）。kinds を付けても同じ", async () => {
    const w = await world();
    await make(w);
    for (const q of ["", "q=", `q=${encodeURIComponent("   ")}`, "q=&kinds=ticket", "kinds=ticket"])
      expect(await ok(w.me, q), JSON.stringify(q)).toEqual([]);
  });

  it("K468-API-007 q の長さは送られたままの文字で数える（契約の maxLength 100）：101 文字は 422・E-SRC-001・欄 q。100 文字ちょうどは 200。前後の空白も数え、全角は 1 文字・正規化で伸びる字（㌔）も 100 文字なら断らない", async () => {
    const w = await world();
    const r = await search(f(), w.me, qs("あ".repeat(101)));
    expect(r.status).toBe(422);
    const b = await json(r);
    expect(b["code"]).toBe("E-SRC-001");
    expect((b.details ?? []).map((d) => d.field)).toContain("q");
    expect((await search(f(), w.me, qs("あ".repeat(100)))).status).toBe(200);
    expect((await search(f(), w.me, qs(wide("a".repeat(100))))).status).toBe(200);
    expect((await search(f(), w.me, qs(wide("a".repeat(101))))).status).toBe(422);
    expect(
      (await search(f(), w.me, qs(`  ${"a".repeat(99)}`))).status,
      "前後の空白も 1 文字に数える（99 字 + 空白 2 つ = 101）",
    ).toBe(422);
    expect((await search(f(), w.me, qs(`  ${"a".repeat(98)}`))).status, "98 字 + 空白 2 つ = 100").toBe(200);
    expect(
      (await search(f(), w.me, qs("㌔".repeat(100)))).status,
      "NFKC で 200 文字に伸びても、送られた字が 100 なら断らない",
    ).toBe(200);
  });

  it("K468-API-008 kinds の選び方：ticket だけ・チケット以外だけ（会社にデータが無いので 0 件）・空は全部・複数は種類の順で重ならない。同じ種類を重ねても同じ（名前は小文字・空白なしの決まった形のまま）", async () => {
    const w = await world();
    const t = await make(w, { title: "請求の件" });
    expect(ids(await ok(w.me, qs("請求", "kinds=ticket")))).toEqual([t.id]);
    expect(await ok(w.me, qs("請求", "kinds=decision,conversation,knowledge"))).toEqual([]);
    expect(ids(await ok(w.me, qs("請求", "kinds=")))).toEqual([t.id]);
    expect(ids(await ok(w.me, qs("請求", "kinds=conversation,ticket")))).toEqual([t.id]);
    expect(ids(await ok(w.me, qs("請求", "kinds=ticket,ticket")))).toEqual([t.id]);
    expect(kindsOf(await ok(w.me, qs("請求")))).toEqual(["ticket"]);
  });

  it("K468-API-009 kinds が契約の形（小文字の 4 つの名前をコンマでつないだだけ）に合わなければ 422・E-SRC-002・欄 kinds：知らない種類・空の項目・大文字・全角・空白", async () => {
    const w = await world();
    for (const kinds of [
      "foo",
      "page",
      "ticket,foo",
      "ticket,,decision",
      ",",
      " Ticket , ticket ",
      "Ticket",
      "ＴＩＣＫＥＴ",
      "ticket, decision",
    ]) {
      const r = await search(f(), w.me, qs("請求", `kinds=${encodeURIComponent(kinds)}`));
      expect(r.status, kinds).toBe(422);
      const b = await json(r);
      expect(b["code"], kinds).toBe("E-SRC-002");
      expect(
        (b.details ?? []).map((d) => d.field),
        kinds,
      ).toContain("kinds");
    }
  });

  it("K468-API-010 limit は種類ごとの上限（既定 5・1〜5）：7 件当たっても 5 件・limit=2 は 2 件。0・6・文字は 422・欄 limit。cursor は形だけ（付けても答えは同じ・数字でない値は 422・欄 cursor）", async () => {
    const w = await world();
    for (let i = 0; i < 7; i += 1) await make(w, { title: `見積 ${i}` });
    expect(await ok(w.me, qs("見積"))).toHaveLength(5);
    expect(await ok(w.me, qs("見積", "limit=2"))).toHaveLength(2);
    expect(await ok(w.me, qs("見積", "limit=5"))).toHaveLength(5);
    for (const [q, field] of [
      ["limit=0", "limit"],
      ["limit=6", "limit"],
      ["limit=abc", "limit"],
      ["cursor=abc", "cursor"],
    ] as const) {
      const r = await search(f(), w.me, qs("見積", q));
      expect(r.status, q).toBe(422);
      expect(
        ((await json(r)).details ?? []).map((d) => d.field),
        q,
      ).toContain(field);
    }
    expect(ids(await ok(w.me, qs("見積", "cursor=3")))).toEqual(ids(await ok(w.me, qs("見積"))));
  });

  it("K468-API-011 並び：番号が一致したものが先、そのあと更新の新しい順 → id の小さい順", async () => {
    const w = await world();
    const target = await make(w, { title: "ほかの題名" });
    const mention = await make(w, { title: `${target.number.toLowerCase()} について` });
    await setRow(f(), "tickets", target.id, { updated_at: "2026-11-01T00:00:00Z" });
    await setRow(f(), "tickets", mention.id, { updated_at: "2026-11-09T00:00:00Z" });
    expect(ids(await ok(w.me, qs(target.number)))).toEqual([target.id, mention.id]);
  });

  it("K468-API-012 見える範囲：見えないグループのチケットは題名でも番号でも出ない。見るだけの人にも見えるグループのは出る", async () => {
    const w = await world();
    const grp = await outsideGroup(f(), w);
    const acct = await f().person(w.tenantId, grp, { name: "経理の人", ticketAbility: "edit" });
    const secret = await make({ ...w, me: acct }, { scope: grp, title: "経理の秘密の請求" });
    const open = await make(w, { title: "公開の請求" });
    const viewer = await f().person(w.tenantId, w.root, { name: "見るだけの人", ticketAbility: "view" });
    expect(ids(await ok(viewer, qs("請求")))).toEqual([open.id]);
    expect(ids(await ok(viewer, qs(secret.number)))).toEqual([]);
    expect(ids(await ok(acct, qs("請求")))).toEqual([secret.id]);
  });

  it("K468-API-013 権限を付けた直後は出て、外した直後は出ない（入り直さなくても）", async () => {
    const w = await world();
    const grp = await outsideGroup(f(), w);
    const acct = await f().person(w.tenantId, grp, { name: "経理の人", ticketAbility: "edit" });
    const t = await make({ ...w, me: acct }, { scope: grp, assignee: acct, title: "権限の変わる請求" });
    const viewer = await f().person(w.tenantId, w.root, { name: "見る人" });
    expect(ids(await ok(viewer, qs("権限の変わる")))).toEqual([]);
    await f().admin.query(
      "insert into permissions (tenant_id, grantee_member_id, target_kind_id, scope_id, ability_id) values ($1, $2, 'tickets', $3, 'view')",
      [w.tenantId, viewer.id, grp],
    );
    expect(ids(await ok(viewer, qs("権限の変わる")))).toEqual([t.id]);
    await f().admin.query("delete from permissions where grantee_member_id = $1 and scope_id = $2", [viewer.id, grp]);
    expect(ids(await ok(viewer, qs("権限の変わる")))).toEqual([]);
  });

  it("K468-API-014 消したチケットは誰にも出ない（消した本人にも）。取り込みの下書きは取り込んだ本人にだけ出る", async () => {
    const w = await world();
    const gone = await make(w, { title: "消した請求" });
    await setRow(f(), "tickets", gone.id, { deleted_at: new Date().toISOString() });
    const draft = await make(w, { title: "下書きの請求", assignee: w.mate });
    const imp = (
      await f().admin.query<{ id: string }>(
        "insert into ticket_imports (tenant_id, uploaded_by, scope_id, source) values ($1, $2, $3, 'generic') returning id",
        [w.tenantId, w.me.id, w.root],
      )
    ).rows[0]!.id;
    await setRow(f(), "tickets", draft.id, { draft_import_id: imp });
    expect(ids(await ok(w.me, qs("請求")))).toEqual([draft.id]);
    expect(ids(await ok(w.mate, qs("請求")))).toEqual([]);
    expect(ids(await ok(w.me, qs(gone.number)))).toEqual([]);
  });

  it("K468-API-015 他の会社のチケットは番号でも題名でも出ない。2 つの会社に入っている人には今のワークスペースのチケットだけ", async () => {
    const w = await world("EG");
    const o = await world("OT");
    const theirs = await make(o, { title: "他社の請求" });
    const here = await make(w, { title: "自社の請求" });
    expect(ids(await ok(w.me, qs("請求")))).toEqual([here.id]);
    expect(ids(await ok(w.me, qs(theirs.number)))).toEqual([]);
    const there = await f().alsoIn(w.me, o.tenantId, o.root);
    await f().admin.query(
      "insert into permissions (tenant_id, grantee_member_id, target_kind_id, scope_id, ability_id) values ($1, $2, 'tickets', $3, 'view')",
      [o.tenantId, there.id, o.root],
    );
    expect(ids(await ok(there, qs("請求")))).toEqual([theirs.id]);
  });

  it("K468-API-016 取引先の人・運営の人（預かりの許可なし）は 403。ログインなしは 401・同意し直しが要るセッションは 403・E-AUTH-010", async () => {
    const w = await world();
    await make(w);
    for (const role of ["client", "ops"] as const) {
      const r = await search(f(), w.me, qs("請求"), f().as(w.me, role));
      expect(r.status, role).toBe(403);
    }
    const anon = await f().req("GET", `/search?${qs("請求")}`);
    expect(anon.status).toBe(401);
    const pending = await search(f(), w.me, qs("請求"), f().pending(w.me));
    expect(pending.status).toBe(403);
    expect((await json(pending))["code"]).toBe("E-AUTH-010");
  });

  it("K468-API-017 1 分に 121 回：429・待つ秒数", async () => {
    const w = await world();
    await k.ready();
    const saved = f().limits["search"];
    f().limits["search"] = 120;
    try {
      let last: Response | null = null;
      for (let i = 0; i < 121; i += 1)
        last = await f().req("GET", `/search?${qs("請求")}`, { headers: w.me.auth, ip: "198.51.100.68" });
      expect(last!.status).toBe(429);
      expect(((await last!.json()) as { retry_after_sec?: number }).retry_after_sec).toBeGreaterThan(0);
    } finally {
      f().limits["search"] = saved!;
    }
  }, 60_000); // 何十回も続けて口を呼ぶ送りすぎの確かめ（重い台でも既定の 5 秒で切らない）

  it("K468-API-018 ログに題名と探す言葉が出ない", async () => {
    const w = await world();
    await make(w, { title: "ログに出ない題名" });
    const out: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))),
    );
    try {
      await ok(w.me, qs("ログに出ない題名"));
      await search(f(), w.me, qs("ログに出ない語".repeat(20)));
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(out.join("\n")).not.toContain("ログに出ない");
  });
});

describe("K-468 探す口：失敗の道と置き場", () => {
  it("K468-API-019 失敗 × DB に届かない：503・E-PAGE-003。中の理由（接続の文）を答えに出さない", async () => {
    const w = await world();
    await make(w, { title: "届かない請求" });
    await k.ready();
    const bad = new pg.Pool({
      host: "127.0.0.1",
      port: 1,
      user: "x",
      database: "x",
      max: 1,
      connectionTimeoutMillis: 1500,
    });
    const mod = (await import(join(SRC, "hooks", "search.ts"))) as {
      searchHooks: (d: { appPool: pg.Pool }) => Record<string, (typeof k.f.hooks)[string]>;
    };
    const original = f().hooks["search"];
    f().hooks["search"] = mod.searchHooks({ appPool: bad })["search"]!;
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const r = await search(f(), w.me, qs("請求"));
      expect(r.status).toBe(503);
      const text = await r.text();
      expect(JSON.parse(text).code).toBe("E-PAGE-003");
      expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|connect/i);
    } finally {
      for (const s of spies) s.mockRestore();
      f().hooks["search"] = original!;
      await bad.end();
    }
    expect(ids(await ok(w.me, qs("請求")))).toHaveLength(1);
  });

  it("K468-API-020 失敗 × ある種類の探し方が例外：全体が 503・E-PAGE-003 で、うまくいった種類（チケット）の結果も返さない（部分の答えを出さない）。直すと元に戻る", async () => {
    const w = await world();
    const t = await make(w, { title: "部分の請求" });
    await k.ready();
    const kinds = (await import(join(SRC, "features", "F7", "search", "kinds.ts"))) as {
      SEARCHERS: Record<string, (...a: never[]) => Promise<Hit[]>>;
    };
    const original = kinds.SEARCHERS["conversation"]!;
    kinds.SEARCHERS["conversation"] = async () => {
      throw new Error("K468 の試験で会話の探し方を壊した");
    };
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const r = await search(f(), w.me, qs("請求"));
      expect(r.status).toBe(503);
      const text = await r.text();
      expect(JSON.parse(text).code).toBe("E-PAGE-003");
      expect(text).not.toContain(t.id);
      expect(text).not.toContain("K468 の試験");
      // 壊した種類を kinds で外せば、ほかの種類は答える（種類ごとに独立）
      expect(ids(await ok(w.me, qs("請求", "kinds=ticket")))).toEqual([t.id]);
    } finally {
      for (const s of spies) s.mockRestore();
      kinds.SEARCHERS["conversation"] = original;
    }
    expect(ids(await ok(w.me, qs("請求")))).toEqual([t.id]);
  });

  it("K468-API-021 種類ごとのファイルの置き場：tickets・decisions・conversations・knowledge の 4 つが features/F7/search/ に在り、KINDS は チケット・決定・会話・ナレッジ の順（K-469・K-470 が自分のファイルだけ直す前提）", async () => {
    for (const name of ["tickets", "decisions", "conversations", "knowledge", "kinds", "query", "index"])
      expect(existsSync(join(SRC, "features", "F7", "search", `${name}.ts`)), `${name}.ts`).toBe(true);
    expect(existsSync(join(SRC, "hooks", "search.ts"))).toBe(true);
    const kinds = (await import(join(SRC, "features", "F7", "search", "kinds.ts"))) as {
      KINDS: readonly string[];
      SEARCHERS: Record<string, unknown>;
    };
    expect([...kinds.KINDS]).toEqual(["ticket", "decision", "conversation", "knowledge"]);
    expect(Object.keys(kinds.SEARCHERS)).toEqual(["ticket", "decision", "conversation", "knowledge"]);
    for (const key of kinds.KINDS) expect(typeof kinds.SEARCHERS[key], key).toBe("function");
  });
});
