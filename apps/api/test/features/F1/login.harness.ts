// 段 2「ログインの口」（K-301 パスワード・K-302 確認のコード・K-306 ログアウト）の試験の共通の土台。行（it）は葉ごとのファイル
//   sign-in.test.ts（K-301）・sign-in-code.test.ts（K-302）・sign-out.test.ts（K-306）にある。土台は各ファイルの頭で setupLogin() を 1 回呼ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。間違っていると思ったら作る人に戻す。実装の前に流して赤を確かめない（D-128.143）。
//
// 組み立ては本番と同じ bootApi（apps/api/src/server.ts）。外に出るものは関門の差し込み口だけ差し替える（K-51・K-52 と同じ）:
//   ・mail … 関門 C6 の送出先（@kaname/notify の MailLike）。新しい端末の知らせのメールをここに貯める。failMailTo の宛先は送れなかったことにする
// 本人は、確定した本人を作る試験の道具 verifiedUser（apps/api/test/_pending.ts・K-52 の確定と同じ部品）で作る（規約にも同意済み・K-321 の試験の鍵つき）。
//   作った後、準備（登録の確定・2 段階を付ける）でできたセッションは閉じる（精査の後の決め 7）。生きたセッションは 0 から始まる。
// 2 段階は、ログインの部品の口を HTTP で通さず、@kaname/auth/two_factor の enableTotp → verifyTotp（ログイン中の本人として）で付ける。
// 時刻は眠らずに、DB の行の期限（login_attempts.locked_until・verification."expiresAt"・"twoFactor"."lockedUntil"）を now() からずらして進める（D-128.130）。
//
// 試験が決める口の形（K-301・K-302・K-306 の「口の形」。契約は 05_flow/screen_api.py の INPUTS・RESPONSES・ERRORS_4XX で直す）:
//   signInWithPassword  POST /api/v1/auth/sign-in            ← { email, password }（ほかの欄は 422）
//     201 { data: { token: string | null, two_factor: boolean, pending: string | null } }
//       ・2 段階なし：token にログインの印・two_factor=false・pending=null
//       ・2 段階あり：token=null・two_factor=true・pending に 2 段階の待ちの印（中身の見えない文字列・5 分）
//     401 { code: "E-AUTH-001", message: "メールアドレスかパスワードが違います。あと N 回で 15 分ロックします", remaining: N }
//     429 { code: "E-AUTH-002", message: errors.json の文, retry_after_sec, remaining: 0 }（ロック）／ 429 RATE_LIMITED（1 分に 11 回）
//     403 { code: "E-AUTH-007" }（会社の人が無い・抜けた）／ 422 E-VAL-008（空）・E-VAL-004（形）・VALIDATION_ERROR（知らない欄）／ 500 E-PAGE-003
//   verifySignInCode    POST /api/v1/auth/two-factor/verify  ← { pending, code } か { pending, backup_code }（ほかの欄は 422）
//     201 { data: { token: string, backup_codes_left: number } }
//     401 E-AUTH-004（コードが違う）・E-AUTH-013（待ちの印が切れた／使った／でたらめ）
//     429 E-AUTH-014（6 けたを 5 回違えた・retry_after_sec）／ 422 E-VAL-009（空・64 文字を超える）
//   signOut             POST /api/v1/auth/sign-out            ← {}（ほかの欄は 422）・ログインの印（Bearer）
//     201 { data: { signed_out: true } }／ 401 UNAUTHENTICATED ／ 429 RATE_LIMITED（1 分に 61 回・人ごと）／ 503 E-PAGE-003
// 足すエラーの番号は精査の後の決め 1 で決め打ちした（E-AUTH-013・014）。文は errors.json の目録（msg）と決めた文の両方で確かめる。
import { afterAll, beforeAll, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "@kaname/db/migrate";
import { migrateAuth } from "@kaname/auth/migrate";
import { createAuth } from "@kaname/auth";
import { createSessionResolver } from "@kaname/auth/resolver";
import { emailHash } from "@kaname/auth/signup";
import { enableTotp, verifyTotp } from "@kaname/auth/two_factor";
import { createPool } from "@kaname/db/pool";
import { CATALOG } from "@kaname/errors";
import type { Config } from "@kaname/config";
import type { MailLike } from "@kaname/notify";
import { bootApi, type BootOptions } from "../../../src/server.js";
import { keepAuth, verifiedUser } from "../../_pending.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PKG = join(HERE, "..", "..", "..", "..", "..", "packages", "db");
/** ログインの口の振る舞いの置き場（K-301・K-302・K-306 が作る。関門の静的な確かめが読む） */
export const FEATURE_DIR = join(HERE, "..", "..", "..", "src", "features", "F1", "login");
const ADMIN = process.env["DATABASE_URL"]!;
const APP_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const AUTH_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_auth:kaname_auth@");
const OPS_EMAIL = "ops-login@example.com";

export const PW = "correct-horse-battery-1";
export const SIGN_IN = "/api/v1/auth/sign-in";
export const VERIFY_CODE = "/api/v1/auth/two-factor/verify";
export const SIGN_OUT = "/api/v1/auth/sign-out";
/** 端末の見分け（device.ts の deviceOf：ブラウザ／OS）。違う 2 つ */
export const UA_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
export const UA_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ---- 決めた番号と文（D-128.141・精査の後の決め 1：番号は今ここで決め打ち。本線でぶつかったら段 2 の全部の葉で一括に付け替える） ----
export const TF_EXPIRED = "E-AUTH-013"; // 足す（待ちの印が切れた・K-302）
export const CODE_LOCKED = "E-AUTH-014"; // 足す（6 けたの止め・K-302）
export const LOCKED_MESSAGE = "15 分間ロックしました。15 分たってから、もう一度入ってください"; // E-AUTH-002 を直した文
export const TF_EXPIRED_MESSAGE = "時間が過ぎました。最初からログインし直してください"; // 足す（待ちの印が切れた）
export const CODE_LOCKED_MESSAGE = "コードを 5 回違えたので 15 分止めました。15 分たってから、もう一度入ってください"; // 足す（6 けたの止め）
/** E-AUTH-001 の文（残り回数を入れて組む） */
export const wrongMessage = (remaining: number) =>
  `メールアドレスかパスワードが違います。あと ${remaining} 回で 15 分ロックします`;

export const msg = (code: string) => CATALOG[code]?.message ?? `（errors.json に ${code} が無い）`;

/** TOTP の 6 けた（RFC 6238・SHA1・30 秒）。step は 30 秒の何個ぶんずらすか（-1 は 1 つ前のコード） */
export const totp = (secretBase32: string, step = 0): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, ""))
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + step));
  const h = createHmac("sha1", key).update(counter).digest();
  const off = h[h.length - 1]! & 0xf;
  const code =
    ((h[off]! & 0x7f) << 24) | ((h[off + 1]! & 0xff) << 16) | ((h[off + 2]! & 0xff) << 8) | (h[off + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
};
/** 30 秒の切れ目の直前（残り 3 秒より少ない）なら、切れ目を越えるまで待つ（1 つ前・2 つ前のコードの行が切れ目で揺れないように） */
export const awayFromStepEdge = async () => {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 50));
};

// ---- 関門 C6 の偽の送出先 ----
export interface SentMail {
  to: string;
  subject: string;
  text: string;
}
export const mails: SentMail[] = [];
export const failMailTo = new Set<string>();
const fakeMail: MailLike = {
  send: async (m) => {
    if (failMailTo.has(m.to)) return { error: { message: "daily quota exceeded" } };
    mails.push({ to: m.to, subject: m.subject, text: m.text });
    return { error: null };
  },
};

const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
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
  secretsMasterKey: MASTER_KEY,
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

export interface User {
  email: string;
  userId: string;
  memberId: string;
  tenantId: string;
  /** 2 段階を付けたときだけ：TOTP の鍵（base32）とバックアップコード 10 個 */
  secret?: string;
  backupCodes?: string[];
}

export interface Login {
  admin: pg.Pool;
  /** この回が作るものの印（メールの頭） */
  run: string;
  email: (tag: string) => string;
  nextIp: () => string;
  req: (
    method: string,
    path: string,
    body?: unknown,
    o?: { ip?: string; headers?: Record<string, string> },
  ) => Promise<Response>;
  json: (r: Response) => Promise<Record<string, unknown> & { data?: Record<string, unknown> }>;
  /** 契約の口でパスワードのログイン */
  signIn: (
    email: string,
    password?: string,
    o?: { ip?: string; ua?: string; headers?: Record<string, string> },
  ) => Promise<Response>;
  /** 契約の口で確認のコード */
  verifyCode: (body: Record<string, unknown>, o?: { ip?: string; ua?: string }) => Promise<Response>;
  /** 確定した本人を作る（2 段階を付けるかを選ぶ）。準備でできたセッションは閉じてから返す（決め 7・生きたセッションは 0 から始まる） */
  makeUser: (tag: string, o?: { twoFactor?: boolean; company?: string }) => Promise<User>;
  /** その印でログインできているか（本物のセッションの解き方で） */
  resolves: (token: string, ua?: string) => Promise<boolean>;
  /** その人の生きている sessions の数（revoked_at が空） */
  liveSessions: (memberId: string) => Promise<number>;
  /** 認証側（kaname_auth.session）のその本人の行の数 */
  authSessions: (userId: string) => Promise<number>;
  /** app.login_attempts のそのメールの行（無ければ undefined） */
  attempts: (email: string) => Promise<{ fails: number; locked_until: Date | null } | undefined>;
  /** console の出力を貯めて返す（fn の間だけ） */
  captureLogs: (fn: () => Promise<void>) => Promise<string>;
  /** 本物のログインの部品（試験の下ごしらえで部品の関数を直に呼ぶ） */
  auth: ReturnType<typeof createAuth>["auth"];
}

/** 各試験のファイルの頭で 1 回呼ぶ。beforeAll で本番と同じ bootApi を立て、afterAll で閉じる */
export function setupLogin(prefix: string): Login {
  const run = `${prefix}-${Date.now().toString(36)}`; // この回が作るものの印（終わったら消す・G-10）
  let ipSeq = Math.floor(Math.random() * 200);
  const nextIp = () => `198.51.100.${(ipSeq = (ipSeq % 250) + 1)}`;
  const email = (tag: string) => `${run}-${tag}@example.com`;
  const used = new Set<string>();
  let app: Awaited<ReturnType<typeof bootApi>>;
  let admin: pg.Pool;
  let fixturePool: pg.Pool;
  let made: ReturnType<typeof createAuth>;
  let resolve: ReturnType<typeof createSessionResolver>;

  beforeAll(async () => {
    await migrate(ADMIN, DB_PKG);
    await migrateAuth(ADMIN);
    admin = new pg.Pool({ connectionString: ADMIN, max: 3 });
    const seams: BootOptions = { bucketExists: async () => true, mail: fakeMail };
    app = await bootApi(config, seams);
    fixturePool = createPool({ databaseUrl: APP_URL, max: 2 });
    made = keepAuth(
      createAuth({
        authDatabaseUrl: AUTH_URL,
        appPool: fixturePool,
        secret: config.authSecret,
        baseURL: config.baseUrl,
      }),
    );
    resolve = createSessionResolver(made.auth, fixturePool);
  }, 60_000);

  afterAll(async () => {
    if (used.size > 0)
      await admin?.query("delete from app.login_attempts where email_hash = any($1)", [[...used].map(emailHash)]);
    await app?.close();
    await made?.pool.end();
    await fixturePool?.end();
    await admin?.end();
  });

  const req: Login["req"] = (method, path, body, o = {}) =>
    Promise.resolve(
      app.app.request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": o.ip ?? nextIp(), ...(o.headers ?? {}) },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
    );
  const json: Login["json"] = async (r) =>
    (await r.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
  const signIn: Login["signIn"] = (e, password = PW, o = {}) => {
    used.add(e);
    return req(
      "POST",
      SIGN_IN,
      { email: e, password },
      {
        ...(o.ip ? { ip: o.ip } : {}),
        headers: { ...(o.ua ? { "user-agent": o.ua } : {}), ...(o.headers ?? {}) },
      },
    );
  };
  const verifyCode: Login["verifyCode"] = (body, o = {}) =>
    req("POST", VERIFY_CODE, body, { ...(o.ip ? { ip: o.ip } : {}), headers: o.ua ? { "user-agent": o.ua } : {} });
  /** 登録の確定と 2 段階を付ける準備でできたセッションを閉じる（精査の後の決め 7）。
   *  ここからは、ログインの試験の要求でできたセッションだけが数に出る（「セッションが 0」「1 つ増える」を見る行が準備の分を数えない）。
   *  sessions の行は理由 logout で閉じ、認証側の行も消す（その印ではもう入れない） */
  const closeSignupSessions = async (u: User) => {
    await admin.query(
      "update sessions set revoked_at = now(), revoke_reason_id = 'logout' where member_id = $1 and revoked_at is null",
      [u.memberId],
    );
    await admin.query('delete from kaname_auth.session where "userId" = $1', [u.userId]);
  };
  const makeUser: Login["makeUser"] = async (tag, o = {}) => {
    const e = email(tag);
    used.add(e);
    const v = await verifiedUser(AUTH_URL, { email: e, password: PW, companyName: o.company ?? `会社 ${tag}` });
    const m = (
      await admin.query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from members where auth_user_id = $1 and deleted_at is null",
        [v.userId],
      )
    ).rows[0]!;
    const u: User = { email: e, userId: v.userId, memberId: m.id, tenantId: m.tenant_id };
    if (o.twoFactor) {
      const h = new Headers({ authorization: `Bearer ${v.token}` });
      const en = await enableTotp(made.auth, h, PW);
      const secret = new URL(en.totpURI).searchParams.get("secret")!;
      await verifyTotp(made.auth, h, totp(secret));
      u.secret = secret;
      u.backupCodes = en.backupCodes;
    }
    await closeSignupSessions(u);
    return u;
  };
  const resolves: Login["resolves"] = async (token, ua = UA_MAC) =>
    !!(await resolve(new Headers({ authorization: `Bearer ${token}`, "user-agent": ua })));
  const liveSessions: Login["liveSessions"] = async (memberId) =>
    Number(
      (
        await admin.query<{ n: string }>(
          "select count(*) as n from sessions where member_id = $1 and revoked_at is null and kind_id = 'web'",
          [memberId],
        )
      ).rows[0]!.n,
    );
  const authSessions: Login["authSessions"] = async (userId) =>
    Number(
      (await admin.query<{ n: string }>('select count(*) as n from kaname_auth.session where "userId" = $1', [userId]))
        .rows[0]!.n,
    );
  const attempts: Login["attempts"] = async (e) =>
    (
      await admin.query<{ fails: number; locked_until: Date | null }>(
        "select fails, locked_until from app.login_attempts where email_hash = $1",
        [emailHash(e)],
      )
    ).rows[0];
  const captureLogs: Login["captureLogs"] = async (fn) => {
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
  };

  return {
    get admin() {
      return admin;
    },
    run,
    email,
    nextIp,
    req,
    json,
    signIn,
    verifyCode,
    makeUser,
    resolves,
    liveSessions,
    authSessions,
    attempts,
    captureLogs,
    get auth() {
      return made.auth;
    },
  };
}

/** パスワードを通して 2 段階の待ちの印を受け取る（201・two_factor=true を確かめる） */
export async function pendingOf(h: Login, u: User, o: { ip?: string; ua?: string } = {}): Promise<string> {
  const r = await h.signIn(u.email, PW, o);
  expect(r.status, await r.clone().text()).toBe(201);
  const d = (await h.json(r)).data!;
  expect(d["two_factor"]).toBe(true);
  expect(typeof d["pending"]).toBe("string");
  return String(d["pending"]);
}

/** その本人の 2 段階の待ちの行（verification の 2fa-…・値が本人の id）の期限を、DB の now() からずらす */
export async function setPendingExpiry(h: Login, userId: string, sql: string): Promise<void> {
  await h.admin.query(
    `update kaname_auth.verification set "expiresAt" = ${sql}
       where identifier like '2fa-%' and identifier not like '2fa-attempts-%' and value = $1`,
    [userId],
  );
  await h.admin.query(
    `update kaname_auth.verification set "expiresAt" = ${sql}
       where identifier in (select '2fa-attempts-' || identifier from kaname_auth.verification
                             where identifier like '2fa-%' and identifier not like '2fa-attempts-%' and value = $1)`,
    [userId],
  );
}
