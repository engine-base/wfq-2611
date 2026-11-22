// K-390「決定を読む・足す口（listTicketDecisions・createTicketDecision）」の単体の試験（口・本物の DB）。
//   名前の頭の行 ID（K390-API-…）は 11_tickets/K-390.md の表と 1 対 1。土台・道具・決めた文は ./decisions.harness.ts。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//   改める・取り消すは K-391（decision-update.test.ts）。ここの並びの確かめは、改めた・取り消した行を DB に直に置く。
import { describe, expect, it } from "vitest";
import {
  setupDecisions,
  VAL_TEXT,
  VAL_DECIDER,
  VAL_SOURCE,
  VAL_NOT_YET,
  DECISION_KIND,
  CLIENT_RULE_LATER,
  f,
  T,
  O,
  boss,
  writer,
  viewer,
  outsider,
  json,
  num,
  one,
  fields,
  asMember,
  ticket,
  post,
  decision,
  list,
  add,
  decisionsOf,
  changeLines,
  notices,
  snapshot,
  breakWritable,
} from "./decisions.harness.js";

setupDecisions();

type Decision = Record<string, unknown> & { id: string };
const KEYS = [
  "cancelled",
  "decided_at",
  "decided_by",
  "decided_note",
  "id",
  "promoted_to",
  "reason",
  "revises_id",
  "source",
  "superseded_by_id",
  "text",
  "ticket_id",
];
const listOf = async (p: typeof boss, ticketId: string) => {
  const r = await list(p, ticketId);
  expect(r.status, await r.clone().text()).toBe(200);
  return (await json(r)).data as Decision[];
};
const created = async (r: Response) => {
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json(r)).data as { decision: Decision; message_id: string };
};

describe("K-390 決定を読む", () => {
  it("K390-API-001 決定が無いチケット：200・data は空の並び・meta は {can_write: true}（書ける人）・Cache-Control に no-store", async () => {
    const t = await ticket();
    const r = await list(boss, t.id);
    expect(r.status).toBe(200);
    const j = await json(r);
    expect(j.data).toEqual([]);
    expect(j["meta"]).toEqual({ can_write: true });
    expect(r.headers.get("cache-control") ?? "").toMatch(/no-store/);
  });

  it("K390-API-002 並び：生きている決定（決めた時刻の新しい順）→ 改められた → 取り消した。鍵はちょうど 12 個・改めた元と取り消しの中身", async () => {
    const t = await ticket();
    const newer = await decision(t, { text: "支払いは翌月末", agoMin: 5 });
    const oldLive = await decision(t, { text: "見積は税込で出す", agoMin: 20 });
    const revised = await decision(t, { text: "支払いは月末", agoMin: 30, superseded: newer });
    const cancelled = await decision(t, {
      text: "郵送もする",
      agoMin: 15,
      cancelled: { by: writer, reason: "先方が不要と" },
    });
    const ds = await listOf(viewer, t.id);
    expect(ds.map((d) => d.id)).toEqual([newer, oldLive, revised, cancelled]);
    for (const d of ds) expect(Object.keys(d).sort()).toEqual(KEYS);
    expect(ds[0]!["revises_id"]).toBe(revised);
    expect(ds[2]!["superseded_by_id"]).toBe(newer);
    expect(ds[3]!["cancelled"]).toMatchObject({ by: { id: writer.id, display_name: "佐藤" }, reason: "先方が不要と" });
    expect(ds[0]!["cancelled"]).toBeNull();
  });

  it("K390-API-003 決めた人を会社から外しても、決定は名前つきで残る（D-128.96）", async () => {
    const t = await ticket();
    const gone = await f.person(T.tenantId, T.rootScope, { name: "辞めた人", ticketAbility: "edit" });
    await decision(t, { by: gone });
    await f.admin.query("update members set deleted_at = now() where id = $1", [gone.id]);
    expect((await listOf(boss, t.id))[0]!["decided_by"]).toEqual({ id: gone.id, display_name: "辞めた人" });
  });
});

describe("K-390 決定を足す", () => {
  it("K390-API-004 書ける人が直接書く（決めた人を送らない）：201・決めた人は本人・行が 1 つ・やり取りに 1 行「佐藤 が決定を足した」・証跡 1 行（ticket_decision.add・C2・payload は決定の id だけ）・答えの形", async () => {
    const t = await ticket();
    const d = await created(await add(writer, t.id, { text: "支払いは翌月末", reason: "先方の締めに合わせる" }));
    expect(Object.keys(d).sort()).toEqual(["decision", "message_id"]);
    expect(Object.keys(d.decision).sort()).toEqual(KEYS);
    expect(d.decision).toMatchObject({
      ticket_id: t.id,
      text: "支払いは翌月末",
      reason: "先方の締めに合わせる",
      decided_by: { id: writer.id, display_name: "佐藤" },
      decided_note: null,
      source: null,
      revises_id: null,
      superseded_by_id: null,
      cancelled: null,
      promoted_to: "ticket",
    });
    const rows = await decisionsOf(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: d.decision.id, decided_by: writer.id, promoted_to: "ticket" });
    const ls = await changeLines(t.id);
    expect(ls.map((l) => l.body)).toEqual(["佐藤 が決定を足した"]);
    expect(ls[0]!.changes).toEqual([{ field: "decision", from: null, to: d.decision.id, note: "add" }]);
    expect(ls[0]!.author_member_id).toBe(writer.id);
    // 証跡（関門 C2）：action ticket_decision.add の 1 行・payload は決定の id だけ（決めたことの字は入れない）
    const audits = await f.admin
      .query<{ actor_member_id: string; choke_point_id: string; payload: Record<string, unknown> }>(
        "select actor_member_id, choke_point_id, payload from audit_events where action = 'ticket_decision.add' and payload::text like '%' || $1 || '%'",
        [d.decision.id],
      )
      .then((r) => r.rows);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_member_id: writer.id, choke_point_id: "C2" });
    expect(Object.values(audits[0]!.payload)).toEqual([d.decision.id]);
    expect(JSON.stringify(audits[0]!.payload)).not.toContain("翌月末");
    // 別の GET で読み直しても同じ 1 件
    expect((await listOf(boss, t.id)).map((x) => x.id)).toEqual([d.decision.id]);
  });

  it("K390-API-005 決めた人をほかのメンバーにし、ひとことを足す：201・decided_by はその人・decided_note が残る（⑱）", async () => {
    const t = await ticket();
    const d = await created(
      await add(writer, t.id, { text: "納品は 12/10", decided_by_member_id: boss.id, decided_note: "先方と合意" }),
    );
    expect(d.decision["decided_by"]).toEqual({ id: boss.id, display_name: "高本" });
    expect(d.decision["decided_note"]).toBe("先方と合意");
    expect((await decisionsOf(t.id))[0]).toMatchObject({ decided_by: boss.id, decided_note: "先方と合意" });
  });

  it("K390-API-006 書き込みから決定にする：201・source は {id, at（元の書き込みの時刻）, deleted: false}。後で元の書き込みが消されても決定は残り source は {id, at, deleted: true}（⑪・画面 K-397 の「元：やり取り MM/DD HH:MM →」）", async () => {
    const t = await ticket();
    const m = await post(t, writer);
    const { at } = await one<{ at: Date }>("select created_at as at from ticket_messages where id = $1", [m]);
    const d = await created(await add(boss, t.id, { text: "支払いは翌月末", source_message_id: m }));
    const src = d.decision["source"] as { id: string; at: string; deleted: boolean };
    expect(Object.keys(src).sort()).toEqual(["at", "deleted", "id"]);
    expect(src).toMatchObject({ id: m, deleted: false });
    expect(Date.parse(src.at)).toBe(at.getTime());
    await f.admin.query("update ticket_messages set deleted_at = now() where id = $1", [m]);
    const after = (await listOf(boss, t.id))[0]!;
    expect(after["text"]).toBe("支払いは翌月末");
    const gone = after["source"] as { id: string; at: string; deleted: boolean };
    expect(gone).toMatchObject({ id: m, deleted: true });
    expect(Date.parse(gone.at)).toBe(at.getTime());
  });

  it("K390-API-007 元の書き込みが別のチケット・変更の 1 行・消した書き込み・無い uuid：404 E-PAGE-001・欄 source_message_id・何も書かない", async () => {
    const t = await ticket();
    const other = await ticket();
    const elsewhere = await post(other, writer);
    const changeLine = (
      await f.admin.query<{ id: string }>(
        "insert into ticket_messages (tenant_id, ticket_id, author_member_id, kind, body, created_by) values ($1, $2, $3, 'change', '高本 が状態を変えた', $3) returning id",
        [t.tenant, t.id, boss.id],
      )
    ).rows[0]!.id;
    const deleted = await post(t, writer);
    await f.admin.query("update ticket_messages set deleted_at = now() where id = $1", [deleted]);
    const before = await snapshot(t.id);
    for (const id of [elsewhere, changeLine, deleted, "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f"]) {
      const r = await add(boss, t.id, { text: "決めた", source_message_id: id });
      expect(r.status, id).toBe(404);
      const j = await json(r);
      expect(j["code"], id).toBe(VAL_SOURCE);
      expect(fields(j), id).toEqual(["source_message_id"]);
    }
    expect(await snapshot(t.id)).toEqual(before);
  });

  it("K390-API-008 決めたことが空・空白だけ（全角）・制御文字だけ・欄が無い：422（空は E-VAL-042・欄 text）。入れさせない欄（created_by・decided_at・revises_id）は 422 VALIDATION_ERROR（strict）。どれも何も書かない", async () => {
    const t = await ticket();
    const before = await snapshot(t.id);
    for (const text of ["", "　 ", "\u0001\u0002"]) {
      const r = await add(boss, t.id, { text });
      expect(r.status, JSON.stringify(text)).toBe(422);
      const j = await json(r);
      expect(j["code"], JSON.stringify(text)).toBe(VAL_TEXT);
      expect(fields(j)).toEqual(["text"]);
    }
    const missing = await add(boss, t.id, { reason: "理由だけ" });
    expect(missing.status).toBe(422);
    expect(fields(await json(missing))).toContain("text");
    // 入れさせない欄（書いた人・決めた時刻・改めた先）は入口の strict で 422
    const extra = await add(boss, t.id, {
      text: "支払いは翌月末",
      created_by: writer.id,
      decided_at: "2026-11-01T00:00:00Z",
      revises_id: t.id,
    });
    expect(extra.status).toBe(422);
    expect((await json(extra))["code"]).toBe("VALIDATION_ERROR");
    expect(await snapshot(t.id)).toEqual(before);
  });

  it("K390-API-009 決めたこと 5000 字・理由 3000 字：201・切らずに全文が残る（2000 字の決まりを外した・D-130.1）", async () => {
    const t = await ticket();
    const text = `頭${"決".repeat(4998)}尾`;
    const reason = "理".repeat(3000);
    const d = await created(await add(boss, t.id, { text, reason }));
    expect(d.decision["text"]).toBe(text);
    const row = (await decisionsOf(t.id))[0]!;
    expect(row.text).toHaveLength(5000);
    expect(row.reason).toBe(reason);
  });

  it("K390-API-010 決めた人が別の会社の人・外された人・止められた人・無い uuid：404 E-PAGE-001・欄 decided_by_member_id・何も書かない", async () => {
    const t = await ticket();
    const removed = await f.person(T.tenantId, T.rootScope, { name: "外された人" });
    await f.admin.query("update members set deleted_at = now() where id = $1", [removed.id]);
    const stopped = await f.person(T.tenantId, T.rootScope, { name: "止められた人" });
    await f.admin.query("update members set suspended_at = now(), suspended_by = $2 where id = $1", [
      stopped.id,
      boss.id,
    ]);
    const before = await snapshot(t.id);
    for (const id of [outsider.id, removed.id, stopped.id, "6a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d"]) {
      const r = await add(boss, t.id, { text: "決めた", decided_by_member_id: id });
      expect(r.status, id).toBe(404);
      const j = await json(r);
      expect(j["code"], id).toBe(VAL_DECIDER);
      expect(fields(j)).toEqual(["decided_by_member_id"]);
    }
    expect(await snapshot(t.id)).toEqual(before);
  });

  it("K390-API-011 どこまで効かせる：取引先のルール（client_rule）は 409 E-CONF-037「取引先の画面ができてから使えます」・このチケット（ticket）は 201・ほかの値は 422", async () => {
    const t = await ticket();
    const before = await snapshot(t.id);
    const r = await add(boss, t.id, { text: "請求書は PDF", promoted_to: "client_rule" });
    expect(r.status).toBe(409);
    const j = await json(r);
    expect(j["code"]).toBe(VAL_NOT_YET);
    expect(j.details).toEqual([{ field: "promoted_to", message: CLIENT_RULE_LATER }]);
    expect((await add(boss, t.id, { text: "請求書は PDF", promoted_to: "everywhere" })).status).toBe(422);
    expect(await snapshot(t.id)).toEqual(before);
    expect(
      (await created(await add(boss, t.id, { text: "請求書は PDF", promoted_to: "ticket" }))).decision["promoted_to"],
    ).toBe("ticket");
  });

  it("K390-API-012 知らせ：担当者でない人が足すと担当者に 1 つ（本文に決めたことの字は入れない）・担当者本人が足すと 0・担当者が止められていると 0（⑲）", async () => {
    const t = await ticket();
    const d = await created(await add(writer, t.id, { text: "値引きはしない" }));
    const ns = await notices(t.id);
    expect(ns.map((n) => n.member_id)).toEqual([boss.id]);
    expect(ns[0]!.dedupe_key).toBe(`${DECISION_KIND}:${d.decision.id}:add`);
    expect(Object.keys(ns[0]!.payload).sort()).toEqual(["action", "decision_id", "number", "ticket_id", "url"]);
    expect(ns[0]!.payload["action"]).toBe("add");
    expect(JSON.stringify(ns[0]!.payload)).not.toContain("値引き");
    const mine = await ticket();
    await created(await add(boss, mine.id, { text: "値引きはしない" }));
    expect(await notices(mine.id)).toHaveLength(0);
    const away = await f.person(T.tenantId, T.rootScope, { name: "休みの人", ticketAbility: "edit" });
    await f.admin.query("update members set suspended_at = now(), suspended_by = $2 where id = $1", [away.id, boss.id]);
    const awayT = await ticket({ assignee: away });
    await created(await add(writer, awayT.id, { text: "値引きはしない" }));
    expect(await notices(awayT.id)).toHaveLength(0);
  });

  it("K390-API-013 段に関わらず足せる：承認待ち・完了・保留のチケットでも 201", async () => {
    for (const stage of ["awaiting_approval", "done", "hold"]) {
      const t = await ticket({ stage });
      await created(await add(boss, t.id, { text: `決めた（${stage}）` }));
      expect(await decisionsOf(t.id)).toHaveLength(1);
    }
  });

  it("K390-API-014 見るだけの人：読むのは 200（meta.can_write は false）・足すのは 403。別の会社の人は両方 404・消したチケットは両方 404・ログインなしは 401（何も書かない）", async () => {
    const t = await ticket();
    await decision(t);
    const gone = await ticket();
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    const before = await snapshot(t.id);
    expect((await listOf(viewer, t.id)).length).toBe(1);
    expect((await json(await list(viewer, t.id)))["meta"]).toEqual({ can_write: false });
    expect((await add(viewer, t.id, { text: "決めた" })).status).toBe(403);
    expect((await list(outsider, t.id)).status).toBe(404);
    expect((await add(outsider, t.id, { text: "決めた" })).status).toBe(404);
    expect((await list(boss, gone.id)).status).toBe(404);
    expect((await add(boss, gone.id, { text: "決めた" })).status).toBe(404);
    expect((await f.req("GET", `/tickets/${t.id}/decisions`)).status).toBe(401);
    expect(await snapshot(t.id)).toEqual(before);
    expect(await num("select count(*) as n from ticket_decisions where ticket_id = $1", [gone.id])).toBe(0);
  });

  it("K390-API-015 DB の守りの 2 層目：見るだけの人が関数 app.ticket_decision_add を直に呼ぶと not_writable・何も書かない", async () => {
    const t = await ticket();
    const before = await snapshot(t.id);
    const v = await asMember<{ v: Record<string, unknown> }>(
      viewer,
      "select app.ticket_decision_add($1, $2::jsonb) as v",
      [t.id, JSON.stringify({ text: "決めた" })],
    );
    expect(v.v["error"]).toBe("not_writable");
    expect(await snapshot(t.id)).toEqual(before);
  });

  it("K390-API-016 守りの判定が例外：503 E-PAGE-003・何も書かない（止める側に倒す・D-136.1）", async () => {
    const t = await ticket({ title: "K390 守りを壊す" });
    const before = await snapshot(t.id);
    const r = await breakWritable("K390 守りを壊す", () => add(boss, t.id, { text: "決めた" }));
    expect(r.status).toBe(503);
    expect((await json(r))["code"]).toBe("E-PAGE-003");
    expect(await snapshot(t.id)).toEqual(before);
  });

  it("K390-API-017 同じ冪等キーで 2 回押す：決定は 1 つ・2 回目は 1 回目と同じ id", async () => {
    const t = await ticket();
    const key = "k390-same-key-0001";
    const a = await created(await add(boss, t.id, { text: "二度押し" }, { "idempotency-key": key }));
    const b = await created(await add(boss, t.id, { text: "二度押し" }, { "idempotency-key": key }));
    expect(b.decision.id).toBe(a.decision.id);
    expect(await decisionsOf(t.id)).toHaveLength(1);
  });

  it("K390-API-018 表の決まり：決定は消せない（アプリの接続の delete は権限で断る）・空白だけの字は表が断る・2001 字は入る", async () => {
    const t = await ticket();
    const id = await decision(t);
    await expect(asMember(boss, "delete from ticket_decisions where id = $1 returning id", [id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      f.admin.query("insert into ticket_decisions (tenant_id, ticket_id, text) values ($1, $2, '   ')", [
        t.tenant,
        t.id,
      ]),
    ).rejects.toThrow(/check constraint/);
    await f.admin.query("insert into ticket_decisions (tenant_id, ticket_id, text) values ($1, $2, $3)", [
      t.tenant,
      t.id,
      "字".repeat(2001),
    ]);
    expect(await num("select count(*) as n from ticket_decisions where ticket_id = $1", [t.id])).toBe(2);
  });

  it("K390-API-019 1 分の上限を超える（足す口）：429・retry_after_sec は 1〜60 の整数", async () => {
    const t = await ticket();
    f.limits["createTicketDecision"] = 1;
    try {
      const ip = "198.51.100.90";
      await f.req("POST", `/tickets/${t.id}/decisions`, { body: { text: "一回目" }, headers: boss.auth, ip });
      const r = await f.req("POST", `/tickets/${t.id}/decisions`, { body: { text: "二回目" }, headers: boss.auth, ip });
      expect(r.status).toBe(429);
      const s = Number((await json(r))["retry_after_sec"]);
      expect(Number.isInteger(s) && s >= 1 && s <= 60).toBe(true);
    } finally {
      f.limits["createTicketDecision"] = 10_000;
    }
  });

  it("K390-API-020 別の会社の決定の行は、自分の会社のチケットの一覧に出ない（同じ表でも会社で分ける）", async () => {
    const mine = await ticket();
    const theirs = await ticket({ tenant: O.tenantId, assignee: outsider });
    await decision(theirs, { by: outsider, text: "別の会社の決定" });
    expect(await listOf(boss, mine.id)).toEqual([]);
    expect((await listOf(outsider, theirs.id)).map((d) => d["text"])).toEqual(["別の会社の決定"]);
    expect(T.tenantId).not.toBe(O.tenantId);
  });
});
