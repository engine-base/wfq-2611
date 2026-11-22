// K-419「招く（口）：メンバーの並びを読む getWorkspaceMembers・メールで招く createInvitations」の口の試験（本物の DB・本物の行の守り・
//   口の入口は createApp と契約の op・偽の画面のログイン（:su= で本人確認の取り直しの時刻）・メールは試験の偽）。
//   行 ID（K419-API-…）は 11_tickets/K-419.md の表と 1 対 1。口の振る舞いは葉の hooks のファイル apps/api/src/hooks/workspace-invitations.ts の register（K-326）。
//   招待のリンク（createInvitationLink）は K-421（PM の決め 2026-11-20・apps/api/test/features/F10/invite-link.test.ts）。
//   入力の形（K-419 の契約・05_flow/screen_api.d/K-419.py）:
//     getWorkspaceMembers  GET  /workspace/members → 200 { data: { groups: [{ id, code, name, members: [{ id, name, email, role, group_role, primary, other_groups, self, suspended, pc, pc_days_away }] }],
//                                                               invitations: [{ id, email, scope_id, role, expires_at, left_days }], alerts: [], count } }
//     createInvitations    POST /invitations ← { emails: string[]（1〜50）, scope_id, role_key, message? } → 201 { data: { invitations: [{ id, email, expires_at, mail }] } }
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateAuth } from "@kaname/auth/migrate";
import { EMAIL_RE, normalizeEmail } from "@kaname/auth/signup";
import { createRepository } from "@kaname/db/repository";
import type { TenantContext } from "@kaname/db/context";
import { createDeviceResolver } from "@kaname/auth/resolver";
import { createApp } from "../../../src/app.js";
import { INVITE_EMAIL_MAX_LENGTH, INVITE_EMAIL_PATTERN } from "../../../src/features/F10/invite/patterns.js";
import { withDevice } from "../../../src/middleware/tenant.js";
import type { Hook } from "../../../src/contract/deps.js";
import type { HookDeps, HookModule } from "../../../src/hooks/registry.js";
import { makeFixture, nextIp, type Fixture, type Person } from "../fixture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");
const HOOK_FILE = join(HERE, "..", "..", "..", "src", "hooks", "workspace-invitations.ts");
const ERRORS = (
  JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
    errors: { id: string; message: string }[];
  }
).errors;
const msg = (code: string): string => ERRORS.find((e) => e.id === code)?.message ?? `（errors.json に ${code} が無い）`;
const WS = "株式会社K419";

let f: Fixture;
let app: ReturnType<typeof createApp>;
const hooks: Record<string, Hook> = {};
const limits: Record<string, number> = {};
const mails: { to: string; subject: string; text: string }[] = [];
const failMailTo = new Set<string>();
let loading: Promise<void> | null = null;
let T: { tenantId: string; rootScope: string };
let O: { tenantId: string; rootScope: string };
let JD: string;
type P = Person & { email: string };
let admin: P, mgr: P, member: P, viewer: P, inviter: P, kenmu: P, stopped: P, pcAway: P, outsider: P;

type J = Record<string, unknown> & {
  data?: Record<string, unknown>;
  details?: { field: string; message: string; email?: string; code?: string }[];
};
const json = async (r: Response) => (await r.clone().json()) as J;
const auth = (p: Person, su?: number) => ({
  authorization: `Bearer fake:member:${p.tenantId}:${p.id}${su === undefined ? "" : `:su=${su}`}`,
});
const req = (method: string, path: string, o: { body?: unknown; headers?: Record<string, string> } = {}) =>
  Promise.resolve(
    app.request(`http://localhost/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(o.headers ?? {}) },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    }),
  );
const ready = async () => {
  loading ??= (async () => {
    if (!existsSync(HOOK_FILE)) return;
    const d = {
      appPool: f.pool,
      repo: await createRepository(f.pool),
      mailer: async (m: { to: string; subject: string; text: string }) => {
        if (failMailTo.has(m.to)) throw new Error("送れなかった（試験）");
        mails.push(m);
      },
      config: { env: "test", webBaseUrl: "http://localhost:3000", opsEmail: "ops@example.com" },
    } as unknown as HookDeps;
    Object.assign(hooks, ((await import(HOOK_FILE)) as { register: HookModule }).register.make(d));
  })();
  await loading;
};
const list = (p: Person) => req("GET", "/workspace/members", { headers: auth(p) });
const invite = (p: Person, body: Record<string, unknown>, o: { su?: number; key?: string } = {}) =>
  req("POST", "/invitations", { body, headers: { ...auth(p, o.su), ...(o.key ? { "idempotency-key": o.key } : {}) } });
const base = (emails: string[], o: Record<string, unknown> = {}) => ({
  emails,
  scope_id: T.rootScope,
  role_key: "member",
  message: "営業の問い合わせをいっしょに回してもらいます",
  ...o,
});
const fresh = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@engine-base.example`;
const invRows = async (email: string) =>
  (
    await f.admin.query(
      "select * from invitations where tenant_id = $1 and lower(email) = lower($2) order by created_at",
      [T.tenantId, email],
    )
  ).rows;
const n = async (sql: string, p: unknown[] = []) => Number((await f.admin.query<{ n: string }>(sql, p)).rows[0]!.n);
async function failOn(table: string, cond: string, fn: () => Promise<void>): Promise<void> {
  const name = `k419_fail_${randomUUID().replaceAll("-", "")}`;
  await f.admin.query(
    `create function app.${name}() returns trigger language plpgsql as $$ begin if ${cond} then raise exception 'K419 試験の失敗'; end if; return new; end $$`,
  );
  await f.admin.query(`create trigger ${name} before insert on ${table} for each row execute function app.${name}()`);
  try {
    await fn();
  } finally {
    await f.admin.query(`drop trigger if exists ${name} on ${table}`);
    await f.admin.query(`drop function if exists app.${name}()`);
  }
}

beforeAll(async () => {
  f = await makeFixture();
  await migrateAuth(process.env["DATABASE_URL"]!);
  const web = async (hd: Headers) => {
    const m = /^Bearer fake:(member):([0-9a-f-]{36}):([0-9a-f-]{36})(?::su=(\d+))?$/.exec(
      hd.get("authorization") ?? "",
    );
    if (!m) return null;
    const ctx: TenantContext = {
      tenantId: m[2]!,
      userId: m[3]!,
      role: "member",
      stepUpAt: m[4] ? new Date(Number(m[4])) : null,
    };
    return { ctx, termsPending: false, sessionId: "", authUserId: "" };
  };
  Object.assign(hooks, f.hooks);
  app = createApp({
    version: "test",
    repo: await createRepository(f.pool),
    resolve: withDevice(web, createDeviceResolver(f.pool)) as never,
    contract: { hooks, limits },
  });
  for (const op of ["getWorkspaceMembers", "createInvitations"]) limits[op] = 10_000;
  T = await f.company(WS, "EG");
  O = await f.company("K419 の別の会社", "OT");
  await f.admin.query("update scopes set name = '営業' where id = $1", [T.rootScope]);
  JD = (
    await f.admin.query<{ id: string }>(
      "insert into scopes (tenant_id, parent_id, name, ticket_prefix) values ($1, $2, '受託開発', 'JD') returning id",
      [T.tenantId, T.rootScope],
    )
  ).rows[0]!.id;
  const make = async (
    key: string,
    name: string,
    o: { tenant?: string; scope?: string; role?: string; stopped?: boolean } = {},
  ): Promise<P> => {
    const tenant = o.tenant ?? T.tenantId;
    const authUserId = randomUUID();
    const email = `${key}-${authUserId.slice(0, 8)}@engine-base.example`;
    await f.admin.query(
      'insert into kaname_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled") values ($1, $2, $3, true, now(), now(), false)',
      [authUserId, name, email],
    );
    const p = await f.person(tenant, o.scope ?? (tenant === T.tenantId ? T.rootScope : O.rootScope), {
      name,
      authUserId,
    });
    await f.admin.query(
      "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status) values ($1, $2, $3, $4, $5)",
      [tenant, p.id, authUserId, o.role ?? "member", o.stopped ? "suspended" : "active"],
    );
    // members_suspended_ck（0078）：止めた時刻と止めた人は両方そろえる（止めたのは会社の管理者・止めた人は管理者の後に作る）
    if (o.stopped)
      await f.admin.query("update members set suspended_at = now(), suspended_by = $2 where id = $1", [p.id, admin.id]);
    return { ...p, email };
  };
  admin = await make("takamoto", "高本 聖斗", { role: "admin" });
  mgr = await make("sato", "佐藤 花子", { role: "manager" });
  member = await make("suzuki", "鈴木 一郎");
  viewer = await make("yamaguchi", "山口 健", { scope: JD, role: "viewer" });
  inviter = await make("inviter", "招く権限の人");
  await f.admin.query(
    "insert into permissions (tenant_id, grantee_member_id, target_kind_id, scope_id, ability_id) values ($1, $2, 'members', null, 'invite')",
    [T.tenantId, inviter.id],
  );
  kenmu = await make("tanaka", "田中 美咲");
  await f.admin.query(
    "insert into scope_memberships (tenant_id, scope_id, member_id, role) values ($1, $2, $3, 'member')",
    [T.tenantId, JD, kenmu.id],
  );
  stopped = await make("stopped", "止めた人", { stopped: true });
  pcAway = await make("away", "PC の人");
  outsider = await make("outsider", "別の会社の人", { tenant: O.tenantId });
  // PC：田中は 3 日前、高本は今（sessions の bridge の行）
  for (const [p, days] of [
    [kenmu, 3],
    [admin, 0],
  ] as const)
    await f.admin.query(
      "insert into sessions (tenant_id, member_id, kind_id, device_label, last_seen_at) values ($1, $2, 'bridge', 'PC', now() - make_interval(days => $3))",
      [T.tenantId, p.id, days],
    );
}, 120_000);
afterAll(async () => {
  await f?.close();
});

describe("K-419 メンバーの並びを読む（getWorkspaceMembers）", () => {
  it("K419-API-001 管理者が読む：200・グループは営業と受託開発・人ごとに名前とメールと役割・兼ねる人は両方のグループに出る・自分の行は self・count は人と招待中の数", async () => {
    await ready();
    const r = await list(admin);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    const d = (await json(r)).data as {
      groups: { id: string; name: string; members: Record<string, unknown>[] }[];
      invitations: unknown[];
      count: number;
    };
    expect(d.groups.map((g) => g.name)).toEqual(["営業", "受託開発"]);
    const sales = d.groups[0]!.members;
    const me = sales.find((m) => m["id"] === admin.id)!;
    expect(me).toMatchObject({ name: "高本 聖斗", email: admin.email, role: "admin", self: true });
    expect(sales.find((m) => m["id"] === member.id)).toMatchObject({ role: "member", self: false });
    expect(d.groups[1]!.members.map((m) => m["id"])).toEqual(expect.arrayContaining([kenmu.id, viewer.id]));
    // 兼ねる人：主のグループの行は primary true と兼ねるグループの名前・兼ねる側の行は primary false（画面の「受託開発も兼ねる」「兼ねている」）
    expect(sales.find((m) => m["id"] === kenmu.id)).toMatchObject({ primary: true, other_groups: ["受託開発"] });
    expect(d.groups[1]!.members.find((m) => m["id"] === kenmu.id)).toMatchObject({ primary: false });
    expect(me).toMatchObject({ primary: true, other_groups: [] });
    expect(sales.map((m) => m["id"])).not.toContain(outsider.id);
    const people = new Set(d.groups.flatMap((g) => g.members.map((m) => m["id"])));
    expect(d.count).toBe(people.size + d.invitations.length);
  });

  it("K419-API-002 招待中の行：期限の内・取り消していない・使われていない招待だけ。left_days は残りの日数（切り上げ）", async () => {
    await ready();
    const mk = async (email: string, o: { expires: string; revoked?: boolean; used?: boolean }) =>
      f.admin.query(
        `insert into invitations (tenant_id, email, scope_id, role_id, token_hash, expires_at, created_by, revoked_at, accepted_member_id)
         values ($1, $2, $3, 'member', $4, now() + ($5::text)::interval, $6, $7, $8)`,
        [
          T.tenantId,
          email,
          T.rootScope,
          createHash("sha256").update(randomUUID()).digest("hex"),
          o.expires,
          admin.id,
          o.revoked ? new Date() : null,
          o.used ? member.id : null,
        ],
      );
    const live = fresh("live");
    await mk(live, { expires: "6 days 2 hours" });
    await mk(fresh("expired"), { expires: "-1 minute" });
    await mk(fresh("revoked"), { expires: "3 days", revoked: true });
    await mk(fresh("used"), { expires: "3 days", used: true });
    const d = (await json(await list(admin))).data as { invitations: Record<string, unknown>[] };
    const mine = d.invitations.filter(
      (i) =>
        String(i["email"]).includes("@engine-base.example") && /^(live|expired|revoked|used)-/.test(String(i["email"])),
    );
    expect(mine.map((i) => i["email"])).toEqual([live]);
    expect(mine[0]).toMatchObject({ role: "member", scope_id: T.rootScope, left_days: 7 });
  });

  it("K419-API-003 PC の様子：今日つながった人 ok・3 日前の人 away（3）・つないでいない人 never・閲覧のみ none", async () => {
    await ready();
    const d = (await json(await list(admin))).data as { groups: { members: Record<string, unknown>[] }[] };
    const all = d.groups.flatMap((g) => g.members);
    const of = (id: string) => all.find((m) => m["id"] === id)!;
    expect(of(admin.id)).toMatchObject({ pc: "ok" });
    expect(of(kenmu.id)).toMatchObject({ pc: "away", pc_days_away: 3 });
    expect(of(pcAway.id)).toMatchObject({ pc: "never", pc_days_away: null });
    expect(of(viewer.id)).toMatchObject({ pc: "none" });
  });

  it("K419-API-004 止めた人は suspended で出る・外した人（status left・消した）は出ない", async () => {
    await ready();
    const left = await f.person(T.tenantId, T.rootScope, { name: "外した人" });
    await f.admin.query(
      "insert into tenant_memberships (tenant_id, member_id, role, status) values ($1, $2, 'member', 'left')",
      [T.tenantId, left.id],
    );
    const d = (await json(await list(admin))).data as { groups: { members: Record<string, unknown>[] }[] };
    const all = d.groups.flatMap((g) => g.members);
    expect(all.find((m) => m["id"] === stopped.id)).toMatchObject({ suspended: true });
    expect(all.map((m) => m["id"])).not.toContain(left.id);
  });

  it("K419-API-005 普通のメンバー・閲覧のみの人：403・並びを返さない。ログインしていない：401", async () => {
    await ready();
    for (const p of [member, viewer]) {
      const r = await list(p);
      expect(r.status).toBe(403);
      expect((await json(r)).data).toBeUndefined();
    }
    expect((await req("GET", "/workspace/members")).status).toBe(401);
  });

  it("K419-API-006 別の会社の管理者の並びに、この会社の人と招待は 1 つも出ない", async () => {
    await ready();
    const oAdminAuth = randomUUID();
    await f.admin.query(
      'insert into kaname_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled") values ($1, $2, $3, true, now(), now(), false)',
      [oAdminAuth, "別の会社の管理者", `oadmin-${oAdminAuth.slice(0, 8)}@example.com`],
    );
    const oAdmin = await f.person(O.tenantId, O.rootScope, { name: "別の会社の管理者", authUserId: oAdminAuth });
    await f.admin.query(
      "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status) values ($1, $2, $3, 'admin', 'active')",
      [O.tenantId, oAdmin.id, oAdminAuth],
    );
    const d = (await json(await list(oAdmin))).data as {
      groups: { members: Record<string, unknown>[] }[];
      invitations: Record<string, unknown>[];
    };
    const ids = d.groups.flatMap((g) => g.members.map((m) => m["id"]));
    for (const p of [admin, mgr, member, kenmu]) expect(ids).not.toContain(p.id);
    expect(d.invitations.every((i) => !String(i["email"]).endsWith("@engine-base.example"))).toBe(true);
  });
});

describe("K-419 メールで招く（createInvitations）", () => {
  it("K419-API-007 管理者が 1 人を招く：201・招待の行（宛て・グループ・役割・ひとこと・期限 7 日・token_hash は 64 けた）・メール 1 通（件名に会社名・本文に招待のリンクとひとことと期限）・証跡 1", async () => {
    await ready();
    const e = fresh("kimura");
    const before = mails.length;
    const r = await invite(admin, base([e]));
    expect(r.status, await r.clone().text()).toBe(201);
    const out = ((await json(r)).data as { invitations: Record<string, unknown>[] }).invitations;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ email: e, mail: "sent" });
    const rows = await invRows(e);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope_id: T.rootScope,
      role_id: "member",
      message: "営業の問い合わせをいっしょに回してもらいます",
      created_by: admin.id,
      revoked_at: null,
      accepted_member_id: null,
    });
    expect(String(rows[0]!["token_hash"])).toMatch(/^[0-9a-f]{64}$/);
    const days = (new Date(rows[0]!["expires_at"] as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    const m = mails.slice(before).filter((x) => x.to === e);
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toContain(WS);
    const link = /http:\/\/localhost:3000\/invite\/([A-Za-z0-9_-]{20,})/.exec(m[0]!.text);
    expect(link, "本文に招待のリンク").not.toBeNull();
    expect(createHash("sha256").update(link![1]!).digest("hex")).toBe(rows[0]!["token_hash"]);
    expect(m[0]!.text).toContain("営業の問い合わせをいっしょに回してもらいます");
    expect(
      await n(
        "select count(*) as n from audit_events where tenant_id = $1 and action = 'invitation.created' and target_id = $2",
        [T.tenantId, String(rows[0]!["id"])],
      ),
    ).toBe(1);
  });

  it("K419-API-008 3 人を一度に招く：201・答え 3 件・招待の行 3 つ・メール 3 通（宛てごとに別のリンク）", async () => {
    await ready();
    const es = [fresh("a"), fresh("b"), fresh("c")];
    const before = mails.length;
    const r = await invite(admin, base(es));
    expect(r.status).toBe(201);
    expect(((await json(r)).data as { invitations: unknown[] }).invitations).toHaveLength(3);
    for (const e of es) expect(await invRows(e)).toHaveLength(1);
    const sent = mails.slice(before).filter((m) => es.includes(m.to));
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((m) => /\/invite\/([A-Za-z0-9_-]+)/.exec(m.text)?.[1])).size).toBe(3);
  });

  it("K419-API-009 表記ゆらぎ：全角・大文字・前後の空白は小文字の半角にそろう。そろえて同じになる宛ては 1 つにまとめる", async () => {
    await ready();
    const id = randomUUID().slice(0, 6);
    const plain = `nakamura${id}@engine-base.example`;
    const wide = [...plain].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join("");
    const r = await invite(admin, base([`\u3000NAKAMURA${id.toUpperCase()}@Engine-Base.Example `, wide, plain]));
    expect(r.status).toBe(201);
    const out = ((await json(r)).data as { invitations: Record<string, unknown>[] }).invitations;
    expect(out.map((x) => x["email"])).toEqual([plain]);
    expect(await invRows(plain)).toHaveLength(1);
  });

  it("K419-API-010 メールの形でない字（ドメインが不完全・@ で始まる・@ が 2 つ）。details の字はそろえた後の字（途中の空白はそろえるときに消える・登録と同じ normalizeEmail）：422・E-INV-009・details に字ごと・正しい宛てが混じっていても招待 0・メール 0", async () => {
    await ready();
    const ok = fresh("ok");
    const before = mails.length;
    const r = await invite(admin, base([ok, "kimura@engine-base", "@example.com", "kimura@@example.com"]));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-INV-009");
    const bad = (j.details ?? []).filter((d) => d.code === "E-INV-009").map((d) => d.email);
    expect(bad).toEqual(["kimura@engine-base", "@example.com", "kimura@@example.com"]);
    expect((j.details ?? []).every((d) => d.field === "emails" && d.message === msg("E-INV-009"))).toBe(true);
    expect(await invRows(ok)).toHaveLength(0);
    expect(mails.length).toBe(before);
  });

  it("K419-API-011 もうこのワークスペースに入っている人（大文字で入れても）：409・E-INV-010・招待 0・メール 0", async () => {
    await ready();
    const before = mails.length;
    const r = await invite(admin, base([member.email.toUpperCase()]));
    expect(r.status).toBe(409);
    const j = await json(r);
    expect(j["code"]).toBe("E-INV-010");
    // 控え帳 20:50 の形（PM の決め 2026-11-21 03:00）：409 は field・details を付けず、入っている宛ては detail（単数）で返す
    expect(j["detail"]).toEqual({ already: [member.email] });
    expect(j.details).toBeUndefined();
    expect(j["field"]).toBeUndefined();
    expect(await invRows(member.email)).toHaveLength(0);
    expect(mails.length).toBe(before);
  });

  it("K419-API-012 形の違う字と入っている人が混じる：形の誤りが先に 422・details は E-INV-009 だけ（入っている人は 409 の話で、形を直した次の回に出す）・招待 0", async () => {
    await ready();
    const before = mails.length;
    const r = await invite(admin, base(["kimura@engine-base", member.email]));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-INV-009");
    expect((j.details ?? []).map((d) => [d.email, d.code])).toEqual([["kimura@engine-base", "E-INV-009"]]);
    expect(await invRows(member.email)).toHaveLength(0);
    expect(mails.length).toBe(before);
  });

  it("K419-API-013 招待中の人に重ねて招く：201・前の招待は取り消し（revoked_at）・新しい招待 1 つ・メール 1 通（代表に聞くこと 3 の勧め）", async () => {
    await ready();
    const e = fresh("again");
    expect((await invite(admin, base([e]))).status).toBe(201);
    const first = (await invRows(e))[0]!;
    const before = mails.length;
    expect((await invite(admin, base([e]))).status).toBe(201);
    const rows = await invRows(e);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x["id"] === first["id"])!["revoked_at"]).not.toBeNull();
    expect(rows.filter((x) => x["revoked_at"] === null)).toHaveLength(1);
    expect(mails.slice(before).filter((m) => m.to === e)).toHaveLength(1);
  });

  it("K419-API-014 グループが別の会社の物・在らない id・消した：404・E-INV-011・招待 0", async () => {
    await ready();
    const gone = (
      await f.admin.query<{ id: string }>(
        "insert into scopes (tenant_id, parent_id, name, ticket_prefix, deleted_at) values ($1, $2, '消した', 'XX', now()) returning id",
        [T.tenantId, T.rootScope],
      )
    ).rows[0]!.id;
    for (const s of [O.rootScope, randomUUID(), gone]) {
      const e = fresh("scope");
      const r = await invite(admin, base([e], { scope_id: s }));
      expect(r.status, s).toBe(404);
      const j = await json(r);
      expect(j["code"]).toBe("E-INV-011");
      // 無いグループと見えないグループは同じ答え：field・details を付けない（PM の決め 2026-11-21 03:00）
      expect(j.details).toBeUndefined();
      expect(j["field"]).toBeUndefined();
      expect(j["detail"]).toEqual({});
      expect(await invRows(e)).toHaveLength(0);
    }
  });

  it("K419-API-015 一度に 51 人：422・E-INV-012・招待 0。50 人ちょうどは 201", async () => {
    await ready();
    const many = Array.from({ length: 51 }, (_, i) => fresh(`m${i}`));
    const r = await invite(admin, base(many));
    expect(r.status).toBe(422);
    expect((await json(r))["code"]).toBe("E-INV-012");
    expect(await n("select count(*) as n from invitations where email = any($1)", [many])).toBe(0);
    expect((await invite(admin, base(many.slice(0, 50)))).status).toBe(201);
  });

  it("K419-API-024 口が打ったとおりに照らす宛ての pattern（patterns.ts の INVITE_EMAIL_PATTERN）と人数（INVITE_MAX）は、契約（08_api/openapi.yaml の InvitationsCreateInput の emails）の items の pattern・maxLength（320）・maxItems・minItems と 1 字も違わない", () => {
    const py =
      "import yaml,json,sys;d=yaml.safe_load(open(sys.argv[1]));" +
      "e=d['components']['schemas']['InvitationsCreateInput']['properties']['emails'];" +
      "print(json.dumps({'pattern':e['items']['pattern'],'max':e['maxItems'],'min':e['minItems'],'len':e['items']['maxLength']}))";
    const yamlPath = join(ROOT, "08_api/openapi.yaml");
    const got = JSON.parse(execFileSync("python3", ["-c", py, yamlPath], { encoding: "utf8" })) as {
      pattern: string;
      max: number;
      min: number;
      len: number;
    };
    expect(got.pattern).toBe(INVITE_EMAIL_PATTERN);
    expect(got.len).toBe(INVITE_EMAIL_MAX_LENGTH);
    expect(INVITE_EMAIL_MAX_LENGTH).toBe(320);
    expect(got.max).toBe(50);
    expect(got.min).toBe(1);
  });

  it("K419-API-025 人数は送られた並びの数（重なりを落とす前）で数える：同じ宛てを重ねた 51 個（そろえると 2 つ）は 422・E-INV-012・招待 0。重ねて 50 個（そろえると 25 人）は 201・25 人", async () => {
    await ready();
    const two = [fresh("dup-a"), fresh("dup-b")];
    const over = Array.from({ length: 51 }, (_, i) => two[i % 2]!);
    const r = await invite(admin, base(over));
    expect(r.status).toBe(422);
    expect((await json(r))["code"]).toBe("E-INV-012");
    expect(await n("select count(*) as n from invitations where email = any($1)", [two])).toBe(0);
    const uniq = Array.from({ length: 25 }, (_, i) => fresh(`dd${i}`));
    const ok = await invite(admin, base([...uniq, ...uniq]));
    expect(ok.status).toBe(201);
    expect(((await json(ok)).data as { invitations: unknown[] }).invitations).toHaveLength(25);
  });

  it("K419-API-026 宛ては、そろえる前の字を契約の pattern で照らす：@ が全角で 2 つ・ドメインに点が無い・@ が無い字は 422・E-INV-009（details の字はそろえた後の字）・招待 0・メール 0。中に空白（半角・全角）・前後の全角の空白・全角の @ と点・小さい @ と点は、そろえて 201（前の口と同じ・PM の決め 2026-11-21 02:45）", async () => {
    await ready();
    const before = mails.length;
    const id = randomUUID().slice(0, 6);
    const r = await invite(
      admin,
      base([`kimura${id}＠＠engine-base.example`, `kimura${id}@engine-base`, `kimura${id}engine-base.example`]),
    );
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-INV-009");
    expect((j.details ?? []).map((d) => [d.email, d.code])).toEqual([
      [`kimura${id}@@engine-base.example`, "E-INV-009"],
      [`kimura${id}@engine-base`, "E-INV-009"],
      [`kimura${id}engine-base.example`, "E-INV-009"],
    ]);
    expect(mails.length).toBe(before);
    const e = (tag: string) => `${tag}${id}@engine-base.example`;
    const forms: [string, string][] = [
      [e("sp"), `sp ${id}@engine-base.example`.replace("sp ", "s p")],
      [e("fw"), `\u3000${e("fw").replace("@", "＠").replace(".", "．")}\u3000`],
      [e("mid"), `mi\u3000d${id} @ engine-base . example`],
      [e("sm"), `${e("sm").replace("@", "﹫").replace(".", "․")}`],
    ];
    for (const [want, typed] of forms) {
      const ok = await invite(admin, base([typed]));
      expect(ok.status, typed).toBe(201);
      expect(await invRows(want.replace(/\s/g, ""))).toHaveLength(1);
    }
  });

  it("K419-API-027 前の口（normalizeEmail でそろえてから EMAIL_RE で見る）が受けていた形は今も受け、断っていた形は今も断る：全 BMP の 1 字を宛ての 7 か所に入れて、前の判定と契約の pattern の判定が同じ。例外は NFKC で 2 字以上に開いて点か @ を含む 27 字だけ（PM の決め 2026-11-21 03:00・前は受けたが今は断る）で、名指しして断ることを確かめる", () => {
    const re = new RegExp(INVITE_EMAIL_PATTERN);
    // 例外の 27 字：‥ … ⒈〜⒛ ㏂ ㏇ ㏘ ︙ ︰
    const REFUSED = [
      0x2025,
      0x2026,
      ...Array.from({ length: 20 }, (_, i) => 0x2488 + i),
      0x33c2,
      0x33c7,
      0x33d8,
      0xfe19,
      0xfe30,
    ];
    const spots = [
      (c: string) => `a${c}@b.co`,
      (c: string) => `a@b${c}.co`,
      (c: string) => `a@b.${c}co`,
      (c: string) => `${c}a@b.co`,
      (c: string) => `a@b.co${c}`,
      (c: string) => `a@${c}b.co`,
      (c: string) => `a@b${c}c`,
    ];
    const diff: string[] = [];
    const opened: number[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCharCode(c);
      const nfkc = ch.normalize("NFKC");
      if (nfkc.length > 1 && /[@.]/.test(nfkc)) {
        opened.push(c);
        continue;
      }
      for (const at of spots) {
        const typed = at(ch);
        if (EMAIL_RE.test(normalizeEmail(typed)) !== re.test(typed))
          diff.push(`U+${c.toString(16)} ${JSON.stringify(typed)}`);
      }
    }
    expect(diff).toEqual([]);
    // 例外は名指しの 27 字だけ（増えても減っても気づく）
    expect(opened).toEqual(REFUSED);
    // 前の口は受け、今は断る（点と数えると、前は断っていた形を新しく受けてしまうため）
    for (const c of REFUSED) {
      const typed = `a@b${String.fromCharCode(c)}c`;
      expect(EMAIL_RE.test(normalizeEmail(typed)), `U+${c.toString(16)} は前の口は受けた`).toBe(true);
      expect(re.test(typed), `U+${c.toString(16)} は今は断る`).toBe(false);
    }
  });

  it("K419-API-028 宛て 1 つの長さは打ったとおりの字（コードポイント）で 320 字まで：321 字は 422・E-INV-009・招待 0・メール 0・details に字は載せず欄・順番・訳だけ。320 字ちょうど（サロゲート対の字を混ぜても）は 201（PM の決め 2026-11-21 03:40・03:55）", async () => {
    await ready();
    const before = mails.length;
    const tail = "@engine-base.example";
    const ok = `${"a".repeat(INVITE_EMAIL_MAX_LENGTH - tail.length - 8)}${randomUUID().slice(0, 8)}${tail}`;
    expect(ok).toHaveLength(INVITE_EMAIL_MAX_LENGTH);
    const over = `${"b".repeat(INVITE_EMAIL_MAX_LENGTH + 1 - tail.length)}${tail}`;
    expect(over).toHaveLength(INVITE_EMAIL_MAX_LENGTH + 1);
    const r = await invite(admin, base([fresh("first"), over]));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-INV-009");
    // 長すぎる宛ては字を返さない（切ると黙って切ることになる・K144-SHAPE-027）：欄・順番・訳だけ
    expect(j.details).toEqual([{ field: "emails", index: 1, code: "E-INV-009", message: msg("E-INV-009") }]);
    expect(JSON.stringify(j)).not.toContain("bbbbbbbb");
    expect(await invRows(over)).toHaveLength(0);
    expect(mails.length).toBe(before);
    expect((await invite(admin, base([ok]))).status).toBe(201);
    expect(await invRows(ok)).toHaveLength(1);
    // サロゲート対（1 字が UTF-16 で 2 つ）を混ぜた 320 字：数え方はコードポイント（契約の maxLength と同じ）なので通る
    const smile = "\u{1F600}".repeat(10);
    const pairs = `${smile}${"c".repeat(INVITE_EMAIL_MAX_LENGTH - 10 - tail.length - 8)}${randomUUID().slice(0, 8)}${tail}`;
    expect(Array.from(pairs)).toHaveLength(INVITE_EMAIL_MAX_LENGTH);
    expect(pairs.length).toBeGreaterThan(INVITE_EMAIL_MAX_LENGTH);
    expect((await invite(admin, base([pairs]))).status).toBe(201);
    expect(await invRows(pairs)).toHaveLength(1);
  });

  it("K419-API-029 pattern が二乗の時間になる長い入力（a@ + 「b.」の 64000 回 + @・pattern だけを当てると約 19 秒）は、pattern を当てる前に長さで断る：3 秒の内に 422・E-INV-009・招待 0", async () => {
    await ready();
    const evil = `a@${"b.".repeat(64000)}@`;
    const t0 = Date.now();
    const r = await invite(admin, base([evil]));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-INV-009");
    expect(j.details).toEqual([{ field: "emails", index: 0, code: "E-INV-009", message: msg("E-INV-009") }]);
    expect(await n("select count(*) as n from invitations where email like 'a@b.b.%'")).toBe(0);
  });

  it("K419-API-016 ひとことが 501 文字：422・招待 0。500 文字は 201・そのまま残る", async () => {
    await ready();
    const e1 = fresh("long");
    expect((await invite(admin, base([e1], { message: "あ".repeat(501) }))).status).toBe(422);
    expect(await invRows(e1)).toHaveLength(0);
    const e2 = fresh("just");
    expect((await invite(admin, base([e2], { message: "あ".repeat(500) }))).status).toBe(201);
    expect((await invRows(e2))[0]!["message"]).toBe("あ".repeat(500));
  });

  it("K419-API-017 管理者として招く：取り直しが無い・16 分前なら 403・STEP_UP_REQUIRED・招待 0。取り直しが 1 分前なら 201・role_id admin", async () => {
    await ready();
    for (const su of [undefined, Date.now() - 16 * 60_000]) {
      const e = fresh("admin");
      const r = await invite(admin, base([e], { role_key: "admin" }), { su });
      expect(r.status).toBe(403);
      expect((await json(r))["code"]).toBe("STEP_UP_REQUIRED");
      expect(await invRows(e)).toHaveLength(0);
    }
    const e = fresh("admin-ok");
    expect((await invite(admin, base([e], { role_key: "admin" }), { su: Date.now() - 60_000 })).status).toBe(201);
    expect((await invRows(e))[0]!["role_id"]).toBe("admin");
  });

  it("K419-API-018 マネージャーは招けない（403・D-128.97）・招く権限を付けたメンバーは招ける（201）・取り直しはメンバーとして招くときは要らない", async () => {
    await ready();
    const e1 = fresh("bymgr");
    expect((await invite(mgr, base([e1]))).status).toBe(403);
    expect(await invRows(e1)).toHaveLength(0);
    const e2 = fresh("byinviter");
    expect((await invite(inviter, base([e2]))).status).toBe(201);
    expect((await invRows(e2))[0]!["created_by"]).toBe(inviter.id);
  });

  it("K419-API-019 役割が知らない値・宛てが空の並び：422・招待 0。ログインしていない：401", async () => {
    await ready();
    const e = fresh("role");
    expect((await invite(admin, base([e], { role_key: "owner" }))).status).toBe(422);
    expect((await invite(admin, base([]))).status).toBe(422);
    expect(await invRows(e)).toHaveLength(0);
    expect((await req("POST", "/invitations", { body: base([fresh("anon")]) })).status).toBe(401);
  });

  it("K419-API-020 二度押し（同じ Idempotency-Key）：2 回とも 201・同じ答え・招待 1・メール 1", async () => {
    await ready();
    const e = fresh("twice");
    const key = randomUUID();
    const before = mails.length;
    const r1 = await invite(admin, base([e]), { key });
    const r2 = await invite(admin, base([e]), { key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await r2.text()).toBe(await r1.text());
    expect(await invRows(e)).toHaveLength(1);
    expect(mails.slice(before).filter((m) => m.to === e)).toHaveLength(1);
  });

  it("K419-API-021 手順 1（招待の行と証跡を 1 つの取引で書く）が失敗：503・E-PAGE-003・3 人とも招待 0・メール 0", async () => {
    await ready();
    const es = [fresh("f1"), fresh("f2"), fresh("f3")];
    const before = mails.length;
    await failOn("invitations", `new.email = '${es[2]}'`, async () => {
      const r = await invite(admin, base(es));
      expect(r.status).toBe(503);
      expect((await json(r))["code"]).toBe("E-PAGE-003");
    });
    expect(await n("select count(*) as n from invitations where email = any($1)", [es])).toBe(0);
    expect(mails.length).toBe(before);
  });

  it("K419-API-022 手順 2（メール）が 1 人だけ失敗 [残る]：201・その人は mail failed・招待の行は残り招待中に出る・ほかの人は sent", async () => {
    await ready();
    const [a, b] = [fresh("ma"), fresh("mb")];
    failMailTo.add(b);
    try {
      const r = await invite(admin, base([a, b]));
      expect(r.status).toBe(201);
      const out = ((await json(r)).data as { invitations: Record<string, unknown>[] }).invitations;
      expect(out.find((x) => x["email"] === a)!["mail"]).toBe("sent");
      expect(out.find((x) => x["email"] === b)!["mail"]).toBe("failed");
      expect(await invRows(b)).toHaveLength(1);
      const d = (await json(await list(admin))).data as { invitations: Record<string, unknown>[] };
      expect(d.invitations.map((i) => i["email"])).toContain(b);
      expect(
        await n(
          "select count(*) as n from audit_events where tenant_id = $1 and action = 'invitation.mail_failed' and payload->>'email_domain' = 'engine-base.example'",
          [T.tenantId],
        ),
      ).toBeGreaterThanOrEqual(1);
    } finally {
      failMailTo.delete(b);
    }
  });

  it("K419-API-023 手順 2 の後片付け（送れなかった証跡 invitation.mail_failed）も失敗：201 のまま・ログに「招待のメールの結果を書けなかった」1 行（宛ての字は無い）", async () => {
    await ready();
    const e = fresh("mc");
    failMailTo.add(e);
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    try {
      await failOn("audit_events", "new.action = 'invitation.mail_failed'", async () => {
        expect((await invite(admin, base([e]))).status).toBe(201);
      });
      const line = logs.filter((l) => l.includes("招待のメールの結果を書けなかった"));
      expect(line).toHaveLength(1);
      expect(line[0]).not.toContain(e);
      expect(await invRows(e)).toHaveLength(1);
    } finally {
      console.error = orig;
      failMailTo.delete(e);
    }
  });
});
