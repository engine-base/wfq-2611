// K-408「引き継ぎを申し出る・申し出に答える」の単体の試験（口・本物の DB）。名前の頭の行 ID（K408-API-…）は 11_tickets/K-408.md の表に 1 対 1。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 口は K-401 が置いた渡す口・答える口（apps/api/src/hooks/handovers.ts の register）。この葉は種類 offer のファイル（create/offer.ts・answer/offer.ts）と
//   DB の関数（app.handover_offer・app.handover_answer_offer）を本物にする。振り分け・入力の確かめ・共通の確かめ（見える・できる種類・止まり・待っている渡し）は K-401 の物で、
//   ここでは申し出の振る舞い（作る・知らせる・渡す・断る・受けるときの止まり・同時・止まった人）だけを見る。
//   土台は K-63 の approve-complete.harness.ts（偽のログイン・書き換えられる hooks）。口の振る舞いは各 it の頭の ready() で読む（切る段の smoke で準備ごと落とさない）。
//   メールの送出（関門 C6）だけは試験の偽。宛ては認証の側の利用者（kaname_auth."user"）。
//
// 試験が決める口の形（K-401 の契約・K-408.md）:
//   createTicketHandover POST  /tickets/:id/handovers ← { kind: "offer", reason }（相手・期限は付けない）→ 201 { data: TicketHandoverCreated（16 の鍵） }
//   answerTicketHandover PATCH /ticket_handovers/:id  ← { decision: "accept" } | { decision: "decline", decline_reason } → 200 { data: TicketHandoverAnswered（16 の鍵） }
//   受け箱の行：handover.offered（担当者へ・受け箱＋メール event offered）・handover.accepted（申し出た人へ・受け箱だけ）・handover.declined（申し出た人へ・受け箱＋メール event declined）
//   断る：AI が動いている・承認を待っている 409 E-HND-003・待っている渡しがある 409 E-HND-004・もう決まっていた 409 E-HND-005・申し出た人が止まった 409 E-HND-006・抜けた（消した）404 E-HND-014（どれも K-401 の番号）
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
  delegated,
  type Ticket,
} from "../F5/approve-complete.harness.js";

setupApproveComplete();

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "hooks", "handovers.ts");
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
    expect(existsSync(HOOKS), "K-401 の hooks のファイル handovers.ts").toBe(true);
    const mod = (await import(HOOKS)) as { register: HookModule };
    const d = {
      appPool: f.pool,
      mailer: async (m: SentMail) => {
        if (failMailTo.has(m.to)) throw new Error("送れなかった（試験）");
        mails.push({ to: m.to, subject: m.subject, text: m.text });
      },
      config: { env: "test", webBaseUrl: WEB, opsEmail: "ops@example.com" },
    } as unknown as HookDeps;
    Object.assign(hooks, mod.register.make(d));
    limits["createTicketHandover"] = 10_000;
    limits["answerTicketHandover"] = 10_000;
  })();
  await loading;
};

type Human = Person & { email: string };
async function human(name: string, o: { tenant?: string } = {}): Promise<Human> {
  const tenant = o.tenant ?? T.tenantId;
  const authUserId = randomUUID();
  const email = `k408-${authUserId.slice(0, 8)}@example.com`;
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
const REASON = "手が空いたので、こちらで先方に返します";
const CREATED_KEYS = [
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
];
const offer = (p: Person, ticketId: string, o: { reason?: unknown; key?: string } = {}) =>
  req("POST", `/tickets/${ticketId}/handovers`, {
    body: { kind: "offer", reason: o.reason === undefined ? REASON : o.reason },
    headers: { ...auth(p), ...(o.key ? { "idempotency-key": o.key } : {}) },
  });
const give = (p: Person, id: string) =>
  req("PATCH", `/ticket_handovers/${id}`, { body: { decision: "accept" }, headers: auth(p) });
const decline = (p: Person, id: string, reason: string) =>
  req("PATCH", `/ticket_handovers/${id}`, { body: { decision: "decline", decline_reason: reason }, headers: auth(p) });
const handoversOf = (ticketId: string) =>
  f.admin
    .query<Record<string, unknown>>("select * from ticket_handovers where ticket_id = $1 order by created_at", [
      ticketId,
    ])
    .then((r) => r.rows);
const assigneeOf = async (ticketId: string) =>
  (await one<{ a: string }>("select assignee_member_id as a from tickets where id = $1", [ticketId])).a;
const notes = (memberId: string, kind: string) =>
  f.admin
    .query<{ payload: Record<string, unknown>; sent: boolean; failed: boolean }>(
      "select payload, sent_at is not null as sent, failed_at is not null as failed from notifications where member_id = $1 and event_kind_id = $2 order by created_at",
      [memberId, kind],
    )
    .then((r) => r.rows);
const audits = (ticketId: string, action: string) =>
  num("select count(*) as n from audit_events where target_id = $1 and action = $2", [ticketId, action]);
/** 手順の失敗を起こす一時の引き金（試験の会社の行だけ・試験の中だけ・finally で消す） */
async function breakOn(table: string, op: "insert" | "update", fn: () => Promise<void>): Promise<void> {
  const name = `k408_boom_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await f.admin.query(
    `create function app.${name}() returns trigger language plpgsql as $$ begin raise exception '試験で起こした DB の失敗' using errcode = 'XX000'; end $$`,
  );
  await f.admin.query(
    `create trigger ${name} before ${op} on "${table}" for each row when (new.tenant_id = '${T.tenantId}'::uuid) execute function app.${name}()`,
  );
  try {
    await fn();
  } finally {
    await f.admin.query(`drop trigger if exists ${name} on "${table}"`);
    await f.admin.query(`drop function if exists app.${name}()`);
  }
}
/** 口が出すログを集める（試験の中だけ） */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))),
  );
  try {
    await fn();
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return out.join("\n");
}
const noteRows = (memberId: string, kind: string) =>
  f.admin
    .query<{ sent_at: Date | null; failed_at: Date | null }>(
      "select sent_at, failed_at from notifications where member_id = $1 and event_kind_id = $2 order by created_at",
      [memberId, kind],
    )
    .then((r) => r.rows);

/** 申し出が待っている形を口で作る（担当者 a のチケットに b が申し出る） */
async function offered(
  a: Human,
  b: Human,
  title = "問い合わせ（山田様）に一次返信する",
): Promise<{ t: Ticket; id: string }> {
  const t = await ticket({ assignee: a, title });
  const r = await offer(b, t.id);
  expect(r.status, await r.clone().text()).toBe(201);
  return { t, id: String(((await json(r)).data as Record<string, unknown>)["id"]) };
}

describe("K-408 引き継ぎを申し出る（createTicketHandover の offer・本物の DB）", () => {
  it("K408-API-001 作業中のチケット × 題名の下の「引き継ぐ（申し出る）」× 同じグループの書ける人：201・鍵はちょうど 16・種類 offer・待っている・相手は今の担当者・期限なし・理由。担当者の受け箱に 1 行（送れた印・理由は入れない）とメール 1 通（K-401 の offered の件名）・証跡 1", async () => {
    await ready();
    const a = await human("高本 001");
    const b = await human("鈴木 001");
    const t = await ticket({ assignee: a, title: "問い合わせ（山田様）に一次返信する" });
    const before = mails.length;
    const r = await offer(b, t.id);
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await json(r)).data as Record<string, unknown>;
    expect(Object.keys(d).sort()).toEqual(CREATED_KEYS);
    expect(d).toMatchObject({
      ticket_id: t.id,
      kind: "offer",
      state: "waiting",
      from: { id: b.id, name: "鈴木 001" },
      to: { id: a.id, name: "高本 001" },
      to_scope: null,
      reason: REASON,
      ask: null,
      reply_due: null,
      notify_managers: false,
      decline_reason: null,
      decided_at: null,
    });
    const rows = await handoversOf(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "offer",
      state: "waiting",
      from_member_id: b.id,
      to_member_id: a.id,
      reply_due: null,
    });
    const n = await notes(a.id, "handover.offered");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ sent: true, failed: false });
    expect(JSON.stringify(n[0]!.payload)).not.toContain(REASON);
    expect(mails.length - before).toBe(1);
    const m = mails.at(-1)!;
    expect(m.to).toBe(a.email);
    expect(m.subject).toBe(`【Kaname】鈴木 001さんが引き継ぎを申し出ています（${t.number}）`);
    expect(m.text).toContain(`${WEB}/tickets/${t.id}`);
    expect(m.subject + m.text).not.toContain(REASON);
    expect(await audits(t.id, "handover.offer")).toBe(1);
  });

  it("K408-API-002 申し出た後 × 担当者：担当者は申し出た人に答えるまで今のまま（D-125.94 成立は相手の合意）", async () => {
    await ready();
    const a = await human("高本 002");
    const b = await human("鈴木 002");
    const { t } = await offered(a, b);
    expect(await assigneeOf(t.id)).toBe(a.id);
  });

  it("K408-API-003 同じチケットに 2 人が同時に申し出る（D-148.20 待っている渡しは 1 つ）：1 つが 201・もう 1 つは 409 E-HND-004。渡しの行は 1 つ・担当者の受け箱も 1 行", async () => {
    await ready();
    const a = await human("高本 003");
    const b = await human("鈴木 003");
    const c = await human("田中 003");
    const t = await ticket({ assignee: a });
    const rs = await Promise.all([offer(b, t.id), offer(c, t.id)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = rs.find((r) => r.status === 409)!;
    expect((await json(lost))["code"]).toBe("E-HND-004");
    expect(await handoversOf(t.id)).toHaveLength(1);
    expect(await notes(a.id, "handover.offered")).toHaveLength(1);
  });

  it("K408-API-004 同じ冪等キーで 2 回送る（二度押し・送り直し）× 申し出る：同じ 201 の答え・渡しの行もメールも 1 つ", async () => {
    await ready();
    const a = await human("高本 004");
    const b = await human("鈴木 004");
    const t = await ticket({ assignee: a });
    const key = randomUUID();
    const before = mails.length;
    const r1 = await offer(b, t.id, { key });
    const r2 = await offer(b, t.id, { key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(((await json(r2)).data as Record<string, unknown>)["id"]).toBe(
      ((await json(r1)).data as Record<string, unknown>)["id"],
    );
    expect(await handoversOf(t.id)).toHaveLength(1);
    expect(mails.length - before).toBe(1);
  });

  it("K408-API-005 手順 S2（メールを送る）の失敗：メールが送れない × 申し出る：201・渡しは待っている・担当者の受け箱の行は残る（送れなかった印）", async () => {
    await ready();
    const a = await human("高本 005");
    const b = await human("鈴木 005");
    const t = await ticket({ assignee: a });
    failMailTo.add(a.email);
    try {
      expect((await offer(b, t.id)).status).toBe(201);
    } finally {
      failMailTo.delete(a.email);
    }
    expect(await notes(a.id, "handover.offered")).toEqual([expect.objectContaining({ sent: false, failed: true })]);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
  });

  it("K408-API-006 守り（2 層目）× DB の関数を直に呼ぶ：担当者本人の文脈で app.handover_offer を呼ぶと断る答え（できる種類に offer が無い）で、渡しの行は作らない", async () => {
    const a = await human("高本 006");
    const t = await ticket({ assignee: a });
    const v = await withTenant(
      f.pool,
      { tenantId: T.tenantId, userId: a.id, role: "member", stepUpAt: null },
      async (cl) =>
        (
          await cl.query<{ v: Record<string, unknown> }>("select app.handover_offer($1, $2) as v", [
            t.id,
            JSON.stringify({ kind: "offer", reason: REASON }),
          ])
        ).rows[0]!.v,
    );
    expect(v["ok"]).not.toBe(true);
    expect(v["error"]).toBe("forbidden");
    expect(await handoversOf(t.id)).toHaveLength(0);
  });

  it("K408-API-015 手順 S1（DB に書く）の失敗：申し出るときに受け箱の行を入れる所で DB が落ちる：503・E-PAGE-003。取引ごと戻り、渡しの行・担当者の受け箱・証跡が残らず、メールも 0 通", async () => {
    await ready();
    const a = await human("高本 015");
    const b = await human("鈴木 015");
    const t = await ticket({ assignee: a });
    const before = mails.length;
    await breakOn("notifications", "insert", async () => {
      const r = await offer(b, t.id);
      expect(r.status).toBe(503);
      expect((await json(r))["code"]).toBe("E-PAGE-003");
    });
    expect(await handoversOf(t.id)).toHaveLength(0);
    expect(await notes(a.id, "handover.offered")).toHaveLength(0);
    expect(await audits(t.id, "handover.offer")).toBe(0);
    expect(mails.length).toBe(before);
    expect(await assigneeOf(t.id)).toBe(a.id);
  });

  it("K408-API-016 手順 S3（送れた印を書く）の失敗：メールは届いたが印を書けない（1 回やり直しても落ちる）：201 のまま・ログに「印を書けなかった」（宛てのメールの字は無い）・受け箱の行は sent_at も failed_at も空で残る", async () => {
    await ready();
    const a = await human("高本 016");
    const b = await human("鈴木 016");
    const t = await ticket({ assignee: a });
    const before = mails.length;
    let status = 0;
    const logs = await captureLogs(async () => {
      await breakOn("notifications", "update", async () => {
        status = (await offer(b, t.id)).status;
      });
    });
    expect(status).toBe(201);
    expect(mails.slice(before).filter((m) => m.to === a.email)).toHaveLength(1);
    expect(logs).toContain("印を書けなかった");
    expect(logs).not.toContain(a.email);
    expect(await noteRows(a.id, "handover.offered")).toEqual([{ sent_at: null, failed_at: null }]);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
  });

  it("K408-API-017 手順 S2（メールを送る）の失敗の後片付け（S3 で送れなかった印を書く）も失敗：201 のまま・メール 0 通・ログに「印を書けなかった」（宛てのメールの字は無い）・受け箱の行は sent_at も failed_at も空で残る", async () => {
    await ready();
    const a = await human("高本 017");
    const b = await human("鈴木 017");
    const t = await ticket({ assignee: a });
    const before = mails.length;
    let status = 0;
    failMailTo.add(a.email);
    try {
      const logs = await captureLogs(async () => {
        await breakOn("notifications", "update", async () => {
          status = (await offer(b, t.id)).status;
        });
      });
      expect(logs).toContain("印を書けなかった");
      expect(logs).not.toContain(a.email);
    } finally {
      failMailTo.delete(a.email);
    }
    expect(status).toBe(201);
    expect(mails.length).toBe(before);
    expect(await noteRows(a.id, "handover.offered")).toEqual([{ sent_at: null, failed_at: null }]);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
  });
});

describe("K-408 申し出に答える（answerTicketHandover の offer・本物の DB）", () => {
  it("K408-API-007 待っている申し出 × 承認待ちの行・詳細の帯の「渡す」× 担当者：200・受けた・決めた時刻・答えた人。担当者が申し出た人に替わる・申し出た人の受け箱に「引き継ぎました」1 行（メールは出さない）・一緒に切り替える物は K-404 の関数の答え・証跡 1", async () => {
    await ready();
    const a = await human("高本 007");
    const b = await human("鈴木 007");
    const { t, id } = await offered(a, b);
    const before = mails.length;
    const r = await give(a, id);
    expect(r.status, await r.clone().text()).toBe(200);
    const d = (await json(r)).data as Record<string, unknown>;
    expect(Object.keys(d).sort()).toEqual(CREATED_KEYS);
    expect(d).toMatchObject({ id, kind: "offer", state: "accepted", decline_reason: null });
    expect(d["decided_at"]).not.toBeNull();
    expect(typeof d["switch_applied"]).toBe("object");
    expect(await assigneeOf(t.id)).toBe(b.id);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "accepted", answered_by: a.id });
    const n = await notes(b.id, "handover.accepted");
    expect(n).toHaveLength(1);
    expect(n[0]!.payload).toMatchObject({ handover_id: id, ticket_id: t.id, number: t.number });
    expect(mails.length).toBe(before);
    expect(await audits(t.id, "handover.accept")).toBe(1);
  });

  it("K408-API-008 待っている申し出 × 「断る」と理由 × 担当者：200・断られた・断った理由が残る（D-125.90）・担当者はそのまま・申し出た人の受け箱に 1 行とメール 1 通（K-401 の declined の件名・理由は書かない）・証跡 1", async () => {
    await ready();
    const a = await human("高本 008");
    const b = await human("鈴木 008");
    const { t, id } = await offered(a, b);
    const before = mails.length;
    const r = await decline(a, id, "先方とは私が話を続けたい");
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await json(r)).data).toMatchObject({ id, state: "declined", decline_reason: "先方とは私が話を続けたい" });
    expect(await assigneeOf(t.id)).toBe(a.id);
    expect((await handoversOf(t.id))[0]).toMatchObject({
      state: "declined",
      answered_by: a.id,
      decline_reason: "先方とは私が話を続けたい",
    });
    expect(await notes(b.id, "handover.declined")).toHaveLength(1);
    expect(mails.length - before).toBe(1);
    const m = mails.at(-1)!;
    expect(m.to).toBe(b.email);
    expect(m.subject).toBe(`【Kaname】高本 008さんが引き継ぎを断りました（${t.number}）`);
    expect(m.subject + m.text).not.toContain("先方とは私が話を続けたい");
    expect(await audits(t.id, "handover.decline")).toBe(1);
  });

  it("K408-API-009 AI が動いている・承認を待っているチケット × 「渡す」（D-148.6）：409 E-HND-003（AI の実行（承認）が終わってから渡してください）・申し出は待ったまま・担当者は替わらない。断るはできる", async () => {
    await ready();
    const a = await human("高本 009");
    const b = await human("鈴木 009");
    const running = await offered(a, b, "AI が動いているチケット");
    await f.admin.query(
      "insert into action_runs (tenant_id, scope_id, ticket_id, phase, status_id, started_at, created_by) values ($1, $2, $3, 'make', 'running', now(), $4)",
      [running.t.tenant, running.t.scope, running.t.id, a.id],
    );
    const r1 = await give(a, running.id);
    expect(r1.status).toBe(409);
    expect((await json(r1))["code"]).toBe("E-HND-003");
    expect(await assigneeOf(running.t.id)).toBe(a.id);
    expect((await handoversOf(running.t.id))[0]).toMatchObject({ state: "waiting" });
    const c = await human("田中 009");
    const waitingApproval = await offered(a, c, "承認を待っているチケット");
    await delegated(waitingApproval.t);
    const r2 = await give(a, waitingApproval.id);
    expect(r2.status).toBe(409);
    expect((await json(r2))["code"]).toBe("E-HND-003");
    expect((await decline(a, waitingApproval.id, "AI の結果を見てから決める")).status).toBe(200);
  });

  it("K408-API-010 申し出た人が止まった・抜けた後 × 「渡す」（G-14）：止まった人は 409 E-HND-006（今は選べません）・抜けた（消した）人は 404 E-HND-014（見つかりません）。どちらも担当者は替わらない・申し出は待ったまま（断るか、申し出た人が取り下げる）", async () => {
    await ready();
    const a = await human("高本 010");
    const b = await human("鈴木 010");
    const { t, id } = await offered(a, b);
    await f.admin.query("update members set suspended_at = now(), suspended_by = id where id = $1", [b.id]);
    const r = await give(a, id);
    expect(r.status).toBe(409);
    expect((await json(r))["code"]).toBe("E-HND-006");
    expect(await assigneeOf(t.id)).toBe(a.id);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
    const c = await human("佐藤 010");
    const gone = await offered(a, c);
    await f.admin.query("update members set deleted_at = now() where id = $1", [c.id]);
    const r2 = await give(a, gone.id);
    expect(r2.status).toBe(404);
    expect((await json(r2))["code"]).toBe("E-HND-014");
    expect(await assigneeOf(gone.t.id)).toBe(a.id);
    expect((await handoversOf(gone.t.id))[0]).toMatchObject({ state: "waiting" });
  });

  it("K408-API-019 申し出た人の書く権限が外れた後 × 「渡す」（G-14・D-148.18）：409 E-HND-006（訳「申し出られなくなっています」）。担当者は替わらず・渡しは待ったまま・申し出た人の受け箱に結末が出ない。権限が戻れば渡せる", async () => {
    await ready();
    const a = await human("高本 019");
    const b = await human("鈴木 019");
    const { t, id } = await offered(a, b);
    await f.admin.query(
      "update permissions set ability_id = 'view' where grantee_member_id = $1 and target_kind_id = 'tickets'",
      [b.id],
    );
    const r = await give(a, id);
    expect(r.status, await r.clone().text()).toBe(409);
    const j = await json(r);
    expect(j["code"]).toBe("E-HND-006");
    expect((j["detail"] as Record<string, unknown>)["訳"]).toBe("申し出られなくなっています");
    expect(await assigneeOf(t.id)).toBe(a.id);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
    expect(await notes(b.id, "handover.accepted")).toHaveLength(0);
    await f.admin.query(
      "update permissions set ability_id = 'edit' where grantee_member_id = $1 and target_kind_id = 'tickets'",
      [b.id],
    );
    expect((await give(a, id)).status).toBe(200);
    expect(await assigneeOf(t.id)).toBe(b.id);
  });

  it("K408-API-020 担当者が止まった・招待中・抜けた人のチケットに申し出る（K-401 の共通の確かめ）：止まった・招待中は 409 E-HND-006・抜けた人は 404 E-HND-014。申し出の行も受け箱の行もメールも出ない", async () => {
    await ready();
    const b = await human("鈴木 020");
    const before = mails.length;
    const cases: [string, (m: Human) => Promise<unknown>, number, string][] = [
      [
        "止まった",
        (m) => f.admin.query("update members set suspended_at = now(), suspended_by = id where id = $1", [m.id]),
        409,
        "E-HND-006",
      ],
      [
        "招待中",
        (m) => f.admin.query("update tenant_memberships set status = 'invited' where member_id = $1", [m.id]),
        409,
        "E-HND-006",
      ],
      [
        "抜けた",
        (m) => f.admin.query("update tenant_memberships set status = 'left' where member_id = $1", [m.id]),
        404,
        "E-HND-014",
      ],
    ];
    for (const [name, apply, status, code] of cases) {
      const a = await human(`担当 020 ${name}`);
      const t = await ticket({ assignee: a });
      await apply(a);
      const r = await offer(b, t.id);
      expect(r.status, name).toBe(status);
      expect((await json(r))["code"], name).toBe(code);
      expect(await handoversOf(t.id), name).toHaveLength(0);
      expect(await notes(a.id, "handover.offered"), name).toHaveLength(0);
    }
    expect(mails.length).toBe(before);
  });

  it("K408-API-021 申し出が待っている間にチケットが消された × 渡す・断る：どちらも 404 E-PAGE-001（欄なし）。担当者は替わらず・渡しは待ったまま・申し出た人の受け箱とメールは増えない", async () => {
    await ready();
    const a = await human("高本 021");
    const b = await human("鈴木 021");
    const { t, id } = await offered(a, b);
    await f.admin.query("update tickets set deleted_at = now() where id = $1", [t.id]);
    const before = mails.length;
    for (const r of [await give(a, id), await decline(a, id, "消したので")]) {
      expect(r.status, await r.clone().text()).toBe(404);
      const j = await json(r);
      expect(j["code"]).toBe("E-PAGE-001");
      for (const key of ["field", "details", "detail"]) expect(j, `404 に ${key} を付けない`).not.toHaveProperty(key);
    }
    expect(await assigneeOf(t.id)).toBe(a.id);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
    expect(await notes(b.id, "handover.accepted")).toHaveLength(0);
    expect(await notes(b.id, "handover.declined")).toHaveLength(0);
    expect(mails.length).toBe(before);
  });

  it("K408-API-011 「渡す」と「断る」を同時に押す（2 つのタブ）：1 つが 200・もう 1 つは 409 E-HND-005。渡しの決まり方は 1 つ・申し出た人の受け箱の結末は 1 行", async () => {
    await ready();
    const a = await human("高本 011");
    const b = await human("鈴木 011");
    const { t, id } = await offered(a, b);
    const rs = await Promise.all([give(a, id), decline(a, id, "やはり自分でやる")]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await json(rs.find((r) => r.status === 409)!))["code"]).toBe("E-HND-005");
    const state = String((await handoversOf(t.id))[0]!["state"]);
    expect(["accepted", "declined"]).toContain(state);
    const ends = (await notes(b.id, "handover.accepted")).length + (await notes(b.id, "handover.declined")).length;
    expect(ends).toBe(1);
    expect(await assigneeOf(t.id)).toBe(state === "accepted" ? b.id : a.id);
  });

  it("K408-API-012 担当者でない人が答える：申し出た本人・同じ会社の別の人は 403、別の会社の人は 404。申し出は待ったまま", async () => {
    await ready();
    const a = await human("高本 012");
    const b = await human("鈴木 012");
    const other = await human("別の人 012");
    const { t, id } = await offered(a, b);
    expect((await give(b, id)).status).toBe(403);
    expect((await give(other, id)).status).toBe(403);
    expect((await give(outsider, id)).status).toBe(404);
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting" });
    expect(await assigneeOf(t.id)).toBe(a.id);
  });

  it("K408-API-013 守り（2 層目）× DB の関数を直に呼ぶ：申し出た本人の文脈で app.handover_answer_offer を呼ぶと断る答え（forbidden）・担当者は替わらない", async () => {
    await ready();
    const a = await human("高本 013");
    const b = await human("鈴木 013");
    const { t, id } = await offered(a, b);
    const v = await withTenant(
      f.pool,
      { tenantId: T.tenantId, userId: b.id, role: "member", stepUpAt: null },
      async (cl) =>
        (
          await cl.query<{ v: Record<string, unknown> }>("select app.handover_answer_offer($1, $2) as v", [
            id,
            JSON.stringify({ decision: "accept" }),
          ])
        ).rows[0]!.v,
    );
    expect(v["ok"]).not.toBe(true);
    expect(v["error"]).toBe("forbidden");
    expect(await assigneeOf(t.id)).toBe(a.id);
  });

  it("K408-API-014 渡した後 × 前の担当者と新しい担当者が詳細を開く：新しい担当者は書ける（担当者）・前の担当者も同じグループの書ける人として読める（見える範囲は変えない）", async () => {
    await ready();
    const a = await human("高本 014");
    const b = await human("鈴木 014");
    const { t, id } = await offered(a, b);
    expect((await give(a, id)).status).toBe(200);
    const asB = await req("GET", `/tickets/${t.id}`, { headers: auth(b) });
    expect(asB.status).toBe(200);
    const asA = await req("GET", `/tickets/${t.id}`, { headers: auth(a) });
    expect(asA.status).toBe(200);
    expect((await json(asB)).data).toMatchObject({ ticket: { id: t.id } });
  });

  it("K408-API-018 答える口に switch を送る（申し出の渡すは切り替えを受けない・K-403 と同じ）× 渡す・断る：どちらも 422・番号なし（VALIDATION_ERROR）・欄 switch（形の誤り・K-401 の決め）。申し出は待ったまま・担当者そのまま・申し出た人の受け箱は 0", async () => {
    await ready();
    const a = await human("高本 018");
    const b = await human("鈴木 018");
    const { t, id } = await offered(a, b);
    const bodies = [
      { decision: "accept", switch: { children: true } },
      { decision: "decline", decline_reason: "自分で続ける", switch: { children: false } },
    ];
    for (const body of bodies) {
      const r = await req("PATCH", `/ticket_handovers/${id}`, { body, headers: auth(a) });
      expect(r.status, JSON.stringify(body)).toBe(422);
      const e = (await json(r)) as unknown as { code?: string; field?: string; details?: { field: string }[] };
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(e.details?.map((x) => x.field) ?? [e.field]).toContain("switch");
    }
    expect((await handoversOf(t.id))[0]).toMatchObject({ state: "waiting", decided_at: null });
    expect(await assigneeOf(t.id)).toBe(a.id);
    expect(await notes(b.id, "handover.accepted")).toHaveLength(0);
    expect(await notes(b.id, "handover.declined")).toHaveLength(0);
  });
});
