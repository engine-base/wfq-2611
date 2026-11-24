// K-402「引き継いでもらう（渡す口の kind pass）」の単体の試験（口・本物の DB）。名前の頭の行 ID（K402-…）は 11_tickets/K-402.md の表に 1 対 1。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。土台は K-401 の ./handover.harness.ts。
// 入力・共通の確かめ（見えるか・担当者か・止まり・相手・切り替え）の断りは K-401 の試験が持つ。この試験は種類 pass の振る舞いと手順の失敗を見る。
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setupHandover, WEB } from "./handover.harness.js";

const h = setupHandover("K402");

const ANSWER_KEYS = [
  "ask",
  "created_at",
  "decided_at",
  "decline_reason",
  "from",
  "id",
  "kind",
  "notify_managers",
  "reason",
  "reply_due",
  "state",
  "switch",
  "switch_applied",
  "ticket_id",
  "to",
  "to_scope",
].sort();
const REASON = "先方と面識があるので、佐藤さんから返したほうが早い";
const ASK = "今日中に一次返信だけお願いします";
/** 日本時間の n 日後の 18:00（時差つき） */
const at18 = (n: number) => `${h.jstDay(n)}T18:00:00+09:00`;
const jstMonthDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};

describe("K-402 引き継いでもらう（createTicketHandover・kind pass）", () => {
  it("K402-API-001 正しい入力で渡す：201・16 の鍵・待っている・担当者は変わらない・相手に受け箱の行とメール（理由とお願いは書かない）", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const due = at18(3);
    const r = await h.create(w.boss, t.id, h.passBody(w.sato, { reason: REASON, ask: ASK, reply_due: due }));
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data!;
    expect(Object.keys(d).sort()).toEqual(ANSWER_KEYS);
    expect(d["state"]).toBe("waiting");
    expect(d["kind"]).toBe("pass");
    expect(d["ticket_id"]).toBe(t.id);
    expect(d["from"]).toEqual({ id: w.boss.id, name: "高本 聖斗" });
    expect(d["to"]).toEqual({ id: w.sato.id, name: "佐藤 花子" });
    expect(d["to_scope"]).toBeNull();
    expect(d["reason"]).toBe(REASON);
    expect(d["ask"]).toBe(ASK);
    expect(new Date(String(d["reply_due"])).getTime()).toBe(new Date(due).getTime());
    expect(d["switch"]).toEqual({ children: false, links: false, group: false, axes: [] });
    expect(d["decided_at"]).toBeNull();
    expect(d["notify_managers"]).toBe(false);
    const rows = await h.handoversOf(t.id);
    expect(rows.length).toBe(1);
    expect(rows[0]!["id"]).toBe(d["id"]);
    expect(rows[0]!["state"]).toBe("waiting");
    expect(await h.assigneeOf(t.id)).toBe(w.boss.id);
    const notes = await h.notes(w.sato.id, "handover.requested");
    expect(notes.length).toBe(1);
    const p = notes[0]!["payload"] as Record<string, unknown>;
    expect(p["ticket_id"]).toBe(t.id);
    expect(p["number"]).toBe(t.number);
    expect(p["handover_id"]).toBe(d["id"]);
    expect(p["from_name"]).toBe("高本 聖斗");
    expect(JSON.stringify(p)).not.toContain(REASON);
    expect(JSON.stringify(p)).not.toContain(ASK);
    expect(notes[0]!["sent_at"]).not.toBeNull();
    const mails = h.mails.filter((m) => m.to === w.sato.email);
    expect(mails.length).toBe(1);
    expect(mails[0]!.subject).toBe(`【Kaname】高本 聖斗さんから引き継ぎの頼みが届きました（${t.number}）`);
    expect(mails[0]!.text).toContain("問い合わせ（山田様）に一次返信する");
    expect(mails[0]!.text).toContain(jstMonthDay(due));
    expect(mails[0]!.text).toContain("18:00");
    expect(mails[0]!.text).toContain(`${WEB}/tickets/${t.id}`);
    expect(mails[0]!.text).not.toContain(REASON);
    expect(mails[0]!.text).not.toContain(ASK);
  });

  it("K402-API-002 返事の期限を書かない：作った時刻の次の平日 18:00（日本時間）", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const r = await h.create(w.boss, t.id, h.passBody(w.sato));
    expect(r.status, await r.clone().text()).toBe(201);
    const row = (await h.handoversOf(t.id))[0]!;
    const want = (
      await h.asOwner<{ v: Date }>(w.boss, "select app.handover_default_due($1::timestamptz) as v", [row["created_at"]])
    )[0]!.v;
    expect(new Date(String((await h.json(r)).data!["reply_due"])).getTime()).toBe(new Date(want).getTime());
    expect(new Date(row["reply_due"] as Date).getTime()).toBe(new Date(want).getTime());
  });

  it("K402-API-003 上の層にも知らせる：グループを管理する人に受け箱の行（メールは無し）。渡す人・相手・閲覧のみ・別のグループのマネージャーには無い", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const r = await h.create(w.boss, t.id, h.passBody(w.sato, { notify_managers: true }));
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await h.json(r)).data!["notify_managers"]).toBe(true);
    const m = await h.notes(w.mgr.id, "handover.managers");
    expect(m.length).toBe(1);
    expect((m[0]!["payload"] as Record<string, unknown>)["to_name"]).toBe("佐藤 花子");
    for (const p of [w.boss, w.sato, w.viewer, w.jdMgr])
      expect((await h.notes(p.id, "handover.managers")).length).toBe(0);
    expect(h.mails.filter((x) => x.to === w.mgr.email).length).toBe(0);
    const t2 = await h.ticket(w);
    expect((await h.create(w.boss, t2.id, h.passBody(w.sato))).status).toBe(201);
    expect(
      await h.num(
        "select count(*) as n from notifications where event_kind_id = 'handover.managers' and payload->>'ticket_id' = $1",
        [t2.id],
      ),
    ).toBe(0);
  });

  it("K402-API-004 一緒に切り替える：決まりの always は選ばなくても true・選んだ ask は true・グループの外の相手へ group を選べば true", async () => {
    await h.ready();
    const w = await h.world();
    await h.f.admin.query("update handover_rules set mode = 'always' where tenant_id = $1 and target = 'links'", [
      w.co.tenantId,
    ]);
    const t = await h.ticket(w);
    const r = await h.create(w.boss, t.id, h.passBody(w.jdMember, { switch: { children: true, group: true } }));
    expect(r.status, await r.clone().text()).toBe(201);
    const want = { children: true, links: true, group: true, axes: [] };
    expect((await h.json(r)).data!["switch"]).toEqual(want);
    expect((await h.handoversOf(t.id))[0]!["switch"]).toEqual(want);
  });

  it("K402-API-005 相手が読める：受託開発の人（営業のチケットは読めない）に渡すと、待っている間は読める", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const seen = async () =>
      Number(
        (await h.asMember<{ n: string }>(w.jdMember, "select count(*) as n from tickets where id = $1", [t.id]))[0]!.n,
      );
    expect(await seen()).toBe(0);
    expect((await h.create(w.boss, t.id, h.passBody(w.jdMember))).status).toBe(201);
    expect(await seen()).toBe(1);
  });

  it("K402-API-006 同時に 2 本：1 本だけ 201・もう 1 本は 409・E-HND-004。待っている行と受け箱の行は 1 つ", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const rs = await Promise.all([
      h.create(w.boss, t.id, h.passBody(w.sato)),
      h.create(w.boss, t.id, h.passBody(w.suzuki)),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = rs.find((r) => r.status === 409)!;
    expect((await h.json(lost)).code).toBe("E-HND-004");
    expect((await h.handoversOf(t.id)).filter((x) => x["state"] === "waiting").length).toBe(1);
    expect(
      await h.num(
        "select count(*) as n from notifications where event_kind_id = 'handover.requested' and payload->>'ticket_id' = $1",
        [t.id],
      ),
    ).toBe(1);
  });

  it("K402-API-007 前の渡しが断られた・取り消された後なら、また渡せる", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    await h.waiting(w, { ticketId: t.id, to: w.suzuki, state: "declined" });
    await h.waiting(w, { ticketId: t.id, to: w.suzuki, state: "withdrawn" });
    const r = await h.create(w.boss, t.id, h.passBody(w.sato));
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await h.handoversOf(t.id)).filter((x) => x["state"] === "waiting").length).toBe(1);
  });

  it("K402-API-008 証跡：handover.pass が 1 行・理由とお願いの文は入れない", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const r = await h.create(w.boss, t.id, h.passBody(w.sato, { reason: REASON, ask: ASK }));
    const id = String((await h.json(r)).data!["id"]);
    const rows = (
      await h.f.admin.query("select * from audit_events where action = 'handover.pass' and target_id = $1", [id])
    ).rows;
    expect(rows.length).toBe(1);
    expect(rows[0]!["actor_member_id"]).toBe(w.boss.id);
    const p = rows[0]!["payload"] as Record<string, unknown>;
    expect(p["ticket_id"]).toBe(t.id);
    expect(p["to_member_id"]).toBe(w.sato.id);
    expect(JSON.stringify(p)).not.toContain(REASON);
    expect(JSON.stringify(p)).not.toContain(ASK);
  });

  it("K402-API-009 手順 S2 失敗（メールを送れない）：201・受け箱の行に failed_at・ログにメールアドレスと理由を出さない", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    h.failMailTo.add(w.sato.email!);
    let status = 0;
    const logs = await h.captureLogs(async () => {
      status = (await h.create(w.boss, t.id, h.passBody(w.sato, { reason: REASON }))).status;
    });
    expect(status).toBe(201);
    const n = (await h.notes(w.sato.id, "handover.requested"))[0]!;
    expect(n["failed_at"]).not.toBeNull();
    expect(n["sent_at"]).toBeNull();
    expect(logs).toContain("[handover]");
    expect(logs).not.toContain(w.sato.email!);
    expect(logs).not.toContain(REASON);
  });

  it("K402-API-010 相手にメールが無い：201・受け箱の行は 1 つ・メールは 0 通", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const noMail = await h.f.person(w.co.tenantId, w.co.eg, { name: "メール無し", ticketAbility: "edit" });
    const before = h.mails.length;
    const r = await h.create(w.boss, t.id, h.passBody(noMail));
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await h.notes(noMail.id, "handover.requested")).length).toBe(1);
    expect(h.mails.length).toBe(before);
  });

  it("K402-API-011 手順 S1 失敗（DB の失敗）：503・E-PAGE-003・渡し・受け箱の行・証跡が残らない・メールは 0 通", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const before = h.mails.length;
    await h.breakOn("notifications", w.co.tenantId, "insert", async () => {
      const r = await h.create(w.boss, t.id, h.passBody(w.sato));
      expect(r.status).toBe(503);
      expect((await h.json(r)).code).toBe("E-PAGE-003");
    });
    expect((await h.handoversOf(t.id)).length).toBe(0);
    expect(await h.handoverNotes(w.co.tenantId)).toBe(0);
    expect(
      await h.num(
        "select count(*) as n from audit_events where action = 'handover.pass' and payload->>'ticket_id' = $1",
        [t.id],
      ),
    ).toBe(0);
    expect(h.mails.length).toBe(before);
  });

  it("K402-API-012 手順 S3 失敗（送った印を書けない＝S2 の後片付けの失敗）：201・メールは届く・ログに渡しの id と「印を書けなかった」", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    let id = "";
    let status = 0;
    const logs = await h.captureLogs(async () => {
      await h.breakOn("notifications", w.co.tenantId, "update", async () => {
        const r = await h.create(w.boss, t.id, h.passBody(w.sato));
        status = r.status;
        id = String((await h.json(r)).data?.["id"] ?? "");
      });
    });
    expect(status).toBe(201);
    expect(h.mails.filter((m) => m.to === w.sato.email).length).toBe(1);
    expect(logs).toContain(id);
    expect(logs).toContain("印を書けなかった");
    expect((await h.notes(w.sato.id, "handover.requested"))[0]!["sent_at"]).toBeNull();
  });

  it("K402-API-013 二度押し（同じ冪等キー）：2 回とも同じ 201・行とメールは 1 つ", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const key = randomUUID();
    const a = await h.create(w.boss, t.id, h.passBody(w.sato), { key });
    const b = await h.create(w.boss, t.id, h.passBody(w.sato), { key });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await h.json(b)).data!["id"]).toBe((await h.json(a)).data!["id"]);
    expect((await h.handoversOf(t.id)).length).toBe(1);
    expect((await h.notes(w.sato.id, "handover.requested")).length).toBe(1);
    expect(h.mails.filter((m) => m.to === w.sato.email).length).toBe(1);
  });

  it("K402-API-014 文の掃除と上限：制御文字は取り除く（改行・タブは残す）・10 万字の理由もそのまま残る", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const r = await h.create(
      w.boss,
      t.id,
      h.passBody(w.sato, { reason: "先方\u0007と\n面識\tあり", ask: "今日\u0001中に" }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    const row = (await h.handoversOf(t.id))[0]!;
    expect(row["reason"]).toBe("先方と\n面識\tあり");
    expect(row["ask"]).toBe("今日中に");
    const t2 = await h.ticket(w);
    const long = "あ".repeat(100_000);
    const r2 = await h.create(w.boss, t2.id, h.passBody(w.sato, { reason: long }));
    expect(r2.status, (await r2.clone().text()).slice(0, 300)).toBe(201);
    expect(String((await h.handoversOf(t2.id))[0]!["reason"]).length).toBe(100_000);
  });

  it("K402-API-015 別の人にする（replaces）：前の渡しは取り消され、新しい渡しが待っている。前の相手に取り消しの受け箱の行（メールなし）", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const old = await h.waiting(w, { ticketId: t.id, to: w.suzuki });
    const before = h.mails.length;
    const r = await h.create(w.boss, t.id, h.passBody(w.sato, { replaces: old }));
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data!;
    expect(d["state"]).toBe("waiting");
    expect(d["to"]).toEqual({ id: w.sato.id, name: "佐藤 花子" });
    const prev = (await h.handover(old))!;
    expect(prev["state"]).toBe("withdrawn");
    expect(prev["decided_at"]).not.toBeNull();
    const rows = await h.handoversOf(t.id);
    expect(rows.filter((x) => x["state"] === "waiting").map((x) => x["id"])).toEqual([d["id"]]);
    const withdrawn = await h.notes(w.suzuki.id, "handover.withdrawn");
    expect(withdrawn.length).toBe(1);
    // K-406 の取り消すと同じ読み方：cause で訳を分け、dedupe_key は <渡し>:<相手>
    expect((withdrawn[0]!["payload"] as Record<string, unknown>)["cause"]).toBe("replaced");
    expect(withdrawn[0]!["dedupe_key"]).toBe(`handover_withdrawn:${old}:${w.suzuki.id}`);
    expect(h.mails.filter((m) => m.to === w.suzuki.email).length).toBe(0);
    expect((await h.notes(w.sato.id, "handover.requested")).length).toBe(1);
    expect(h.mails.length - before).toBe(1);
    const audits = (
      await h.f.admin.query("select payload from audit_events where action = 'handover.withdraw' and target_id = $1", [
        old,
      ])
    ).rows;
    expect(audits.length).toBe(1);
    expect((audits[0]!["payload"] as Record<string, unknown>)["replaced_by"]).toBe(d["id"]);
  });

  it("K402-API-016 replaces が自分の待っている渡しでない：別の人が渡した物・でたらめは 403・E-HND-002、もう決まった物は 409・E-HND-005。何も変わらない", async () => {
    await h.ready();
    const w = await h.world();
    const t = await h.ticket(w);
    const others = await h.waiting(w, { ticketId: t.id, from: w.suzuki, to: w.mgr });
    const before = h.mails.length;
    const r1 = await h.create(w.boss, t.id, h.passBody(w.sato, { replaces: others }));
    expect(r1.status).toBe(403);
    expect((await h.json(r1)).code).toBe("E-HND-002");
    const r2 = await h.create(w.boss, t.id, h.passBody(w.sato, { replaces: randomUUID() }));
    expect(r2.status).toBe(403);
    expect((await h.json(r2)).code).toBe("E-HND-002");
    expect((await h.handover(others))!["state"]).toBe("waiting");
    const t2 = await h.ticket(w);
    const declined = await h.waiting(w, { ticketId: t2.id, to: w.suzuki, state: "declined" });
    const r3 = await h.create(w.boss, t2.id, h.passBody(w.sato, { replaces: declined }));
    expect(r3.status).toBe(409);
    const j3 = await h.json(r3);
    expect(j3.code).toBe("E-HND-005");
    expect(JSON.stringify(j3)).toContain("declined");
    expect((await h.handover(declined))!["state"]).toBe("declined");
    expect((await h.handoversOf(t.id)).length).toBe(1);
    expect((await h.handoversOf(t2.id)).length).toBe(1);
    expect((await h.notes(w.sato.id, "handover.requested")).length).toBe(0);
    expect((await h.notes(w.suzuki.id, "handover.withdrawn")).length).toBe(0);
    expect(h.mails.length).toBe(before);
  });
});
