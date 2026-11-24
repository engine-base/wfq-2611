// K-403「受ける／断る（答える口の kind pass）」の単体の試験（口・本物の DB）。名前の頭の行 ID（K403-…）は 11_tickets/K-403.md の表に 1 対 1。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。土台は K-401 の ./handover.harness.ts。
// 待っている渡しの行は DB に直に置く（渡す口 K-402 に依存しない）。一緒に切り替える物が移るかは K-404 の試験と中間テスト K-416 が見る
//   （この試験は switch_applied の中身を見ない：K-404 が入る前は空の形 '{}'）。
import { describe, expect, it } from "vitest";
import { setupHandover, WEB, type World } from "./handover.harness.js";

const h = setupHandover("K403");

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
const WHY = "今週は月次の締めで手が空きません";
const accept = { decision: "accept" };
const decline = (why = WHY) => ({ decision: "decline", decline_reason: why });

/** 高本が担当のチケットと、佐藤（か to）への待っている渡し */
async function waitingPass(w: World, o: { to?: World["sato"]; replyDue?: string } = {}) {
  const t = await h.ticket(w);
  const hid = await h.waiting(w, {
    ticketId: t.id,
    to: o.to ?? w.sato,
    ...(o.replyDue ? { replyDue: o.replyDue } : {}),
  });
  return { t, hid };
}

describe("K-403 受ける／断る（answerTicketHandover・kind pass）", () => {
  it("K403-API-001 受ける：200・16 の鍵・受けた・担当者が移る・渡した人に受け箱の行（メールは無し）・証跡 1 行", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    const r = await h.answer(w.sato, hid, accept);
    expect(r.status, await r.clone().text()).toBe(200);
    const d = (await h.json(r)).data!;
    expect(Object.keys(d).sort()).toEqual(ANSWER_KEYS);
    expect(d["id"]).toBe(hid);
    expect(d["state"]).toBe("accepted");
    expect(d["decided_at"]).not.toBeNull();
    expect(typeof d["switch_applied"]).toBe("object");
    expect(d["switch_applied"]).not.toBeNull();
    expect(await h.assigneeOf(t.id)).toBe(w.sato.id);
    const row = (await h.handover(hid))!;
    expect(row["answered_by"]).toBe(w.sato.id);
    expect(row["state"]).toBe("accepted");
    const n = await h.notes(w.boss.id, "handover.accepted");
    expect(n.length).toBe(1);
    expect((n[0]!["payload"] as Record<string, unknown>)["to_name"]).toBe("佐藤 花子");
    expect(h.mails.filter((m) => m.to === w.boss.email).length).toBe(0);
    expect(
      await h.num("select count(*) as n from audit_events where action = 'handover.accept' and target_id = $1", [hid]),
    ).toBe(1);
  });

  it("K403-API-002 断る：200・断られた・理由は残る（制御文字は取り除く）・担当者は変わらない・受け箱の行とメール（理由は書かない）・証跡に理由が無い", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    const r = await h.answer(w.sato, hid, decline("今週は\u0007月次の締めで\n手が空きません"));
    expect(r.status, await r.clone().text()).toBe(200);
    const d = (await h.json(r)).data!;
    expect(d["state"]).toBe("declined");
    expect(d["decline_reason"]).toBe("今週は月次の締めで\n手が空きません");
    expect(await h.assigneeOf(t.id)).toBe(w.boss.id);
    const n = await h.notes(w.boss.id, "handover.declined");
    expect(n.length).toBe(1);
    expect(JSON.stringify(n[0]!["payload"])).not.toContain("月次の締め");
    const mails = h.mails.filter((m) => m.to === w.boss.email);
    expect(mails.length).toBe(1);
    expect(mails[0]!.subject).toBe(`【Kaname】佐藤 花子さんが引き継ぎを断りました（${t.number}）`);
    expect(mails[0]!.text).toContain(`${WEB}/tickets/${t.id}`);
    expect(mails[0]!.text).not.toContain("月次の締め");
    const a = (
      await h.f.admin.query("select payload from audit_events where action = 'handover.decline' and target_id = $1", [
        hid,
      ])
    ).rows;
    expect(a.length).toBe(1);
    expect(JSON.stringify(a[0]!["payload"])).not.toContain("月次の締め");
  });

  it("K403-API-003 受けた後の役：佐藤は pass・高本は offer（下見の口）・佐藤は読める", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    expect((await h.answer(w.sato, hid, accept)).status).toBe(200);
    expect((await h.json(await h.preview(w.sato, t.id))).data!["kinds"]).toEqual(["pass"]);
    expect((await h.json(await h.preview(w.boss, t.id))).data!["kinds"]).toEqual(["offer"]);
    expect((await h.asMember(w.sato, "select id from tickets where id = $1", [t.id])).length).toBe(1);
  });

  it("K403-API-004 同時に受けると断る：200 と 409・E-HND-005 が 1 つずつ・状態は 200 の方・受け箱の行は 1 つ", async () => {
    await h.ready();
    const w = await h.world();
    const { hid } = await waitingPass(w);
    const [a, b] = await Promise.all([h.answer(w.sato, hid, accept), h.answer(w.sato, hid, decline())]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? "accepted" : "declined";
    expect((await h.json(a.status === 409 ? a : b)).code).toBe("E-HND-005");
    expect((await h.handover(hid))!["state"]).toBe(won);
    const n =
      (await h.notes(w.boss.id, "handover.accepted")).length + (await h.notes(w.boss.id, "handover.declined")).length;
    expect(n).toBe(1);
  });

  it("K403-API-005 受けるを二度押し：200 と 409・E-HND-005・担当者の書き換え・知らせ・証跡は 1 回", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    expect((await h.answer(w.sato, hid, accept)).status).toBe(200);
    const again = await h.answer(w.sato, hid, accept);
    expect(again.status).toBe(409);
    expect((await h.json(again)).code).toBe("E-HND-005");
    expect(await h.assigneeOf(t.id)).toBe(w.sato.id);
    expect((await h.notes(w.boss.id, "handover.accepted")).length).toBe(1);
    expect(
      await h.num("select count(*) as n from audit_events where action = 'handover.accept' and target_id = $1", [hid]),
    ).toBe(1);
  });

  it("K403-API-006 渡した後に AI に任せた：受けると 409・E-HND-003（待っているまま）・断るは押せる", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    await h.aiRunning(w, t.id, w.boss);
    const r = await h.answer(w.sato, hid, accept);
    expect(r.status).toBe(409);
    const j = await h.json(r);
    expect(j.code).toBe("E-HND-003");
    expect(j["message"]).toBe("AI の実行（承認）が終わってから渡してください");
    expect((await h.handover(hid))!["state"]).toBe("waiting");
    expect(await h.assigneeOf(t.id)).toBe(w.boss.id);
    const d = await h.answer(w.sato, hid, decline());
    expect(d.status, await d.clone().text()).toBe(200);
    expect((await h.handover(hid))!["state"]).toBe("declined");
  });

  it("K403-API-007 承認待ちのチケット：受けると 409・E-HND-003・待っているまま", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    await h.approvalWaiting(w, t.id, w.boss);
    const r = await h.answer(w.sato, hid, accept);
    expect(r.status).toBe(409);
    expect((await h.json(r)).code).toBe("E-HND-003");
    expect((await h.handover(hid))!["state"]).toBe("waiting");
  });

  it("K403-API-008 返事の期限が過ぎていても受けられる：200・受けた・担当者が移る", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w, { replyDue: new Date(Date.now() - 3_600_000).toISOString() });
    const r = await h.answer(w.sato, hid, accept);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await h.assigneeOf(t.id)).toBe(w.sato.id);
  });

  it("K403-API-009 断った後の見え方：受託開発の人は、断った後は営業のチケットを読めない", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w, { to: w.jdMember });
    const seen = async () =>
      Number(
        (await h.asMember<{ n: string }>(w.jdMember, "select count(*) as n from tickets where id = $1", [t.id]))[0]!.n,
      );
    expect(await seen()).toBe(1);
    expect((await h.answer(w.jdMember, hid, decline())).status).toBe(200);
    expect(await seen()).toBe(0);
  });

  it("K403-API-010 手順 S1 失敗（DB の失敗）：503・E-PAGE-003・担当者も渡しも変わらない・受け箱の行と証跡が残らない", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    await h.breakOn("ticket_handovers", w.co.tenantId, "update", async () => {
      const r = await h.answer(w.sato, hid, accept);
      expect(r.status).toBe(503);
      expect((await h.json(r)).code).toBe("E-PAGE-003");
    });
    expect(await h.assigneeOf(t.id)).toBe(w.boss.id);
    expect((await h.handover(hid))!["state"]).toBe("waiting");
    expect(await h.handoverNotes(w.co.tenantId)).toBe(0);
    expect(await h.num("select count(*) as n from audit_events where target_id = $1", [hid])).toBe(0);
  });

  it("K403-API-011 手順 S2 失敗（断るのメールを送れない）：200・断られた・受け箱の行に failed_at・ログにメールと理由を出さない", async () => {
    await h.ready();
    const w = await h.world();
    const { hid } = await waitingPass(w);
    h.failMailTo.add(w.boss.email!);
    let status = 0;
    const logs = await h.captureLogs(async () => {
      status = (await h.answer(w.sato, hid, decline())).status;
    });
    expect(status).toBe(200);
    expect((await h.handover(hid))!["state"]).toBe("declined");
    expect((await h.notes(w.boss.id, "handover.declined"))[0]!["failed_at"]).not.toBeNull();
    expect(logs).toContain("[handover]");
    expect(logs).not.toContain(w.boss.email!);
    expect(logs).not.toContain(WHY);
  });

  it("K403-API-012 種類 pass の受ける・断るに switch を送ると番号なしの 422（VALIDATION_ERROR）・待っているまま・担当者は変わらず知らせも証跡も残らない", async () => {
    await h.ready();
    const w = await h.world();
    const { t, hid } = await waitingPass(w);
    for (const body of [
      { decision: "accept", switch: { children: true } },
      { ...decline(), switch: { children: true } },
    ]) {
      const r = await h.answer(w.sato, hid, body);
      expect(r.status).toBe(422);
      const j = await h.json(r);
      expect(j.code).toBe("VALIDATION_ERROR");
      expect(j.details?.map((x) => x.field) ?? [j.field]).toContain("switch");
      expect((await h.handover(hid))!["state"]).toBe("waiting");
      expect(await h.assigneeOf(t.id)).toBe(w.boss.id);
    }
    expect((await h.notes(w.boss.id, "handover.accepted")).length).toBe(0);
    expect((await h.notes(w.boss.id, "handover.declined")).length).toBe(0);
    expect(
      await h.num(
        "select count(*) as n from audit_events where action in ('handover.accept', 'handover.decline') and target_id = $1",
        [hid],
      ),
    ).toBe(0);
  });

  it("K403-API-013 手順 S3 失敗（送った印を書けない＝S2 の後片付けの失敗）：200・断られた・メールは届く・ログに「印を書けなかった」", async () => {
    await h.ready();
    const w = await h.world();
    const { hid } = await waitingPass(w);
    let status = 0;
    const logs = await h.captureLogs(async () => {
      await h.breakOn("notifications", w.co.tenantId, "update", async () => {
        status = (await h.answer(w.sato, hid, decline())).status;
      });
    });
    expect(status).toBe(200);
    expect((await h.handover(hid))!["state"]).toBe("declined");
    expect(h.mails.filter((m) => m.to === w.boss.email).length).toBe(1);
    expect(logs).toContain("印を書けなかった");
  });
});
