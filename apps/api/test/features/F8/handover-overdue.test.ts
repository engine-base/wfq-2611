// K-407「返事の期限が過ぎたら、渡した人が開いたときに 1 回知らせる」の単体の試験（口・本物の DB）。名前の頭の行 ID（K407-API-…）は 11_tickets/K-407.md の表に 1 対 1。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 「開いたとき」は承認待ちを読む口 listApprovalQueue（K-161）。チケットの一覧・詳細・承認待ちの画面が、どれも左のメニューの数のために最初に読む口（F4 の ticket-shell の readApprovals）。
//   土台は K-63 の approve-complete.harness.ts。承認待ちの口は、K-407 が直した hooks のファイル apps/api/src/hooks/approve-complete.ts の register を、
//   メールの送出（試験の偽）を持つ材料で作り直して差す（各 it の頭の ready()・切る段の smoke で準備ごと落とさない・answer=8f745003d023）。
//   渡しの行は DB に直に置く（渡す口 K-402 は通さない）。時刻は眠らずに reply_due を now() からずらして置く（D-128.130）。
//
// 試験が決める形（K-407.md の「実施事項」）:
//   読む前の片付けの 1 本の文の中で app.handover_overdue_sweep() が、呼んだ人が渡した人で、待っていて、返事の期限が過ぎ、まだ知らせていない渡しに
//   overdue_notified_at を入れ、渡した人の受け箱に handover.overdue を 1 行入れて、メールの宛てを返す。取引の後に K-401 の sendHandoverMails が送る（event overdue）。
//   片付けが失敗しても承認待ちは 200 で読める（何も書かない・ログに 1 行）。
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { HookDeps, HookModule } from "../../../src/hooks/registry.js";
import type { Person } from "../fixture.js";
import {
  setupApproveComplete,
  f,
  hooks,
  T,
  O,
  outsider,
  json,
  one,
  num,
  auth,
  req,
  ticket,
  type Ticket,
} from "../F5/approve-complete.harness.js";

setupApproveComplete();

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "hooks");
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
    const mod = (await import(join(HOOKS_DIR, "approve-complete.ts"))) as { register: HookModule };
    const d = {
      appPool: f.pool,
      mailer: async (m: SentMail) => {
        if (failMailTo.has(m.to)) throw new Error("送れなかった（試験）");
        mails.push({ to: m.to, subject: m.subject, text: m.text });
      },
      config: { env: "test", webBaseUrl: WEB, opsEmail: "ops@example.com" },
    } as unknown as HookDeps;
    Object.assign(hooks, mod.register.make(d));
  })();
  await loading;
};

type Human = Person & { email: string };
async function human(name: string, tenant = T.tenantId): Promise<Human> {
  const authUserId = randomUUID();
  const email = `k407-${authUserId.slice(0, 8)}@example.com`;
  await f.admin.query(
    'insert into kaname_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled") values ($1, $2, $3, true, now(), now(), false)',
    [authUserId, name, email],
  );
  const p = await f.person(tenant, tenant === T.tenantId ? T.rootScope : O.rootScope, {
    name,
    ticketAbility: "edit",
    authUserId,
  });
  await f.admin.query(
    "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status) values ($1, $2, $3, 'member', 'active')",
    [tenant, p.id, authUserId],
  );
  return { ...p, email };
}
const REASON = "来週から展示会の準備に入るため";
/** 渡しの行を DB に直に置く。due は返事の期限を今から何秒後にするか（負なら過ぎている） */
async function handover(
  t: Ticket,
  o: {
    kind?: "pass" | "offer" | "distribute";
    from: Person;
    to?: Person | null;
    toScope?: string | null;
    due: number | null;
    state?: string;
  },
): Promise<string> {
  const state = o.state ?? "waiting";
  return (
    await one<{ id: string }>(
      `insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_member_id, to_scope_id, reason, reply_due, state, decline_reason, decided_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, case when $8::int is null then null else now() + make_interval(secs => $8::int) end, $9,
               case when $9 = 'declined' then '手が空かない' end, case when $9 = 'waiting' then null else now() end, $4) returning id`,
      [
        t.tenant,
        t.id,
        o.kind ?? "pass",
        o.from.id,
        o.to === undefined ? null : (o.to?.id ?? null),
        o.toScope ?? null,
        REASON,
        o.due,
        state,
      ],
    )
  ).id;
}
const open = (p: Person) => req("GET", "/approvals/queue", { headers: auth(p) });
async function openOk(p: Person) {
  const r = await open(p);
  expect(r.status, await r.clone().text()).toBe(200);
  return json(r);
}
const overdueNotes = (memberId: string) =>
  f.admin
    .query<{ payload: Record<string, unknown>; sent: boolean; failed: boolean }>(
      "select payload, sent_at is not null as sent, failed_at is not null as failed from notifications where member_id = $1 and event_kind_id = 'handover.overdue' order by created_at",
      [memberId],
    )
    .then((r) => r.rows);
const notifiedAt = async (id: string) =>
  (await one<{ t: string | null }>("select overdue_notified_at::text as t from ticket_handovers where id = $1", [id]))
    .t;

describe("K-407 返事の期限が過ぎたら、渡した人が開いたときに 1 回知らせる（承認待ちを読む口・本物の DB）", () => {
  it("K407-API-001 期限が過ぎた待っている渡し × 渡した人が承認待ち（一覧・詳細の左のメニュー）を開く：200 のまま・渡した人の受け箱に「返事がまだありません」が 1 行（送れた印）・メール 1 通（件名は K-401 の overdue の文・本文に題名とリンク・理由は書かない）・知らせた時刻が入る", async () => {
    await ready();
    const from = await human("高本 001");
    const to = await human("佐藤 001");
    const t = await ticket({ assignee: from, title: "見積もりを山田様に送る" });
    const id = await handover(t, { from, to, due: -60 });
    const before = mails.length;
    const j = await openOk(from);
    expect(j.data).toEqual([]);
    const n = await overdueNotes(from.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ sent: true, failed: false });
    expect(n[0]!.payload).toMatchObject({
      handover_id: id,
      ticket_id: t.id,
      number: t.number,
      title: "見積もりを山田様に送る",
      to_name: "佐藤 001",
    });
    expect(JSON.stringify(n[0]!.payload)).not.toContain(REASON);
    expect(mails.length - before).toBe(1);
    const m = mails.at(-1)!;
    expect(m.to).toBe(from.email);
    expect(m.subject).toBe(`【Kaname】佐藤 001さんの引き継ぎの返事がまだありません（${t.number}）`);
    expect(m.text).toContain("見積もりを山田様に送る");
    expect(m.text).toContain(`${WEB}/tickets/${t.id}`);
    expect(m.subject + m.text).not.toContain(REASON);
    expect(await notifiedAt(id)).not.toBeNull();
  });

  it("K407-API-002 もう知らせた渡し × もう一度開く（1 回だけ・D-148.9）：受け箱もメールも増えない・知らせた時刻は最初のまま", async () => {
    await ready();
    const from = await human("高本 002");
    const to = await human("佐藤 002");
    const id = await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    await openOk(from);
    const first = await notifiedAt(id);
    const before = mails.length;
    await openOk(from);
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(1);
    expect(mails.length).toBe(before);
    expect(await notifiedAt(id)).toBe(first);
  });

  it("K407-API-003 期限の境目（G-12）× 開く：期限の 1 分前は何も出さない・期限を 1 秒過ぎた後に開くと 1 回出る", async () => {
    await ready();
    const from = await human("高本 003");
    const to = await human("佐藤 003");
    const id = await handover(await ticket({ assignee: from }), { from, to, due: 60 });
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(0);
    expect(await notifiedAt(id)).toBeNull();
    await f.admin.query("update ticket_handovers set reply_due = now() - interval '1 second' where id = $1", [id]);
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(1);
  });

  it("K407-API-004 もう決まった・消した × 期限が過ぎていても開く：受けた・断られた・取り消された渡し、消した渡し、消したチケットの渡しは知らせない", async () => {
    await ready();
    const from = await human("高本 004");
    const to = await human("佐藤 004");
    for (const state of ["accepted", "declined", "withdrawn"])
      await handover(await ticket({ assignee: from }), { from, to, due: -60, state });
    const del = await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    await f.admin.query("update ticket_handovers set deleted_at = now() where id = $1", [del]);
    const gone = await ticket({ assignee: from });
    await handover(gone, { from, to, due: -60 });
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [gone.id]);
    const before = mails.length;
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(0);
    expect(mails.length).toBe(before);
  });

  it("K407-API-005 渡した人でない人が開く：渡された人・同じ会社の別の人・別の会社の人が開いても、渡した人への知らせは出ない（知らせた時刻も空）。その後に渡した人が開くと 1 回出る", async () => {
    await ready();
    const from = await human("高本 005");
    const to = await human("佐藤 005");
    const other = await human("別の人 005");
    const id = await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    for (const p of [to, other, outsider]) await openOk(p);
    expect(await overdueNotes(from.id)).toHaveLength(0);
    expect(await overdueNotes(to.id)).toHaveLength(0);
    expect(await notifiedAt(id)).toBeNull();
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(1);
  });

  it("K407-API-006 期限が過ぎた渡しが 2 つ（別のチケット）× 開く：渡しごとに受け箱 1 行・メール 1 通（合わせて 2 つずつ）", async () => {
    await ready();
    const from = await human("高本 006");
    const a = await human("佐藤 006");
    const b = await human("鈴木 006");
    await handover(await ticket({ assignee: from }), { from, to: a, due: -120 });
    await handover(await ticket({ assignee: from }), { from, to: b, due: -60 });
    const before = mails.length;
    await openOk(from);
    const n = await overdueNotes(from.id);
    expect(n.map((x) => x.payload["to_name"]).sort()).toEqual(["佐藤 006", "鈴木 006"]);
    expect(mails.length - before).toBe(2);
  });

  it("K407-API-007 返事の期限が無い渡し（申し出・グループに配った）× 開く：期限切れにならず、知らせない", async () => {
    await ready();
    const from = await human("高本 007");
    const assignee = await human("担当者 007");
    await handover(await ticket({ assignee }), { kind: "offer", from, to: assignee, due: null });
    const jd = (
      await one<{ id: string }>(
        "insert into scopes (tenant_id, parent_id, name, ticket_prefix) values ($1, $2, 'グループ 007', 'JK') returning id",
        [T.tenantId, T.rootScope],
      )
    ).id;
    await handover(await ticket({ assignee: from }), { kind: "distribute", from, to: null, toScope: jd, due: null });
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(0);
  });

  it("K407-API-008 手順 S2（メールを送る）の失敗：メールが送れない × 開く：承認待ちは 200・受け箱の行は残る（送れなかった印）・知らせた時刻も入る。もう一度開いても送り直さない（1 回だけ）。ログに宛先と理由の字を出さない", async () => {
    await ready();
    const from = await human("高本 008");
    const to = await human("佐藤 008");
    const id = await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    failMailTo.add(from.email);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await openOk(from);
      const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toContain(from.email);
      expect(logged).not.toContain(REASON);
    } finally {
      failMailTo.delete(from.email);
      err.mockRestore();
    }
    expect(await overdueNotes(from.id)).toEqual([expect.objectContaining({ sent: false, failed: true })]);
    expect(await notifiedAt(id)).not.toBeNull();
    const before = mails.length;
    await openOk(from);
    expect(mails.length).toBe(before);
  });

  it("K407-API-009 手順 S1（DB に書く）の失敗：片付けが例外（受け箱の行を入れられない）× 開く：承認待ちは 200 で読めた行と数を返す・渡しの知らせた時刻は空のまま・受け箱もメールも無い・飛ばしたことをログに 1 行（次に開いたときにまた片付ける）", async () => {
    await ready();
    const from = await human("高本 009");
    const to = await human("佐藤 009");
    const id = await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    const fn = `k407_break_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await f.admin.query(
      `create function app.${fn}() returns trigger language plpgsql as $$ begin
         if new.event_kind_id = 'handover.overdue' then raise exception 'K407 の試験で受け箱を壊した'; end if; return new; end $$`,
    );
    await f.admin.query(
      `create trigger ${fn} before insert on notifications for each row execute function app.${fn}()`,
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = mails.length;
    try {
      const r = await open(from);
      expect(r.status, await r.clone().text()).toBe(200);
      expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("期限切れ");
    } finally {
      err.mockRestore();
      await f.admin.query(`drop trigger if exists ${fn} on notifications`);
      await f.admin.query(`drop function if exists app.${fn}()`);
    }
    expect(await notifiedAt(id)).toBeNull();
    expect(await overdueNotes(from.id)).toHaveLength(0);
    expect(mails.length).toBe(before);
    await openOk(from);
    expect(await overdueNotes(from.id)).toHaveLength(1);
  });

  it("K407-API-010 同時に 2 回開く（2 つのタブ・左のメニューと一覧）× 期限が過ぎた渡し：受け箱 1 行・メール 1 通だけ", async () => {
    await ready();
    const from = await human("高本 010");
    const to = await human("佐藤 010");
    await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    const before = mails.length;
    const rs = await Promise.all([open(from), open(from)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(await overdueNotes(from.id)).toHaveLength(1);
    expect(mails.length - before).toBe(1);
    expect(await num("select count(*) as n from notifications where member_id = $1", [to.id])).toBe(0);
  });
  it("K407-API-011 手順 S2（メールを送る）の後片付け＝手順 S3（送れなかった印を書く）の失敗：送れず、印も書けない（やり直しても落ちる）とき承認待ちは 200。知らせた時刻と受け箱の行は残り、印は sent_at も failed_at も空。もう一度開いても送り直さない・ログに宛先と理由の字を出さない", async () => {
    await ready();
    const from = await human("高本 011");
    const to = await human("佐藤 011");
    const id = await handover(await ticket({ assignee: from }), { from, to, due: -60 });
    const fn = `k407_mark_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await f.admin.query(
      `create function app.${fn}() returns trigger language plpgsql as $$ begin
         if old.member_id = '${from.id}'::uuid and old.event_kind_id = 'handover.overdue' then raise exception 'K407 の試験で印を壊した'; end if;
         return new; end $$`,
    );
    await f.admin.query(
      `create trigger ${fn} before update on notifications for each row execute function app.${fn}()`,
    );
    failMailTo.add(from.email);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await openOk(from);
      const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(err.mock.calls.length).toBeGreaterThan(0);
      expect(logged).not.toContain(from.email);
      expect(logged).not.toContain(REASON);
    } finally {
      failMailTo.delete(from.email);
      err.mockRestore();
      await f.admin.query(`drop trigger if exists ${fn} on notifications`);
      await f.admin.query(`drop function if exists app.${fn}()`);
    }
    expect(await notifiedAt(id)).not.toBeNull();
    expect(await overdueNotes(from.id)).toEqual([expect.objectContaining({ sent: false, failed: false })]);
    const before = mails.length;
    await openOk(from);
    expect(mails.length).toBe(before);
    expect(await overdueNotes(from.id)).toHaveLength(1);
  });
});
