// K-409「人に配る」の口の試験（本物の DB・本物の行の守り・口の入口は createApp と契約の op・偽の画面のログイン）。
//   行 ID（K409-API-…）は 11_tickets/K-409.md の表と 1 対 1。土台は distribute.harness.ts（この葉が carry で運ぶ・K-410 も使う）。
//   配る：createTicketHandover の kind distribute・to_member_id（中身は apps/api/src/features/F8/handovers/create/distribute.ts）。
//   合意ありで配った後に答える：answerTicketHandover（中身は answer/distribute.ts）。合意ありの設定の欄は F9・F10（D-148.16）なので、待っている行は DB に直に置く。
//   配ったチケットが完了したら配った人に知らせる（D-125.99）：tickets の completed_at を書いたときの引き金（DB）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AI_RUNNING_TEXT, EV, WAITING_TEXT, msg, setupDistribute } from "./distribute.harness.js";

const h = setupDistribute("K409");
const P = () => h.people;
const body = (to: string, o: { reason?: unknown; ask?: string } = {}) =>
  h.createBody({ kind: "distribute", to_member_id: to, ...o });

/** 何も変わっていない：担当者・渡しの行・受け箱・メール */
async function unchanged(ticketId: string, assignee: string, mailsBefore: number): Promise<void> {
  expect(await h.assigneeOf(ticketId)).toBe(assignee);
  expect((await h.handoversOf(ticketId)).filter((x) => x["kind"] === "distribute")).toHaveLength(0);
  expect(h.mails.length).toBe(mailsBefore);
}

describe("K-409 人に配る", () => {
  it("K409-API-001 マネージャーがほかの人のチケットを人に配る（合意なし）：201・担当者がすぐ鈴木・渡しの行は distribute／accepted／決めた時刻あり・証跡 1", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id, { ask: "金曜までに一次返信" }));
    expect(r.status, await r.clone().text()).toBe(201);
    // 答えは K-401 の成功の答えの形（16 の鍵・app.handover_json）
    const data = (await h.json(r))["data"] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
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
    ]);
    expect(data).toMatchObject({ kind: "distribute", state: "accepted", ticket_id: t.id });
    expect((data["to"] as Record<string, unknown>)["id"]).toBe(P().suzuki.id);
    expect(await h.assigneeOf(t.id)).toBe(P().suzuki.id);
    const rows = await h.handoversOf(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "distribute",
      state: "accepted",
      from_member_id: P().mgr.id,
      to_member_id: P().suzuki.id,
    });
    expect(rows[0]!["decided_at"]).not.toBeNull();
    expect(rows[0]!["reason"]).toBe("来週の展示会の準備を優先してもらうため");
    expect(await h.audits(t.id, "handover.distributed")).toBe(1);
  });

  it("K409-API-002 配られた人に受け箱の行 1 つとメール 1 通。メールの件名に番号、本文に理由とお願いの字が無い（D-148.19）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss, title: "セイコー様へ 11月分の請求書を送る" });
    const before = h.mails.length;
    const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id, { reason: "理由の字XYZ", ask: "お願いの字ABC" }));
    expect(r.status).toBe(201);
    const notes = await h.notes(P().suzuki.id, EV.distributed);
    expect(notes.filter((n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t.id)).toHaveLength(1);
    const mine = h.mails.slice(before).filter((m) => m.to === P().suzuki.email);
    expect(mine).toHaveLength(1);
    const number = (await h.f.admin.query<{ n: string }>("select number as n from tickets where id = $1", [t.id]))
      .rows[0]!.n;
    expect(mine[0]!.subject).toContain(number);
    expect(mine[0]!.text).not.toContain("理由の字XYZ");
    expect(mine[0]!.text).not.toContain("お願いの字ABC");
    expect(mine[0]!.subject + mine[0]!.text).not.toContain("理由の字XYZ");
  });

  it("K409-API-003 前の担当者に受け箱の行 1 つ（担当が替わった）・前の担当者へのメールは無い", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const before = h.mails.length;
    expect((await h.distribute(P().mgr, t.id, body(P().suzuki.id))).status).toBe(201);
    const notes = (await h.notes(P().boss.id, EV.reassigned)).filter(
      (n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t.id,
    );
    expect(notes).toHaveLength(1);
    expect(h.mails.slice(before).filter((m) => m.to === P().boss.email)).toHaveLength(0);
  });

  it("K409-API-004 理由が空（空の字・空白だけ・欄なし）：422・何も変わらない（D-125.33）", async () => {
    await h.ready();
    for (const reason of ["", "   　", undefined]) {
      const t = await h.ticket({ assignee: P().boss });
      const before = h.mails.length;
      const b = body(P().suzuki.id);
      if (reason === undefined) delete b["reason"];
      else b["reason"] = reason;
      const r = await h.distribute(P().mgr, t.id, b);
      expect(r.status, `理由 ${JSON.stringify(reason)}`).toBe(422);
      await unchanged(t.id, P().boss.id, before);
    }
  });

  it("K409-API-005 配る権限の無い人（同じグループの書ける人・担当者でない）：403・E-HND-002（K-401 の共通の確かめ）・何も変わらない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const before = h.mails.length;
    const r = await h.distribute(P().suzuki, t.id, body(P().jdMember.id));
    expect(r.status).toBe(403);
    expect((await h.json(r))["code"]).toBe("E-HND-002");
    await unchanged(t.id, P().boss.id, before);
  });

  it("K409-API-006 マネージャーが自分が担当のチケットで配る：403・E-HND-002（担当者本人ができるのは「引き継いでもらう」だけ・D-148.3・K-401 の共通の確かめ）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().mgr });
    const before = h.mails.length;
    const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
    expect(r.status).toBe(403);
    expect((await h.json(r))["code"]).toBe("E-HND-002");
    await unchanged(t.id, P().mgr.id, before);
  });

  it("K409-API-007 相手が止まっている人は 409・E-HND-006、別の会社の人・在らない id は 404・E-HND-014（K-401 の共通の確かめ・DB の中身で決まる断りは 404／409）・何も変わらない", async () => {
    await h.ready();
    for (const [to, code, status] of [
      [P().stopped.id, "E-HND-006", 409],
      [P().outsider.id, "E-HND-014", 404],
      [randomUUID(), "E-HND-014", 404],
    ] as const) {
      const t = await h.ticket({ assignee: P().boss });
      const before = h.mails.length;
      const r = await h.distribute(P().mgr, t.id, body(to));
      expect(r.status, to).toBe(status);
      expect((await h.json(r))["code"]).toBe(code);
      await unchanged(t.id, P().boss.id, before);
    }
  });

  it("K409-API-008 相手が閲覧のみ・ゲスト：409・E-HND-130（D-148.18）", async () => {
    await h.ready();
    for (const to of [P().viewer.id, P().requester.id]) {
      const t = await h.ticket({ assignee: P().boss });
      const r = await h.distribute(P().mgr, t.id, body(to));
      expect(r.status).toBe(409);
      expect((await h.json(r))["code"]).toBe("E-HND-130");
      expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
    }
  });

  it("K409-API-009 相手が今の担当者：409・E-HND-131", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const r = await h.distribute(P().mgr, t.id, body(P().boss.id));
    expect(r.status).toBe(409);
    expect((await h.json(r))["code"]).toBe("E-HND-131");
  });

  it("K409-API-010 待っている渡しが在る（引き継いでもらう中）：409・文に「返事を待っています」・何も変わらない（D-148.20）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    await h.waiting({ ticketId: t.id, kind: "pass", from: P().boss, toMember: P().jdMember });
    const before = h.mails.length;
    const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
    expect(r.status).toBe(409);
    expect(msg((await h.json(r))["code"])).toContain(WAITING_TEXT);
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
    expect(h.mails.length).toBe(before);
  });

  it("K409-API-011 AI の承認待ちのチケット：409・文は「AI の実行（承認）が終わってから渡してください」・何も変わらない（D-148.6）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss, stage: "awaiting_approval" });
    await h.f.admin.query(
      `insert into approvals (tenant_id, scope_id, kind, ticket_id, approver_member_id, requested_by, status_id, created_by)
       values ($1, $2, 'artifact', $3, $4, $4, 'pending', $4)`,
      [h.T.tenantId, h.T.rootScope, t.id, P().boss.id],
    );
    const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
    expect(r.status).toBe(409);
    expect(msg((await h.json(r))["code"])).toBe(AI_RUNNING_TEXT);
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
  });

  it("K409-API-012 完了したチケット：409・E-HND-009（K-401 の共通の確かめ）。消したチケット：見えないチケットと同じ 404（app.ticket_visible が外す・0102）", async () => {
    await h.ready();
    const done = await h.ticket({ assignee: P().boss, stage: "done" });
    await h.f.admin.query("update tickets set completed_at = now() where id = $1", [done.id]);
    const r1 = await h.distribute(P().mgr, done.id, body(P().suzuki.id));
    expect(r1.status).toBe(409);
    expect((await h.json(r1))["code"]).toBe("E-HND-009");
    const gone = await h.ticket({ assignee: P().boss });
    await h.f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    const r2 = await h.distribute(P().mgr, gone.id, body(P().suzuki.id));
    expect(r2.status).toBe(404);
    expect(await h.assigneeOf(gone.id)).toBe(P().boss.id);
  });

  it("K409-API-013 別の会社のチケット：404（無いのと同じ）・何も変わらない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().outsider, tenant: h.O.tenantId, scope: h.O.rootScope });
    const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
    expect(r.status).toBe(404);
    expect(await h.assigneeOf(t.id)).toBe(P().outsider.id);
  });

  it("K409-API-014 ログインしていない：401・何も変わらない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const r = await h.req("POST", `/tickets/${t.id}/handovers`, { body: body(P().suzuki.id) });
    expect(r.status).toBe(401);
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
  });

  it("K409-API-015 二度押し（同じ Idempotency-Key）：2 回とも 201 で同じ答え・渡しの行 1・受け箱 1・メール 1", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const key = randomUUID();
    const before = h.mails.length;
    const r1 = await h.distribute(P().mgr, t.id, body(P().suzuki.id), { key });
    const r2 = await h.distribute(P().mgr, t.id, body(P().suzuki.id), { key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await r2.text()).toBe(await r1.text());
    expect(await h.handoversOf(t.id)).toHaveLength(1);
    expect(
      (await h.notes(P().suzuki.id, EV.distributed)).filter(
        (n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t.id,
      ),
    ).toHaveLength(1);
    expect(h.mails.slice(before).filter((m) => m.to === P().suzuki.email)).toHaveLength(1);
  });

  it("K409-API-016 管理者（どのグループでも配る権限）は配れる・下のグループのマネージャーは上のグループのチケットが見えない（404・E-PAGE-001・K401-DB-027）", async () => {
    await h.ready();
    const t1 = await h.ticket({ assignee: P().boss });
    expect((await h.distribute(P().admin, t1.id, body(P().suzuki.id))).status).toBe(201);
    expect(await h.assigneeOf(t1.id)).toBe(P().suzuki.id);
    const t2 = await h.ticket({ assignee: P().boss });
    const r = await h.distribute(P().jdMgr, t2.id, body(P().jdMember.id));
    expect(r.status).toBe(404);
    expect((await h.json(r))["code"]).toBe("E-PAGE-001");
    expect(await h.assigneeOf(t2.id)).toBe(P().boss.id);
  });

  it("K409-API-017 グループをまたいで配れる：受託開発の人へ配ると 201・担当者が中村（チケットのグループは変えない）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    expect((await h.distribute(P().mgr, t.id, body(P().jdMember.id))).status).toBe(201);
    expect(await h.assigneeOf(t.id)).toBe(P().jdMember.id);
    const s = (await h.f.admin.query<{ s: string }>("select scope_id as s from tickets where id = $1", [t.id])).rows[0]!
      .s;
    expect(s).toBe(h.T.rootScope);
  });

  it("K409-API-018 手順 S1（渡しの行・担当者・受け箱・証跡を 1 つの取引で書く）が失敗：503・E-PAGE-003・担当者そのまま・渡しの行 0・受け箱 0・メール 0", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const fn = `k409_fail_${randomUUID().replaceAll("-", "")}`;
    await h.f.admin.query(
      `create function app.${fn}() returns trigger language plpgsql as $$ begin
         if new.ticket_id = '${t.id}' then raise exception 'K409 試験の失敗'; end if; return new; end $$`,
    );
    await h.f.admin.query(
      `create trigger ${fn} before insert on ticket_handovers for each row execute function app.${fn}()`,
    );
    try {
      const before = h.mails.length;
      const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
      expect(r.status).toBe(503);
      expect((await h.json(r))["code"]).toBe("E-PAGE-003");
      await unchanged(t.id, P().boss.id, before);
      expect(
        (await h.notes(P().suzuki.id, EV.distributed)).filter(
          (n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t.id,
        ),
      ).toHaveLength(0);
    } finally {
      await h.f.admin.query(`drop trigger if exists ${fn} on ticket_handovers`);
      await h.f.admin.query(`drop function if exists app.${fn}()`);
    }
  });

  it("K409-API-019 手順 S2（メール）が失敗 [残る]：201・担当者は鈴木のまま・受け箱の行は残り、送れなかった印（failed_at・K-401 の app.handover_mail_mark）が付く", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    h.failMailTo.add(P().suzuki.email);
    try {
      const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
      expect(r.status).toBe(201);
      expect(await h.assigneeOf(t.id)).toBe(P().suzuki.id);
      expect(
        (await h.notes(P().suzuki.id, EV.distributed)).filter(
          (n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t.id,
        ),
      ).toHaveLength(1);
      const failed = await h.num(
        "select count(*) as n from notifications where member_id = $1 and event_kind_id = $2 and failed_at is not null and payload->>'ticket_id' = $3",
        [P().suzuki.id, EV.distributed, t.id],
      );
      expect(failed).toBe(1);
    } finally {
      h.failMailTo.delete(P().suzuki.email);
    }
  });

  it("K409-API-020 手順 S2 の後片付け（手順 S3：送れなかった印を書く・1 回やり直す）も失敗：201 のまま・担当者は鈴木・ログに送れなかった行と印を書けなかった行（[handover] の行が 2 つ以上・宛てのメールの字は出さない）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    h.failMailTo.add(P().suzuki.email);
    const fn = `k409_mark_${randomUUID().replaceAll("-", "")}`;
    await h.f.admin.query(
      `create function app.${fn}() returns trigger language plpgsql as $$ begin
         if new.payload->>'ticket_id' = '${t.id}' and new.failed_at is not null then raise exception 'K409 試験の失敗'; end if; return new; end $$`,
    );
    await h.f.admin.query(
      `create trigger ${fn} before update on notifications for each row execute function app.${fn}()`,
    );
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    try {
      const r = await h.distribute(P().mgr, t.id, body(P().suzuki.id));
      expect(r.status).toBe(201);
      expect(await h.assigneeOf(t.id)).toBe(P().suzuki.id);
      const lines = logs.filter((l) => l.includes("[handover]"));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.join("\n")).not.toContain(P().suzuki.email);
    } finally {
      console.error = orig;
      h.failMailTo.delete(P().suzuki.email);
      await h.f.admin.query(`drop trigger if exists ${fn} on notifications`);
      await h.f.admin.query(`drop function if exists app.${fn}()`);
    }
  });

  it("K409-API-021 相手の欄が人とグループの両方は 422（欄 to_member_id）・どちらも無いは 422・E-HND-013（K-401 の入力と共通の確かめ）・何も変わらない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const both = h.createBody({ kind: "distribute", to_member_id: P().suzuki.id, to_scope_id: h.JD });
    const none = h.createBody({ kind: "distribute" });
    const r1 = await h.distribute(P().mgr, t.id, both);
    expect(r1.status).toBe(422);
    expect(((await h.json(r1))["details"] as { field: string }[] | undefined)?.map((d) => d.field)).toContain(
      "to_member_id",
    );
    const r2 = await h.distribute(P().mgr, t.id, none);
    expect(r2.status).toBe(422);
    expect((await h.json(r2))["code"]).toBe("E-HND-013");
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
    expect(await h.handoversOf(t.id)).toHaveLength(0);
  });
});

describe("K-409 合意ありで配ったものに答える（待っている行は DB に直に置く）", () => {
  it("K409-API-022 配られた人が受ける：200・accepted・担当者が配られた人・配った人に受け箱 1（メールは無い）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const id = await h.waiting({ ticketId: t.id, kind: "distribute", from: P().mgr, toMember: P().suzuki });
    const before = h.mails.length;
    const r = await h.answer(P().suzuki, id, h.answerBody(true));
    expect(r.status, await r.clone().text()).toBe(200);
    const data = (await h.json(r))["data"] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
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
    ]);
    expect(data).toMatchObject({ id, state: "accepted" });
    expect((await h.handover(id))!["state"]).toBe("accepted");
    expect(await h.assigneeOf(t.id)).toBe(P().suzuki.id);
    expect(
      (await h.notes(P().mgr.id, EV.accepted)).filter(
        (n) => (n["payload"] as Record<string, unknown>)["handover_id"] === id,
      ),
    ).toHaveLength(1);
    expect(h.mails.slice(before).filter((m) => m.to === P().mgr.email)).toHaveLength(0);
  });

  it("K409-API-023 配られた人が理由を付けて断る：200・declined・理由が残る・担当者そのまま・配った人に受け箱 1 とメール 1（メールに理由の字は無い）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const id = await h.waiting({ ticketId: t.id, kind: "distribute", from: P().mgr, toMember: P().suzuki });
    const before = h.mails.length;
    const r = await h.answer(P().suzuki, id, h.answerBody(false, "今週は展示会の準備で手が空かない"));
    expect(r.status).toBe(200);
    expect(await h.handover(id)).toMatchObject({
      state: "declined",
      decline_reason: "今週は展示会の準備で手が空かない",
    });
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
    expect(
      (await h.notes(P().mgr.id, EV.declined)).filter(
        (n) => (n["payload"] as Record<string, unknown>)["handover_id"] === id,
      ),
    ).toHaveLength(1);
    const mine = h.mails.slice(before).filter((m) => m.to === P().mgr.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).not.toContain("展示会の準備で手が空かない");
  });

  it("K409-API-024 断るのに理由が空：422・waiting のまま・知らせ 0", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const id = await h.waiting({ ticketId: t.id, kind: "distribute", from: P().mgr, toMember: P().suzuki });
    for (const reason of ["", "  ", undefined]) {
      const r = await h.answer(P().suzuki, id, h.answerBody(false, reason));
      expect(r.status, JSON.stringify(reason)).toBe(422);
    }
    expect((await h.handover(id))!["state"]).toBe("waiting");
    expect(
      await h
        .notes(P().mgr.id, EV.declined)
        .then((x) => x.filter((n) => (n["payload"] as Record<string, unknown>)["handover_id"] === id)),
    ).toHaveLength(0);
  });

  it("K409-API-025 配られた人でない人（配った人・同じグループの人）が答える：403・waiting のまま・担当者そのまま", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const id = await h.waiting({ ticketId: t.id, kind: "distribute", from: P().mgr, toMember: P().suzuki });
    for (const who of [P().mgr, P().jdMember]) {
      const r = await h.answer(who, id, h.answerBody(true));
      expect([403, 404], who.id).toContain(r.status);
    }
    expect((await h.handover(id))!["state"]).toBe("waiting");
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
  });

  it("K409-API-026 もう決まっていた（取り消された・受けた）配りに答える：409・E-HND-005（K-401 の共通の確かめ）・行は変わらない", async () => {
    await h.ready();
    for (const state of ["withdrawn", "accepted"]) {
      const t = await h.ticket({ assignee: P().boss });
      const id = await h.waiting({ ticketId: t.id, kind: "distribute", from: P().mgr, toMember: P().suzuki });
      await h.f.admin.query("update ticket_handovers set state = $2, decided_at = now() where id = $1", [id, state]);
      const r = await h.answer(P().suzuki, id, h.answerBody(true));
      expect(r.status, state).toBe(409);
      expect((await h.json(r))["code"]).toBe("E-HND-005");
      expect((await h.handover(id))!["state"]).toBe(state);
    }
  });
});

describe("K-409 配ったチケットが完了したら配った人に知らせる（D-125.99）", () => {
  it("K409-API-027 配って担当者が移ったチケットが完了：配った人に受け箱の行 1（メールは無い）。戻して 2 回目の完了でも 1 つのまま", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    expect((await h.distribute(P().mgr, t.id, body(P().suzuki.id))).status).toBe(201);
    const before = h.mails.length;
    await h.f.admin.query("update tickets set completed_at = now(), completed_by = $2 where id = $1", [
      t.id,
      P().suzuki.id,
    ]);
    const mine = () =>
      h
        .notes(P().mgr.id, EV.done)
        .then((x) => x.filter((n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t.id));
    expect(await mine()).toHaveLength(1);
    await h.f.admin.query("update tickets set completed_at = null, completed_by = null where id = $1", [t.id]);
    await h.f.admin.query("update tickets set completed_at = now(), completed_by = $2 where id = $1", [
      t.id,
      P().suzuki.id,
    ]);
    expect(await mine()).toHaveLength(1);
    expect(h.mails.slice(before).filter((m) => m.to === P().mgr.email)).toHaveLength(0);
  });

  it("K409-API-028 引き継いでもらった（pass）チケットの完了では渡した人に完了の知らせは無い・配り直したら最後に配った人だけに出る", async () => {
    await h.ready();
    const t1 = await h.ticket({ assignee: P().boss });
    const pid = await h.waiting({ ticketId: t1.id, kind: "pass", from: P().boss, toMember: P().suzuki });
    await h.f.admin.query("update ticket_handovers set state = 'accepted', decided_at = now() where id = $1", [pid]);
    await h.f.admin.query("update tickets set assignee_member_id = $2 where id = $1", [t1.id, P().suzuki.id]);
    await h.f.admin.query("update tickets set completed_at = now() where id = $1", [t1.id]);
    expect(
      (await h.notes(P().boss.id, EV.done)).filter(
        (n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t1.id,
      ),
    ).toHaveLength(0);

    const t2 = await h.ticket({ assignee: P().boss });
    expect((await h.distribute(P().mgr, t2.id, body(P().suzuki.id))).status).toBe(201);
    expect((await h.distribute(P().admin, t2.id, body(P().jdMember.id))).status).toBe(201);
    await h.f.admin.query("update tickets set completed_at = now() where id = $1", [t2.id]);
    const of = (m: string) =>
      h
        .notes(m, EV.done)
        .then((x) => x.filter((n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === t2.id));
    expect(await of(P().admin.id)).toHaveLength(1);
    expect(await of(P().mgr.id)).toHaveLength(0);
  });
});
