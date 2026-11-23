// K-385「やり取りに書き込む口（createTicketMessage）」の単体の試験（口と DB・本物の Postgres）。
// テストの名前の頭の行 ID（K385-API-…）は 11_tickets/K-385.md の表の行に 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 試験が決める口の形（契約は 05_flow/screen_api.py の PERMS と 05_flow/screen_api.d/K-385.py で直す）:
//   createTicketMessage  POST /api/v1/tickets/:id/messages（そのチケットを読める人。閲覧のみの人も書ける・answer=eaa451436670 ⑧・60 回／分／人）
//     体 { body: string（必須・上限なし・守りは送る量 1MB だけ・D-130.1）, mention_member_ids?: uuid[], notify_member_ids?: uuid[], quote_of_id?: uuid | null }（strict）
//     201 { data: TimelineItem（K-383 と同じ形・kind post）}・Cache-Control: private, no-store
//     @ と知らせる人：そのチケットを見られる、抜けていない・止められていない人だけ（ほかは 404・E-PAGE-001・欄も明細も付けない＝在るかを漏らさない・何も書かない。DB の中身で決まる断りは 422 にしない・控え帳 2026-11-21 01:15）。重なりは 1 つにし、知らせる人から自分を外す
//     受け箱：(@ ∪ 知らせる人) − 自分 に 1 人 1 通（@ された人は ticket.mentioned、ほかは ticket.message）。本文は入れない。dedupe_key ticket.message:<書き込み>:<人>
//     引用：同じチケットの、消していない書き込み（kind post）だけ。元の頭の 2 行を quote_text に写す（元を消しても字は残る・⑮3）
//     書き込みと受け箱の行は 1 つの取引（app.ticket_message_post）。途中で落ちたら何も残らない（503・E-PAGE-003）
//     本文が無い・空・空白だけ（全角の空白も）は 422（形の誤り・契約の pattern \S と必須。欄 body に E-VAL-027 の文・新しい番号・errors.d/K-385.json）
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ITEM_KEYS, MESSAGE_KEYS, setupThread, who, type Item, type Person, type Ticket } from "./thread.harness.js";

const h = setupThread(["ticket-message-post", "ticket-timeline"]);

const send = (p: Person | null, t: Ticket, body: unknown, headers: Record<string, string> = {}) =>
  h.req(p, "POST", `/tickets/${t.id}/messages`, body, headers);
const msgs = (t: Ticket) =>
  h.num("select count(*) as n from ticket_messages where ticket_id = $1 and kind = 'post'", [t.id]);
const inbox = (t: Ticket) =>
  h.f.admin
    .query<{ member_id: string; event_kind_id: string; payload: Record<string, unknown>; dedupe_key: string }>(
      "select member_id, event_kind_id, payload, dedupe_key from notifications where payload->>'ticket_id' = $1 order by created_at, member_id",
      [t.id],
    )
    .then((r) => r.rows);
const fieldsOf = async (r: Response) =>
  (((await h.json(r))["details"] ?? []) as { field: string }[]).map((x) => x.field);
/** 存在しない id（無い物）。選べない物と答えの本文全体が一致することを見る（無い物と選べない物は同じ答え・控え帳 2026-11-21 01:30） */
const sameAnswer = async (a: Response, b: Response, why: string) => {
  expect(a.status, why).toBe(b.status);
  expect(await h.json(a), why).toEqual(await h.json(b));
};
/** 選べない人・引用元の断り：404・E-PAGE-001・欄も明細も無い（在るかを漏らさない） */
const expectHidden = async (r: Response, why: string) => {
  expect(r.status, why).toBe(404);
  const j = await h.json(r);
  expect(j["code"], why).toBe("E-PAGE-001");
  expect(j["field"], why).toBeUndefined();
  expect(j["details"], why).toBeUndefined();
  expect(j["detail"], why).toBeUndefined();
};

describe("K-385 書き込む：ふつう", () => {
  it("K385-API-001 ふつう：本文と @ と知らせる人で書くと 201。答えは TimelineItem（kind post・自分の書き込みなので直す・消すができ、新しくない）。DB に 1 行、受け箱は自分以外に 1 人 1 通・貯めない", async () => {
    const t = await h.ticket();
    const r = await send(h.writer, t, {
      body: "見積もりを見てください",
      mention_member_ids: [h.boss.id],
      notify_member_ids: [h.manager.id],
    });
    expect(r.status).toBe(201);
    const d = (await h.json(r)).data as Item;
    expect(Object.keys(d).sort()).toEqual(ITEM_KEYS);
    expect(Object.keys(d.message!).sort()).toEqual(MESSAGE_KEYS);
    expect(d.kind).toBe("post");
    expect(d.actor).toEqual(who(h.writer, "佐藤"));
    expect(d.message).toMatchObject({
      body: "見積もりを見てください",
      mentions: [who(h.boss, "高本")],
      notified: [who(h.manager, "田中")],
      can_edit: true,
      can_delete: true,
      is_new: false,
      stars: 0,
      edited_at: null,
      quote: null,
    });
    const row = await h.one<Record<string, unknown>>(
      "select kind, author_member_id, body, mentions, notify_member_ids, created_by from ticket_messages where id = $1",
      [d.id],
    );
    expect(row).toEqual({
      kind: "post",
      author_member_id: h.writer.id,
      body: "見積もりを見てください",
      mentions: [h.boss.id],
      notify_member_ids: [h.manager.id],
      created_by: h.writer.id,
    });
    const box = await inbox(t);
    expect(box.map((x) => [x.member_id, x.event_kind_id]).sort()).toEqual(
      [
        [h.boss.id, "ticket.mentioned"],
        [h.manager.id, "ticket.message"],
      ].sort(),
    );
    const cc = r.headers.get("cache-control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toContain("no-store");
  });

  it("K385-API-002 閲覧のみの人（チケットを書けない人）も書ける（answer=eaa451436670 ⑧）", async () => {
    const t = await h.ticket();
    const r = await send(h.viewer, t, { body: "質問です" });
    expect(r.status).toBe(201);
    expect(await msgs(t)).toBe(1);
  });

  it("K385-API-003 同じ人が @ と知らせる人の両方に入っていても知らせは 1 通（ticket.mentioned）。@ の重なりは 1 つにし、並びは書いた順", async () => {
    const t = await h.ticket();
    const r = await send(h.writer, t, {
      body: "@高本 @鈴木",
      mention_member_ids: [h.boss.id, h.viewer.id, h.boss.id],
      notify_member_ids: [h.boss.id],
    });
    expect(r.status).toBe(201);
    const d = (await h.json(r)).data as Item;
    expect(d.message!.mentions.map((x) => x.member_id)).toEqual([h.boss.id, h.viewer.id]);
    const box = await inbox(t);
    expect(box.filter((x) => x.member_id === h.boss.id).map((x) => x.event_kind_id)).toEqual(["ticket.mentioned"]);
    expect(box).toHaveLength(2);
  });

  it("K385-API-004 自分を @ しても・知らせる人に入れても、自分には知らせない。知らせる人の並びから自分を外して残す", async () => {
    const t = await h.ticket();
    const r = await send(h.writer, t, {
      body: "メモ",
      mention_member_ids: [h.writer.id],
      notify_member_ids: [h.writer.id, h.boss.id],
    });
    expect(r.status).toBe(201);
    const d = (await h.json(r)).data as Item;
    expect(d.message!.notified.map((x) => x.member_id)).toEqual([h.boss.id]);
    expect((await inbox(t)).map((x) => x.member_id)).toEqual([h.boss.id]);
  });

  it("K385-API-005 受け箱の行：本文を入れない（チケットの id・番号・題名・書き込みの id・リンクだけ）。dedupe_key は ticket.message:<書き込み>:<人>", async () => {
    const t = await h.ticket({ title: "K385 受け箱の形" });
    const r = await send(h.writer, t, { body: "受け箱に出てはいけない本文", mention_member_ids: [h.boss.id] });
    const d = (await h.json(r)).data as Item;
    const [x] = await inbox(t);
    expect(Object.keys(x!.payload).sort()).toEqual(["message_id", "number", "ticket_id", "title", "url"]);
    expect(x!.payload["message_id"]).toBe(d.id);
    expect(x!.payload["url"]).toBe(`/tickets/${t.id}`);
    expect(JSON.stringify(x!.payload)).not.toContain("出てはいけない");
    expect(x!.dedupe_key).toBe(`ticket.message:${d.id}:${h.boss.id}`);
  });
});

describe("K-385 書き込む：選べない人・引用・入力", () => {
  it("K385-API-006 @ に、そのチケットを見られない人（同じ会社の別のグループ）・別の会社の人・会社から抜けた人・止められた人を入れると 404・E-PAGE-001（欄も明細も付けない）。書き込みも知らせも残らない", async () => {
    const t = await h.ticket();
    const left = await h.person("抜けた人");
    await h.f.admin.query("update members set deleted_at = now() where id = $1", [left.id]);
    const stopped = await h.person("止められた人");
    await h.f.admin.query("update members set suspended_at = now(), suspended_by = $2 where id = $1", [
      stopped.id,
      h.boss.id,
    ]);
    for (const p of [h.stranger, h.outsider, left, stopped]) {
      const r = await send(h.writer, t, { body: "呼ぶ", mention_member_ids: [p.id] });
      await expectHidden(r, p.id);
    }
    const ghost = await send(h.writer, t, { body: "呼ぶ", mention_member_ids: [randomUUID()] });
    await expectHidden(ghost, "存在しない人");
    await sameAnswer(
      ghost,
      await send(h.writer, t, { body: "呼ぶ", mention_member_ids: [h.outsider.id] }),
      "@ の存在しない人",
    );
    expect(await msgs(t)).toBe(0);
    expect(await inbox(t)).toHaveLength(0);
  });

  it("K385-API-007 知らせる人に見られない人を入れると 404・E-PAGE-001（欄も明細も付けない）で何も残らない。グループの外の担当者・承認する人（関わっている人）は選べる", async () => {
    const t = await h.ticket({ assignee: h.stranger });
    const bad = await send(h.writer, t, { body: "知らせる", notify_member_ids: [h.outsider.id] });
    await expectHidden(bad, "notify");
    const ghost = await send(h.writer, t, { body: "知らせる", notify_member_ids: [randomUUID()] });
    await expectHidden(ghost, "存在しない人");
    await sameAnswer(ghost, bad, "知らせる人の存在しない人");
    expect(await msgs(t)).toBe(0);
    const ok = await send(h.writer, t, { body: "担当者に知らせる", notify_member_ids: [h.stranger.id] });
    expect(ok.status).toBe(201);
    expect((await inbox(t)).map((x) => x.member_id)).toEqual([h.stranger.id]);
  });

  it("K385-API-008 引用：同じチケットの書き込みなら頭の 2 行を写す（元を後で消しても字は残る）。消した書き込み・別のチケットの書き込み・仕組みの行は 404・E-PAGE-001（欄も明細も付けない）", async () => {
    const t = await h.ticket();
    const src = await h.post(t, h.boss, { body: "1 行目\n2 行目\n3 行目" });
    const r = await send(h.writer, t, { body: "返事です", quote_of_id: src });
    expect(r.status).toBe(201);
    const d = (await h.json(r)).data as Item;
    expect(d.message!.quote).toEqual({ id: src, excerpt: "1 行目\n2 行目" });
    await h.f.admin.query("update ticket_messages set deleted_at = now(), deleted_by = $2 where id = $1", [
      src,
      h.boss.id,
    ]);
    expect((await h.one<{ q: string }>("select quote_text as q from ticket_messages where id = $1", [d.id])).q).toBe(
      "1 行目\n2 行目",
    );
    const other = await h.post(await h.ticket(), h.boss, { body: "別のチケット" });
    const sys = await h.post(t, null, { kind: "system", body: "仕組みの行" });
    for (const q of [src, other, sys]) {
      const bad = await send(h.writer, t, { body: "引用", quote_of_id: q });
      await expectHidden(bad, q);
    }
    const ghost = await send(h.writer, t, { body: "引用", quote_of_id: randomUUID() });
    await expectHidden(ghost, "存在しない書き込み");
    await sameAnswer(ghost, await send(h.writer, t, { body: "引用", quote_of_id: other }), "存在しない引用元");
    expect(await msgs(t)).toBe(2); // 元の 1 行と、最初の返事だけ
  });

  it("K385-API-009 本文が無い・空・空白だけ・全角の空白だけ・改行だけ：422・E-VAL-027・欄 body で何も残らない", async () => {
    const t = await h.ticket();
    for (const body of [{}, { body: "" }, { body: "   " }, { body: "　　" }, { body: "\n\n" }]) {
      const r = await send(h.writer, t, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect((await h.json(r))["code"]).toBe("E-VAL-027");
      expect(await fieldsOf(r)).toContain("body");
    }
    expect(await msgs(t)).toBe(0);
  });

  it("K385-API-010 字数の上限は無い（D-130.1）：90 万字は 201 でそのまま残る（切らない）。送る量が 1MB を超えたら 413 で何も残らない", async () => {
    const t = await h.ticket();
    const big = "a".repeat(900_000);
    const r = await send(h.writer, t, { body: big });
    expect(r.status).toBe(201);
    expect(
      (await h.one<{ n: number }>("select length(body) as n from ticket_messages where ticket_id = $1", [t.id])).n,
    ).toBe(900_000);
    const tooBig = await send(h.writer, t, { body: "a".repeat(1_100_000) });
    expect(tooBig.status).toBe(413);
    expect(await msgs(t)).toBe(1);
  });

  it("K385-API-011 入れさせない欄（書いた人・種類・☆・変更・知らない欄）は 422 で何も残らない", async () => {
    const t = await h.ticket();
    for (const extra of [
      { author_member_id: h.boss.id },
      { kind: "system" },
      { reactions: { star: [h.boss.id] } },
      { changes: [{ field: "stage" }] },
      { title: "x" },
    ]) {
      const r = await send(h.writer, t, { body: "本文", ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(422);
    }
    expect(await msgs(t)).toBe(0);
  });
});

describe("K-385 書き込む：段・二度押し・守り・失敗", () => {
  it("K385-API-012 完了したチケットにも書ける（段は完了のまま・⑭）。承認待ち（仕組みの段）のチケットにも書ける（段は変わらない）", async () => {
    for (const stage of ["done", "awaiting_approval"]) {
      const t = await h.ticket({ stage });
      const r = await send(h.writer, t, { body: "お礼です" });
      expect(r.status, stage).toBe(201);
      const k = await h.one<{ key: string }>(
        "select s.key from tickets t join ticket_stages s on s.id = t.stage_id where t.id = $1",
        [t.id],
      );
      expect(k.key, stage).toBe(stage);
    }
  });

  it("K385-API-013 二度押し：同じ冪等キーで同時に 2 回は 1 行・同じ答え。同じキーで違う本文は 409。キー無しで 2 回は 2 行（わざと 2 回書ける）", async () => {
    const t = await h.ticket();
    const key = { "idempotency-key": `k385-${t.id}` };
    const [a, b] = await Promise.all([
      send(h.writer, t, { body: "一回だけ" }, key),
      send(h.writer, t, { body: "一回だけ" }, key),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(((await h.json(a)).data as Item).id).toBe(((await h.json(b)).data as Item).id);
    expect(await msgs(t)).toBe(1);
    expect((await send(h.writer, t, { body: "違う本文" }, key)).status).toBe(409);
    await send(h.writer, t, { body: "キー無し" });
    await send(h.writer, t, { body: "キー無し" });
    expect(await msgs(t)).toBe(3);
  });

  it("K385-API-014 守り：見えない人・別の会社の人・消したチケットは 404 で何も残らない。取引先の役は 403", async () => {
    const t = await h.ticket();
    for (const p of [h.stranger, h.outsider]) expect((await send(p, t, { body: "入る" })).status, p.id).toBe(404);
    expect(
      (await h.req(null, "POST", `/tickets/${t.id}/messages`, { body: "先方" }, h.f.as(h.boss, "client"))).status,
    ).toBe(403);
    expect(await msgs(t)).toBe(0);
    const gone = await h.ticket();
    await h.f.admin.query("update tickets set deleted_at = now(), deleted_by = $2 where id = $1", [gone.id, h.boss.id]);
    expect((await send(h.writer, gone, { body: "消したチケット" })).status).toBe(404);
    expect(await msgs(gone)).toBe(0);
  });

  it("K385-API-015 ログインしていない：401。上限（1 分に 60 回）を超えたら 429・retry_after_sec", async () => {
    const t = await h.ticket();
    expect((await send(null, t, { body: "x" })).status).toBe(401);
    const p = await h.person("上限を見る人");
    h.f.limits["createTicketMessage"] = 2;
    try {
      const codes: number[] = [];
      let last: Response | null = null;
      for (let i = 0; i < 3; i++) {
        last = await h.f.req("POST", `/tickets/${t.id}/messages`, {
          body: { body: `上限 ${i}` },
          headers: p.auth,
          ip: "198.51.100.253",
        });
        codes.push(last.status);
      }
      expect(codes).toEqual([201, 201, 429]);
      expect(Number.isInteger((await h.json(last!))["retry_after_sec"])).toBe(true);
    } finally {
      h.f.limits["createTicketMessage"] = 10_000;
    }
  });

  it("K385-API-016 失敗 × 守りの判定（見えるか）の所で例外になった：503・E-PAGE-003 で、書き込みも知らせも残らない（D-136.1）", async () => {
    const title = "K385 守りが壊れる";
    const t = await h.ticket({ title });
    await h.breakVisible(title, async () => {
      const r = await send(h.writer, t, { body: "壊れたとき", mention_member_ids: [h.boss.id] });
      expect(r.status).toBe(503);
      expect((await h.json(r))["code"]).toBe("E-PAGE-003");
    });
    expect(await msgs(t)).toBe(0);
    expect(await inbox(t)).toHaveLength(0);
  });

  it("K385-API-017 S1 の失敗（受け箱の行を書く所で DB が落ちた）：503・E-PAGE-003。1 つの取引なので書き込みも残らない（受け箱の行だけ・書き込みだけが残ることは無い）", async () => {
    const t = await h.ticket({ title: "K385 受け箱が書けない" });
    await h.f.admin.query(`create or replace function public.k385_break() returns trigger language plpgsql as $$
      begin raise exception 'K385 の試験で書けなくした'; end $$`);
    await h.f.admin.query(
      `create trigger k385_break before insert on notifications for each row when (new.payload->>'ticket_id' = '${t.id}') execute function public.k385_break()`,
    );
    try {
      const r = await send(h.writer, t, { body: "知らせが書けない", mention_member_ids: [h.boss.id] });
      expect(r.status).toBe(503);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-PAGE-003");
      expect(JSON.stringify(j)).not.toContain("書けなくした");
    } finally {
      await h.f.admin.query("drop trigger if exists k385_break on notifications");
    }
    expect(await msgs(t)).toBe(0);
  });

  it("K385-API-018 書いた書き込みは、読む口（K-383）でほかの人に新しい書き込みとして出る", async () => {
    const t = await h.ticket();
    const r = await send(h.writer, t, { body: "読めるか", mention_member_ids: [h.boss.id] });
    const id = ((await h.json(r)).data as Item).id;
    const list = ((await h.json(await h.req(h.boss, "GET", `/tickets/${t.id}/timeline`))).data ?? []) as Item[];
    const x = list.find((i) => i.id === id)!;
    expect(x.message!.body).toBe("読めるか");
    expect(x.message!.is_new).toBe(true);
    expect(x.message!.mentions.map((m) => m.member_id)).toEqual([h.boss.id]);
  });

  it("K385-API-019 本文に対にならないサロゲートがあっても書ける：201・本文の片割れの字は U+FFFD になる（jsonb に入らず 503 にしない・K-387 の口と同じ置き換え）", async () => {
    const t = await h.ticket();
    const r = await send(h.writer, t, { body: "片割れ\uD800です" });
    expect(r.status, await r.clone().text()).toBe(201);
    const id = ((await h.json(r)).data as Item).id;
    const list = ((await h.json(await h.req(h.boss, "GET", `/tickets/${t.id}/timeline`))).data ?? []) as Item[];
    expect(list.find((x) => x.id === id)!.message!.body).toBe("片割れ\uFFFDです");
  });
});
