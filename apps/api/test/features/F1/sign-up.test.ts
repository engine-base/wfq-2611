// K-51「登録する」の単体の試験（口・本物の DB）。テストの名前の頭の行 ID（K51-API-…）は 11_tickets/K-51.md の表のマスに 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。間違っていると思ったら、作る人に戻す。
//
// 組み立ては本番と同じ bootApi（apps/api/src/server.ts）。外に出るものは関門の差し込み口だけを差し替える（本物の網には出ない）:
//   ・mail          … 関門 C6 の送出先（@kaname/notify の MailLike。Resend の代わり）。届いたメールを全部ここに貯める
//   ・outboundFetch … 関門 C1 の外への口（漏れたパスワードの照合 = Have I Been Pwned の範囲の問い合わせ）が使う fetch
// ★実装する人へ：BootOptions に mail と outboundFetch を足し、bootApi はそれを関門 C6・C1 に渡すこと（下の Seams の型）。
// 時刻は眠らずに、DB の行の期限（expires_at）を過去へ動かして進める。
//
// 申し込みの印（D-128.142）：createSignup の 201 の答え（data.signup_token）で、登録を送ったブラウザにだけ渡す値。
//   待つ画面の状態（getSignupStatus）と送り直し（resendSignupEmail）は、この印を頭（ヘッダー x-signup-token）で受けて引く。
//   メールでは引かない（メールを入れて登録済みかを探られないように）。印は確認のメールのリンクの手がかりとは別の値で、
//   DB には平文で残さない（ハッシュで持つ）。頭にするのは、URL に載せるとアクセスの記録に残るため。
//
// 試験が前提にする DB の形（このチケットで migration を 1 本足す・K-52 が確定のときに terms_consents へ移す）:
//   kaname_auth.pending_signup に terms_version_id uuid・privacy_version_id uuid（terms_versions.id）・consented_at timestamptz
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "@kaname/db/migrate";
import { migrateAuth } from "@kaname/auth/migrate";
import { createAuth } from "@kaname/auth";
import { signUp } from "@kaname/auth/signup";
import { hashPendingToken } from "@kaname/auth/pending";
import { createPool } from "@kaname/db/pool";
import type { Config } from "@kaname/config";
import type { MailLike } from "@kaname/notify";
import { bootApi, type BootOptions } from "../../../src/server.js";

const DB_PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "packages", "db");
const ADMIN = process.env["DATABASE_URL"]!;
const APP_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const AUTH_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_auth:kaname_auth@");
const OPS_EMAIL = "ops-k51@example.com";
const RUN = `k51-${Date.now().toString(36)}`; // この回が作る申し込みの印（終わったら消す・G-10）
const PW = "correct-horse-battery-1"; // 12 文字以上・漏れていない
const LEAKED_PW = "password1234"; // 偽の照合が「漏れた」と答えるもの（12 文字）
const NAME_MAX = 100; // 名前・会社名の上限（E-VAL-007 の招待の名前と同じ 100 文字にそろえる）
const COMPANY_MAX = 100;
const SIGN_UP = "/api/v1/auth/sign-up";
const SIGNUP_TOKEN_HEADER = "x-signup-token"; // 申し込みの印を渡す頭（D-128.142）
const STATUS = "/api/v1/auth/sign-up/status";
const RESEND = "/api/v1/auth/sign-up/resend";

/** 実装する人が BootOptions に足す差し込み口（関門 C6・C1 の送出先） */
type Seams = BootOptions & { mail: MailLike; outboundFetch: typeof fetch };

// ---- 関門 C6 の偽の送出先 ----
interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const mails: SentMail[] = [];
const failMailTo = new Set<string>(); // この宛先は送出先が断る（こちら側の都合：1 日の上限）
const fakeMail: MailLike = {
  send: async (m) => {
    if (failMailTo.has(m.to)) return { error: { message: "daily quota exceeded" } };
    mails.push({ to: m.to, subject: m.subject, text: m.text });
    return { error: null };
  },
};
const mailsTo = (email: string) => mails.filter((m) => m.to === email);
const tokenOf = (m: SentMail) => {
  const u = /https?:\/\/\S+\/verify-email\?token=([^\s&]+)/.exec(m.text);
  if (!u) throw new Error(`確認のリンクが本文に無い: ${m.text}`);
  return decodeURIComponent(u[1]!);
};

// ---- 関門 C1 の偽の外（Have I Been Pwned の範囲の問い合わせ） ----
type PwnedMode = "ok" | "down" | "http500" | "garbage";
let pwnedMode: PwnedMode = "ok";
const pwnedCalls: { url: string; body: string }[] = [];
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").toUpperCase();
const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  pwnedCalls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
  const m = /^https:\/\/api\.pwnedpasswords\.com\/range\/([0-9A-F]{5})$/i.exec(url);
  if (!m) throw new Error(`試験の外への口は照合だけ: ${url}`);
  if (pwnedMode === "down") throw new TypeError("fetch failed (ECONNREFUSED)");
  if (pwnedMode === "http500") return new Response("oops", { status: 500 });
  if (pwnedMode === "garbage") return new Response("<html>maintenance</html>", { status: 200 });
  const leaked = sha1(LEAKED_PW);
  const lines = ["0018A45C4D1DEF81644B54AB7F969B88D65:3", "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2"];
  if (leaked.startsWith(m[1]!.toUpperCase())) lines.push(`${leaked.slice(5)}:24230577`);
  return new Response(lines.join("\r\n"), { status: 200, headers: { "content-type": "text/plain" } });
};

const config = {
  env: "test",
  databaseUrl: APP_URL,
  authDatabaseUrl: AUTH_URL,
  authSecret: "test-secret-0123456789-abcdefghijklmnop",
  baseUrl: "http://127.0.0.1:3001",
  webBaseUrl: "http://127.0.0.1:3123",
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
let authFixture: ReturnType<typeof createAuth>;
let fixturePool: pg.Pool;
let termsId = "";
let privacyId = "";
let ipSeq = 0;
/** 試験ごとに別の IP（上限の数え方を試験どうしで混ぜない） */
const nextIp = () => `198.51.100.${(ipSeq = (ipSeq % 250) + 1)}`;
const email = (tag: string) => `${RUN}-${tag}@example.com`;
const req = (method: string, path: string, body?: unknown, ip = nextIp(), headers: Record<string, string> = {}) =>
  app.app.request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const signup = (b: Record<string, unknown>, ip?: string) => req("POST", SIGN_UP, b, ip);
const okBody = (tag: string, extra: Record<string, unknown> = {}) => ({
  email: email(tag),
  name: "高本 聖斗",
  company_name: "株式会社テスト",
  password: PW,
  ...extra,
});
interface PendingRow {
  email: string;
  name: string;
  company_name: string | null;
  token_hash: string;
  expires_at: Date;
  sent_at: Date | null;
  send_error: string | null;
  consumed_at: Date | null;
  terms_version_id: string | null;
  privacy_version_id: string | null;
  consented_at: Date | null;
  [k: string]: unknown;
}
const pending = async (e: string) =>
  (await admin.query<PendingRow>("select * from kaname_auth.pending_signup where email = $1", [e])).rows;
const pendingText = async (e: string) =>
  (await admin.query<{ t: string }>("select p::text as t from kaname_auth.pending_signup p where email = $1", [e]))
    .rows[0]?.t ?? "";
const expire = (e: string) =>
  admin.query("update kaname_auth.pending_signup set expires_at = now() - interval '1 second' where email = $1", [e]);
/** 201 の答えから申し込みの印を取り出す（登録を送ったブラウザにだけ渡る値） */
const signupTokenOf = async (r: Response) => {
  const t = (await json(r.clone())).data?.["signup_token"];
  expect(typeof t, "201 の答えに data.signup_token（申し込みの印）がある").toBe("string");
  expect(String(t).length, "印は推し量れない長さ（32 文字以上）").toBeGreaterThanOrEqual(32);
  return String(t);
};
/** 登録して、201 と申し込みの印を確かめて返す */
const signupOk = async (tag: string, extra: Record<string, unknown> = {}) => {
  const r = await signup(okBody(tag, extra));
  expect(r.status, await r.clone().text()).toBe(201);
  return signupTokenOf(r);
};
/** 待つ画面の状態を印で引く（印を渡さないときは query だけで呼ぶ） */
const status = (token: string | null, query = "") =>
  req("GET", `${STATUS}${query}`, undefined, nextIp(), token === null ? {} : { [SIGNUP_TOKEN_HEADER]: token });
/** 送り直しを印で頼む */
const resend = (token: string | null, body: unknown = {}) =>
  req("POST", RESEND, body, nextIp(), token === null ? {} : { [SIGNUP_TOKEN_HEADER]: token });
const json = async (r: Response) => (await r.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
/** 422 の理由が、その欄を指しているか（details[].field か field） */
const fieldsOf = (j: Record<string, unknown>) => {
  const d = (j["details"] as { field?: string }[] | undefined) ?? [];
  const one = (j["detail"] as { field?: string } | undefined)?.field ?? (j["field"] as string | undefined);
  return [...d.map((x) => x.field), one].filter(Boolean);
};

beforeAll(async () => {
  await migrate(ADMIN, DB_PKG);
  await migrateAuth(ADMIN);
  admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  // 今の規約とプライバシーポリシーの版（運営のテナントが出す・この回が一番新しい）
  const ops = (await admin.query<{ id: string }>("select app.ops_tenant_id() as id")).rows[0]!.id;
  const ins = (kind: string) =>
    admin.query<{ id: string }>(
      "insert into terms_versions (tenant_id, kind, version, url, published_at) values ($1, $2, $3, $4, now()) returning id",
      [ops, kind, RUN, `https://kaname.example/${kind}`],
    );
  termsId = (await ins("terms")).rows[0]!.id;
  privacyId = (await ins("privacy")).rows[0]!.id;
  const seams: Seams = { bucketExists: async () => true, mail: fakeMail, outboundFetch: fakeFetch };
  app = await bootApi(config, seams);
  // 「確定済み」の人を作る道具（K-52 の確定を通さず、ログインの部品で直に本人を作る）
  fixturePool = createPool({ databaseUrl: APP_URL, max: 2 });
  authFixture = createAuth({
    authDatabaseUrl: AUTH_URL,
    appPool: fixturePool,
    secret: config.authSecret,
    baseURL: config.baseUrl,
  });
}, 60_000);

afterAll(async () => {
  await admin?.query("delete from kaname_auth.pending_signup where email like $1", [`${RUN}-%`]);
  await admin?.query("delete from terms_versions where version = $1", [RUN]);
  await app?.close();
  await authFixture?.pool.end();
  await fixturePool?.end();
  await admin?.end();
});

describe("K-51 登録する：状態 × 入口 × 利用者の状態", () => {
  it("K51-API-001 無し × 登録の画面から送る：保留の申し込みを 1 行作り、確認のメールを 1 通送る。本人・会社はまだ作らない", async () => {
    const e = email("new");
    const r = await signup(okBody("new"));
    expect(r.status, await r.clone().text()).toBe(201);
    const signupToken = await signupTokenOf(r);
    const j = await json(r);
    expect(j.data).toMatchObject({ email: e, sent: true, mail_error: null });
    expect(typeof j.data!["expires_at"]).toBe("string");
    const rows = await pending(e);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("高本 聖斗");
    expect(rows[0]!.company_name).toBe("株式会社テスト");
    expect(rows[0]!.sent_at).not.toBeNull();
    expect(rows[0]!.consumed_at).toBeNull();
    // 期限は 30 分（DB の時刻で）
    const left = (new Date(rows[0]!.expires_at).getTime() - Date.now()) / 60_000;
    expect(left).toBeGreaterThan(29);
    expect(left).toBeLessThanOrEqual(30.5);
    expect(mailsTo(e)).toHaveLength(1);
    // 印は確認のメールのリンクの手がかりとは別の値（印だけで登録を確定できてはいけない）
    expect(signupToken).not.toBe(tokenOf(mailsTo(e)[0]!));
    const u = await admin.query('select 1 from kaname_auth."user" where email = $1', [e]);
    expect(u.rowCount).toBe(0); // 確定はメールのリンクを押した時点（K-52）
  });

  it("K51-API-002 保留中（期限内）× 同じメールで送る：上書きして新しいメールを送る。前のリンクの手がかりはもう今の申し込みを指さない", async () => {
    const e = email("again");
    expect((await signup(okBody("again"))).status).toBe(201);
    const first = await pending(e);
    const r = await signup(okBody("again", { name: "高本 二回目" }));
    expect(r.status).toBe(201);
    const rows = await pending(e);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("高本 二回目");
    expect(rows[0]!.token_hash).not.toBe(first[0]!.token_hash);
    const ms = mailsTo(e);
    expect(ms).toHaveLength(2);
    expect(hashPendingToken(tokenOf(ms[1]!))).toBe(rows[0]!.token_hash); // 新しいリンクが今の申し込み
    expect(hashPendingToken(tokenOf(ms[0]!))).not.toBe(rows[0]!.token_hash); // 前のリンクは使えない
  });

  it("K51-API-003 保留中（期限切れ・30 分を過ぎた）× 同じメールで送る：新しく作り直す（期限切れは無いのと同じ）", async () => {
    const e = email("expired");
    expect((await signup(okBody("expired"))).status).toBe(201);
    await expire(e);
    const old = (await pending(e))[0]!;
    const r = await signup(okBody("expired"));
    expect(r.status).toBe(201);
    const now = (await pending(e))[0]!;
    expect(new Date(now.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(now.token_hash).not.toBe(old.token_hash);
    expect(mailsTo(e)).toHaveLength(2);
  });

  it("K51-API-004 確定済み × 同じメールで送る：409・E-CONF-001。申し込みは作らず、メールも送らない", async () => {
    const e = email("done");
    await signUp(authFixture.auth, { email: e, password: PW, name: "確定 済子", companyName: "確定済み社" });
    const r = await signup(okBody("done", { email: e.toUpperCase() }));
    expect(r.status).toBe(409);
    const j = await json(r);
    expect(j["code"]).toBe("E-CONF-001");
    expect(j["message"]).toBe(
      "このメールアドレスは既に登録されています。ログインするか、パスワードを再設定してください",
    );
    expect(await pending(e)).toHaveLength(0);
    expect(mailsTo(e)).toHaveLength(0);
  });
});

describe("K-51 申し込みの今の状態（getSignupStatus）と送り直し（resendSignupEmail）：申し込みの印で引く（D-128.142）", () => {
  it("K51-API-005 待つ画面の再読み込み：印で引くと、期限内なら pending・メール・期限。申し込みは二重にならず、状態を見ただけでは送らない", async () => {
    const e = email("st-pending");
    const t = await signupOk("st-pending");
    const r = await status(t);
    expect(r.status, await r.clone().text()).toBe(200);
    const j = await json(r);
    expect(j.data).toMatchObject({ state: "pending", email: e });
    expect(typeof j.data!["expires_at"]).toBe("string");
    expect(await pending(e)).toHaveLength(1);
    expect(mailsTo(e)).toHaveLength(1);
  });

  it("K51-API-006 長く放っておいてから待つ画面に戻る：印の申し込みの期限が切れていれば expired（「期限が切れました。もう一度登録してください」の元）", async () => {
    const e = email("st-expired");
    const t = await signupOk("st-expired");
    await expire(e);
    const j = await json(await status(t));
    expect(j.data).toMatchObject({ state: "expired" });
  });

  it("K51-API-007 別の端末で確定した後に待つ画面を再読み込み：印で引くと registered（「登録は確認まで終わっています。ログインへ」の元・D-088.9）", async () => {
    const e = email("st-done");
    const t = await signupOk("st-done");
    // 別の端末で確認のリンクを押して確定した（K-52 の確定を通さず、本人を直に作り、申し込みを使い終わりにする）
    await signUp(authFixture.auth, { email: e, password: PW, name: "確定 済子" });
    await admin.query("update kaname_auth.pending_signup set consumed_at = now() where email = $1", [e]);
    const j = await json(await status(t));
    expect(j.data).toMatchObject({ state: "registered" });
  });

  it("K51-API-008 印が無い・知らない印・上書きされた前の印：知らない印は none（メールも期限も出さない）。印が無ければ状態を返さない", async () => {
    // 知らない印（推し量った値）
    const unknown = await json(await status("x".repeat(43)));
    expect(unknown.data).toMatchObject({ state: "none" });
    expect(unknown.data!["email"] ?? null).toBeNull();
    expect(unknown.data!["expires_at"] ?? null).toBeNull();
    // 同じメールでもう一度送られて上書きされた前の申し込みの印は、今の申し込みを引けない
    const e = email("st-replaced");
    const first = await signupOk("st-replaced");
    const second = await signupOk("st-replaced");
    expect(second).not.toBe(first);
    const old = await json(await status(first));
    expect(old.data).toMatchObject({ state: "none" });
    expect(JSON.stringify(old)).not.toContain(e);
    expect((await json(await status(second))).data).toMatchObject({ state: "pending", email: e });
    // 印を渡さない：状態を返さない（4xx）
    const none = await status(null);
    expect(none.status).toBeGreaterThanOrEqual(400);
    expect(none.status).toBeLessThan(500);
    expect((await json(none)).data?.["state"]).toBeUndefined();
  });

  it("K51-API-029 メールで引こうとする（?email=）：受け付けない。登録済み・保留中・申し込み無しのどのメールでも同じ答えで、状態もメールも出さない", async () => {
    const done = email("probe-st-done");
    await signUp(authFixture.auth, { email: done, password: PW, name: "探られ 太郎" });
    const held = email("probe-st-pending");
    await signupOk("probe-st-pending");
    const none = email("probe-st-none");
    const answers: { status: number; body: string }[] = [];
    for (const e of [done, held, none]) {
      const r = await status(null, `?email=${encodeURIComponent(e)}`);
      const body = await r.text();
      expect(r.status, `?email=${e} は受け付けない`).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      for (const word of ["registered", "pending", "expired", e, e.split("@")[0]!]) expect(body).not.toContain(word);
      answers.push({ status: r.status, body });
    }
    // 3 つの答えが全く同じ（違いから登録の有無を読み取れない）
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // 印と一緒にメールを渡しても、メールは見ない（印の申し込みの状態だけを返す）
    const t = await signupOk("probe-st-mixed");
    const mixed = await json(await status(t, `?email=${encodeURIComponent(done)}`));
    expect(mixed.data).toMatchObject({ state: "pending", email: email("probe-st-mixed") });
  });

  it("K51-API-009 送り直す（期限内・印で）：新しいメールを 1 通・リンクの手がかりが替わる・申し込みは 1 行のまま。印はそのまま使える", async () => {
    const e = email("rs");
    const t = await signupOk("rs");
    const before = (await pending(e))[0]!;
    const r = await resend(t);
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await json(r)).data).toMatchObject({ email: e, sent: true, pending: true });
    const rows = await pending(e);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(before.token_hash);
    const ms = mailsTo(e);
    expect(ms).toHaveLength(2);
    expect(hashPendingToken(tokenOf(ms[1]!))).toBe(rows[0]!.token_hash);
    expect((await json(await status(t))).data).toMatchObject({ state: "pending", email: e });
  });

  it("K51-API-010 送り直す（確定済み・知らない印・印が無い）：送ったとは言わない。確定済みは registered、知らない印は pending=false。メールは出ない", async () => {
    const done = email("rs-done");
    const t = await signupOk("rs-done");
    await signUp(authFixture.auth, { email: done, password: PW, name: "確定 済子" });
    await admin.query("update kaname_auth.pending_signup set consumed_at = now() where email = $1", [done]);
    const sentBefore = mailsTo(done).length;
    const a = await json(await resend(t));
    expect(a.data).toMatchObject({ sent: false, registered: true });
    expect(mailsTo(done)).toHaveLength(sentBefore);
    const b = await json(await resend("y".repeat(43)));
    expect(b.data).toMatchObject({ sent: false, pending: false });
    expect(b.data!["email"] ?? null).toBeNull();
    const total = mails.length;
    const c = await resend(null);
    expect(c.status).toBeGreaterThanOrEqual(400);
    expect(c.status).toBeLessThan(500);
    expect(mails.length).toBe(total);
  });

  it("K51-API-030 送り直しをメールで頼む（本文の email だけ）：受け付けない。登録済み・保留中・申し込み無しのどれでも同じ答えで、メールは 1 通も出ない", async () => {
    const done = email("probe-rs-done");
    await signUp(authFixture.auth, { email: done, password: PW, name: "探られ 花子" });
    const held = email("probe-rs-pending");
    await signupOk("probe-rs-pending");
    const none = email("probe-rs-none");
    const total = mails.length;
    const answers: { status: number; body: string }[] = [];
    for (const e of [done, held, none]) {
      const r = await resend(null, { email: e });
      const body = await r.text();
      expect(r.status, `本文の email=${e} だけでは送り直さない`).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      for (const word of ["registered", e]) expect(body).not.toContain(word);
      answers.push({ status: r.status, body });
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(mails.length).toBe(total); // 誰のメールにも送らない（他人の宛先へ送りつけられない）
  });
});

describe("K-51 入力", () => {
  it("K51-API-011 メールが空・形が違う：422・E-VAL-004・欄は email。申し込みは作らない", async () => {
    for (const bad of ["", "abc@", "abc@example", "a b@example.com"]) {
      const r = await signup(okBody("x", { email: bad }));
      expect(r.status, `「${bad}」`).toBe(422);
      const j = await json(r);
      expect(j["code"]).toBe("E-VAL-004");
      expect(fieldsOf(j)).toContain("email");
    }
  });

  it("K51-API-012 メールの大文字小文字・前後の空白・全角：正規化して同じ人として扱う（申し込みは 1 行）", async () => {
    const e = email("norm");
    const [local, domain] = e.split("@") as [string, string];
    // eslint-disable-next-line no-irregular-whitespace -- 全角の空白と全角の＠を意図して入れる（表記ゆらぎ）
    const raw = `　${local.toUpperCase()}＠${domain.toUpperCase()} `;
    const r = await signup(okBody("norm", { email: raw }));
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await json(r)).data).toMatchObject({ email: e });
    expect((await signup(okBody("norm", { email: ` ${e} ` }))).status).toBe(201);
    expect(await pending(e)).toHaveLength(1);
    expect(mailsTo(e)).toHaveLength(2); // 宛先は正規化したメール
  });

  it(`K51-API-013 名前が空・長さの上限（${NAME_MAX} 文字）：空と ${NAME_MAX + 1} 文字は 422・E-VAL-010「名前を入れてください」・欄は name、${NAME_MAX} 文字は通る`, async () => {
    for (const [tag, name] of [
      ["nm-empty", ""],
      ["nm-space", "　 "],
      ["nm-long", "あ".repeat(NAME_MAX + 1)],
    ] as const) {
      const r = await signup(okBody(tag, { name }));
      expect(r.status, tag).toBe(422);
      const j = await json(r);
      expect(j["code"], tag).toBe("E-VAL-010");
      expect(j["message"], tag).toBe("名前を入れてください");
      expect(fieldsOf(j), tag).toContain("name");
      expect(await pending(email(tag))).toHaveLength(0);
    }
    expect((await signup(okBody("nm-max", { name: "あ".repeat(NAME_MAX) }))).status).toBe(201);
  });

  it("K51-API-014 会社名が空：個人のテナントの申し込みとして通る（会社名は空のまま預け、確定のときに本人の名前で作る・D-125.135）", async () => {
    for (const [tag, extra] of [
      ["co-empty", { company_name: "" }],
      ["co-missing", {}],
    ] as const) {
      const b: Record<string, unknown> = { ...okBody(tag), ...extra };
      if (tag === "co-missing") delete b["company_name"];
      const r = await signup(b);
      expect(r.status, `${tag} ${await r.clone().text()}`).toBe(201);
      const row = (await pending(email(tag)))[0]!;
      expect(["", null]).toContain(row.company_name);
      expect(row.name).toBe("高本 聖斗");
    }
  });

  it(`K51-API-015 会社名の長さの上限（${COMPANY_MAX} 文字）と表記ゆれ：${COMPANY_MAX + 1} 文字は 422・欄は company_name。全角英数・前後の空白は直して預ける`, async () => {
    const r = await signup(okBody("co-long", { company_name: "社".repeat(COMPANY_MAX + 1) }));
    expect(r.status).toBe(422);
    expect(fieldsOf(await json(r))).toContain("company_name");
    expect((await signup(okBody("co-max", { company_name: "社".repeat(COMPANY_MAX) }))).status).toBe(201);
    expect((await signup(okBody("co-norm", { company_name: "　株式会社ＡＢＣ " }))).status).toBe(201);
    expect((await pending(email("co-norm")))[0]!.company_name).toBe("株式会社ABC");
  });

  it("K51-API-016 パスワード 11 文字／12 文字：11 は 422・E-VAL-005・欄は password、12 は通る", async () => {
    const r = await signup(okBody("pw11", { password: "abcdefgh123" }));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-VAL-005");
    expect(fieldsOf(j)).toContain("password");
    expect(await pending(email("pw11"))).toHaveLength(0);
    expect((await signup(okBody("pw12", { password: "abcdefgh1234" }))).status).toBe(201);
  });

  it("K51-API-017 漏れたパスワード：422・E-VAL-011「漏れたことのあるパスワードです。別のパスワードにしてください」・欄は password。外にはハッシュの頭 5 文字だけを送る", async () => {
    pwnedMode = "ok";
    const from = pwnedCalls.length;
    const r = await signup(okBody("leaked", { password: LEAKED_PW }));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j["code"]).toBe("E-VAL-011");
    expect(j["message"]).toBe("漏れたことのあるパスワードです。別のパスワードにしてください");
    expect(fieldsOf(j)).toContain("password");
    expect(await pending(email("leaked"))).toHaveLength(0);
    expect(mailsTo(email("leaked"))).toHaveLength(0);
    const calls = pwnedCalls.slice(from);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.pwnedpasswords.com/range/${sha1(LEAKED_PW).slice(0, 5)}`);
    const sent = calls.map((c) => c.url + c.body).join(" ");
    expect(sent).not.toContain(LEAKED_PW);
    expect(sent.toUpperCase()).not.toContain(sha1(LEAKED_PW).slice(5));
  });

  it("K51-API-018 入力に HTML や制御文字：500 にならず、保存は無害化（制御文字を除く・HTML は文字のまま）。NUL（\\u0000）だけは入口が 422（K-427）", async () => {
    const e = email("html");
    // K-427：NUL（Postgres の text に入らない字）は入口が 422・欄 name で断る（前は黙って取り除いて 201 にしていた）。登録の行は増えない
    const nul = await signup(okBody("html-nul", { name: "高本\u0000" }));
    expect(nul.status, await nul.clone().text()).toBe(422);
    const nulBody = (await nul.json()) as { code?: string; details?: { field: string }[] };
    expect(nulBody.code).toBe("VALIDATION_ERROR");
    expect((nulBody.details ?? []).map((d) => d.field)).toEqual(["name"]);
    expect(await pending(email("html-nul"))).toHaveLength(0);
    const r = await signup(
      okBody("html", { name: "<img src=x onerror=alert(1)>\u0001高本\u0007", company_name: "<b>社</b>\u001b" }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    const row = (await pending(e))[0]!;
    // eslint-disable-next-line no-control-regex -- 制御文字が残っていないことを見る
    const ctrl = /[\u0000-\u001f\u007f]/;
    expect(row.name).not.toMatch(ctrl);
    expect(row.company_name ?? "").not.toMatch(ctrl);
    expect(row.name).toContain("高本");
  });
});

describe("K-51 失敗", () => {
  // 照合のサービスが落ちている間（D-128.134・D-128.146）：登録は止めずに通し、毎回 security_events に pwned_check_unavailable を残す。
  //   運営へのメールは落ち始めの 1 通だけ（まだ運営が「確かめた」にしていない pwned_check_unavailable が他に無いときだけ）。
  //   「確かめた」は security_events への pwned_check_acknowledged の追記（追記専用の表なので行に印は付けない・migration 0086）。
  //   運営の画面とボタンは F12（K-72）。ここでは試験が「確かめた」を直に追記する
  const UNAVAILABLE = "pwned_check_unavailable";
  const unavailableCount = async () =>
    Number(
      (await admin.query<{ n: string }>("select count(*) as n from security_events where kind_id = $1", [UNAVAILABLE]))
        .rows[0]!.n,
    );
  /** 運営が「確かめた」にした（F12 のボタンが書くのと同じ追記） */
  const acknowledge = () =>
    admin.query(
      "insert into security_events (tenant_id, kind_id, detail) values (app.ops_tenant_id(), 'pwned_check_acknowledged', '{}'::jsonb)",
    );
  /** 照合を mode で失敗させて 1 回登録し、記録と運営へのメールの増え方を返す。メールもパスワードも記録と知らせに入らない */
  const failOnce = async (mode: Exclude<PwnedMode, "ok">, tag: string) => {
    pwnedMode = mode;
    try {
      const e = email(tag);
      const before = await unavailableCount();
      const opsBefore = mailsTo(OPS_EMAIL).length;
      const r = await signup(okBody(tag));
      expect(r.status, `${mode}：${await r.clone().text()}`).toBe(201);
      expect(await pending(e)).toHaveLength(1);
      expect(mailsTo(e)).toHaveLength(1);
      const ev = await admin.query<{ t: string }>(
        "select s::text as t from security_events s where kind_id = $1 order by occurred_at desc limit 1",
        [UNAVAILABLE],
      );
      expect(ev.rows[0]!.t).not.toContain(e); // 記録にメールもパスワードも入れない
      expect(ev.rows[0]!.t).not.toContain(PW);
      for (const m of mailsTo(OPS_EMAIL).slice(opsBefore)) {
        expect(m.text).not.toContain(e);
        expect(m.text).not.toContain(PW);
      }
      return { events: (await unavailableCount()) - before, ops: mailsTo(OPS_EMAIL).length - opsBefore };
    } finally {
      pwnedMode = "ok";
    }
  };

  it.each([
    ["down", "照合のサービスにつながらない"],
    ["http500", "照合のサービスが 500 を返す"],
    ["garbage", "照合の答えの形が違う（TP-EXT-02）"],
  ] as const)(
    "K51-API-019 %s：%s（確かめた後の落ち始め）→ 登録は止めずに通し、セキュリティの記録に残して運営に 1 通知らせる（D-128.134・D-128.146）",
    async (mode) => {
      await acknowledge();
      expect(await failOnce(mode, `pwned-${mode}`)).toEqual({ events: 1, ops: 1 });
    },
  );

  it("K51-API-031 落ち続ける：続けて落ちても運営へのメールは落ち始めの 1 通だけ。記録は毎回残る（D-128.146）", async () => {
    await acknowledge();
    expect(await failOnce("down", "pwned-run-1")).toEqual({ events: 1, ops: 1 });
    expect(await failOnce("http500", "pwned-run-2")).toEqual({ events: 1, ops: 0 });
    expect(await failOnce("garbage", "pwned-run-3")).toEqual({ events: 1, ops: 0 });
  });

  it("K51-API-032 運営が確かめた後にまた落ちる：また 1 通だけ知らせる（時間では間引かない・D-128.146）", async () => {
    await acknowledge();
    expect(await failOnce("down", "pwned-again-1")).toEqual({ events: 1, ops: 1 });
    expect(await failOnce("down", "pwned-again-2")).toEqual({ events: 1, ops: 0 });
    await acknowledge();
    expect(await failOnce("garbage", "pwned-again-3")).toEqual({ events: 1, ops: 1 });
    expect(await failOnce("http500", "pwned-again-4")).toEqual({ events: 1, ops: 0 });
  });

  it("K51-API-020 メールが送れない：申し込みは残し、送れなかったことを返す（sent=false・理由）。「送った」とは記録しない", async () => {
    const e = email("mailfail");
    failMailTo.add(e);
    try {
      const r = await signup(okBody("mailfail"));
      expect(r.status).toBe(201);
      const j = await json(r);
      expect(j.data).toMatchObject({ email: e, sent: false });
      expect(String(j.data!["mail_error"] ?? "")).not.toBe("");
      const row = (await pending(e))[0]!;
      expect(row.sent_at).toBeNull();
      expect(row.send_error).toBeTruthy();
    } finally {
      failMailTo.delete(e);
    }
  });

  it("K51-API-021 DB が落ちた（申し込みの書き込みが失敗）：503・申し込みは途中まで残らない・メールも出ない", async () => {
    const e = email("dbdown");
    await admin.query(`create or replace function kaname_auth.k51_fail() returns trigger language plpgsql as $$
      begin if new.email like '%-dbdown@example.com' then raise exception 'K-51 の試験：DB が落ちた'; end if; return new; end $$`);
    await admin.query(
      "create trigger k51_fail before insert or update on kaname_auth.pending_signup for each row execute function kaname_auth.k51_fail()",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await signup(okBody("dbdown"));
      expect(r.status).toBe(503);
      expect(await r.text()).not.toContain("K-51 の試験"); // 中の理由は応答に出さない
    } finally {
      spy.mockRestore();
      await admin.query("drop trigger if exists k51_fail on kaname_auth.pending_signup");
      await admin.query("drop function if exists kaname_auth.k51_fail()");
    }
    expect(await pending(e)).toHaveLength(0);
    expect(mailsTo(e)).toHaveLength(0);
  });
});

describe("K-51 操作の揺れ・守り", () => {
  it("K51-API-022 同じメールで同時に 2 回：申し込みは 1 行・どちらも 500 にならない・今の申し込みを指すリンクがちょうど 1 通", async () => {
    const e = email("race");
    const rs = await Promise.all([signup(okBody("race")), signup(okBody("race"))]);
    for (const r of rs) expect(r.status).toBeLessThan(500);
    expect(rs.some((r) => r.status === 201)).toBe(true);
    const rows = await pending(e);
    expect(rows).toHaveLength(1);
    const hits = mailsTo(e).filter((m) => hashPendingToken(tokenOf(m)) === rows[0]!.token_hash);
    expect(hits).toHaveLength(1);
  });

  it("K51-API-023 1 分に 11 回：11 回目は 429・待つ秒数（retry_after_sec）", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      const r = await signup(okBody(`rl-${i}`), ip);
      expect(r.status, `${i + 1} 回目は通る`).toBe(201);
    }
    const r = await signup(okBody("rl-10"), ip);
    expect(r.status).toBe(429);
    expect(Number((await json(r))["retry_after_sec"])).toBeGreaterThan(0);
    expect(await pending(email("rl-10"))).toHaveLength(0);
  });

  it("K51-API-024 登録済みかを探られる：409 は文言だけで、その人の名前・会社・日時など他の情報を出さない", async () => {
    const e = email("probe");
    await signUp(authFixture.auth, { email: e, password: PW, name: "探られ 太郎", companyName: "探られ社" });
    const r = await signup(okBody("probe"));
    expect(r.status).toBe(409);
    const text = await r.text();
    expect(text).not.toContain("探られ");
    const j = JSON.parse(text) as Record<string, unknown>;
    for (const k of ["data", "user", "user_id", "name", "created_at", "company_name"]) expect(j).not.toHaveProperty(k);
  });

  it("K51-API-025 ログ：登録の間に、パスワードもメールも申し込みの印もログに出ない（送れたとき・送れなかったときの両方）", async () => {
    const out: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))),
    );
    const e1 = email("log-ok");
    const e2 = email("log-fail");
    const tokens: string[] = [];
    failMailTo.add(e2);
    try {
      tokens.push(await signupOk("log-ok"));
      tokens.push(await signupOk("log-fail"));
      expect((await resend(tokens[0]!)).status).toBe(201);
      expect((await status(tokens[0]!)).status).toBe(200);
    } finally {
      failMailTo.delete(e2);
      for (const s of spies) s.mockRestore();
    }
    const all = out.join("\n");
    for (const secret of [PW, e1, e2, e1.split("@")[0]!, e2.split("@")[0]!]) expect(all).not.toContain(secret);
    for (const m of [...mailsTo(e1), ...mailsTo(e2)]) expect(all).not.toContain(tokenOf(m)); // リンクの手がかりも出さない
    for (const t of tokens) expect(all).not.toContain(t); // 申し込みの印も出さない
  });

  it("K51-API-026 DB の中：パスワードと申し込みの印は平文で無い・リンクの手がかりはハッシュだけ。メールの本文にもパスワードは無く、リンクは 30 分で切れると書く", async () => {
    const e = email("db");
    const signupToken = await signupOk("db");
    const text = await pendingText(e);
    expect(text).not.toContain(PW);
    expect(text).not.toContain(signupToken); // 申し込みの印も平文で残さない
    const m = mailsTo(e)[0]!;
    const token = tokenOf(m);
    expect(text).not.toContain(token);
    expect((await pending(e))[0]!.token_hash).toBe(hashPendingToken(token));
    expect(m.subject).toBe("Kaname｜メールアドレスの確認（登録を確定する）");
    expect(m.text).not.toContain(PW);
    expect(m.text).toContain("30 分");
    expect(m.text).toContain(`${config.webBaseUrl}/verify-email?token=`);
  });

  it("K51-API-027 規約の版：同意した利用規約とプライバシーポリシーの版（今の版）と時刻が申し込みに残る（D-128.137）", async () => {
    const e = email("terms");
    const t0 = Date.now();
    expect((await signup(okBody("terms"))).status).toBe(201);
    const row = (await pending(e))[0]!;
    expect(row.terms_version_id).toBe(termsId);
    expect(row.privacy_version_id).toBe(privacyId);
    expect(row.consented_at).not.toBeNull();
    const at = new Date(row.consented_at!).getTime();
    expect(at).toBeGreaterThanOrEqual(t0 - 5_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("K51-API-028 前の道すじは消えている：POST /api/auth-ext/sign-up・/signup-status・/resend-signup は無い（契約の口だけ）", async () => {
    expect((await req("POST", "/api/auth-ext/sign-up", okBody("old"))).status).toBe(404);
    expect((await req("GET", `/api/auth-ext/signup-status?email=${encodeURIComponent(email("old"))}`)).status).toBe(
      404,
    );
    expect((await req("POST", "/api/auth-ext/resend-signup", { email: email("old") })).status).toBe(404);
    expect(await pending(email("old"))).toHaveLength(0);
  });
});
