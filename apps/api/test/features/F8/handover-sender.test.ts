// K-406「渡した人が取り消す・催促する」の単体の試験（口・本物の DB）。名前の頭の行 ID（K406-API-…）は 11_tickets/K-406.md の表に 1 対 1。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 土台は K-63 の approve-complete.harness.ts（本物の Postgres・本物の口の入口・書き換えられる hooks と limits）。渡しの行は DB に直に置く（渡す口 K-402 は通さない）。
//   この葉の口は hooks のファイル apps/api/src/hooks/handovers-sender.ts の register を、各 it の頭の ready() で読む（切る段の smoke で準備ごと落とさない・answer=8f745003d023）。
//   メールの送出（関門 C6）だけは試験の偽（貯める・failMailTo の宛ては送れなかったことにする）。宛ては認証の側の利用者（kaname_auth."user"）から引く。
//
// 試験が決める口の形（K-406.md の「入力の形」「答えの形」「エラーの対応」）:
//   withdrawTicketHandover POST /ticket_handovers/:id/withdraw ← {}（strict）→ 201 { data: { id, state: "withdrawn", decided_at } }
//   remindTicketHandover   POST /ticket_handovers/:id/remind   ← {}（strict）→ 201 { data: { id, reminded_at }, meta: { mail: "sent" | "failed" } }
//   断る：もう決まっていた 409 E-HND-005（K-401 の番号）・今日はもう催促した 409 E-HND-080・催促できない種類 409 E-HND-081・渡した人でない 403・見えない 404
// 受け箱の行の種類：handover.withdrawn（取り消された・受け箱だけ・D-148.19）・handover.reminded（催促・受け箱＋メール）。
//   メールは K-401 の部品（notify.ts の sendHandoverMails・mail.ts の event reminded の件名・送れた／送れなかったの印は app.handover_mail_mark）
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { withTenant } from "@kaname/db/context";
import type { HookDeps, HookModule } from "../../../src/hooks/registry.js";
import type { Person } from "../fixture.js";
import {
  setupApproveComplete,
  f,
  hooks,
  limits,
  T,
  O,
  outsider,
  json,
  one,
  num,
  auth,
  req,
  ticket,
  jstDate,
  type Ticket,
} from "../F5/approve-complete.harness.js";

setupApproveComplete();

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "hooks");
const SENDER_HOOKS = join(HOOKS_DIR, "handovers-sender.ts");
const WEB = "http://localhost:3000";
interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const mails: SentMail[] = [];
const failMailTo = new Set<string>();
let loading: Promise<void> | null = null;
const ready = async () => {
  loading ??= (async () => {
    expect(existsSync(SENDER_HOOKS), "この葉の hooks のファイル handovers-sender.ts").toBe(true);
    const mod = (await import(SENDER_HOOKS)) as { register: HookModule };
    const d = {
      appPool: f.pool,
      mailer: async (m: SentMail) => {
        if (failMailTo.has(m.to)) throw new Error("送れなかった（試験）");
        mails.push({ to: m.to, subject: m.subject, text: m.text });
      },
      config: { env: "test", webBaseUrl: WEB, opsEmail: "ops@example.com" },
    } as unknown as HookDeps;
    Object.assign(hooks, mod.register.make(d));
    limits["withdrawTicketHandover"] = 10_000;
    limits["remindTicketHandover"] = 10_000;
  })();
  await loading;
};

type Human = Person & { email: string };
/** メールの宛てを持つ人（認証の側の利用者と所属の行も入れる・distribute.harness.ts と同じ入れ方） */
async function human(
  name: string,
  o: { scope?: string; tenant?: string; ability?: "edit" | "view" | null } = {},
): Promise<Human> {
  const tenant = o.tenant ?? T.tenantId;
  const authUserId = randomUUID();
  const email = `k406-${authUserId.slice(0, 8)}@example.com`;
  await f.admin.query(
    'insert into kaname_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled") values ($1, $2, $3, true, now(), now(), false)',
    [authUserId, name, email],
  );
  const p = await f.person(tenant, o.scope ?? (tenant === T.tenantId ? T.rootScope : O.rootScope), {
    name,
    ticketAbility: o.ability === undefined ? "edit" : o.ability,
    authUserId,
  });
  await f.admin.query(
    "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status) values ($1, $2, $3, 'member', 'active')",
    [tenant, p.id, authUserId],
  );
  return { ...p, email };
}
const REASON = "来週から展示会の準備に入るため";
const ASK = "金曜までに先方へ一次返信を";
/** 渡しの行を DB に直に置く */
async function handover(
  t: Ticket,
  o: {
    kind?: "pass" | "offer" | "distribute";
    from: Person;
    to?: Person | null;
    toScope?: string | null;
    state?: "waiting" | "accepted" | "declined" | "withdrawn";
    replyDue?: string | null;
  },
): Promise<string> {
  const state = o.state ?? "waiting";
  return (
    await one<{ id: string }>(
      `insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_member_id, to_scope_id, reason, ask, reply_due,
                                     state, decline_reason, decided_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $10 = 'waiting' then null else now() end, $4) returning id`,
      [
        t.tenant,
        t.id,
        o.kind ?? "pass",
        o.from.id,
        o.to === undefined ? null : (o.to?.id ?? null),
        o.toScope ?? null,
        REASON,
        ASK,
        o.replyDue === undefined ? `${jstDate(1)}T09:00:00.000Z` : o.replyDue,
        state,
        state === "declined" ? "今週は手が空かない" : null,
      ],
    )
  ).id;
}
const withdraw = (p: Person, id: string, o: { body?: unknown; key?: string } = {}) =>
  req("POST", `/ticket_handovers/${id}/withdraw`, {
    body: o.body ?? {},
    headers: { ...auth(p), ...(o.key ? { "idempotency-key": o.key } : {}) },
  });
const remind = (p: Person, id: string, o: { body?: unknown } = {}) =>
  req("POST", `/ticket_handovers/${id}/remind`, { body: o.body ?? {}, headers: auth(p) });
const row = (id: string) =>
  one<{ state: string; decided_at: string | null; reminded_at: string | null; updated_by: string | null }>(
    "select state, decided_at::text, reminded_at::text, updated_by from ticket_handovers where id = $1",
    [id],
  );
const notes = async (memberId: string, kind: string) =>
  (
    await f.admin.query<{ payload: Record<string, unknown>; channel_id: string }>(
      "select payload, channel_id from notifications where member_id = $1 and event_kind_id = $2 and deleted_at is null order by created_at",
      [memberId, kind],
    )
  ).rows;
/** その人の、その種類のいちばん新しい知らせの行に、送れた／送れなかったの印があるか（K-401 の app.handover_mail_mark） */
const sentMark = async (memberId: string, kind: string) => {
  const r = await one<{ s: boolean; f: boolean }>(
    "select sent_at is not null as s, failed_at is not null as f from notifications where member_id = $1 and event_kind_id = $2 order by created_at desc limit 1",
    [memberId, kind],
  );
  return { sent: r.s, failed: r.f };
};
const audits = (ticketId: string, action: string) =>
  num("select count(*) as n from audit_events where target_id = $1 and action = $2", [ticketId, action]);
const scopeOf = async (name: string, prefix: string) =>
  (
    await one<{ id: string }>(
      "insert into scopes (tenant_id, parent_id, name, ticket_prefix) values ($1, $2, $3, $4) returning id",
      [T.tenantId, T.rootScope, name, prefix],
    )
  ).id;

/**
 * 受け箱（notifications）の書き込みを、その人・その種類の行だけ壊す（試験の中だけ・返す関数で外す）。
 * insert を壊すと DB に書く手順（S1・S4）が、update を壊すと送れた／送れなかったの印（S3・app.handover_mail_mark）が失敗する。
 * 壊すのはこの試験が作った人の行だけなので、ほかの試験には効かない（K407-API-009 と同じ壊し方）。
 */
async function breakNotes(memberId: string, when: "insert" | "update", kind: string): Promise<() => Promise<void>> {
  const fn = `k406_break_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const r = when === "insert" ? "new" : "old";
  await f.admin.query(
    `create function app.${fn}() returns trigger language plpgsql as $$ begin
       if ${r}.member_id = '${memberId}'::uuid and ${r}.event_kind_id = '${kind}' then raise exception 'K406 の試験で受け箱を壊した'; end if;
       return new; end $$`,
  );
  await f.admin.query(`create trigger ${fn} before ${when} on notifications for each row execute function app.${fn}()`);
  return async () => {
    await f.admin.query(`drop trigger if exists ${fn} on notifications`);
    await f.admin.query(`drop function if exists app.${fn}()`);
  };
}
const causeOfAudits = async (ticketId: string) =>
  (
    await f.admin.query<{ c: string | null }>(
      "select payload->>'cause' as c from audit_events where target_id = $1 and action = 'handover.withdraw' order by occurred_at",
      [ticketId],
    )
  ).rows.map((x) => x.c);
const completedAt = async (ticketId: string) =>
  (await one<{ c: string | null }>("select completed_at::text as c from tickets where id = $1", [ticketId])).c;

describe("K-406 取り消す（withdrawTicketHandover・本物の DB）", () => {
  it("K406-API-001 待っている渡し × 渡し中の帯の「取り消す」× 渡した人：201・渡しは withdrawn と決めた時刻・担当者は渡した人のまま・渡された人の受け箱に「取り消されました」が 1 行（メールは出さない・理由とお願いは入れない）・証跡 1", async () => {
    await ready();
    const from = await human("高本 001");
    const to = await human("佐藤 001");
    const t = await ticket({ assignee: from, title: "見積もりを山田様に送る" });
    const id = await handover(t, { from, to });
    const before = mails.length;
    const r = await withdraw(from, id);
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await json(r)).data).toMatchObject({ id, state: "withdrawn" });
    expect(await row(id)).toMatchObject({ state: "withdrawn", updated_by: from.id });
    expect((await row(id)).decided_at).not.toBeNull();
    expect((await one<{ a: string }>("select assignee_member_id as a from tickets where id = $1", [t.id])).a).toBe(
      from.id,
    );
    const n = await notes(to.id, "handover.withdrawn");
    expect(n).toHaveLength(1);
    expect(n[0]!.channel_id).toBe("inapp");
    expect(n[0]!.payload).toMatchObject({
      handover_id: id,
      ticket_id: t.id,
      number: t.number,
      title: "見積もりを山田様に送る",
      from_name: "高本 001",
    });
    expect(JSON.stringify(n[0]!.payload)).not.toContain(REASON);
    expect(JSON.stringify(n[0]!.payload)).not.toContain(ASK);
    expect(mails.length).toBe(before);
    expect(await audits(t.id, "handover.withdraw")).toBe(1);
  });

  it("K406-API-002 取り消した後 × 渡された人：承認待ちに並ばない（数 0）。同じチケットに新しい渡しを待たせられる（待っている渡しは 1 つの決まりから外れる・D-148.20）", async () => {
    await ready();
    const from = await human("高本 002");
    const to = await human("佐藤 002");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    expect((await withdraw(from, id)).status).toBe(201);
    const q = await json(await req("GET", "/approvals/queue", { headers: auth(to) }));
    expect((q.data as unknown as { id: string }[]).map((x) => x.id)).not.toContain(id);
    expect(await handover(t, { from, to: await human("鈴木 002") })).toBeTruthy();
  });

  it("K406-API-003 もう決まった渡し（受けた・断られた・取り消された）× 取り消す：409・E-HND-005（K-401）・渡しも受け箱も証跡も変わらない", async () => {
    await ready();
    const from = await human("高本 003");
    const to = await human("佐藤 003");
    for (const state of ["accepted", "declined", "withdrawn"] as const) {
      const t = await ticket({ assignee: from });
      const id = await handover(t, { from, to, state });
      const r = await withdraw(from, id);
      expect(r.status, state).toBe(409);
      expect((await json(r))["code"]).toBe("E-HND-005");
      expect((await row(id)).state).toBe(state);
      expect(await audits(t.id, "handover.withdraw")).toBe(0);
    }
    expect(await notes(to.id, "handover.withdrawn")).toHaveLength(0);
  });

  it("K406-API-004 渡した人でない × 取り消す：渡された人・同じ会社の別の人（チケットを見られる）は 403、別の会社の人と無い id は 404、uuid でない 422（欄 id）、ログインしていない 401。どれも渡しは待ったまま", async () => {
    await ready();
    const from = await human("高本 004");
    const to = await human("佐藤 004");
    const other = await human("別の人 004");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    expect((await withdraw(to, id)).status).toBe(403);
    expect((await withdraw(other, id)).status).toBe(403);
    expect((await withdraw(outsider, id)).status).toBe(404);
    expect((await withdraw(from, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const bad = await withdraw(from, "not-a-uuid");
    expect(bad.status).toBe(422);
    expect(((await json(bad))["details"] as { field: string }[]).map((x) => x.field)).toContain("id");
    expect((await req("POST", `/ticket_handovers/${id}/withdraw`, { body: {} })).status).toBe(401);
    expect((await row(id)).state).toBe("waiting");
  });

  it("K406-API-005 体に知らない欄 × 取り消す・催促する：422（体は空の形・strict）。渡しは待ったまま・受け箱もメールも無い", async () => {
    await ready();
    const from = await human("高本 005");
    const to = await human("佐藤 005");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    const before = mails.length;
    expect((await withdraw(from, id, { body: { reason: "やめた" } })).status).toBe(422);
    expect((await remind(from, id, { body: { message: "早く" } })).status).toBe(422);
    expect(await row(id)).toMatchObject({ state: "waiting", reminded_at: null });
    expect(mails.length).toBe(before);
    expect(await notes(to.id, "handover.reminded")).toHaveLength(0);
  });

  it("K406-API-006 申し出・グループに配る × 取り消す：申し出た人が取り下げると担当者の受け箱に 1 行、配った人がグループ宛てを取り消すと、そのグループで答える人（マネージャー）の受け箱に 1 行", async () => {
    await ready();
    const assignee = await human("担当者 006");
    const offerer = await human("申し出る人 006");
    const t1 = await ticket({ assignee });
    const offer = await handover(t1, { kind: "offer", from: offerer, to: assignee, replyDue: null });
    expect((await withdraw(offerer, offer)).status).toBe(201);
    expect(await notes(assignee.id, "handover.withdrawn")).toHaveLength(1);
    const jd = await scopeOf("受託開発 006", "JH");
    const jdMgr = await human("受託開発のマネージャー 006", { scope: jd });
    await f.admin.query(
      "insert into scope_memberships (tenant_id, scope_id, member_id, role) values ($1, $2, $3, 'manager')",
      [T.tenantId, jd, jdMgr.id],
    );
    const mgr = await human("配る人 006");
    const t2 = await ticket({ assignee: mgr });
    const group = await handover(t2, { kind: "distribute", from: mgr, to: null, toScope: jd, replyDue: null });
    expect((await withdraw(mgr, group)).status).toBe(201);
    expect(await notes(jdMgr.id, "handover.withdrawn")).toHaveLength(1);
    expect(await notes(mgr.id, "handover.withdrawn")).toHaveLength(0);
  });

  it("K406-API-007 同時に 2 回押す（二度押し・別のタブ）× 取り消す：1 つが 201・もう 1 つは 409 E-HND-005。受け箱の行も証跡も 1 つずつ", async () => {
    await ready();
    const from = await human("高本 007");
    const to = await human("佐藤 007");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    const rs = await Promise.all([withdraw(from, id), withdraw(from, id)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await notes(to.id, "handover.withdrawn")).toHaveLength(1);
    expect(await audits(t.id, "handover.withdraw")).toBe(1);
  });

  it("K406-API-008 渡し中に渡した人が完了にする（D-148.5・引き金 S4）：待っている渡しは自動で withdrawn と決めた時刻。前に断られた渡しは変えない。担当者は渡した人のまま。完了は会社の文脈の無い admin の update でも落ちず（引き金は NEW.tenant_id で見る）、証跡の actor_role は system", async () => {
    await ready();
    const from = await human("高本 008");
    const to = await human("佐藤 008");
    const done = await ticket({ assignee: from });
    const h1 = await handover(done, { from, to });
    const old = await handover(done, { from, to: await human("鈴木 008"), state: "declined" });
    await f.admin.query("update tickets set completed_at = now() where id = $1", [done.id]);
    expect((await row(h1)).state).toBe("withdrawn");
    expect((await row(h1)).decided_at).not.toBeNull();
    expect((await row(old)).state).toBe("declined");
    expect((await one<{ a: string }>("select assignee_member_id as a from tickets where id = $1", [done.id])).a).toBe(
      from.id,
    );
    const audit = await one<{ r: string; m: string | null }>(
      "select actor_role as r, actor_member_id::text as m from audit_events where target_id = $1 and action = 'handover.withdraw'",
      [done.id],
    );
    expect(audit).toEqual({ r: "system", m: null });
  });

  it("K406-API-009 守り（2 層目）× DB の関数を直に呼ぶ：渡された人の文脈で app.handover_withdraw を呼ぶと断る答え（403）で、渡しは待ったまま・受け箱は増えない", async () => {
    const from = await human("高本 009");
    const to = await human("佐藤 009");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    const v = await withTenant(
      f.pool,
      { tenantId: T.tenantId, userId: to.id, role: "member", stepUpAt: null },
      async (cl) =>
        (await cl.query<{ v: Record<string, unknown> }>("select app.handover_withdraw($1) as v", [id])).rows[0]!.v,
    );
    expect(v).toMatchObject({ ok: false, status: 403 });
    expect((await row(id)).state).toBe("waiting");
    expect(await notes(to.id, "handover.withdrawn")).toHaveLength(0);
  });
});

describe("K-406 完了・消すときの自動の取り消しと、失敗の道（本物の DB）", () => {
  it("K406-API-019 渡し中にチケットを消す（D-148.5・引き金 S4）：待っている渡しは自動で withdrawn と決めた時刻。もう取り消された渡しは変えない", async () => {
    await ready();
    const from = await human("高本 019");
    const to = await human("佐藤 019");
    const gone = await ticket({ assignee: from });
    const h = await handover(gone, { from, to });
    const old = await handover(gone, { from, to: await human("鈴木 019"), state: "withdrawn" });
    const oldAt = (await row(old)).decided_at;
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    expect((await row(h)).state).toBe("withdrawn");
    expect((await row(h)).decided_at).not.toBeNull();
    expect(await row(old)).toMatchObject({ state: "withdrawn", decided_at: oldAt });
  });

  it("K406-API-020 自動の取り消しの知らせ（D-148.19）：完了・消したとき、人宛ては渡された人に、グループ宛てはそのグループで答える人（マネージャー）に受け箱「取り消されました」が 1 行（cause が completed／deleted・理由とお願いは入れない）。メールは出さない・渡した人には 0・証跡 handover.withdraw に cause", async () => {
    await ready();
    const from = await human("高本 020");
    const to = await human("佐藤 020");
    const before = mails.length;
    const done = await ticket({ assignee: from });
    await handover(done, { from, to });
    await f.admin.query("update tickets set completed_at = now() where id = $1", [done.id]);
    const gone = await ticket({ assignee: from });
    await handover(gone, { from, to });
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    const n = await notes(to.id, "handover.withdrawn");
    expect(n.map((x) => x.payload["cause"])).toEqual(["completed", "deleted"]);
    expect(n.map((x) => x.channel_id)).toEqual(["inapp", "inapp"]);
    expect(n[0]!.payload).toMatchObject({ ticket_id: done.id, number: done.number, from_name: "高本 020" });
    expect(JSON.stringify(n)).not.toContain(REASON);
    expect(JSON.stringify(n)).not.toContain(ASK);
    expect(await causeOfAudits(done.id)).toEqual(["completed"]);
    expect(await causeOfAudits(gone.id)).toEqual(["deleted"]);
    const jd = await scopeOf("受託開発 020", "JL");
    const jdMgr = await human("受託開発のマネージャー 020", { scope: jd });
    await f.admin.query(
      "insert into scope_memberships (tenant_id, scope_id, member_id, role) values ($1, $2, $3, 'manager')",
      [T.tenantId, jd, jdMgr.id],
    );
    const g = await ticket({ assignee: from });
    await handover(g, { kind: "distribute", from, to: null, toScope: jd, replyDue: null });
    await f.admin.query("update tickets set completed_at = now() where id = $1", [g.id]);
    expect((await notes(jdMgr.id, "handover.withdrawn")).map((x) => x.payload["cause"])).toEqual(["completed"]);
    expect(await notes(from.id, "handover.withdrawn")).toHaveLength(0);
    expect(mails.length).toBe(before);
  });

  it("K406-API-021 手順 S1（DB に書く）の失敗：取り消す・催促するの途中で受け箱の行が書けないと 503・E-PAGE-003。取引ごと戻り、渡しは待ったまま・催促した時刻・受け箱・証跡・メールはどれも残らない", async () => {
    await ready();
    const from = await human("高本 021");
    const to = await human("佐藤 021");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    const before = mails.length;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fix = [
      await breakNotes(to.id, "insert", "handover.withdrawn"),
      await breakNotes(to.id, "insert", "handover.reminded"),
    ];
    try {
      for (const call of [() => withdraw(from, id), () => remind(from, id)]) {
        const r = await call();
        expect(r.status, await r.clone().text()).toBe(503);
        expect((await json(r))["code"]).toBe("E-PAGE-003");
      }
    } finally {
      err.mockRestore();
      for (const x of fix) await x();
    }
    expect(await row(id)).toMatchObject({ state: "waiting", decided_at: null, reminded_at: null });
    expect(await notes(to.id, "handover.withdrawn")).toHaveLength(0);
    expect(await notes(to.id, "handover.reminded")).toHaveLength(0);
    expect(await audits(t.id, "handover.withdraw")).toBe(0);
    expect(await audits(t.id, "handover.remind")).toBe(0);
    expect(mails.length).toBe(before);
  });

  it("K406-API-022 手順 S2（メールを送る）の後片付け＝手順 S3（送れなかった印を書く）の失敗：送れず、印も書けない（やり直しても落ちる）とき 201・meta.mail failed のまま。催促した時刻と受け箱の行は残り、印は sent_at も failed_at も空。ログに宛先と理由の字を出さない", async () => {
    await ready();
    const from = await human("高本 022");
    const to = await human("佐藤 022");
    const id = await handover(await ticket({ assignee: from }), { from, to });
    failMailTo.add(to.email);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fix = await breakNotes(to.id, "update", "handover.reminded");
    try {
      const r = await remind(from, id);
      expect(r.status, await r.clone().text()).toBe(201);
      expect((await json(r)).meta).toMatchObject({ mail: "failed" });
      const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(err.mock.calls.length).toBeGreaterThan(0);
      expect(logged).not.toContain(to.email);
      expect(logged).not.toContain(REASON);
    } finally {
      failMailTo.delete(to.email);
      err.mockRestore();
      await fix();
    }
    expect((await row(id)).reminded_at).not.toBeNull();
    expect(await notes(to.id, "handover.reminded")).toHaveLength(1);
    expect(await sentMark(to.id, "handover.reminded")).toEqual({ sent: false, failed: false });
  });

  it("K406-API-023 手順 S4（引き金の自動の取り消し）の失敗：取り消しの知らせが書けないと、完了にする書き込みごと戻る（完了の時刻は空・渡しは待ったまま・受け箱 0）。渡しが宙に浮かない", async () => {
    await ready();
    const from = await human("高本 023");
    const to = await human("佐藤 023");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    const fix = await breakNotes(to.id, "insert", "handover.withdrawn");
    try {
      await expect(f.admin.query("update tickets set completed_at = now() where id = $1", [t.id])).rejects.toThrow(
        /K406 の試験で受け箱を壊した/,
      );
    } finally {
      await fix();
    }
    expect(await completedAt(t.id)).toBeNull();
    expect((await row(id)).state).toBe("waiting");
    expect(await notes(to.id, "handover.withdrawn")).toHaveLength(0);
  });
});

describe("K-406 催促する（remindTicketHandover・本物の DB）", () => {
  it("K406-API-010 待っている渡し × 帯の「催促する」× 渡した人：201・催促した時刻・渡された人の受け箱に 1 行とメール 1 通（件名に番号、本文に題名・返事の期限・開くリンク。理由とお願いは書かない・D-148.19）・meta.mail sent・証跡 1", async () => {
    await ready();
    const from = await human("高本 010");
    const to = await human("佐藤 010");
    const t = await ticket({ assignee: from, title: "見積もりを山田様に送る" });
    const id = await handover(t, { from, to, replyDue: "2026-11-23T09:00:00.000Z" });
    const before = mails.length;
    const r = await remind(from, id);
    expect(r.status, await r.clone().text()).toBe(201);
    const j = await json(r);
    expect(j.data).toMatchObject({ id });
    expect(j.meta).toMatchObject({ mail: "sent" });
    expect((await row(id)).reminded_at).not.toBeNull();
    expect(await notes(to.id, "handover.reminded")).toHaveLength(1);
    expect(await sentMark(to.id, "handover.reminded")).toEqual({ sent: true, failed: false });
    expect(mails.length - before).toBe(1);
    const m = mails.at(-1)!;
    expect(m.to).toBe(to.email);
    expect(m.subject).toBe(`【Kaname】高本 010さんから引き継ぎの返事の催促が届きました（${t.number}）`);
    expect(m.text).toContain("見積もりを山田様に送る");
    expect(m.text).toContain("11月23日（月）18:00");
    expect(m.text).toContain(`${WEB}/tickets/${t.id}`);
    expect(m.subject + m.text).not.toContain(REASON);
    expect(m.subject + m.text).not.toContain(ASK);
    expect(await audits(t.id, "handover.remind")).toBe(1);
  });

  it("K406-API-011 同じ日（日本の日付）に 2 回目 × 催促する：409・E-HND-080（今日はもう催促しました）・受け箱もメールも増えない。前の催促が昨日なら 201（D-148.8 は 1 日 1 回）", async () => {
    await ready();
    const from = await human("高本 011");
    const to = await human("佐藤 011");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    expect((await remind(from, id)).status).toBe(201);
    const before = mails.length;
    const r = await remind(from, id);
    expect(r.status).toBe(409);
    expect((await json(r))["code"]).toBe("E-HND-080");
    expect(mails.length).toBe(before);
    expect(await notes(to.id, "handover.reminded")).toHaveLength(1);
    await f.admin.query("update ticket_handovers set reminded_at = reminded_at - interval '1 day' where id = $1", [id]);
    expect((await remind(from, id)).status).toBe(201);
    expect(await notes(to.id, "handover.reminded")).toHaveLength(2);
  });

  it("K406-API-012 返事の期限の前と後（G-12）× 催促する：期限の 1 分前でも、1 秒過ぎた後でも 201（期限の前でも押せる・D-148.8）", async () => {
    await ready();
    const from = await human("高本 012");
    const to = await human("佐藤 012");
    const early = await handover(await ticket({ assignee: from }), { from, to });
    await f.admin.query("update ticket_handovers set reply_due = now() + interval '1 minute' where id = $1", [early]);
    expect((await remind(from, early)).status).toBe(201);
    const late = await handover(await ticket({ assignee: from }), { from, to });
    await f.admin.query("update ticket_handovers set reply_due = now() - interval '1 second' where id = $1", [late]);
    expect((await remind(from, late)).status).toBe(201);
  });

  it("K406-API-013 もう決まった渡し・催促できない種類 × 催促する：決まった渡しは 409 E-HND-005、申し出とグループに配った渡しは 409 E-HND-081。どれも催促した時刻を書かず、受け箱もメールも無い", async () => {
    await ready();
    const from = await human("高本 013");
    const to = await human("佐藤 013");
    const before = mails.length;
    const decided = await handover(await ticket({ assignee: from }), { from, to, state: "declined" });
    const r1 = await remind(from, decided);
    expect(r1.status).toBe(409);
    expect((await json(r1))["code"]).toBe("E-HND-005");
    const offer = await handover(await ticket({ assignee: to }), { kind: "offer", from, to, replyDue: null });
    const r2 = await remind(from, offer);
    expect(r2.status).toBe(409);
    expect((await json(r2))["code"]).toBe("E-HND-081");
    const jd = await scopeOf("グループ 013", "JI");
    const group = await handover(await ticket({ assignee: from }), {
      kind: "distribute",
      from,
      to: null,
      toScope: jd,
      replyDue: null,
    });
    const r3 = await remind(from, group);
    expect(r3.status).toBe(409);
    expect((await json(r3))["code"]).toBe("E-HND-081");
    for (const id of [decided, offer, group]) expect((await row(id)).reminded_at).toBeNull();
    expect(mails.length).toBe(before);
  });

  it("K406-API-014 手順 S2（メールを送る）の失敗：メールが送れない・宛てが無い × 催促する：201・meta.mail failed・受け箱の行は残り（送れなかった印）、催促した時刻も書く（1 日 1 回に数える）。ログに宛先と理由の字を出さない", async () => {
    await ready();
    const from = await human("高本 014");
    const to = await human("佐藤 014");
    const t = await ticket({ assignee: from });
    const id = await handover(t, { from, to });
    failMailTo.add(to.email);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await remind(from, id);
      expect(r.status).toBe(201);
      expect((await json(r)).meta).toMatchObject({ mail: "failed" });
      const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toContain(to.email);
      expect(logged).not.toContain(REASON);
    } finally {
      failMailTo.delete(to.email);
      err.mockRestore();
    }
    expect(await notes(to.id, "handover.reminded")).toHaveLength(1);
    expect(await sentMark(to.id, "handover.reminded")).toEqual({ sent: false, failed: true });
    expect((await row(id)).reminded_at).not.toBeNull();
    const noMail = await f.person(T.tenantId, T.rootScope, { name: "メールの無い人 014", ticketAbility: "edit" });
    const id2 = await handover(await ticket({ assignee: from }), { from, to: noMail });
    const r2 = await remind(from, id2);
    expect(r2.status).toBe(201);
    expect((await json(r2)).meta).toMatchObject({ mail: "failed" });
    expect(await notes(noMail.id, "handover.reminded")).toHaveLength(1);
  });

  it("K406-API-015 同時に 2 回押す × 催促する：1 つが 201・もう 1 つは 409 E-HND-080。受け箱の行もメールも 1 つ", async () => {
    await ready();
    const from = await human("高本 015");
    const to = await human("佐藤 015");
    const id = await handover(await ticket({ assignee: from }), { from, to });
    const before = mails.length;
    const rs = await Promise.all([remind(from, id), remind(from, id)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await notes(to.id, "handover.reminded")).toHaveLength(1);
    expect(mails.length - before).toBe(1);
  });

  it("K406-API-016 渡した人でない × 催促する：渡された人・別の人は 403、別の会社の人は 404、ログインしていない 401。催促した時刻を書かない", async () => {
    await ready();
    const from = await human("高本 016");
    const to = await human("佐藤 016");
    const other = await human("別の人 016");
    const id = await handover(await ticket({ assignee: from }), { from, to });
    expect((await remind(to, id)).status).toBe(403);
    expect((await remind(other, id)).status).toBe(403);
    expect((await remind(outsider, id)).status).toBe(404);
    expect((await req("POST", `/ticket_handovers/${id}/remind`, { body: {} })).status).toBe(401);
    expect((await row(id)).reminded_at).toBeNull();
  });

  it("K406-API-017 守り × 取り消す・催促するを 1 分に 31 回：429・待つ秒数は 1〜60 の整数", async () => {
    await ready();
    const from = await human("上限 017");
    const to = await human("佐藤 017");
    const id = await handover(await ticket({ assignee: from }), { from, to, state: "declined" });
    for (const [op, call] of [
      ["withdrawTicketHandover", () => withdraw(from, id)],
      ["remindTicketHandover", () => remind(from, id)],
    ] as const) {
      limits[op] = 30;
      try {
        for (let i = 0; i < 30; i++) expect((await call()).status).toBe(409);
        const r = await call();
        expect(r.status, op).toBe(429);
        const sec = Number((await json(r))["retry_after_sec"]);
        expect(Number.isInteger(sec) && sec >= 1 && sec <= 60).toBe(true);
      } finally {
        limits[op] = 10_000;
      }
    }
  }, 60_000); // 何十回も続けて口を呼ぶ送りすぎの確かめ（重い台でも既定の 5 秒で切らない）

  it("K406-API-018 守り（2 層目）× DB の関数を直に呼ぶ：渡された人の文脈で app.handover_remind を呼ぶと断る答え（403）・催促した時刻も受け箱も無い。別の会社の文脈では見つからない（404）", async () => {
    const from = await human("高本 018");
    const to = await human("佐藤 018");
    const id = await handover(await ticket({ assignee: from }), { from, to });
    const call = (tenantId: string, userId: string) =>
      withTenant(
        f.pool,
        { tenantId, userId, role: "member", stepUpAt: null },
        async (cl) =>
          (await cl.query<{ v: Record<string, unknown> }>("select app.handover_remind($1) as v", [id])).rows[0]!.v,
      );
    expect(await call(T.tenantId, to.id)).toMatchObject({ ok: false, status: 403 });
    expect(await call(O.tenantId, outsider.id)).toMatchObject({ ok: false, status: 404 });
    expect((await row(id)).reminded_at).toBeNull();
    expect(await notes(to.id, "handover.reminded")).toHaveLength(0);
  });
});
