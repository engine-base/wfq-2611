// K-433「版を読む・戻す口と、項目の変更を比べる口」の単体の試験（口と DB・本物の Postgres）。2026-11-21 の作り直し（区画ごと → 本文 1 枚の版と項目の変更）。
// テストの名前の頭の行 ID（K433-API-…）は 11_tickets/K-433.md の表の行に 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 試験が決める口の形（土台 ticket-body.harness.ts の頭にも書いた）:
//   listTicketVersions     GET /api/v1/tickets/:id/versions?from=&to=
//     200 { data: { versions: Version[], from: { version, text } | null, to: { version, text } | null }, meta: { limit: 200, truncated, can_restore } }
//       can_restore ＝ そのチケットに書けて、完了していない（listTestSpecs の meta.can_edit と同じ形）。画面 K-449 が「戻す」を押せるかの出し分けに使う
//     Version = { version, edited_by: { id, name } | null, edited_by_ai, edited_at, is_current, restored_from, summary }（鍵はちょうど 7・本文は載せない）
//       versions は新しい順・200 版まで（超えたら truncated true）。edited_by_ai の版は edited_by が null（画面は「AI」と出す）
//       summary：版 1 は「作成」・戻した版は「版 K に戻した」・ほかは「本文を直した」
//       from・to は比べる 2 つの版の版の番号。省くと to は今の版・from はその 1 つ前（版が 1 つだけなら from は null）。text は素の文字（差分は画面が行どうしで作る）
//     from・to は ^[1-9][0-9]{0,8}$ の数字だけ。違う形（0・負・小数・文字）も無い版も 404 E-PAGE-001（道の :v と同じく形で 422 にしない・問い合わせの値域の仕組みは段 8 の物なので使わない）。本文の行が無いチケットは versions が [] で from・to は null
//   restoreTicketVersion   POST /api/v1/tickets/:id/versions/:v/restore   入力（strict）: { current_version: integer(>=1) }
//     201 { data: { version, changed, edited_at } }（戻すと新しい版が 1 つ増える・前の版の行は消えない・D-150.14）
//     409 E-SEC-004（今見ている版が古い）／E-SEC-020（戻す先が今の中身と同じ）／E-SEC-005（完了したチケット・K-432 の番号）。404・409 には field・details を付けない
//     道の :v は ^[1-9][0-9]{0,8}$ の数字だけ。違う形・無い版・本文の行が無いは 404 E-PAGE-001（形で 422 にしない）
//   listTicketItemChanges  GET /api/v1/tickets/:id/item-changes?from=&to=
//     200 { data: { points, from, to, diff }, meta: { limit: 200, truncated } }
//     diff の各行に生の値 raw_from・raw_to（変更の行に書かれていればそのまま・無ければ null）を通す（戻す葉 K-576 が戻すのに使う）
//     points = [{ n, at, by: { id, name } | null, by_ai, summary }]（鍵はちょうど 5・新しい順）。n=1 は「作成」、n=k+1 は k 番目の項目の更新の行の後
//       項目の更新の行 ＝ ticket_messages の kind change のうち、changes に body・test_spec・item_restore（項目を戻したまとめの行・K-576）以外の欄が 1 つでもある行。by が null（機械・AI）は by_ai true
//       summary は項目の名前を「・」でつないで「を変えた」（期限・開始日・優先度・担当者・状態・親・会社の項目の名前）
//     diff = [{ field, name, from, to, raw_from, raw_to, restorable, why }]（from から to までの間の正味の変わり。同じ項目の最初の from と最後の to を比べ、同じなら出さない・最初に現れた順）
//       restorable は 開始日（start_on）・期限（due_on）・優先度（priority）・予定時間（estimate_minutes・書く組は K-583）・会社が足した項目（field:<id>）だけ true（D-150.52）。戻せない項目の why は固定の文：
//       状態「状態は段の決まりがあるので戻せません」・担当者「担当者は「渡す」の流れで変えます」・親「親は 3 段までの決まりがあるので戻せません」
//     from・to は versions と同じ（数字だけ・違う形や無い n は 404 E-PAGE-001）。省くと to は今の n・from はその 1 つ前（n が 1 だけなら from は null で diff は []）
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { BARE, bareKeys, docOf, setupBody, type Json, type World } from "./ticket-body.harness.js";

const h = setupBody(["ticket-versions"]);

let w: World;
const FIRST = docOf("月末の請求を出す");
const SATO = docOf("佐藤の直し");
const SUZUKI = docOf("鈴木の直し");
const SAME_MSG = "先に直されました。読み直してから、もう一度直してください";
const VERSION_KEYS = ["edited_at", "edited_by", "edited_by_ai", "is_current", "restored_from", "summary", "version"];
const listPath = (id: string, q = "") => `/tickets/${id}/versions${q}`;
const get = (who: World["writer"] | null, id: string, q = "") => h.call(who, "GET", listPath(id, q));
const restore = (who: World["writer"] | null, id: string, v: string | number, b: unknown) =>
  h.call(who, "POST", `/tickets/${id}/versions/${v}/restore`, { body: b });
const items = (who: World["writer"] | null, id: string, q = "") =>
  h.call(who, "GET", `/tickets/${id}/item-changes${q}`);
const fieldsOf = (j: Json): string[] => ((j["details"] as { field: string }[] | undefined) ?? []).map((d) => d.field);
interface Data {
  versions: {
    version: number;
    summary: string;
    is_current: boolean;
    edited_by: { id: string; name: string } | null;
    edited_by_ai: boolean;
    restored_from: number | null;
  }[];
  from: { version: number; text: string } | null;
  to: { version: number; text: string } | null;
}
const readData = async (r: Response) => {
  expect(r.status, await r.clone().text()).toBe(200);
  return (await h.json(r)).data as unknown as Data;
};
/** 版 3 つ（作成の高本相当＝鈴木・佐藤・鈴木）の本文があるチケット */
const history = async (): Promise<string> => {
  const t = await h.ticket(w, { assignee: w.assignee });
  await h.seedBody(t.id, [FIRST, SATO, SUZUKI], { by: [null, w.assignee, w.writer] });
  return t.id;
};
const intact = async (id: string, version = 3) => {
  expect((await h.bodyRow(id))!.version).toBe(version);
  expect(await h.versionRows(id)).toHaveLength(version);
  expect(await h.messages(id)).toHaveLength(0);
};

beforeAll(async () => {
  w = await h.world("K433");
}, 60_000);

describe("K-433 本文の版を読む（listTicketVersions）", () => {
  it("K433-API-001 版の一覧：新しい順・今の版に印・書いた人の名前・説明（作成／本文を直した）・本文は載せない・貯めない", async () => {
    const id = await history();
    const r = await get(w.writer, id);
    expect(r.headers.get("cache-control") ?? "").toMatch(/no-store/);
    const d = await readData(r);
    expect(d.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(Object.keys(d.versions[0]!).sort()).toEqual(VERSION_KEYS);
    expect(d.versions[0]).toMatchObject({
      is_current: true,
      edited_by: { id: w.writer.id, name: "鈴木" },
      edited_by_ai: false,
      restored_from: null,
      summary: "本文を直した",
    });
    expect(d.versions[1]).toMatchObject({
      is_current: false,
      edited_by: { id: w.assignee.id, name: "佐藤" },
      summary: "本文を直した",
    });
    expect(d.versions[2]).toMatchObject({ is_current: false, summary: "作成" });
    expect(JSON.stringify(d.versions)).not.toContain("の直し");
    expect((await h.json(r)).meta).toMatchObject({ limit: 200, truncated: false, can_restore: true });
  });

  it("K433-API-002 比べる 2 つを省く：to は今の版（3）・from はその 1 つ前（2）で、text は素の文字（鍵は version と text だけ）", async () => {
    const id = await history();
    const d = await readData(await get(w.writer, id));
    expect(d.to).toEqual({ version: 3, text: "鈴木の直し" });
    expect(d.from).toEqual({ version: 2, text: "佐藤の直し" });
  });

  it("K433-API-003 from と to を指す：離れた版（1 と 3）も、逆の向き（3 と 1）も、そのまま返す", async () => {
    const id = await history();
    const a = await readData(await get(w.writer, id, "?from=1&to=3"));
    expect([a.from, a.to]).toEqual([
      { version: 1, text: "月末の請求を出す" },
      { version: 3, text: "鈴木の直し" },
    ]);
    const b = await readData(await get(w.writer, id, "?from=3&to=1"));
    expect([b.from!.version, b.to!.version]).toEqual([3, 1]);
  });

  it("K433-API-004 版が 1 つだけ：versions は 1 つ・from は null・to は版 1", async () => {
    const t = await h.ticket(w);
    await h.seedBody(t.id, [FIRST]);
    const d = await readData(await get(w.writer, t.id));
    expect(d.versions).toHaveLength(1);
    expect(d.from).toBeNull();
    expect(d.to).toMatchObject({ version: 1 });
  });

  it("K433-API-005 AI が直した版と戻した版：AI の版は edited_by が null で edited_by_ai が true・戻した版は restored_from と「版 K に戻した」", async () => {
    const t = await h.ticket(w);
    await h.seedBody(t.id, [FIRST, SATO, FIRST], { clone: [false, true, false], restoredFrom: [null, null, 1] });
    const d = await readData(await get(w.writer, t.id));
    expect(d.versions[1]).toMatchObject({ version: 2, edited_by: null, edited_by_ai: true, summary: "本文を直した" });
    expect(d.versions[0]).toMatchObject({ version: 3, restored_from: 1, summary: "版 1 に戻した" });
  });

  it("K433-API-006 本文の行がまだ無いチケット（前の形で作った物）：200・versions は []・from と to は null", async () => {
    const t = await h.ticket(w);
    const r = await get(w.writer, t.id);
    expect(await readData(r.clone())).toEqual({ versions: [], from: null, to: null });
    expect((await h.json(r)).meta).toMatchObject({ can_restore: true });
  });

  it("K433-API-007 見える範囲：閲覧のみは読める・別の会社の人と無い id は入口が 404・NOT_FOUND・消したチケットは口が 404・E-PAGE-001（error と code だけ）・ログインなしは 401", async () => {
    const id = await history();
    const rv = await get(w.viewer, id);
    expect((await readData(rv.clone())).versions).toHaveLength(3);
    expect((await h.json(rv)).meta).toMatchObject({ can_restore: false }); // 読めるが戻せない人
    for (const [who, tid] of [
      [w.outsider, id],
      [w.writer, randomUUID()],
    ] as const) {
      const r = await get(who, tid);
      expect(r.status).toBe(404);
      const j = await h.json(r);
      expect(j["code"]).toBe("NOT_FOUND");
      expect(bareKeys(j)).toEqual(BARE);
    }
    const gone = await history();
    await h.removeTicket(gone);
    const r = await get(w.writer, gone);
    expect(r.status).toBe(404);
    const j = await h.json(r);
    expect(j["code"]).toBe("E-PAGE-001");
    expect(bareKeys(j)).toEqual(BARE);
    expect((await get(null, id)).status).toBe(401);
  });

  it("K433-API-008 入力：from・to が 0・-1・1.5・文字、または無い版（99）は 404・E-PAGE-001（error と code だけ・形で 422 にしない）", async () => {
    const id = await history();
    for (const q of ["?from=0", "?to=-1", "?from=1.5", "?to=abc", "?from=99", "?to=99"]) {
      const r = await get(w.writer, id, q);
      expect(r.status, q).toBe(404);
      const j = await h.json(r);
      expect(j["code"], q).toBe("E-PAGE-001");
      expect(bareKeys(j), q).toEqual(BARE);
    }
  });

  it("K433-API-009 200 版を超える：新しい順に 200 版だけ返し truncated が true（205 版を直に入れて確かめる）", async () => {
    const t = await h.ticket(w);
    const docs = Array.from({ length: 205 }, (_, i) => docOf(`版 ${i + 1} の本文`));
    await h.seedBody(t.id, docs);
    const r = await get(w.writer, t.id);
    const d = await readData(r);
    expect(d.versions).toHaveLength(200);
    expect(d.versions[0]!.version).toBe(205);
    expect(d.versions[199]!.version).toBe(6);
    expect((await h.json(r)).meta).toMatchObject({ limit: 200, truncated: true });
    expect(d.to).toMatchObject({ version: 205 });
  });
});

describe("K-433 本文の版に戻す（restoreTicketVersion）", () => {
  it("K433-API-010 版 1 に戻す（今の版 3）：201・新しい版 4 ができ、本文は版 1 と同じ中身・版の行は 1〜4 が残り、版 4 に restored_from と戻した人", async () => {
    const id = await history();
    const r = await restore(w.writer, id, 1, { current_version: 3 });
    expect(r.status, await r.clone().text()).toBe(201);
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    const d = (await h.json(r)).data as Record<string, unknown>;
    expect(Object.keys(d).sort()).toEqual(["changed", "edited_at", "version"]);
    expect(d).toMatchObject({ version: 4, changed: true });
    const row = (await h.bodyRow(id))!;
    expect(row.version).toBe(4);
    expect(row.body.doc).toEqual(FIRST);
    const vs = await h.versionRows(id);
    expect(vs.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    expect(vs[0]!.body.doc).toEqual(FIRST);
    expect(vs[2]!.body.doc).toEqual(SUZUKI);
    expect(vs[3]).toMatchObject({ edited_by: w.writer.id, edited_by_clone: false, restored_from: 1 });
    expect(vs[3]!.body).toEqual(row.body);
    const list = await readData(await get(w.writer, id));
    expect(list.versions[0]).toMatchObject({
      version: 4,
      is_current: true,
      restored_from: 1,
      summary: "版 1 に戻した",
    });
  });

  it("K433-API-011 やり取りの 1 行と証跡：「〈名前〉が本文を版 1 に戻しました」（changes に版 3 → 4）が 1 つ・証跡 ticket.body.restore が 1 つ・本文の字は入らない・お知らせなし", async () => {
    const id = await history();
    const before = await h.notifications(w.tenantId);
    expect((await restore(w.writer, id, 1, { current_version: 3 })).status).toBe(201);
    const m = await h.messages(id);
    expect(m).toHaveLength(1);
    expect(m[0]!.author_member_id).toBe(w.writer.id);
    expect(m[0]!.body).toBe(`${await h.name(w.writer)}が本文を版 1 に戻しました`);
    expect(m[0]!.changes).toEqual([{ field: "body", from: "版 3", to: "版 4", note: "版 1 に戻した" }]);
    const a = await h.audits(w.tenantId, "ticket.body.restore", id);
    expect(a).toHaveLength(1);
    expect(a[0]!.choke_point_id).toBe("C2");
    expect(Object.keys(a[0]!.payload).sort()).toEqual(["from_version", "restored_from", "ticket_id", "to_version"]);
    expect(a[0]!.payload).toMatchObject({ from_version: 3, to_version: 4, restored_from: 1, ticket_id: id });
    expect(JSON.stringify([m, a])).not.toContain("月末の請求");
    expect(await h.notifications(w.tenantId)).toBe(before);
  });

  it("K433-API-012 今見ている版が古い（先に直された）：409・E-SEC-004・K-432 と同じ名前の無い決まった文・field と details が無く、本文も版も変わらない", async () => {
    const id = await history();
    const r = await restore(w.writer, id, 1, { current_version: 2 });
    expect(r.status).toBe(409);
    const j = await h.json(r);
    expect(j).toMatchObject({ error: "conflict", code: "E-SEC-004", message: SAME_MSG });
    expect(bareKeys(j)).toEqual(["code", "error", "message"]);
    await intact(id);
  });

  it("K433-API-013 戻す先が今の中身と同じ（版 3 を版 3 に）：409・E-SEC-020「もう同じ中身です」・field と details が無く、版は増えない", async () => {
    const id = await history();
    const r = await restore(w.writer, id, 3, { current_version: 3 });
    expect(r.status).toBe(409);
    const j = await h.json(r);
    expect(j).toMatchObject({ error: "conflict", code: "E-SEC-020", message: "もう同じ中身です" });
    expect(bareKeys(j)).toEqual(["code", "error", "message"]);
    await intact(id);
  });

  it("K433-API-014 無い物：無い版（99）・数字でない道の v（abc・0・01）・本文の行が無いチケットは 404・E-PAGE-001（error と code だけ・422 にしない）", async () => {
    const id = await history();
    const empty = await h.ticket(w);
    const cases: [string, string | number, unknown][] = [
      [id, 99, { current_version: 3 }],
      [id, "abc", { current_version: 3 }],
      [id, "0", { current_version: 3 }],
      [id, "01", { current_version: 3 }],
      [empty.id, 1, { current_version: 1 }],
    ];
    for (const [tid, v, b] of cases) {
      const r = await restore(w.writer, tid, v, b);
      expect(r.status, `${tid} v=${v}`).toBe(404);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-PAGE-001");
      expect(bareKeys(j)).toEqual(BARE);
    }
    await intact(id);
  });

  it("K433-API-015 完了したチケット：409・E-SEC-005（K-432 と同じ番号と文・D-150.30）・field と details が無く、本文も版も変わらない", async () => {
    const id = await history();
    await h.finish(id);
    const r = await restore(w.writer, id, 1, { current_version: 3 });
    expect(r.status).toBe(409);
    const j = await h.json(r);
    expect(j).toMatchObject({ error: "conflict", code: "E-SEC-005" });
    expect(bareKeys(j)).toEqual(["code", "error", "message"]);
    await intact(id);
    expect((await h.json(await get(w.writer, id))).meta).toMatchObject({ can_restore: false }); // 完了したら読めるが戻せない
  });

  it("K433-API-016 戻せる人：閲覧のみは 403・FORBIDDEN・別の会社の人と無い id は入口が 404・NOT_FOUND・消したチケットは口が 404・E-PAGE-001・ログインなしは 401・どれも何も書かない", async () => {
    const id = await history();
    const r = await restore(w.viewer, id, 1, { current_version: 3 });
    expect(r.status).toBe(403);
    expect((await h.json(r))["code"]).toBe("FORBIDDEN");
    for (const [who, tid] of [
      [w.outsider, id],
      [w.writer, randomUUID()],
    ] as const) {
      const x = await restore(who, tid, 1, { current_version: 3 });
      expect(x.status).toBe(404);
      expect((await h.json(x))["code"]).toBe("NOT_FOUND");
    }
    const gone = await history();
    await h.removeTicket(gone);
    const g = await restore(w.writer, gone, 1, { current_version: 3 });
    expect(g.status).toBe(404);
    expect((await h.json(g))["code"]).toBe("E-PAGE-001");
    expect((await restore(null, id, 1, { current_version: 3 })).status).toBe(401);
    await intact(id);
  });

  it("K433-API-017 入力：current_version が無い・0・文字・知らない欄（doc・text・number）は 422（知らない欄は欄 body）・何も書かない", async () => {
    const id = await history();
    const cases: [unknown, string][] = [
      [{}, "current_version"],
      [{ current_version: 0 }, "current_version"],
      [{ current_version: "3" }, "current_version"],
      [{ current_version: 3, doc: SATO }, "body"],
      [{ current_version: 3, text: "画面が作った text" }, "body"],
      [{ current_version: 3, number: "EG-1" }, "body"],
    ];
    for (const [b, field] of cases) {
      const r = await restore(w.writer, id, 1, b);
      expect(r.status, JSON.stringify(b)).toBe(422);
      expect(fieldsOf(await h.json(r)), JSON.stringify(b)).toContain(field);
    }
    await intact(id);
  });

  it("K433-API-018 同じ今の版で 2 つの画面が同時に戻す：201 と 409（E-SEC-004）が 1 つずつ・版は 4 まで（5 にならない）・やり取りは 1 つ", async () => {
    const id = await history();
    const rs = await Promise.all([
      restore(w.writer, id, 1, { current_version: 3 }),
      restore(w.writer, id, 2, { current_version: 3 }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await h.bodyRow(id))!.version).toBe(4);
    expect(await h.versionRows(id)).toHaveLength(4);
    expect(await h.messages(id)).toHaveLength(1);
  });

  it("K433-API-019 手順 S1 失敗（版 4 の行を書けない）：503・E-PAGE-003・本文は版 3 のまま・版の行は 3 つ・やり取りも証跡も 0・ログに「[ticket-body]」の 1 行があり本文の字が出ない", async () => {
    const id = await history();
    const undo = await h.breakInsert("ticket_section_versions", `new.ticket_id = '${id}'::uuid and new.version = 4`);
    let status = 0;
    let code = "";
    let logs = "";
    try {
      logs = await h.captureLogs(async () => {
        const r = await restore(w.writer, id, 1, { current_version: 3 });
        status = r.status;
        code = String((await h.json(r))["code"]);
      });
    } finally {
      await undo();
    }
    expect(status).toBe(503);
    expect(code).toBe("E-PAGE-003");
    await intact(id);
    expect(await h.audits(w.tenantId, "ticket.body.restore", id)).toHaveLength(0);
    expect(logs).toContain("[ticket-body]");
    expect(logs).not.toContain("月末の請求");
  });

  it("K433-API-020 戻した後の二重書きの食い違い 0：本文の版＝版の行の最大・本文の中身＝その版の中身。版の行は追記だけ（アプリの役では delete できない）", async () => {
    const id = await history();
    expect((await restore(w.writer, id, 2, { current_version: 3 })).status).toBe(201);
    expect((await restore(w.writer, id, 1, { current_version: 4 })).status).toBe(201);
    const row = (await h.bodyRow(id))!;
    const vs = await h.versionRows(id);
    expect(row.version).toBe(5);
    expect(vs.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
    expect(vs[4]!.body).toEqual(row.body);
    expect(vs.map((v) => v.restored_from)).toEqual([null, null, null, 2, 1]);
    await expect(h.f.pool.query("delete from ticket_section_versions where ticket_id = $1", [id])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("K-433 項目の変更を比べる（listTicketItemChanges）", () => {
  /** 作成 → 期限・（本文）・担当者と支払期日・（確認項目）・AI の優先度と期限、の順の項目の更新を入れたチケット。返すのは支払期日の項目の id */
  let cfId: string | undefined;
  const changed = async () => {
    const t = await h.ticket(w, { assignee: w.assignee });
    // 会社の項目「支払期日」は会社に 1 つだけ（同じ名前は二重に作れない）。最初に呼んだときに作って使い回す
    cfId ??= (
      await h.f.admin.query<{ id: string }>(
        "insert into custom_fields (tenant_id, name, field_type) values ($1, '支払期日', 'date') returning id",
        [w.tenantId],
      )
    ).rows[0]!.id;
    const cf = cfId;
    await h.seedChange(t.id, [{ field: "due_on", from: "2026-11-27", to: "2026-12-01", note: "先方の都合" }], w.writer);
    await h.seedChange(t.id, [{ field: "body", from: "版 1", to: "版 2" }], w.writer);
    await h.seedChange(
      t.id,
      [
        { field: "assignee", from: "鈴木", to: "高本" },
        { field: `field:${cf}`, from: null, to: "2026-12-15", raw_from: null, raw_to: "2026-12-15" },
      ],
      w.assignee,
    );
    await h.seedChange(t.id, [{ field: "test_spec", from: null, to: "請求額が合っている" }], w.writer);
    await h.seedChange(
      t.id,
      [
        { field: "priority", from: "中", to: "高" },
        { field: "due_on", from: "2026-12-01", to: "2026-11-27" },
      ],
      null,
    );
    return { id: t.id, cf };
  };
  interface Item {
    points: { n: number; summary: string; by: { id: string; name: string } | null; by_ai: boolean }[];
    from: number | null;
    to: number | null;
    diff: {
      field: string;
      name: string;
      from: unknown;
      to: unknown;
      raw_from: unknown;
      raw_to: unknown;
      restorable: boolean;
      why: string | null;
    }[];
  }
  const readItems = async (r: Response) => {
    expect(r.status, await r.clone().text()).toBe(200);
    return (await h.json(r)).data as unknown as Item;
  };

  it("K433-API-021 点の一覧：作成と項目の更新の行だけ（本文・確認項目の行は数えない）・新しい順・番号は作成が 1・説明は項目の名前をつないで「を変えた」・鍵はちょうど 5・貯めない", async () => {
    const { id } = await changed();
    const r = await items(w.writer, id);
    expect(r.headers.get("cache-control") ?? "").toMatch(/no-store/);
    const d = await readItems(r);
    expect(d.points.map((p) => p.n)).toEqual([4, 3, 2, 1]);
    expect(Object.keys(d.points[0]!).sort()).toEqual(["at", "by", "by_ai", "n", "summary"]);
    expect(d.points.map((p) => p.summary)).toEqual([
      "優先度・期限を変えた",
      "担当者・支払期日を変えた",
      "期限を変えた",
      "作成",
    ]);
    expect(d.points[2]).toMatchObject({ by: { id: w.writer.id, name: "鈴木" }, by_ai: false });
    expect(d.points[1]).toMatchObject({ by: { id: w.assignee.id, name: "佐藤" } });
    expect((await h.json(r)).meta).toMatchObject({ limit: 200, truncated: false });
  });

  it("K433-API-022 機械・AI の更新：書いた人が無い行は by が null で by_ai が true（画面は「AI」と出す）", async () => {
    const { id } = await changed();
    const d = await readItems(await items(w.writer, id));
    expect(d.points[0]).toMatchObject({ n: 4, by: null, by_ai: true });
  });

  it("K433-API-023 比べる 2 つを省く：to は今の n（4）・from はその 1 つ前（3）。その間の更新の最初の from と最後の to が出る", async () => {
    const { id } = await changed();
    const d = await readItems(await items(w.writer, id));
    expect([d.from, d.to]).toEqual([3, 4]);
    expect(d.diff.map((x) => [x.field, x.from, x.to])).toEqual([
      ["priority", "中", "高"],
      ["due_on", "2026-12-01", "2026-11-27"],
    ]);
    expect(d.diff.map((x) => x.name)).toEqual(["優先度", "期限"]);
    expect(d.diff.map((x) => [x.raw_from, x.raw_to])).toEqual([
      [null, null],
      [null, null],
    ]); // 変更の行に生の値が無ければ null
  });

  it("K433-API-024 離れた 2 つの正味（1 と 4）：同じ項目が行き来して元に戻った物（期限）は出ない・最初に現れた順で、会社の項目の名前も出る", async () => {
    const { id, cf } = await changed();
    const d = await readItems(await items(w.writer, id, "?from=1&to=4"));
    expect(d.diff.map((x) => x.field)).toEqual(["assignee", `field:${cf}`, "priority"]);
    expect(d.diff.map((x) => x.name)).toEqual(["担当者", "支払期日", "優先度"]);
    expect(d.diff[1]).toMatchObject({ from: null, to: "2026-12-15", raw_from: null, raw_to: "2026-12-15" }); // 会社の項目の行は生の値を通す
    const one = await readItems(await items(w.writer, id, "?from=1&to=2"));
    expect(one.diff.map((x) => [x.field, x.from, x.to])).toEqual([["due_on", "2026-11-27", "2026-12-01"]]);
  });

  it("K433-API-025 戻せる項目の印：期限・開始日・優先度・予定時間・会社の項目は restorable true・状態・担当者・親は false で固定の訳・知らない項目も false", async () => {
    const t = await h.ticket(w);
    const cf = (
      await h.f.admin.query<{ id: string }>(
        "insert into custom_fields (tenant_id, name, field_type) values ($1, '取引先の区分', 'short_text') returning id",
        [w.tenantId],
      )
    ).rows[0]!.id;
    await h.seedChange(
      t.id,
      [
        { field: "start_on", from: null, to: "2026-11-25" },
        { field: "due_on", from: "2026-12-01", to: "2026-11-27" },
        { field: "priority", from: "中", to: "高" },
        { field: `field:${cf}`, from: null, to: "A 社" },
        { field: "stage", from: "未着手", to: "作業中" },
        { field: "assignee", from: "鈴木", to: "高本" },
        { field: "parent", from: null, to: "EG-1" },
        { field: "estimate_minutes", from: null, to: "2 時間" },
        { field: "actual_minutes", from: null, to: "1 時間" },
      ],
      w.writer,
    );
    const d = await readItems(await items(w.writer, t.id));
    const by = Object.fromEntries(d.diff.map((x) => [x.field, x]));
    expect(by["start_on"]).toMatchObject({ restorable: true, why: null });
    expect(by["due_on"]).toMatchObject({ restorable: true, why: null });
    expect(by["priority"]).toMatchObject({ restorable: true, why: null });
    expect(by[`field:${cf}`]).toMatchObject({ restorable: true, why: null });
    expect(by["estimate_minutes"]).toMatchObject({ name: "予定時間", restorable: true, why: null });
    expect(by["stage"]).toMatchObject({ restorable: false, why: "状態は段の決まりがあるので戻せません" });
    expect(by["assignee"]).toMatchObject({ restorable: false, why: "担当者は「渡す」の流れで変えます" });
    expect(by["parent"]).toMatchObject({ restorable: false, why: "親は 3 段までの決まりがあるので戻せません" });
    expect(by["actual_minutes"]!.restorable).toBe(false);
    expect(typeof by["actual_minutes"]!.why).toBe("string");
    expect(Object.keys(d.diff[0]!).sort()).toEqual([
      "field",
      "from",
      "name",
      "raw_from",
      "raw_to",
      "restorable",
      "to",
      "why",
    ]);
  });

  it("K433-API-026 項目の更新が 1 つも無い：点は「作成」だけ・from は null・diff は []。本文・確認項目・項目を戻したまとめの行（item_restore）だけがあっても同じ", async () => {
    const t = await h.ticket(w);
    await h.seedChange(t.id, [{ field: "body", from: "版 1", to: "版 2" }], w.writer);
    await h.seedChange(t.id, [{ field: "test_spec", from: null, to: "確かめること" }], w.writer);
    await h.seedChange(
      t.id,
      [{ field: "item_restore", from: null, to: "点 1 の形", note: "点 1 の形に戻した" }],
      w.writer,
    );
    const d = await readItems(await items(w.writer, t.id));
    expect(d.points.map((p) => p.n)).toEqual([1]);
    expect([d.from, d.to]).toEqual([null, 1]);
    expect(d.diff).toEqual([]);
  });

  it("K433-API-027 見える範囲と入力：閲覧のみは読める・別の会社と無い id は入口が 404・NOT_FOUND・消したチケットは口が 404・E-PAGE-001・無い n（99）・from が 0・文字は 404・E-PAGE-001（形で 422 にしない）・ログインなしは 401", async () => {
    const { id } = await changed();
    expect((await readItems(await items(w.viewer, id))).points).toHaveLength(4);
    for (const [who, tid] of [
      [w.outsider, id],
      [w.writer, randomUUID()],
    ] as const) {
      const r = await items(who, tid);
      expect(r.status).toBe(404);
      const j = await h.json(r);
      expect(j["code"]).toBe("NOT_FOUND");
      expect(bareKeys(j)).toEqual(BARE);
    }
    const gone = (await changed()).id;
    await h.removeTicket(gone);
    const g = await items(w.writer, gone);
    expect(g.status).toBe(404);
    expect((await h.json(g))["code"]).toBe("E-PAGE-001");
    const miss = await items(w.writer, id, "?from=99");
    expect(miss.status).toBe(404);
    expect(bareKeys(await h.json(miss))).toEqual(BARE);
    for (const q of ["?from=0", "?to=abc"]) {
      const r = await items(w.writer, id, q);
      expect(r.status, q).toBe(404);
      expect(bareKeys(await h.json(r)), q).toEqual(BARE);
    }
    expect((await items(null, id)).status).toBe(401);
  });
});
