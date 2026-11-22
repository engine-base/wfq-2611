// K-314「新しいパスワードを決める口」の単体の試験（口・本物の DB・本物の Better Auth）。テストの名前の頭の行 ID（K314-API-…）は 11_tickets/K-314.md の表と 1 対 1。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。間違っていると思ったら、作る人に戻す。
//
// 組み立ては本番と同じ bootApi。外に出るものは関門の差し込み口だけを差し替える:
//   ・mail          … 関門 C6 の送出先（リンクは K-313 の口 POST /api/v1/auth/password/forgot で頼み、届いたメールから取る）
//   ・outboundFetch … 関門 C1。漏れたパスワードの照合（Have I Been Pwned の範囲の問い合わせ）にだけ答える。LEAKED だけを「漏れた」と答え、
//                     pwnedDown が立っている間は落ちる
// 試験が決める口の形（契約の口 resetPassword・POST /api/v1/auth/password/reset・リンクを持つ人）:
//   要求の体 { token: string, new_password: string }
//   201 { data: { reset: true } }（ログインの印は入れない）
//   410 E-AUTH-006（期限切れ・使い終わった・前のリンク）／409 E-PAGE-006（無い・空・K-638 で 410 から替えた）／422（欄 token・new_password。E-VAL-005・E-VAL-011）／
//   500 E-PAGE-003（切る所・変える所で落ちた。リンクは残る）／429 retry_after_sec
// 時刻は眠らずに、DB の行の時刻を DB の now() からずらして進める（D-128.130）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "@kaname/db/migrate";
import { migrateAuth } from "@kaname/auth/migrate";
import { createAuth } from "@kaname/auth";
import { emailHash, signInWithLock, signUp } from "@kaname/auth/signup";
import { createSessionResolver } from "@kaname/auth/resolver";
import { createPool } from "@kaname/db/pool";
import { CATALOG } from "@kaname/errors";
import type { Config } from "@kaname/config";
import type { MailLike } from "@kaname/notify";
import { bootApi, type BootOptions } from "../../../src/server.js";
import { resetWorkIdle } from "../../../src/features/F1/password-reset/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PKG = join(HERE, "..", "..", "..", "..", "..", "packages", "db");
const ADMIN = process.env["DATABASE_URL"]!;
const APP_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const AUTH_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_auth:kaname_auth@");
const OPS_EMAIL = "ops-k314@example.com";
const RUN = `k314-${Date.now().toString(36)}`;
const PW = "correct-horse-battery-1";
const NEW_PW = "brand-new-password-314";
const LEAKED = "leaked-password-k314-0001";
const FORGOT = "/api/v1/auth/password/forgot";
const RESET = "/api/v1/auth/password/reset";
const WEB = "http://127.0.0.1:3123";
const UA_WEB = "Mozilla/5.0 (K-314 test)";
const UA_BRIDGE = "Kaname-Bridge/1.0 (K-314 test)";

type Seams = BootOptions & { mail: MailLike; outboundFetch: typeof fetch };

interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const mails: SentMail[] = [];
const fakeMail: MailLike = {
  send: async (m) => {
    mails.push({ to: m.to, subject: m.subject, text: m.text });
    return { error: null };
  },
};
const pwnedDown = { v: false };
const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex").toUpperCase();
const fakeFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /^https:\/\/api\.pwnedpasswords\.com\/range\/([0-9A-F]{5})$/i.exec(url);
  if (!m) throw new Error(`K-314 の口は照合のほかに外へ出ない: ${url}`);
  if (pwnedDown.v) throw new Error("K-314 の試験：照合のサービスが落ちている");
  const leaked = sha1(LEAKED);
  const body =
    m[1]!.toUpperCase() === leaked.slice(0, 5)
      ? `${leaked.slice(5)}:42\r\n0018A45C4D1DEF81644B54AB7F969B88D65:3`
      : "0018A45C4D1DEF81644B54AB7F969B88D65:3";
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
};

const config = {
  env: "test",
  databaseUrl: APP_URL,
  authDatabaseUrl: AUTH_URL,
  authSecret: "test-secret-k314-0123456789-abcdefghij",
  baseUrl: "http://127.0.0.1:3001",
  webBaseUrl: WEB,
  webOrigins: [],
  storage: {
    endpoint: "http://127.0.0.1:9000",
    region: "ap-northeast-1",
    bucket: "kaname-dev",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    forcePathStyle: true,
  },
  secretsMasterKey: Buffer.alloc(32, 7).toString("base64"),
  resendApiKey: null,
  mailFrom: "Kaname <noreply@example.com>",
  opsEmail: OPS_EMAIL,
  mailReplyTo: OPS_EMAIL,
  operator: { service: "Kaname", company: "試験", representative: "試験", email: OPS_EMAIL, phone: "", address: null },
  mailSuppressPrefix: "",
  bridgeReleaseBase: "",
  bridgeReleaseDir: "",
  infisical: null,
  listenDatabaseUrl: null,
  port: 0,
} as Config;

let app: Awaited<ReturnType<typeof bootApi>>;
let admin: pg.Pool;
let fixturePool: pg.Pool;
let authFixture: ReturnType<typeof createAuth>;
let resolve: ReturnType<typeof createSessionResolver>;
let ipSeq = 0;
const nextIp = () => `192.0.2.${(ipSeq = (ipSeq % 250) + 1)}`;
const email = (tag: string) => `${RUN}-${tag}@example.com`;
const post = (path: string, body: unknown, o: { ip?: string; headers?: Record<string, string> } = {}) =>
  app.app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": o.ip ?? nextIp(), ...(o.headers ?? {}) },
    body: JSON.stringify(body),
  });
const reset = (
  token: unknown,
  newPassword: unknown = NEW_PW,
  o: { ip?: string; headers?: Record<string, string> } = {},
) =>
  post(
    RESET,
    { ...(token === undefined ? {} : { token }), ...(newPassword === undefined ? {} : { new_password: newPassword }) },
    o,
  );
const json = async (r: Response) => (await r.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
const msg = (code: string) => CATALOG[code]?.message ?? `（errors.json に ${code} が無い）`;
const expectGone = async (r: Response, code: "E-AUTH-006" | "E-PAGE-006") => {
  // 期限切れ・使い終わった・前のリンク（E-AUTH-006）は 410。リンクが DB に無い（E-PAGE-006）は 409（K-638：形どおりの入力が DB の中身で断られる所を 410 にしない）
  expect(r.status, await r.clone().text()).toBe(code === "E-PAGE-006" ? 409 : 410);
  const j = await json(r);
  expect(j["code"]).toBe(code);
  expect(j["message"]).toBe(msg(code));
};

const registered = async (tag: string) => {
  const r = await signUp(authFixture.auth, {
    email: email(tag),
    password: PW,
    name: "決める 花子",
    companyName: `${RUN} 社`,
  });
  await admin.query('update kaname_auth."user" set "emailVerified" = true where id = $1', [r.userId]);
  return r.userId;
};
/** 再設定のリンクを頼み（K-313 の口）、届いた最後のメールから手がかりを取る */
const linkFor = async (e: string) => {
  const r = await post(FORGOT, { email: e });
  expect(r.status).toBe(201);
  await resetWorkIdle();
  const got = mails.filter((m) => m.to === e);
  const last = got[got.length - 1];
  if (!last) throw new Error(`再設定のメールが届かない: ${e}`);
  const u = /\/password-reset\?token=([^\s&]+)/.exec(last.text);
  if (!u) throw new Error("リンクが本文に無い");
  return decodeURIComponent(u[1]!);
};
const passwordHash = async (uid: string) =>
  (
    await admin.query<{ password: string }>(
      'select password from kaname_auth.account where "userId" = $1 and password is not null',
      [uid],
    )
  ).rows[0]?.password ?? null;
const canSignIn = async (e: string, pw: string) =>
  (await signInWithLock(authFixture.auth, fixturePool, e, pw, UA_WEB)).ok;
/** その人の行（会社を作った人の members.auth_user_id か、2 社目の所属の行の auth_user_id） */
const OWN_MEMBER =
  "(m.auth_user_id = $1 or exists (select 1 from tenant_memberships tm where tm.member_id = m.id and tm.auth_user_id = $1))";
const sessionsOf = async (uid: string) =>
  (
    await admin.query<{ kind_id: string; revoked_at: Date | null; revoke_reason_id: string | null; tenant_id: string }>(
      `select s.kind_id, s.revoked_at, s.revoke_reason_id, s.tenant_id from sessions s join members m on m.id = s.member_id
        where ${OWN_MEMBER}`,
      [uid],
    )
  ).rows;
const doneEvents = async (uid: string) =>
  (
    await admin.query<{ tenant_id: string; detail: Record<string, unknown> }>(
      `select e.tenant_id, e.detail from security_events e join members m on m.id = e.member_id
        where ${OWN_MEMBER} and e.kind_id = 'password_reset_done'`,
      [uid],
    )
  ).rows;
/** 同じ人を 2 つめのワークスペースにも入れ、そこに PC のセッションを 1 つ置く。members.auth_user_id は一意なので、
 *  2 社目の人の行は所属の行（tenant_memberships.auth_user_id）でログインに結ぶ（0089 の引き方と同じ・K-313 の試験と同じ） */
const secondWorkspaceWithBridge = async (uid: string) => {
  const t = (
    await admin.query<{ id: string }>(
      "insert into tenants (id, tenant_id, name) select u, u, $1 from gen_random_uuid() u returning id",
      [`${RUN} 2 社目`],
    )
  ).rows[0]!.id;
  const s = (
    await admin.query<{ id: string }>(
      "insert into scopes (tenant_id, name, ticket_prefix) values ($1, '全体', '') returning id",
      [t],
    )
  ).rows[0]!.id;
  const m = (
    await admin.query<{ id: string }>(
      "insert into members (tenant_id, scope_id, kind_id, display_name) values ($1, $2, 'human', '決める 花子') returning id",
      [t, s],
    )
  ).rows[0]!.id;
  await admin.query(
    "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status) values ($1, $2, $3, 'member', 'active')",
    [t, m, uid],
  );
  await admin.query(
    "insert into sessions (tenant_id, member_id, kind_id, device_label, auth_session_id, alive_at) values ($1, $2, 'bridge', 'K-314 の PC', $3, now())",
    [t, m, `${RUN}-${uid}`],
  );
  return t;
};
const watchConsole = () => {
  const spies = (["log", "warn", "error", "info"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation(() => undefined),
  );
  return {
    text: () => spies.flatMap((s) => s.mock.calls.map((a) => a.map(String).join(" "))).join("\n"),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
};

beforeAll(async () => {
  await migrate(ADMIN, DB_PKG);
  await migrateAuth(ADMIN);
  admin = new pg.Pool({ connectionString: ADMIN, max: 3 });
  const seams: Seams = { bucketExists: async () => true, mail: fakeMail, outboundFetch: fakeFetch };
  app = await bootApi(config, seams);
  fixturePool = createPool({ databaseUrl: APP_URL, max: 3 });
  authFixture = createAuth({
    authDatabaseUrl: AUTH_URL,
    appPool: fixturePool,
    secret: config.authSecret,
    baseURL: config.baseUrl,
  });
  resolve = createSessionResolver(authFixture.auth, fixturePool);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await authFixture?.pool.end();
  await fixturePool?.end();
  await admin?.end();
});

describe("K-314 リンクの状態 × 決める", () => {
  it("K314-API-001 期限内のリンクで決める：201・reset。新しいパスワードで入れる。2 社の画面と PC のセッションが全部切れる。2 社に password_reset_done。リンクの行は消える", async () => {
    const e = email("ok");
    const uid = await registered("ok");
    const second = await secondWorkspaceWithBridge(uid);
    expect((await signInWithLock(authFixture.auth, fixturePool, e, PW, UA_WEB)).ok).toBe(true);
    expect((await signInWithLock(authFixture.auth, fixturePool, e, PW, UA_BRIDGE)).ok).toBe(true);
    const before = await sessionsOf(uid);
    expect(before.filter((s) => s.revoked_at === null).length).toBeGreaterThanOrEqual(3);
    const token = await linkFor(e);
    const r = await reset(token);
    expect(r.status, await r.clone().text()).toBe(201);
    const j = await json(r);
    expect(j).toEqual({ data: { reset: true } });
    const after = await sessionsOf(uid);
    expect(after.length).toBe(before.length);
    expect(after.every((s) => s.revoked_at !== null && s.revoke_reason_id === "password_changed")).toBe(true);
    expect(after.some((s) => s.tenant_id === second && s.kind_id === "bridge")).toBe(true);
    expect(await canSignIn(e, NEW_PW)).toBe(true);
    expect(await canSignIn(e, PW)).toBe(false);
    const ev = await doneEvents(uid);
    expect(new Set(ev.map((x) => x.tenant_id)).size).toBe(2);
    expect(ev).toHaveLength(2);
    for (const x of ev) {
      const d = JSON.stringify(x.detail);
      expect(d).not.toContain(token);
      expect(d).not.toContain(NEW_PW);
      expect(d).not.toContain(e);
    }
    const rows = await admin.query(
      "select 1 from kaname_auth.verification where value = $1 and (identifier like 'reset-password:%' or identifier like 'reset-password-taken:%')",
      [uid],
    );
    expect(rows.rowCount).toBe(0);
  });

  it("K314-API-002 再設定した後：前の画面の印で GET /api/v1/me は 401。前の画面と PC の印は解けない。別の人のセッションは解けたまま", async () => {
    const e = email("old-session");
    await registered("old-session");
    const web = await signInWithLock(authFixture.auth, fixturePool, e, PW, UA_WEB);
    const pc = await signInWithLock(authFixture.auth, fixturePool, e, PW, UA_BRIDGE);
    const o = email("bystander");
    await registered("bystander");
    const other = await signInWithLock(authFixture.auth, fixturePool, o, PW, UA_WEB);
    const me = (t: string) =>
      app.app.request("http://localhost/api/v1/me", {
        headers: { authorization: `Bearer ${t}`, "user-agent": UA_WEB },
      });
    // getMe はまだ作っていない（501）。セッションが生きていることは 401 でないことで見る（step_up.test.ts と同じ）
    expect((await me(web.token!)).status).not.toBe(401);
    const token = await linkFor(e);
    // 別のアカウント（bystander）でログインしたまま、リンクの人の再設定を送る
    expect(
      (await reset(token, NEW_PW, { headers: { authorization: `Bearer ${other.token!}`, "user-agent": UA_WEB } }))
        .status,
    ).toBe(201);
    expect((await me(web.token!)).status).toBe(401);
    expect(await resolve(new Headers({ authorization: `Bearer ${web.token!}`, "user-agent": UA_WEB }))).toBeNull();
    expect(await resolve(new Headers({ authorization: `Bearer ${pc.token!}`, "user-agent": UA_BRIDGE }))).toBeNull();
    expect(
      await resolve(new Headers({ authorization: `Bearer ${other.token!}`, "user-agent": UA_WEB })),
    ).not.toBeNull();
  });

  it("K314-API-003 期限切れ（期限を now() の 1 秒前にし、部品の片付けを挟んでリンクの行が消えた後）：410・E-AUTH-006・正本の文。パスワードは変わらない", async () => {
    const e = email("expired");
    const uid = await registered("expired");
    const token = await linkFor(e);
    await admin.query(
      `update kaname_auth.verification set "expiresAt" = now() - interval '1 second' where value = $1 and identifier like 'reset-password:%'`,
      [uid],
    );
    // 部品は verification を引くたびに期限の過ぎた行を表ぜんぶから消す。本番と同じく、送る前に部品の引きを 1 回挟む
    await authFixture.auth.api.requestPasswordReset({ body: { email: email("expired-nobody") } });
    const left = await admin.query(
      "select 1 from kaname_auth.verification where value = $1 and identifier like 'reset-password:%'",
      [uid],
    );
    expect(left.rowCount, "リンクの行は部品の片付けで消えている").toBe(0);
    const before = await passwordHash(uid);
    await expectGone(await reset(token), "E-AUTH-006");
    expect(await passwordHash(uid)).toBe(before);
  });

  it("K314-API-004 期限の境：残り 5 秒は 201。ちょうど now() と 1 秒前は 410・E-AUTH-006", async () => {
    const a = email("edge-in");
    const ua = await registered("edge-in");
    const ta = await linkFor(a);
    await admin.query(
      `update kaname_auth.verification set "expiresAt" = now() + interval '5 seconds' where value = $1 and identifier like 'reset-password:%'`,
      [ua],
    );
    expect((await reset(ta)).status).toBe(201);
    const b = email("edge-on");
    const ub = await registered("edge-on");
    const tb = await linkFor(b);
    await admin.query(
      `update kaname_auth.verification set "expiresAt" = now() where value = $1 and identifier like 'reset-password:%'`,
      [ub],
    );
    await expectGone(await reset(tb), "E-AUTH-006");
    const c = email("edge-past");
    const uc = await registered("edge-past");
    const tc = await linkFor(c);
    await admin.query(
      `update kaname_auth.verification set "expiresAt" = now() - interval '1 second' where value = $1 and identifier like 'reset-password:%'`,
      [uc],
    );
    await expectGone(await reset(tc), "E-AUTH-006");
  });

  it("K314-API-005 使い終わったリンクをもう一度：410・E-AUTH-006。2 回目のパスワードにはならない", async () => {
    const e = email("used");
    const uid = await registered("used");
    const token = await linkFor(e);
    expect((await reset(token)).status).toBe(201);
    const h = await passwordHash(uid);
    await expectGone(await reset(token, "another-password-314-x"), "E-AUTH-006");
    expect(await passwordHash(uid)).toBe(h);
    expect(await canSignIn(e, NEW_PW)).toBe(true);
  });

  it("K314-API-006 前のリンク（1 通目の行を 61 秒前にして頼み直した後の 1 通目）：1 通目は 410・E-AUTH-006。2 通目は 201", async () => {
    const e = email("replaced");
    const uid = await registered("replaced");
    const first = await linkFor(e);
    await admin.query(
      `update kaname_auth.verification set "createdAt" = "createdAt" - interval '61 seconds', "updatedAt" = "updatedAt" - interval '61 seconds' where value = $1 and identifier like 'reset-password:%'`,
      [uid],
    );
    const second = await linkFor(e);
    expect(second).not.toBe(first);
    await expectGone(await reset(first), "E-AUTH-006");
    expect((await reset(second)).status).toBe(201);
  });

  it("K314-API-007 でたらめ・空・空白だけは 409・E-PAGE-006（正本の文）。手がかりの欄が無いは 422（欄 token）", async () => {
    for (const t of ["not-a-real-token-k314", "", "   "]) await expectGone(await reset(t), "E-PAGE-006");
    const r = await reset(undefined);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await json(r))).toContain("token");
  });

  it("K314-API-008 手がかりの前後に空白・改行（メールソフトが付ける）：除いて 201", async () => {
    const e = email("trim");
    await registered("trim");
    const token = await linkFor(e);
    expect((await reset(` \n${token}\r\n `)).status).toBe(201);
  });

  it("K314-API-009 新しいパスワード 11 文字は 422・E-VAL-005・欄 new_password（リンクは使えるまま）。続けて 12 文字なら 201", async () => {
    const e = email("short");
    await registered("short");
    const token = await linkFor(e);
    const r = await reset(token, "a".repeat(11));
    expect(r.status).toBe(422);
    const s = JSON.stringify(await json(r));
    expect(s).toContain("new_password");
    expect(s).toContain(msg("E-VAL-005"));
    expect((await reset(token, "b23456789012")).status).toBe(201);
    expect(await canSignIn(e, "b23456789012")).toBe(true);
  });

  it("K314-API-010 漏れたパスワードは 422・E-VAL-011・欄 new_password（変わらない）。照合のサービスが落ちている間は通して 201", async () => {
    const e = email("leaked");
    const uid = await registered("leaked");
    const token = await linkFor(e);
    const before = await passwordHash(uid);
    const r = await reset(token, LEAKED);
    expect(r.status).toBe(422);
    const s = JSON.stringify(await json(r));
    expect(s).toContain("new_password");
    expect(s).toContain(msg("E-VAL-011"));
    expect(await passwordHash(uid)).toBe(before);
    pwnedDown.v = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await reset(token, NEW_PW)).status).toBe(201);
    } finally {
      pwnedDown.v = false;
      spy.mockRestore();
    }
  });

  it("K314-API-011 前と同じパスワード：201（D-128.141）。そのパスワードで入れる", async () => {
    const e = email("same");
    await registered("same");
    const token = await linkFor(e);
    expect((await reset(token, PW)).status).toBe(201);
    expect(await canSignIn(e, PW)).toBe(true);
  });

  it("K314-API-012 ロック中（5 回違えて 15 分）の人：201。app.login_attempts の行が消え、すぐ新しいパスワードで入れる", async () => {
    const e = email("locked");
    await registered("locked");
    await admin.query(
      "insert into app.login_attempts (email_hash, fails, first_failed_at, locked_until) values ($1, 5, now(), now() + interval '15 minutes') on conflict (email_hash) do update set fails = 5, locked_until = excluded.locked_until",
      [emailHash(e)],
    );
    const token = await linkFor(e);
    expect((await reset(token)).status).toBe(201);
    expect((await admin.query("select 1 from app.login_attempts where email_hash = $1", [emailHash(e)])).rowCount).toBe(
      0,
    );
    expect(await canSignIn(e, NEW_PW)).toBe(true);
  });

  it("K314-API-013 2 段階ありの人：201。two_factor_enabled は true のまま。新しいパスワードで入ると 2 段階の待ちになる", async () => {
    const e = email("tf");
    const uid = await registered("tf");
    await admin.query('update kaname_auth."user" set "twoFactorEnabled" = true where id = $1', [uid]);
    const token = await linkFor(e);
    expect((await reset(token)).status).toBe(201);
    const u = await admin.query<{ t: boolean }>(
      'select "twoFactorEnabled" as t from kaname_auth."user" where id = $1',
      [uid],
    );
    expect(u.rows[0]!.t).toBe(true);
    const s = await signInWithLock(authFixture.auth, fixturePool, e, NEW_PW, UA_WEB);
    expect(s.ok).toBe(true);
    expect(s.twoFactor).toBe(true);
    expect(s.token ?? null).toBeNull();
  });

  it("K314-API-014 止められた人（members.suspended_at）：201。account.password が変わる", async () => {
    const e = email("suspended");
    const uid = await registered("suspended");
    await admin.query("update members set suspended_at = now(), suspended_by = id where auth_user_id = $1", [uid]);
    const before = await passwordHash(uid);
    const token = await linkFor(e);
    expect((await reset(token)).status).toBe(201);
    expect(await passwordHash(uid)).not.toBe(before);
  });

  it("K314-API-015 頼んだのと別の IP・別の UA から送る：201", async () => {
    const e = email("other-device");
    await registered("other-device");
    const token = await linkFor(e);
    const r = await reset(token, NEW_PW, {
      ip: "203.0.113.250",
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    });
    expect(r.status).toBe(201);
  });
});

describe("K-314 揺れ・失敗・守り", () => {
  it("K314-API-016 同じリンクを同時に 2 つ：201 と 410・E-AUTH-006 が 1 つずつ。password_reset_done は 1 行だけ", async () => {
    const e = email("race");
    const uid = await registered("race");
    const token = await linkFor(e);
    const rs = await Promise.all([reset(token, "race-password-aaaa-1"), reset(token, "race-password-bbbb-2")]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 410]);
    const gone = rs.find((r) => r.status === 410)!;
    expect((await json(gone))["code"]).toBe("E-AUTH-006");
    expect(await doneEvents(uid)).toHaveLength(1);
  });

  it("K314-API-017 端末を切る所で失敗：500・E-PAGE-003。パスワードは変わらない。直った後に同じリンクで送ると 201", async () => {
    const e = email("revoke-down");
    const uid = await registered("revoke-down");
    expect(await canSignIn(e, PW)).toBe(true); // 切るセッションを 1 つ作る
    const token = await linkFor(e);
    const before = await passwordHash(uid);
    await admin.query(`create or replace function public.k314_revoke_down() returns trigger language plpgsql as $$
      begin if old.member_id in (select id from members where auth_user_id = '${uid}') then raise exception 'K-314 の試験：切れない'; end if; return new; end $$`);
    await admin.query(
      "create trigger k314_revoke_down before update on sessions for each row execute function public.k314_revoke_down()",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await reset(token);
      expect(r.status).toBe(500);
      const j = await json(r);
      expect(j["code"]).toBe("E-PAGE-003");
      expect(j["message"]).toBe(msg("E-PAGE-003"));
      expect(await passwordHash(uid)).toBe(before);
    } finally {
      spy.mockRestore();
      await admin.query("drop trigger if exists k314_revoke_down on sessions");
      await admin.query("drop function if exists public.k314_revoke_down()");
    }
    expect((await reset(token)).status).toBe(201);
  });

  it("K314-API-018 切れた後、パスワードを変える所で失敗：500・E-PAGE-003。セッションは切れたまま。直った後に同じリンクで送ると 201", async () => {
    const e = email("change-down");
    const uid = await registered("change-down");
    expect(await canSignIn(e, PW)).toBe(true);
    const token = await linkFor(e);
    await admin.query(`create or replace function kaname_auth.k314_change_down() returns trigger language plpgsql as $$
      begin if old."userId" = '${uid}' then raise exception 'K-314 の試験：変えられない'; end if; return new; end $$`);
    await admin.query(
      "create trigger k314_change_down before update on kaname_auth.account for each row execute function kaname_auth.k314_change_down()",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await reset(token);
      expect(r.status).toBe(500);
      expect((await json(r))["code"]).toBe("E-PAGE-003");
      const ss = await sessionsOf(uid);
      expect(ss.length).toBeGreaterThan(0);
      expect(ss.every((s) => s.revoked_at !== null)).toBe(true);
      expect(await canSignIn(e, NEW_PW)).toBe(false);
    } finally {
      spy.mockRestore();
      await admin.query("drop trigger if exists k314_change_down on kaname_auth.account");
      await admin.query("drop function if exists kaname_auth.k314_change_down()");
    }
    expect((await reset(token)).status).toBe(201);
    expect(await canSignIn(e, NEW_PW)).toBe(true);
  });

  it("K314-API-019 同じ IP から 1 分に 11 回：11 回目は 429・retry_after_sec は 1〜60 の整数", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      const r = await reset(`not-a-token-${i}`, NEW_PW, { ip });
      expect(r.status, `${i + 1} 回目は上限の内`).toBe(409);
    }
    const r = await reset("not-a-token-10", NEW_PW, { ip });
    expect(r.status).toBe(429);
    const sec = Number((await json(r))["retry_after_sec"]);
    expect(Number.isInteger(sec)).toBe(true);
    expect(sec).toBeGreaterThanOrEqual(1);
    expect(sec).toBeLessThanOrEqual(60);
  });

  it("K314-API-020 DB の中：account.password に平文が無い。verification（リンクの行と使った印の行）に手がかりの平文が無い", async () => {
    const e = email("hashed");
    const uid = await registered("hashed");
    const token = await linkFor(e);
    expect((await reset(token)).status).toBe(201);
    const pw = await passwordHash(uid);
    expect(pw).not.toBeNull();
    expect(pw).not.toContain(NEW_PW);
    const hit = await admin.query(
      "select 1 from kaname_auth.verification where position($1 in identifier) > 0 or position($1 in value) > 0",
      [token],
    );
    expect(hit.rowCount).toBe(0);
  });

  it("K314-API-021 ログ：決める・410・500 の道で、console に手がかり・新しいパスワード・メールアドレスが出ない", async () => {
    const e = email("log");
    const uid = await registered("log");
    expect(await canSignIn(e, PW)).toBe(true);
    const token = await linkFor(e);
    const c = watchConsole();
    try {
      await reset("not-a-real-token-log");
      await admin.query(`create or replace function kaname_auth.k314_log_down() returns trigger language plpgsql as $$
        begin if old."userId" = '${uid}' then raise exception 'K-314 の試験：ログ'; end if; return new; end $$`);
      await admin.query(
        "create trigger k314_log_down before update on kaname_auth.account for each row execute function kaname_auth.k314_log_down()",
      );
      expect((await reset(token)).status).toBe(500);
      await admin.query("drop trigger if exists k314_log_down on kaname_auth.account");
      expect((await reset(token)).status).toBe(201);
      const out = c.text();
      expect(out).not.toContain(token);
      expect(out).not.toContain(NEW_PW);
      expect(out).not.toContain(e);
    } finally {
      c.restore();
      await admin.query("drop trigger if exists k314_log_down on kaname_auth.account");
      await admin.query("drop function if exists kaname_auth.k314_log_down()");
    }
  });

  it("K314-API-022 新しいパスワード 129 文字は 422・E-VAL-026・欄 new_password。セッションは切れず変わらず、リンクは使えるまま。続けて 128 文字なら 201", async () => {
    const e = email("long");
    const uid = await registered("long");
    expect(await canSignIn(e, PW)).toBe(true);
    const token = await linkFor(e);
    const before = await passwordHash(uid);
    const r = await reset(token, "x".repeat(129));
    expect(r.status).toBe(422);
    const s = JSON.stringify(await json(r));
    expect(s).toContain("new_password");
    expect(s).toContain(msg("E-VAL-026"));
    expect(await passwordHash(uid)).toBe(before);
    expect(
      (await sessionsOf(uid)).some((x) => x.revoked_at === null),
      "セッションは切れていない",
    ).toBe(true);
    expect((await reset(token, "y".repeat(128))).status).toBe(201);
  });

  it("K314-API-023 抜けた会社（所属 left）と今の会社がある人が決める：記録 password_reset_done は今の会社に 1 行だけ。抜けた会社には 0 行", async () => {
    const e = email("left-ws");
    const uid = await registered("left-ws");
    const leftWs = await secondWorkspaceWithBridge(uid);
    await admin.query("update tenant_memberships set status = 'left' where tenant_id = $1 and auth_user_id = $2", [
      leftWs,
      uid,
    ]);
    const token = await linkFor(e);
    expect((await reset(token)).status).toBe(201);
    const ev = await doneEvents(uid);
    expect(ev).toHaveLength(1);
    expect(ev.some((x) => x.tenant_id === leftWs)).toBe(false);
  });
});
