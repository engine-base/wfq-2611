// K-410「グループに配る・グループに来たものを引き取る」の口の試験（本物の DB・本物の行の守り・口の入口は createApp と契約の op・偽の画面のログイン）。
//   行 ID（K410-API-…）は 11_tickets/K-410.md の表と 1 対 1。土台は distribute.harness.ts（K-409 が carry で運ぶ）。
//   グループに配る：createTicketHandover の kind distribute・to_scope_id（中身は apps/api/src/features/F8/handovers/create/distribute-group.ts）。
//   自分が持つ：answerTicketHandover の decision accept（K-401 の振り分けが answer/distribute-group.ts の answerDistributeGroup へ渡す）。断るは 409（グループ宛ては断れない）。
//   人を決める：claimTicketHandover（POST /ticket_handovers/:id/claim・{ member_id }。中身は claim.ts・登録は hooks/handover-claim.ts）。
//   共通の断り（見えない・答える人でない・決まった渡し・グループが無い・配る権限が無い）は K-401 の番号（E-PAGE-001・E-HND-002・005・012）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Person } from "../fixture.js";
import { AI_RUNNING_TEXT, EV, WAITING_TEXT, msg, setupDistribute } from "./distribute.harness.js";

const h = setupDistribute("K410");
const P = () => h.people;
const toGroup = (scope: string, o: { reason?: unknown } = {}) =>
  h.createBody({ kind: "distribute", to_scope_id: scope, ...o });
const of = (ticketId: string) => (rows: Record<string, unknown>[]) =>
  rows.filter((n) => (n["payload"] as Record<string, unknown>)["ticket_id"] === ticketId);

/** グループに配った待っている行を口で作る（既定：佐藤が高本のチケットを受託開発へ） */
async function grouped(o: { assignee?: Person } = {}): Promise<{ t: { id: string; number: string }; id: string }> {
  const t = await h.ticket({ assignee: o.assignee ?? P().boss });
  const r = await h.distribute(P().mgr, t.id, toGroup(h.JD));
  expect(r.status, await r.clone().text()).toBe(201);
  const row = (await h.handoversOf(t.id)).at(-1)!;
  return { t, id: String(row["id"]) };
}

/** 失敗を起こす一時の引き金（試験の中だけ・finally で消す） */
async function failOn(table: string, when: "insert" | "update", cond: string, fn: () => Promise<void>): Promise<void> {
  const name = `k410_fail_${randomUUID().replaceAll("-", "")}`;
  await h.f.admin.query(
    `create function app.${name}() returns trigger language plpgsql as $$ begin if ${cond} then raise exception 'K410 試験の失敗'; end if; return new; end $$`,
  );
  await h.f.admin.query(
    `create trigger ${name} before ${when} on ${table} for each row execute function app.${name}()`,
  );
  try {
    await fn();
  } finally {
    await h.f.admin.query(`drop trigger if exists ${name} on ${table}`);
    await h.f.admin.query(`drop function if exists app.${name}()`);
  }
}

describe("K-410 グループに配る", () => {
  it("K410-API-001 マネージャーが受託開発に配る：201・渡しの行は distribute／waiting・to_scope 受託開発・to_member 無し・担当者は配った人（佐藤）・証跡 1", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const r = await h.distribute(P().mgr, t.id, toGroup(h.JD));
    expect(r.status, await r.clone().text()).toBe(201);
    // 答えは K-401 の成功の答えの形（16 の鍵・app.handover_json）。to は空・to_scope が受託開発
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
    expect(data).toMatchObject({ kind: "distribute", state: "waiting", to: null });
    expect((data["to_scope"] as Record<string, unknown>)["id"]).toBe(h.JD);
    const rows = await h.handoversOf(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "distribute",
      state: "waiting",
      to_scope_id: h.JD,
      to_member_id: null,
      from_member_id: P().mgr.id,
    });
    expect(rows[0]!["decided_at"]).toBeNull();
    expect(await h.assigneeOf(t.id)).toBe(P().mgr.id);
    expect(await h.audits(t.id, "handover.group_distributed")).toBe(1);
  });

  it("K410-API-002 受託開発で権限を持つ人（田中・管理者）に受け箱 1 とメール 1。配った人と受託開発の普通のメンバーには無い。メールに理由の字が無い", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const before = h.mails.length;
    expect((await h.distribute(P().mgr, t.id, toGroup(h.JD, { reason: "理由の字QWE" }))).status).toBe(201);
    for (const p of [P().jdMgr, P().admin]) {
      expect(of(t.id)(await h.notes(p.id, EV.groupDistributed)), p.email).toHaveLength(1);
      const mine = h.mails.slice(before).filter((m) => m.to === p.email);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.subject + mine[0]!.text).not.toContain("理由の字QWE");
    }
    for (const p of [P().mgr, P().jdMember]) {
      expect(of(t.id)(await h.notes(p.id, EV.groupDistributed))).toHaveLength(0);
      expect(h.mails.slice(before).filter((m) => m.to === p.email)).toHaveLength(0);
    }
  });

  it("K410-API-003 マネージャーが自分が担当のチケットをグループに配る：201・担当者は佐藤のまま（人に配るときと違い断らない）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().mgr });
    expect((await h.distribute(P().mgr, t.id, toGroup(h.JD))).status).toBe(201);
    expect(await h.assigneeOf(t.id)).toBe(P().mgr.id);
  });

  it("K410-API-004 グループが別の会社の物・在らない id・消した：どれも 404・E-HND-012（K-401 の共通の確かめ・DB の中身で決まる断り）・渡しの行 0", async () => {
    await h.ready();
    const gone = (
      await h.f.admin.query<{ id: string }>(
        "insert into scopes (tenant_id, parent_id, name, ticket_prefix, deleted_at) values ($1, $2, '消したグループ', 'XX', now()) returning id",
        [h.T.tenantId, h.T.rootScope],
      )
    ).rows[0]!.id;
    for (const s of [h.O.rootScope, randomUUID(), gone]) {
      const t = await h.ticket({ assignee: P().boss });
      const r = await h.distribute(P().mgr, t.id, toGroup(s));
      expect(r.status, s).toBe(404);
      expect((await h.json(r))["code"]).toBe("E-HND-012");
      expect(await h.handoversOf(t.id)).toHaveLength(0);
      expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
    }
  });

  it("K410-API-005 配る権限の無い人がグループに配る：403・E-HND-002（K-401 の共通の確かめ）・何も変わらない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const r = await h.distribute(P().suzuki, t.id, toGroup(h.JD));
    expect(r.status).toBe(403);
    expect((await h.json(r))["code"]).toBe("E-HND-002");
    expect(await h.handoversOf(t.id)).toHaveLength(0);
  });

  it("K410-API-006 待っている渡しが在る（引き継いでもらう中）：409・文に「返事を待っています」・何も変わらない（D-148.20）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    await h.waiting({ ticketId: t.id, kind: "pass", from: P().boss, toMember: P().suzuki });
    const r = await h.distribute(P().mgr, t.id, toGroup(h.JD));
    expect(r.status).toBe(409);
    expect(msg((await h.json(r))["code"])).toContain(WAITING_TEXT);
    expect(await h.handoversOf(t.id)).toHaveLength(1);
  });

  it("K410-API-007 AI の承認待ちのチケット：409・文は「AI の実行（承認）が終わってから渡してください」（D-148.6）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss, stage: "awaiting_approval" });
    await h.f.admin.query(
      `insert into approvals (tenant_id, scope_id, kind, ticket_id, approver_member_id, requested_by, status_id, created_by)
       values ($1, $2, 'artifact', $3, $4, $4, 'pending', $4)`,
      [h.T.tenantId, h.T.rootScope, t.id, P().boss.id],
    );
    const r = await h.distribute(P().mgr, t.id, toGroup(h.JD));
    expect(r.status).toBe(409);
    expect(msg((await h.json(r))["code"])).toBe(AI_RUNNING_TEXT);
  });

  it("K410-API-008 理由が空（空の字・空白だけ）：422・渡しの行 0", async () => {
    await h.ready();
    for (const reason of ["", " 　 "]) {
      const t = await h.ticket({ assignee: P().boss });
      const r = await h.distribute(P().mgr, t.id, toGroup(h.JD, { reason }));
      expect(r.status).toBe(422);
      expect(await h.handoversOf(t.id)).toHaveLength(0);
    }
  });

  it("K410-API-009 配る手順 1（渡しの行・担当者・受け箱・証跡を 1 つの取引で）が失敗：503・E-PAGE-003・何も残らない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const before = h.mails.length;
    await failOn("ticket_handovers", "insert", `new.ticket_id = '${t.id}'`, async () => {
      const r = await h.distribute(P().mgr, t.id, toGroup(h.JD));
      expect(r.status).toBe(503);
      expect((await h.json(r))["code"]).toBe("E-PAGE-003");
    });
    expect(await h.handoversOf(t.id)).toHaveLength(0);
    expect(await h.assigneeOf(t.id)).toBe(P().boss.id);
    expect(of(t.id)(await h.notes(P().jdMgr.id, EV.groupDistributed))).toHaveLength(0);
    expect(h.mails.length).toBe(before);
  });

  it("K410-API-010 配る手順 2（メール）が失敗 [残る]：201・渡しの行は waiting のまま残る・受け箱の行は残り、送れなかった印（failed_at・K-401 の app.handover_mail_mark）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    h.failMailTo.add(P().jdMgr.email);
    try {
      expect((await h.distribute(P().mgr, t.id, toGroup(h.JD))).status).toBe(201);
      expect((await h.handoversOf(t.id))[0]!["state"]).toBe("waiting");
      expect(of(t.id)(await h.notes(P().jdMgr.id, EV.groupDistributed))).toHaveLength(1);
      expect(
        await h.num(
          "select count(*) as n from notifications where member_id = $1 and event_kind_id = $2 and failed_at is not null and payload->>'ticket_id' = $3",
          [P().jdMgr.id, EV.groupDistributed, t.id],
        ),
      ).toBe(1);
    } finally {
      h.failMailTo.delete(P().jdMgr.email);
    }
  });

  it("K410-API-011 手順 2 の後片付け（印を書く・1 回やり直す）も失敗：201 のまま・ログに [handover] の行が 2 つ以上（宛てのメールの字は無い）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    h.failMailTo.add(P().jdMgr.email);
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    try {
      await failOn(
        "notifications",
        "update",
        `new.payload->>'ticket_id' = '${t.id}' and new.failed_at is not null`,
        async () => {
          expect((await h.distribute(P().mgr, t.id, toGroup(h.JD))).status).toBe(201);
        },
      );
      const lines = logs.filter((l) => l.includes("[handover]"));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.join("\n")).not.toContain(P().jdMgr.email);
    } finally {
      console.error = orig;
      h.failMailTo.delete(P().jdMgr.email);
    }
  });

  it("K410-API-027 担当者でグループを管理する人（佐藤）が自分のチケットの下見を開く（K-401 の handover_kinds の p_to_scope の枝・下見の groups）：200・kinds は pass のまま・groups に会社のグループ（消していない）が名前の順で全部・1 件の鍵は id・name・code", async () => {
    await h.ready();
    h.limits["previewTicketHandover"] = 10_000;
    const t = await h.ticket({ assignee: P().mgr });
    const r = await h.req("GET", `/tickets/${t.id}/handover-preview`, { headers: h.auth(P().mgr) });
    expect(r.status, await r.clone().text()).toBe(200);
    const d = (await h.json(r)).data as Record<string, unknown>;
    expect(d["kinds"]).toEqual(["pass"]);
    const want = (
      await h.f.admin.query<{ id: string; name: string; code: string }>(
        "select id, name, ticket_prefix as code from scopes where tenant_id = $1 and deleted_at is null order by name",
        [h.T.tenantId],
      )
    ).rows;
    expect(want.map((g) => g.id)).toContain(h.JD);
    const groups = d["groups"] as Record<string, unknown>[];
    expect(groups.map((g) => Object.keys(g).sort())).toEqual(want.map(() => ["code", "id", "name"]));
    expect(groups).toEqual(want.map((g) => ({ id: g.id, name: g.name, code: g.code })));
    expect(groups.map((g) => g["id"])).not.toContain(h.O.rootScope);
  });

  it("K410-API-028 チケットと同じグループ（営業）に配る（登録したての会社はグループが 1 つ・K-418 の STG-02 の形）：201・to_scope 営業・E-HND-012 にならない・担当者は配った人（佐藤）", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const r = await h.distribute(P().mgr, t.id, toGroup(h.T.rootScope));
    expect(r.status, await r.clone().text()).toBe(201);
    const rows = await h.handoversOf(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "distribute",
      state: "waiting",
      to_scope_id: h.T.rootScope,
      to_member_id: null,
    });
    expect(await h.assigneeOf(t.id)).toBe(P().mgr.id);
  });
});

describe("K-410 グループに来たものを引き取る（自分が持つ＝答える口・人を決める＝claimTicketHandover）", () => {
  const take = (p: Person, id: string, key?: string) =>
    h.req("PATCH", `/ticket_handovers/${id}`, {
      body: h.answerBody(true),
      headers: { ...h.auth(p), ...(key ? { "idempotency-key": key } : {}) },
    });
  const failedOf = (member: string, kind: string, ticketId: string) =>
    h.num(
      "select count(*) as n from notifications where member_id = $1 and event_kind_id = $2 and failed_at is not null and payload->>'ticket_id' = $3",
      [member, kind, ticketId],
    );

  it("K410-API-012 受託開発のマネージャーが「自分が持つ」（答える口・accept）：200・accepted・to_member 田中・担当者 田中・配った人に受け箱 handover.claimed 1（メールは無い）・証跡 1", async () => {
    await h.ready();
    const { t, id } = await grouped();
    const before = h.mails.length;
    const r = await take(P().jdMgr, id);
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
    expect(await h.handover(id)).toMatchObject({ state: "accepted", to_member_id: P().jdMgr.id, to_scope_id: h.JD });
    expect(await h.assigneeOf(t.id)).toBe(P().jdMgr.id);
    expect(of(t.id)(await h.notes(P().mgr.id, EV.claimed))).toHaveLength(1);
    expect(h.mails.slice(before).filter((m) => m.to === P().mgr.email)).toHaveLength(0);
    expect(await h.audits(t.id, "handover.claimed")).toBe(1);
  });

  it("K410-API-013 受託開発のマネージャーが「人を決める」（中村）：200・担当者 中村・中村に受け箱 handover.distributed とメール 1・配った人に handover.claimed 1", async () => {
    await h.ready();
    const { t, id } = await grouped();
    const before = h.mails.length;
    const r = await h.claim(P().jdMgr, id, { member_id: P().jdMember.id });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await h.handover(id)).toMatchObject({ state: "accepted", to_member_id: P().jdMember.id });
    expect(await h.assigneeOf(t.id)).toBe(P().jdMember.id);
    expect(of(t.id)(await h.notes(P().jdMember.id, EV.distributed))).toHaveLength(1);
    expect(h.mails.slice(before).filter((m) => m.to === P().jdMember.email)).toHaveLength(1);
    expect(of(t.id)(await h.notes(P().mgr.id, EV.claimed))).toHaveLength(1);
  });

  it("K410-API-014 人を決める相手：同じ会社でグループの外（営業の鈴木）は 409・E-HND-150／別の会社の人・無い id は 404・E-PAGE-001（欄・details・detail なし）。waiting のまま", async () => {
    await h.ready();
    const { t, id } = await grouped();
    const r1 = await h.claim(P().jdMgr, id, { member_id: P().suzuki.id });
    expect(r1.status).toBe(409);
    expect((await h.json(r1))["code"]).toBe("E-HND-150");
    // 受託開発の中でも、会社から抜けた人・消した人は「無い人」と同じ 404
    const left = await h.f.person(h.T.tenantId, h.JD, { name: "k410-left", ticketAbility: "edit" });
    await h.f.admin.query(
      "insert into tenant_memberships (tenant_id, member_id, role, status) values ($1, $2, 'member', 'left')",
      [h.T.tenantId, left.id],
    );
    const gone = await h.f.person(h.T.tenantId, h.JD, { name: "k410-gone", ticketAbility: "edit" });
    await h.f.admin.query("update members set deleted_at = now() where id = $1", [gone.id]);
    for (const m of [P().outsider.id, randomUUID(), left.id, gone.id]) {
      const r = await h.claim(P().jdMgr, id, { member_id: m });
      expect(r.status, m).toBe(404);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-PAGE-001");
      expect(j["field"]).toBeUndefined();
      expect(j["details"]).toBeUndefined();
      expect(j["detail"]).toBeUndefined();
    }
    expect((await h.handover(id))!["state"]).toBe("waiting");
    expect(await h.assigneeOf(t.id)).toBe(P().mgr.id);
  });

  it("K410-API-015 人を決める相手が閲覧のみ・止まっている（受託開発の中）：409・E-HND-151・waiting のまま", async () => {
    await h.ready();
    const { id } = await grouped();
    const mk = async (key: string, o: { viewer?: boolean; stopped?: boolean }) => {
      const p = await h.f.person(h.T.tenantId, h.JD, { name: key, ticketAbility: o.viewer ? "view" : "edit" });
      await h.f.admin.query(
        "insert into tenant_memberships (tenant_id, member_id, role, status) values ($1, $2, $3, $4)",
        [h.T.tenantId, p.id, o.viewer ? "viewer" : "member", o.stopped ? "suspended" : "active"],
      );
      if (o.stopped)
        await h.f.admin.query("update members set suspended_at = now(), suspended_by = id where id = $1", [p.id]);
      return p;
    };
    for (const p of [await mk("受託の閲覧のみ", { viewer: true }), await mk("受託の止めた人", { stopped: true })]) {
      const r = await h.claim(P().jdMgr, id, { member_id: p.id });
      expect(r.status).toBe(409);
      expect((await h.json(r))["code"]).toBe("E-HND-151");
    }
    expect((await h.handover(id))!["state"]).toBe("waiting");
  });

  it("K410-API-016 配った人（営業のマネージャー・チケットは見える・答える人でない）は「自分が持つ」「人を決める」とも 403（入口の行の確かめ）。受託開発の普通のメンバー（営業のチケットは見えない・答える人でない）は両方とも 404。waiting のまま・担当者そのまま", async () => {
    await h.ready();
    const { t, id } = await grouped();
    // 入口の行の確かめ（recipient＝app.handover_answerer）で止まる 403（番号は入口の共通の物）
    expect((await take(P().mgr, id)).status, "配った人").toBe(403);
    expect((await h.claim(P().mgr, id, { member_id: P().jdMember.id })).status, "配った人").toBe(403);
    expect((await take(P().jdMember, id)).status, "受託開発のメンバー").toBe(404);
    expect((await h.claim(P().jdMember, id, { member_id: P().jdMember.id })).status, "受託開発のメンバー").toBe(404);
    expect((await h.handover(id))!["state"]).toBe("waiting");
    expect(await h.assigneeOf(t.id)).toBe(P().mgr.id);
  });

  it("K410-API-017 管理者は引き取れる（自分が持つ）：200・担当者が管理者", async () => {
    await h.ready();
    const { t, id } = await grouped();
    expect((await take(P().admin, id)).status).toBe(200);
    expect(await h.assigneeOf(t.id)).toBe(P().admin.id);
  });

  it("K410-API-018 もう決まっていた（ほかの人が持った・取り消された）：自分が持つも人を決めるも 409・E-HND-005・行は変わらない", async () => {
    await h.ready();
    const a = await grouped();
    expect((await take(P().jdMgr, a.id)).status).toBe(200);
    for (const r of [await take(P().admin, a.id), await h.claim(P().admin, a.id, { member_id: P().jdMember.id })]) {
      expect(r.status).toBe(409);
      expect((await h.json(r))["code"]).toBe("E-HND-005");
    }
    expect(await h.assigneeOf(a.t.id)).toBe(P().jdMgr.id);

    const b = await grouped();
    await h.f.admin.query("update ticket_handovers set state = 'withdrawn', decided_at = now() where id = $1", [b.id]);
    const r2 = await h.claim(P().jdMgr, b.id, { member_id: P().jdMember.id });
    expect(r2.status).toBe(409);
    expect((await h.json(r2))["code"]).toBe("E-HND-005");
    expect((await h.handover(b.id))!["state"]).toBe("withdrawn");
  });

  it("K410-API-019 同時に 2 人（田中は自分が持つ・管理者は中村に決める）：1 つが 200・もう 1 つが 409・担当者は 1 人・配った人への知らせは 1 つ", async () => {
    await h.ready();
    const { t, id } = await grouped();
    const [r1, r2] = await Promise.all([take(P().jdMgr, id), h.claim(P().admin, id, { member_id: P().jdMember.id })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const winner = r1.status === 200 ? P().jdMgr.id : P().jdMember.id;
    expect(await h.assigneeOf(t.id)).toBe(winner);
    expect((await h.handover(id))!["to_member_id"]).toBe(winner);
    expect(of(t.id)(await h.notes(P().mgr.id, EV.claimed))).toHaveLength(1);
  });

  it("K410-API-020 人宛ての渡し（引き継いでもらう中）に人を決めるを押す：403・行は変わらない", async () => {
    await h.ready();
    const t = await h.ticket({ assignee: P().boss });
    const id = await h.waiting({ ticketId: t.id, kind: "pass", from: P().boss, toMember: P().suzuki });
    const r = await h.claim(P().admin, id, { member_id: P().jdMember.id });
    expect(r.status).toBe(403);
    expect(await h.handover(id)).toMatchObject({ state: "waiting", to_member_id: P().suzuki.id });
  });

  it("K410-API-021 人を決めるの二度押し（同じ Idempotency-Key）：2 回とも 200 で同じ答え・決めた人への知らせ 1・証跡 1", async () => {
    await h.ready();
    const { t, id } = await grouped();
    const key = randomUUID();
    const r1 = await h.claim(P().jdMgr, id, { member_id: P().jdMember.id }, { key });
    const r2 = await h.claim(P().jdMgr, id, { member_id: P().jdMember.id }, { key });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe(await r1.text());
    expect(of(t.id)(await h.notes(P().jdMember.id, EV.distributed))).toHaveLength(1);
    expect(await h.audits(t.id, "handover.claimed")).toBe(1);
  });

  it("K410-API-022 人を決める：別の会社の人は 404・ログインしていないは 401・どちらも行は変わらない", async () => {
    await h.ready();
    const { id } = await grouped();
    expect((await h.claim(P().outsider, id, { member_id: P().jdMember.id })).status).toBe(404);
    expect(
      (await h.req("POST", `/ticket_handovers/${id}/claim`, { body: { member_id: P().jdMember.id } })).status,
    ).toBe(401);
    expect((await h.handover(id))!["state"]).toBe("waiting");
  });

  it("K410-API-023 引き取る手順 1（渡しの行・担当者・受け箱・証跡を 1 つの取引で）が失敗：503・E-PAGE-003・waiting のまま・担当者そのまま・知らせ 0", async () => {
    await h.ready();
    const { t, id } = await grouped();
    await failOn("ticket_handovers", "update", `new.id = '${id}'`, async () => {
      const r = await h.claim(P().jdMgr, id, { member_id: P().jdMember.id });
      expect(r.status).toBe(503);
      expect((await h.json(r))["code"]).toBe("E-PAGE-003");
    });
    expect((await h.handover(id))!["state"]).toBe("waiting");
    expect(await h.assigneeOf(t.id)).toBe(P().mgr.id);
    expect(of(t.id)(await h.notes(P().mgr.id, EV.claimed))).toHaveLength(0);
  });

  it("K410-API-024 引き取る手順 2（人を決めた相手へのメール）が失敗 [残る]：200・担当者は中村・受け箱の行は残り送れなかった印（failed_at）", async () => {
    await h.ready();
    const { t, id } = await grouped();
    h.failMailTo.add(P().jdMember.email);
    try {
      expect((await h.claim(P().jdMgr, id, { member_id: P().jdMember.id })).status).toBe(200);
      expect(await h.assigneeOf(t.id)).toBe(P().jdMember.id);
      expect(of(t.id)(await h.notes(P().jdMember.id, EV.distributed))).toHaveLength(1);
      expect(await failedOf(P().jdMember.id, EV.distributed, t.id)).toBe(1);
    } finally {
      h.failMailTo.delete(P().jdMember.email);
    }
  });

  it("K410-API-025 グループに配られたものを答える口で断る：409・E-HND-152（自分が持つか人を決める）・waiting のまま・知らせ 0", async () => {
    await h.ready();
    const { t, id } = await grouped();
    const r = await h.answer(P().jdMgr, id, h.answerBody(false, "受託開発では受けられない"));
    expect(r.status).toBe(409);
    expect((await h.json(r))["code"]).toBe("E-HND-152");
    expect((await h.handover(id))!["state"]).toBe("waiting");
    expect(of(t.id)(await h.notes(P().mgr.id, EV.declined))).toHaveLength(0);
  });

  it("K410-API-026 人を決めるの体に member_id が無い・uuid でない・知らない欄：422・waiting のまま", async () => {
    await h.ready();
    const { id } = await grouped();
    for (const b of [{}, { member_id: "nakamura" }, { member_id: P().jdMember.id, note: "x" }]) {
      const r = await h.claim(P().jdMgr, id, b as Record<string, unknown>);
      expect(r.status, JSON.stringify(b)).toBe(422);
    }
    expect((await h.handover(id))!["state"]).toBe("waiting");
  });
});
