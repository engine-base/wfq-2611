// 段 4（F3 使い始めの準備）の「預けたログイン情報を PC が使う」口の試験の土台（K-355 が持ち込む・K-354 も使う）。
//   ログインの土台（F1/login.harness.ts の setupLogin：本番と同じ bootApi・本物の DB・本物のログインの部品・本物の関門 C8（開発の預かり先））の上に、
//   本人のログイン（2 段階つき・本人確認の取り直しまで）・PC をつなぐ・預ける・仕事を取る・取り出す・確かめの口の呼び方を足す。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。間違っていると思ったら作る人に戻す。実装の前に流して赤を確かめない（D-128.143）。
//
// 預けるのは契約の口 createCredential（K-352）で通す（値は預かり先にしか置けないので、DB に直に入れない）。体の形は下の cred() の 1 か所だけ：
//   POST /api/v1/credentials ← { name（英大文字・数字・_）, layer: "workspace"|"personal", kind: "login"|"key", login?, password?, two_factor?, totp_secret?,
//                                value?, destinations: string[], expires_on? } → 201 { data: { id, … } }（K-352 の INPUTS と同じ）
//   K-352 の形が変われば、ここだけを切る段でそろえる（K-354・K-355 の行は形に依らない）。
// 層の列・名前の列は K-351 の migration が足す（credentials.layer・credentials.name）。ここでは口だけを通し、列は読まない。
//
// 取り出しの封（K-354・D-128.57 ②④「平文を返さない形」）：PC はその回だけの鍵の組（X25519）を作り、公開の鍵を executor_key で送る。
//   口はその回だけの鍵の組を作って共有の鍵を出し、HKDF-SHA256（塩は空・info は "kaname.credential.v1:<job_id>:<credential_id>"・32 バイト）で
//   AES-256-GCM の鍵にし、AAD を "<job_id>:<credential_id>" にして値（JSON）を封じる。答えは server_key・iv・tag・ciphertext_for_executor（どれも base64）。
//   鍵の書き方：公開の鍵は SPKI の DER を base64（X25519 は 44 バイト）。開けるのは PC の秘密の鍵だけ（答えにも記録にも平文は無い）。
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { expect } from "vitest";
import { BRIDGE_PROTOCOL_MIN } from "../../../src/features/F3/connect-pc/hooks.js";
import { PW, VERIFY_CODE, msg, pendingOf, setupLogin, totp, type Login, type User } from "../F1/login.harness.js";
// 作り物の秘密の値は _fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K355_KEY_VALUE, K355_PASSWORD } from "../../_fake/secrets.js";

export { PW, msg, type User };
export const CREDENTIALS = "/api/v1/credentials";
export const CHECK = (id: string) => `${CREDENTIALS}/${id}/login-check`;
export const ANSWER = (id: string) => `${CREDENTIALS}/${id}/login-check/answer`;
export const REPORT = (id: string) => `/api/v1/bridge/credentials/${id}/check-result`;
export const RESOLVE = "/api/v1/bridge/credentials/resolve";

// ---- 足すエラーの番号（E-CRED の組。K-352 が 001〜007、K-354・K-355 は 010 から：まとめ役の割り当て） ----
export const E = {
  jobNotRunning: "E-CRED-010", // 動いている仕事のためにだけ取り出せる・知らせられる（403／409・K-355 が足す）
  revoked: "E-CRED-011", // 失効した・期限が切れた・預かり先の物が読めない（預け直す・K-355 が足す）
  checkBusy: "E-CRED-012", // いま確かめている（もう一度は押せない・K-355）
  notLogin: "E-CRED-013", // API キー・値はログインして確かめない（K-355）
  notAsked: "E-CRED-014", // いまはコードを頼まれていない（もう答えた・止まった・K-355）
  wrongPlace: "E-CRED-016", // 使える場所の外に入れようとした（403・持ち主に知らせる・K-354 が足す）
  codeEmpty: "E-VAL-009", // コードが空・64 文字を超える（前からある）
} as const;

export interface Who {
  user: User;
  /** 契約の口のログインの印（Bearer の中身・2 段階まで通した・本人確認を取り直した） */
  token: string;
  bearer: Record<string, string>;
}
export interface Pc {
  token: string;
  /** その PC の sessions の行の id */
  sessionId: string;
  headers: Record<string, string>;
}
export interface CredOpts {
  name?: string;
  layer?: "workspace" | "personal";
  kind?: "login" | "key";
  destinations?: string[];
  twoFactor?: "none" | "totp" | "sms" | "email" | "push";
  login?: string;
  password?: string;
  totpSecret?: string;
  value?: string;
  /** 期限の日（YYYY-MM-DD・日本の今日以降） */
  expiresOn?: string;
}
export interface Sealed {
  credential_id: string;
  kind: string;
  name: string;
  ciphertext_for_executor: string;
  server_key: string;
  iv: string;
  tag: string;
  destinations: string[];
  two_factor: string;
  expires_at: string | null;
}
export interface ExecutorKey {
  /** 送る公開の鍵（SPKI の DER の base64） */
  pub: string;
  /** 答えを開ける（開けなければ投げる） */
  open: (s: Sealed, jobId: string, credentialId: string) => Record<string, unknown>;
}

export interface CredHarness extends Login {
  /** 2 段階つきの本人を作り、ログインして本人確認を取り直す */
  who: (tag: string) => Promise<Who>;
  /** 同じアカウントの人を、ほかのワークスペースにも入れる（members と tenant_memberships の行・ログインは同じ）。返すのはそこでの member の id */
  joinWorkspace: (u: User, tenantId: string) => Promise<string>;
  /** PC をつなぐ（接続コード → 引き取り）。PC はアカウントのもの（D-128.150 ④） */
  pc: (w: Who) => Promise<Pc>;
  /** 預ける（契約の口 createCredential・K-352）。返すのは id */
  cred: (w: Who, o?: CredOpts) => Promise<string>;
  /** 仕事を取る（いちばん古い待ちの仕事。無ければ null） */
  take: (p: Pc) => Promise<(Record<string, unknown> & { job_id: string }) | null>;
  /** 待ちの仕事を全部取って終わらせる（試験の前に、預けた直後に積まれた確かめの仕事を片付ける） */
  drain: (p: Pc) => Promise<void>;
  /** 会話の仕事を 1 つ積む（その人・そのワークスペース）。返すのは仕事の id */
  chatJob: (memberId: string, tenantId: string) => Promise<string>;
  check: (w: Who, id: string) => Promise<Response>;
  answer: (w: Who, id: string, body: unknown) => Promise<Response>;
  report: (p: Pc, id: string, body: unknown) => Promise<Response>;
  resolve: (p: Pc, body: unknown) => Promise<Response>;
  /** その回だけの鍵の組を作る */
  executorKey: () => ExecutorKey;
  credRow: (id: string) => Promise<Record<string, unknown>>;
  jobRow: (id: string) => Promise<Record<string, unknown>>;
  count: (sql: string, p?: unknown[]) => Promise<number>;
  /** その関数を kaname_app から一時的に呼べなくする（fn の間だけ・必ず戻す） */
  withoutFn: (signature: string, fn: () => Promise<void>) => Promise<void>;
}

export const PROTOCOL = BRIDGE_PROTOCOL_MIN;
export const SEAL_ALG_INFO = (jobId: string, credentialId: string) => `kaname.credential.v1:${jobId}:${credentialId}`;

/** 試験の側の封の開け方（契約の正本は上の説明。実装と別に書く） */
export function makeExecutorKey(): ExecutorKey {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const open = (s: Sealed, jobId: string, credentialId: string): Record<string, unknown> => {
    const serverPub: KeyObject = createPublicKey({
      key: Buffer.from(s.server_key, "base64"),
      format: "der",
      type: "spki",
    });
    const shared = diffieHellman({ privateKey, publicKey: serverPub });
    const key = Buffer.from(
      hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from(SEAL_ALG_INFO(jobId, credentialId)), 32),
    );
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
    d.setAAD(Buffer.from(`${jobId}:${credentialId}`));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    const plain = Buffer.concat([d.update(Buffer.from(s.ciphertext_for_executor, "base64")), d.final()]).toString(
      "utf8",
    );
    return JSON.parse(plain) as Record<string, unknown>;
  };
  return { pub, open };
}

/** 封の偽物（鍵の違う相手に封じた物）を作る：開けられないことを見る行で使う */
export function sealFor(
  executorPub: string,
  payload: unknown,
  jobId: string,
  credentialId: string,
): Omit<Sealed, "credential_id" | "kind" | "name" | "destinations" | "two_factor" | "expires_at"> {
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({
    privateKey: eph.privateKey,
    publicKey: createPublicKey({ key: Buffer.from(executorPub, "base64"), format: "der", type: "spki" }),
  });
  const key = Buffer.from(
    hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from(SEAL_ALG_INFO(jobId, credentialId)), 32),
  );
  const iv = Buffer.from(randomUUID().replace(/-/g, "").slice(0, 24), "hex");
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`${jobId}:${credentialId}`));
  const data = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return {
    server_key: eph.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    ciphertext_for_executor: data.toString("base64"),
  };
}

/** 各試験のファイルの頭で 1 回呼ぶ */
export function setupCredentialDevice(prefix: string): CredHarness {
  const h = setupLogin(prefix);

  const who: CredHarness["who"] = async (tag) => {
    const user = await h.makeUser(tag, { twoFactor: true });
    const pending = await pendingOf(h, user);
    const v = await h.req("POST", VERIFY_CODE, { pending, code: totp(user.secret!) });
    expect(v.status, await v.clone().text()).toBe(201);
    const token = String((await h.json(v)).data!["token"]);
    const bearer = { authorization: `Bearer ${token}` };
    // 預ける・上書きは本人確認の取り直しが要る（D-125.139）。15 分効く
    //   同じ 6 けたの使い回しを断る部品なら、次の 30 秒のコードで取り直す（どちらかで 201 になることを確かめる）
    let s = await h.req(
      "POST",
      "/api/v1/auth/step-up",
      { password: PW, code: totp(user.secret!) },
      { headers: bearer },
    );
    if (s.status === 401)
      s = await h.req(
        "POST",
        "/api/v1/auth/step-up",
        { password: PW, code: totp(user.secret!, 1) },
        { headers: bearer },
      );
    expect(s.status, await s.clone().text()).toBe(201);
    return { user, token, bearer };
  };

  const joinWorkspace: CredHarness["joinWorkspace"] = async (u, tenantId) => {
    const scope = (
      await h.admin.query<{ id: string }>(
        "select id from scopes where tenant_id = $1 and deleted_at is null order by created_at limit 1",
        [tenantId],
      )
    ).rows[0]!.id;
    const id = (
      await h.admin.query<{ id: string }>(
        "insert into members (tenant_id, scope_id, kind_id, display_name) values ($1, $2, 'human', '同じ人（別のワークスペース）') returning id",
        [tenantId, scope],
      )
    ).rows[0]!.id;
    await h.admin.query(
      "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status, joined_at) values ($1, $2, $3, 'member', 'active', now())",
      [tenantId, id, u.userId],
    );
    return id;
  };

  const pc: CredHarness["pc"] = async (w) => {
    const c = await h.req("POST", "/api/v1/bridge/pairing-codes", {}, { headers: w.bearer });
    expect(c.status, await c.clone().text()).toBe(201);
    const code = String((await h.json(c)).data!["code"]);
    const cl = await h.req("POST", "/api/v1/bridge/claim", { code, device_label: "高本の MacBook" });
    expect(cl.status, await cl.clone().text()).toBe(201);
    const got = (await h.json(cl)).data!;
    const token = String(got["device_token"]);
    return { token, sessionId: String(got["device_id"]), headers: { "x-bridge-session": token } };
  };

  const cred: CredHarness["cred"] = async (w, o = {}) => {
    const kind = o.kind ?? "login";
    const body: Record<string, unknown> = {
      name: o.name ?? `HACCHU_${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      layer: o.layer ?? "personal",
      kind,
      destinations: o.destinations ?? ["hacchu-navi.example"],
      ...(o.expiresOn ? { expires_on: o.expiresOn } : {}),
      ...(kind === "login"
        ? {
            login: o.login ?? "me@example.com",
            password: o.password ?? K355_PASSWORD,
            two_factor: o.twoFactor ?? "none",
            ...(o.totpSecret ? { totp_secret: o.totpSecret } : {}),
          }
        : { value: o.value ?? K355_KEY_VALUE }),
    };
    const r = await h.req("POST", CREDENTIALS, body, { headers: w.bearer });
    expect(r.status, await r.clone().text()).toBe(201);
    return String((await h.json(r)).data!["id"]);
  };

  const take: CredHarness["take"] = async (p) => {
    const r = await h.req(
      "POST",
      "/api/v1/bridge/jobs/take",
      { wait_sec: 0, protocol: PROTOCOL, idle: false },
      { headers: p.headers },
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await h.json(r)).data!["job"] as (Record<string, unknown> & { job_id: string }) | null) ?? null;
  };
  const drain: CredHarness["drain"] = async (p) => {
    for (let i = 0; i < 20; i++) {
      const j = await take(p);
      if (!j) return;
      await h.admin.query("update bridge_jobs set state_id = 'done', finished_at = now() where id = $1", [j.job_id]);
    }
  };
  const chatJob: CredHarness["chatJob"] = async (memberId, tenantId) =>
    (
      await h.admin.query<{ id: string }>(
        `insert into bridge_jobs (tenant_id, scope_id, member_id, conversation_id, prompt, created_by, kind)
         select $2, m.scope_id, $1, null, '見積を作る', $1, 'chat' from members m where m.id = $1 returning id`,
        [memberId, tenantId],
      )
    ).rows[0]!.id;

  const credRow: CredHarness["credRow"] = async (id) =>
    (
      await h.admin.query(
        "select login_check_state, login_check_detail, login_check_at, use_count, last_used_at, revoked_at, deleted_at from credentials where id = $1",
        [id],
      )
    ).rows[0] as Record<string, unknown>;
  const jobRow: CredHarness["jobRow"] = async (id) =>
    (
      await h.admin.query(
        "select state_id, kind, credential_id, prompt, result, stopped_reason, taken_session_id from bridge_jobs where id = $1",
        [id],
      )
    ).rows[0] as Record<string, unknown>;
  const count: CredHarness["count"] = async (sql, p = []) =>
    Number((await h.admin.query<{ n: string }>(sql, p)).rows[0]!.n);
  const withoutFn: CredHarness["withoutFn"] = async (signature, fn) => {
    await h.admin.query(`revoke execute on function ${signature} from kaname_app`);
    try {
      await fn();
    } finally {
      await h.admin.query(`grant execute on function ${signature} to kaname_app`);
    }
  };

  // h の admin・auth は beforeAll の後に決まる（getter）。値を写さず、毎回 h から読む
  return {
    get admin() {
      return h.admin;
    },
    get auth() {
      return h.auth;
    },
    run: h.run,
    email: h.email,
    nextIp: h.nextIp,
    req: h.req,
    json: h.json,
    signIn: h.signIn,
    verifyCode: h.verifyCode,
    makeUser: h.makeUser,
    resolves: h.resolves,
    liveSessions: h.liveSessions,
    authSessions: h.authSessions,
    attempts: h.attempts,
    captureLogs: h.captureLogs,
    who,
    joinWorkspace,
    pc,
    cred,
    take,
    drain,
    chatJob,
    check: (w: Who, id: string) => h.req("POST", CHECK(id), {}, { headers: w.bearer }),
    answer: (w: Who, id: string, body: unknown) => h.req("POST", ANSWER(id), body, { headers: w.bearer }),
    report: (p: Pc, id: string, body: unknown) => h.req("POST", REPORT(id), body, { headers: p.headers }),
    resolve: (p: Pc, body: unknown) => h.req("POST", RESOLVE, body, { headers: p.headers }),
    executorKey: makeExecutorKey,
    credRow,
    jobRow,
    count,
    withoutFn,
  };
}
