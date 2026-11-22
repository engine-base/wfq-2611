// K-434「確認項目を読む・足す口（listTestSpecs・createTestSpec）と表の形」の単体の試験（口と DB・本物の Postgres）。2026-11-21 の作り直し。
// テストの名前の頭の行 ID（K434-API-…）は 11_tickets/K-434.md の表の行に 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 試験が決める口の形（土台 test-spec.harness.ts の頭にも書いた）:
//   listTestSpecs   GET  /api/v1/tickets/:id/test-specs  200 { data: SpecItem[], meta: { count, limit, can_edit } }
//     SpecItem = { id, title, checked, position, source, version }（鍵はちょうど 6）。並びは作った順（created_at・id）で position は 1 から。消した行は出さない
//     完了後・読むだけの人は読めて can_edit が false
//   createTestSpec  POST /api/v1/tickets/:id/test-specs  201 { data: SpecItem }
//     体は { title } だけ（strict）。種類・判定の型・設定値・出どころ・チェック・id・版などは受けない（知らない欄は 422）
//     title は前後の空白を落として 1〜200 字（落とす前の長さが 200 を超えれば 422）。足したときはチェック無し・source manual
//     同じ取引でやり取りに変更の行（ticket_messages の kind change・「〈名前〉が確認項目を足しました：〈文〉」）を 1 つ書く
//     チケットが完了なら 409・E-SPEC-001、消されていれば 404
//   422 の details は { field, message }：欄は title
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { BARE, bareKeys, setupSpecs, type Json, type World } from "./test-spec.harness.js";

const h = setupSpecs(["test-specs-create"]);

const KEYS = ["checked", "id", "position", "source", "title", "version"];
interface Item {
  id: string;
  title: string;
  checked: boolean;
  position: number;
  source: string;
  version: number;
}

let w: World; // 会社 A
let wb: World; // 会社 B（別の会社）
const fieldsOf = (j: Json): string[] => ((j["details"] as { field: string }[] | undefined) ?? []).map((d) => d.field);
const listPath = (id: string) => `/tickets/${id}/test-specs`;
const add = (who: World["writer"] | null, ticketId: string, body: unknown, headers?: Record<string, string>) =>
  h.call(who, "POST", listPath(ticketId), { body, ...(headers ? { headers } : {}) });
const spec = (title = "請求書の宛名を確かめる") => ({ title });

beforeAll(async () => {
  w = await h.world("K434 会社 A");
  wb = await h.world("K434 会社 B");
}, 60_000);

describe("K-434 確認項目を読む（listTestSpecs）", () => {
  it("K434-API-001 一覧：作った順・position は 1 から・チェックの有無・消した行と別のチケットの行は出ない・鍵はちょうど 6（version は行の版）", async () => {
    const t = await h.ticket(w);
    const other = await h.ticket(w);
    const a = await h.seed(t.id, { title: "最初" });
    const b = await h.seed(t.id, { title: "人がチェックした行", checked: "member" });
    await h.seed(t.id, { title: "消した行", deleted: true });
    const c = await h.seed(t.id, { title: "AI がチェックした行", checked: "ai" });
    await h.seed(other.id, { title: "別のチケットの行" });
    const r = await h.call(w.writer, "GET", listPath(t.id));
    expect(r.status, await r.clone().text()).toBe(200);
    const data = (await h.json(r)).data as Item[];
    expect(data.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(data.map((x) => x.position)).toEqual([1, 2, 3]);
    expect(data.map((x) => x.checked)).toEqual([false, true, true]);
    expect(data[1]!.title).toBe("人がチェックした行");
    expect(Object.keys(data[0]!).sort()).toEqual(KEYS);
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
  });

  it("K434-API-002 一覧の meta：件数・can_edit・limit。0 件でも data は [] で meta は付く", async () => {
    const t = await h.ticket(w);
    const empty = await h.json(await h.call(w.writer, "GET", listPath(t.id)));
    expect(empty.data).toEqual([]);
    expect(empty.meta).toMatchObject({ count: 0, can_edit: true });
    expect(typeof (empty.meta as { limit: unknown }).limit).toBe("number");
    await h.seed(t.id);
    await h.seed(t.id);
    const two = await h.json(await h.call(w.writer, "GET", listPath(t.id)));
    expect((two.meta as { count: number }).count).toBe(2);
  });

  it("K434-API-003 読むだけの人：200 で読め、can_edit は false（書けるかは口の答えで決める）", async () => {
    const t = await h.ticket(w);
    await h.seed(t.id, { title: "読める行" });
    const r = await h.call(w.viewer, "GET", listPath(t.id));
    expect(r.status).toBe(200);
    const j = await h.json(r);
    expect((j.data as Item[]).length).toBe(1);
    expect((j.meta as { can_edit: boolean }).can_edit).toBe(false);
  });

  it("K434-API-004 完了した後：200 で読め、can_edit は false", async () => {
    const t = await h.ticket(w);
    await h.seed(t.id, { title: "完了前に足した行" });
    await h.finish(t.id);
    const r = await h.call(w.writer, "GET", listPath(t.id));
    expect(r.status).toBe(200);
    const j = await h.json(r);
    expect((j.data as Item[]).length).toBe(1);
    expect((j.meta as { can_edit: boolean }).can_edit).toBe(false);
  });

  it("K434-API-005 見えない・無い・消された・別の会社：一覧はどれも 404（体は error と code だけ・在るかを漏らさない）", async () => {
    const t = await h.ticket(w);
    await h.seed(t.id);
    const gone = await h.ticket(w);
    await h.removeTicket(gone.id);
    for (const [who, id, why] of [
      [w.stranger, t.id, "見えない人"],
      [wb.writer, t.id, "別の会社の人"],
      [w.writer, randomUUID(), "無い id"],
      [w.writer, gone.id, "消されたチケット"],
    ] as const) {
      const r = await h.call(who, "GET", listPath(id));
      expect(r.status, why).toBe(404);
      const j = await h.json(r);
      expect(j["error"], why).toBe("not_found");
      expect(bareKeys(j), `${why}：field・details・detail を付けない`).toEqual(BARE);
    }
  });

  it("K434-API-006 ログインしていない一覧は 401。読めない", async () => {
    const t = await h.ticket(w);
    expect((await h.call(null, "GET", listPath(t.id))).status).toBe(401);
  });

  it("K434-API-007 上限：1 分あたりの上限を超えた一覧は 429・retry_after_sec が付く", async () => {
    const t = await h.ticket(w);
    const me = await h.f.person(w.tenantId, w.rootScope, { name: "数える人", ticketAbility: "edit" });
    h.limit("listTestSpecs", 2);
    try {
      expect((await h.call(me, "GET", listPath(t.id))).status).toBe(200);
      expect((await h.call(me, "GET", listPath(t.id))).status).toBe(200);
      const r = await h.call(me, "GET", listPath(t.id));
      expect(r.status).toBe(429);
      expect(typeof (await h.json(r))["retry_after_sec"]).toBe("number");
    } finally {
      h.limit("listTestSpecs", 100_000);
    }
  });

  it("K434-API-019 出どころの列：直に入れて省くと manual・knowledge と ai の行は答えの source にそのまま出る・出どころの id は答えに出ない", async () => {
    const t = await h.ticket(w);
    const page = randomUUID();
    const m = await h.seed(t.id, { title: "人が足した" });
    await h.seed(t.id, { title: "ナレッジから", source: "knowledge", source_ref_id: page });
    await h.seed(t.id, { title: "AI が足した", source: "ai" });
    expect(m.source).toBe("manual");
    expect(m.source_ref_id).toBeNull();
    const data = (await h.json(await h.call(w.writer, "GET", listPath(t.id)))).data as Item[];
    expect(data.map((x) => x.source)).toEqual(["manual", "knowledge", "ai"]);
    expect(Object.keys(data[1]!).sort()).toEqual(KEYS);
    expect(JSON.stringify(data)).not.toContain(page);
  });

  it("K434-API-021 件数が多いとき：501 行あっても一覧は先頭の 500 行で切り、ログに 1 行（題名は出さない）。meta の count は 500", async () => {
    const t = await h.ticket(w);
    await h.f.admin.query(
      // 種類（check_kind）は前からの行と同じ 'human' を入れる（この葉の migration の前の表でも準備が通る・口は種類を見ない）
      `insert into test_specs (tenant_id, ticket_id, check_kind, title, created_by, updated_by, created_at)
       select $1, $2, 'human', '大量の行 ' || g, $3, $3, now() + (g || ' milliseconds')::interval from generate_series(1, 501) g`,
      [w.tenantId, t.id, w.writer.id],
    );
    let j: Json = {};
    const logs = await h.captureLogs(async () => {
      j = await h.json(await h.call(w.writer, "GET", listPath(t.id)));
    });
    const data = j.data as Item[];
    expect(data.length).toBe(500);
    expect(data[0]!.title).toBe("大量の行 1");
    expect(data[499]!.position).toBe(500);
    expect((j.meta as { count: number }).count).toBe(500);
    expect(logs).toContain("[test-spec] 一覧を 500 行で切った");
    expect(logs).not.toContain("大量の行");
  });
});

describe("K-434 確認項目を足す（createTestSpec）", () => {
  it("K434-API-008 足す：201・鍵 6・チェック無し・manual・足した人・DB の行 1（版 1・種類なし・チェックの列は空）・やり取りに 1 行・証跡 1・別の GET の一覧に出る", async () => {
    const t = await h.ticket(w);
    const r = await add(w.writer, t.id, spec("目的が空でない"));
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data as Item;
    expect(Object.keys(d).sort()).toEqual(KEYS);
    expect(d).toMatchObject({ title: "目的が空でない", checked: false, position: 1, source: "manual", version: 1 });
    const rows = await h.rows(t.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      id: d.id,
      tenant_id: w.tenantId,
      ticket_id: t.id,
      check_kind: null,
      title: "目的が空でない",
      version: 1,
      checked_at: null,
      checked_by_member_id: null,
      checked_by_ai: false,
      source: "manual",
      source_ref_id: null,
      deleted_at: null,
      created_by: w.writer.id,
      updated_by: w.writer.id,
    });
    const msgs = await h.messages(t.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.author_member_id).toBe(w.writer.id);
    expect(msgs[0]!.body).toBe(`${await h.name(w.writer)}が確認項目を足しました：目的が空でない`);
    expect(msgs[0]!.changes).toEqual([
      { field: "test_spec", from: null, to: "目的が空でない", note: "目的が空でない" },
    ]);
    expect(await h.audits(w.tenantId, "test_spec.create", d.id)).toBe(1);
    const got = (await h.json(await h.call(w.writer, "GET", listPath(t.id)))).data as Item[];
    expect(got.map((x) => x.id)).toEqual([d.id]);
  });

  it("K434-API-009 題名：前後の空白（全角も）は落として残す・200 字ちょうどは通り・201 字・空・空白だけ・欠け・文字でない値は 422（欄 title）。行もやり取りも増えない", async () => {
    const t = await h.ticket(w);
    const ok = await add(w.writer, t.id, spec("　 前後に空白 　"));
    expect(ok.status).toBe(201);
    expect(((await h.json(ok)).data as Item).title).toBe("前後に空白");
    expect((await add(w.writer, t.id, spec("あ".repeat(200)))).status).toBe(201);
    for (const body of [
      spec("あ".repeat(201)),
      spec(""),
      spec("   "),
      spec("　\t　"),
      {},
      { title: 1 },
      { title: null },
      { title: ["a"] },
    ]) {
      const r = await add(w.writer, t.id, body);
      expect(r.status, JSON.stringify(body).slice(0, 30)).toBe(422);
      const j = await h.json(r);
      expect(j["code"]).toBe("VALIDATION_ERROR");
      expect(fieldsOf(j)).toContain("title");
    }
    expect((await h.rows(t.id)).length).toBe(2);
    expect((await h.messages(t.id)).length).toBe(2);
  });

  it("K434-API-010 知らない欄：種類・判定の型・設定値・出どころ・チェック・ticket_id・id・version・off_reason・tenant_id・deleted_at・知らない欄を足すと 422。行は増えない", async () => {
    const t = await h.ticket(w);
    const other = await h.ticket(w);
    for (const extra of [
      { check_kind: "human" },
      { judge_type: "required_field" },
      { params: {} },
      { source: "ai" },
      { source_ref_id: randomUUID() },
      { checked_at: "2026-01-01T00:00:00Z" },
      { checked_by_ai: true },
      { ticket_id: other.id },
      { id: randomUUID() },
      { version: 5 },
      { off_reason: "最初から OFF" },
      { tenant_id: wb.tenantId },
      { deleted_at: "2026-01-01T00:00:00Z" },
      { unknown_field: 1 },
    ]) {
      const r = await add(w.writer, t.id, { ...spec(), ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(422);
      expect((await h.json(r))["code"]).toBe("VALIDATION_ERROR");
    }
    expect((await h.rows(t.id)).length).toBe(0);
    expect((await h.rows(other.id)).length).toBe(0);
  });

  it("K434-API-011 足せない人：読むだけ 403・見えない 404・別の会社 404・消されたチケット 404・ログインなし 401。行もやり取りも証跡も増えない", async () => {
    const t = await h.ticket(w);
    const gone = await h.ticket(w);
    await h.removeTicket(gone.id);
    const auditsBefore = await h.audits(w.tenantId, "test_spec.create");
    const cases: [World["writer"] | null, string, number][] = [
      [w.viewer, t.id, 403],
      [w.stranger, t.id, 404],
      [wb.writer, t.id, 404],
      [w.writer, gone.id, 404],
      [null, t.id, 401],
    ];
    for (const [who, id, status] of cases) {
      const r = await add(who, id, spec());
      expect(r.status, `${who?.id ?? "未ログイン"}`).toBe(status);
      if (status === 404) expect(bareKeys(await h.json(r))).toEqual(BARE);
    }
    expect((await h.rows(t.id)).length).toBe(0);
    expect((await h.rows(gone.id)).length).toBe(0);
    expect((await h.messages(t.id)).length).toBe(0);
    expect(await h.audits(w.tenantId, "test_spec.create"), "証跡も増えない").toBe(auditsBefore);
  });

  it("K434-API-012 完了した後：足せない 409・E-SPEC-001（体は code と error だけ）。行もやり取りも証跡も増えない。読むのは 200", async () => {
    const t = await h.ticket(w);
    await h.seed(t.id, { title: "完了前の行" });
    await h.finish(t.id);
    const auditsBefore = await h.audits(w.tenantId, "test_spec.create");
    const r = await add(w.writer, t.id, spec());
    expect(r.status).toBe(409);
    const j = await h.json(r);
    expect(j["code"]).toBe("E-SPEC-001");
    expect(bareKeys(j), "field・details・detail を付けない").toEqual(BARE);
    expect((await h.rows(t.id)).length).toBe(1);
    expect((await h.messages(t.id)).length).toBe(0);
    expect(await h.audits(w.tenantId, "test_spec.create"), "証跡も増えない").toBe(auditsBefore);
    expect((await h.call(w.writer, "GET", listPath(t.id))).status).toBe(200);
  });

  it("K434-API-013 完了の確定と同時：チケットの行のロックを待ち、完了が確定した後は 409・E-SPEC-001（足した行もやり取りも残らない）", async () => {
    const t = await h.ticket(w);
    const c = await h.f.admin.connect();
    let committed = false;
    try {
      await c.query("begin");
      await c.query("select 1 from tickets where id = $1 for update", [t.id]);
      const pending = add(w.writer, t.id, spec("完了と同時に足す"));
      await h.untilLockWaiter("test_spec_create");
      await c.query(
        `update tickets t set stage_id = s.id, completed_at = now(), completed_by = t.assignee_member_id
           from ticket_stages s where t.id = $1 and s.tenant_id = t.tenant_id and s.key = 'done'`,
        [t.id],
      );
      await c.query("commit");
      committed = true;
      const r = await pending;
      expect(r.status).toBe(409);
      expect((await h.json(r))["code"]).toBe("E-SPEC-001");
    } finally {
      if (!committed) await c.query("rollback");
      c.release();
    }
    expect((await h.rows(t.id)).length).toBe(0);
    expect((await h.messages(t.id)).length).toBe(0);
  });

  it("K434-API-014 二度押し（同じ冪等キー）：2 回とも 201・同じ id・行 1・やり取り 1・証跡 1", async () => {
    const t = await h.ticket(w);
    const headers = { "idempotency-key": randomUUID() };
    const r1 = await add(w.writer, t.id, spec("二度押し"), headers);
    const r2 = await add(w.writer, t.id, spec("二度押し"), headers);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const a = ((await h.json(r1)).data as Item).id;
    const b = ((await h.json(r2)).data as Item).id;
    expect(a).toBe(b);
    expect((await h.rows(t.id)).length).toBe(1);
    expect((await h.messages(t.id)).length).toBe(1);
    expect(await h.audits(w.tenantId, "test_spec.create", a)).toBe(1);
  });

  it("K434-API-015 同時に 2 つ（別の冪等キー・同じ題名）：2 つとも 201 で別の行・position は 1 と 2（同じ題名は足せる）", async () => {
    const t = await h.ticket(w);
    const [r1, r2] = await Promise.all([
      add(w.writer, t.id, spec("同じ題名"), { "idempotency-key": randomUUID() }),
      add(w.writer, t.id, spec("同じ題名"), { "idempotency-key": randomUUID() }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const ids = new Set([((await h.json(r1)).data as Item).id, ((await h.json(r2)).data as Item).id]);
    expect(ids.size).toBe(2);
    const got = (await h.json(await h.call(w.writer, "GET", listPath(t.id)))).data as Item[];
    expect(got.map((x) => x.position)).toEqual([1, 2]);
    expect((await h.messages(t.id)).length).toBe(2);
  });

  it("K434-API-016 手順 S1 失敗（DB に書く所で落ちる）：503・E-PAGE-003。行もやり取りも証跡も無い。ログに題名を出さない", async () => {
    const t = await h.ticket(w);
    const auditsBefore = await h.audits(w.tenantId, "test_spec.create");
    const undo = await h.breakAudit(w.tenantId, "test_spec.create");
    try {
      let status = 0;
      let code: unknown;
      const logs = await h.captureLogs(async () => {
        const r = await add(w.writer, t.id, spec("秘密の題名ABC"));
        status = r.status;
        code = (await h.json(r))["code"];
      });
      expect(status).toBe(503);
      expect(code).toBe("E-PAGE-003");
      expect(logs).not.toContain("秘密の題名ABC");
    } finally {
      await undo();
    }
    expect((await h.rows(t.id)).length, "同じ取引なので行も残らない").toBe(0);
    expect((await h.messages(t.id)).length, "やり取りの行も残らない").toBe(0);
    expect(await h.audits(w.tenantId, "test_spec.create"), "証跡も増えない").toBe(auditsBefore);
  });

  it("K434-API-017 DB の守り（口を通さずに書く）：チェックの時刻が無いのに付けた人がいる・人と AI の両方・出どころが 3 つの外は DB が断る。種類なし・時刻と人・時刻と AI は入る", async () => {
    const t = await h.ticket(w);
    const ins = (cols: string, vals: string) =>
      h.f.admin.query(
        `insert into test_specs (tenant_id, ticket_id, title, ${cols}) values ($1, $2, 'DB の守り', ${vals})`,
        [w.tenantId, t.id],
      );
    await expect(ins("checked_by_member_id", `'${w.writer.id}'`), "時刻なしで人").rejects.toMatchObject({
      code: "23514",
    });
    await expect(ins("checked_by_ai", "true"), "時刻なしで AI").rejects.toMatchObject({ code: "23514" });
    await expect(
      ins("checked_at, checked_by_member_id, checked_by_ai", `now(), '${w.writer.id}', true`),
      "人と AI の両方",
    ).rejects.toMatchObject({ code: "23514" });
    await expect(ins("source", "'robot'"), "出どころの外").rejects.toMatchObject({ code: "23514" });
    expect((await h.rows(t.id)).length).toBe(0);
    await ins("check_kind", "null");
    await ins("checked_at, checked_by_member_id", `now(), '${w.writer.id}'`);
    await ins("checked_at, checked_by_ai", "now(), true");
    expect((await h.rows(t.id)).length).toBe(3);
  });

  it("K434-API-018 1 分あたりの上限を超えた「足す」は 429・retry_after_sec が付き、行は増えない", async () => {
    const t = await h.ticket(w);
    const me = await h.f.person(w.tenantId, w.rootScope, { name: "数える人 2", ticketAbility: "edit" });
    h.limit("createTestSpec", 2);
    try {
      expect((await add(me, t.id, spec("1"))).status).toBe(201);
      expect((await add(me, t.id, spec("2"))).status).toBe(201);
      const r = await add(me, t.id, spec("3"));
      expect(r.status).toBe(429);
      expect(typeof (await h.json(r))["retry_after_sec"]).toBe("number");
    } finally {
      h.limit("createTestSpec", 100_000);
    }
    expect((await h.rows(t.id)).length).toBe(2);
  });

  it("K434-API-020 AI に任せるときの使わない理由の列（tickets.no_spec_reason）：既定は空・文は入る・空白だけは DB が断る（使うのは K-565）", async () => {
    const t = await h.ticket(w);
    const get = async () =>
      (await h.f.admin.query<{ r: string | null }>("select no_spec_reason as r from tickets where id = $1", [t.id]))
        .rows[0]!.r;
    expect(await get()).toBeNull();
    await expect(
      h.f.admin.query("update tickets set no_spec_reason = '   ' where id = $1", [t.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await h.f.admin.query("update tickets set no_spec_reason = '見て分かるのでチェックは要らない' where id = $1", [
      t.id,
    ]);
    expect(await get()).toBe("見て分かるのでチェックは要らない");
  });
});
