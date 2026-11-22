// PC がログイン情報を取り出す口（K-354・契約の口 resolveCredential・POST /api/v1/bridge/credentials/resolve・D-128.57 ①②④・D-102.2・関門 C2・C8）。
//   取り出せるのは、つないだ PC が取った動いている仕事のためだけ・個人の物は持ち主の仕事・ワークスペースの物はそのワークスペースの人の仕事・
//   入れる場所（宛先の名前）が使える場所の中のときだけ。答えは平文を返さない形：PC がその回だけの X25519 の公開の鍵を送り、
//   口はその回だけの鍵の組で共有の鍵を出して HKDF-SHA256 → AES-256-GCM で封じる（PC の秘密の鍵でしか開けない）。
//   判定と記録は DB の関数（20261119120700）。値は預かり先から関門 C8（secrets.resolve・caller executor）で読み、その場で封じる。
//   値・ログイン名・場所の名前は答え（封の外）・ログ・証跡に出さない（ログは場所と例外の種類だけ）。Cache-Control: private, no-store は入口（app.ts）が付ける
import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import type pg from "pg";
import { kanameError } from "@kaname/errors";
import type { SecretsGateway } from "@kaname/secrets";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { hostAllowed, hostnameOf } from "./host.js";
import { invalid, isReply } from "./input.js";
import { kindOf, unavailable } from "./vault.js";

/** 口が使う材料 */
export interface ResolveDeps {
  appPool: pg.Pool;
  secrets: SecretsGateway;
}

/** 宛先の名前の長さの上限（DNS の名前の上限） */
export const HOST_MAX = 253;
/** 入れる場所の字数の上限（契約の maxLength と同じ・screen_api.d/K-354.py） */
const DESTINATION_MAX = 2048;
/** PC の公開の鍵：X25519 の SPKI の DER（44 バイト）を base64 */
const EXECUTOR_KEY_BYTES = 44;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** 封の決まり（契約の正本・試験の土台 credential-device.harness.ts の説明と同じ） */
export const sealInfo = (jobId: string, credentialId: string): string =>
  `kaname.credential.v1:${jobId}:${credentialId}`;
const sealAad = (jobId: string, credentialId: string): string => `${jobId}:${credentialId}`;

const gone = (): HookReply => ({ status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } });
const notFound = (): HookReply => ({ status: 404, body: { error: "not_found", code: "NOT_FOUND" } });
/** この口は「動いていない仕事」「失効」も使える場所の外と同じく止める側の 403（目録の類の既定の番号でなく、口の決まり） */
const forbidden = (code: string, extra: Record<string, unknown> = {}): HookReply => ({
  status: 403,
  body: { ...kanameError(code).toJSON(), ...extra },
});

/** 判定の関数の答え（誤りか、取り出しに要る列） */
interface Allowed {
  vault_ref: string;
  kind_id: string | null;
  name: string;
  destinations: string[];
  two_factor_id: string | null;
  expires_at: string | null;
  tenant_id: string;
  member: string;
}
const ERROR_REPLIES: Readonly<Record<string, () => HookReply>> = {
  not_found: notFound,
  not_running: () => forbidden("E-CRED-010"),
  revoked: () => forbidden("E-CRED-011"),
};

/** ① PC の公開の鍵を読む。base64 で 44 バイトの X25519 の SPKI でなければ null */
export function readExecutorKey(v: unknown): KeyObject | null {
  if (typeof v !== "string" || !BASE64_RE.test(v)) return null;
  const der = Buffer.from(v, "base64");
  if (der.length !== EXECUTOR_KEY_BYTES) return null;
  try {
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return key.asymmetricKeyType === "x25519" ? key : null;
  } catch {
    return null;
  }
}

/** 入口が字をそろえる前の体（宛先だけはこの字で名前を取り出す：入口の NFKC が全角の区切り ／ ＃ ？ ＼ を半角にすると、
 *  ブラウザが読む行き先と違う名前になるため）。形（欄の型・知らない欄）は入口が契約の strict な形で確かめ済み */
async function rawBody(a: HookArgs): Promise<Record<string, unknown>> {
  const raw = (await a.c.req.json().catch(() => ({}))) as unknown;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

interface ResolveInput {
  job: string;
  credential: string;
  /** 送られたままの宛先 */
  destination: string;
  /** 宛先から取り出した名前（知らせと証跡に書くのはこれだけ）。名前に読めない・253 文字を超える宛先は null（使える場所に入りようが無いので③で 403） */
  host: string | null;
  executor: KeyObject;
}

/** ① 体の形：job_id・credential_id は文字（uuid の形は入口が確かめ済み）、宛先は文字、PC の鍵は X25519（形は入口の契約の pattern が確かめ済み）。
 *  宛先が名前に読めないのは形の誤りでなく使える場所の外（契約に書けない 422 は持たない・代表の答え answer=431fc50df51b・f0f290e785a9） */
export function parseResolve(input: Record<string, unknown>, raw: Record<string, unknown>): ResolveInput | HookReply {
  const job = typeof input["job_id"] === "string" ? input["job_id"] : "";
  if (!job) return invalid("job_id", "仕事の id が要ります");
  const credential = typeof input["credential_id"] === "string" ? input["credential_id"] : "";
  if (!credential) return invalid("credential_id", "ログイン情報の id が要ります");
  const destination = raw["destination"];
  // 契約の決まり（screen_api.d/K-354.py の VALUE_RANGES：pattern `\S`・maxLength 2048）と同じ数で生の字を照らす（空・空白だけは 422）
  if (typeof destination !== "string" || !/\S/.test(destination) || destination.length > DESTINATION_MAX)
    return invalid("destination", "入れる場所を入れてください");
  const named = hostnameOf(destination);
  const host = named !== null && named.length <= HOST_MAX ? named : null;
  const executor = readExecutorKey(input["executor_key"]);
  if (!executor) return invalid("executor_key", "PC の鍵（X25519 の公開の鍵）を送ってください");
  return { job, credential, destination, host, executor };
}

/** ⑦ 封じる：その回だけの鍵の組 → 共有の鍵 → HKDF-SHA256（塩は空・32 バイト）→ AES-256-GCM（iv 12 バイト・AAD は仕事と情報の id） */
export function seal(
  executor: KeyObject,
  plain: string,
  jobId: string,
  credentialId: string,
): { server_key: string; iv: string; tag: string; ciphertext_for_executor: string } {
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: executor });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from(sealInfo(jobId, credentialId)), 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(sealAad(jobId, credentialId)));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  key.fill(0);
  shared.fill(0);
  return {
    server_key: eph.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    ciphertext_for_executor: data.toString("base64"),
  };
}

/** ⑤ 預かり先の中身を、PC に渡す形に整える（ログインは { login, password, totp_secret }・API キーは { value }）。読めなければ null */
export function payloadOf(kind: "login" | "key", value: string): string | null {
  let v: Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (kind === "key")
    return typeof v["value"] === "string" && v["value"] ? JSON.stringify({ value: v["value"] }) : null;
  if (typeof v["login"] !== "string" || typeof v["password"] !== "string") return null;
  const totp = typeof v["totp_secret"] === "string" && v["totp_secret"] ? v["totp_secret"] : null;
  return JSON.stringify({ login: v["login"], password: v["password"], totp_secret: totp });
}

/** ④ 預かり先から読めなかったときの答え：断られた → 403 E-CRED-011（預け直す）・上限 → 503 E-SEC-003 と待つ秒数・届かない → 502 E-SEC-001 */
function vaultFailed(o: { status: "denied" | "failed"; handoff: string; retryAfterSec?: number }): HookReply {
  if (o.status === "denied") return forbidden("E-CRED-011");
  if (o.retryAfterSec) {
    const e = kanameError("E-SEC-003");
    return {
      status: 503,
      body: {
        ...e.toJSON(),
        message: e.entry.message.replace("◯", String(o.retryAfterSec)),
        retry_after_sec: o.retryAfterSec,
      },
    };
  }
  return { status: 502, body: { ...kanameError("E-SEC-001").toJSON(), handoff: o.handoff } };
}

const expiresOf = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

export function createResolveCredential(d: ResolveDeps): (a: HookArgs) => Promise<HookReply> {
  const call = async <T>(sql: string, args: unknown[]): Promise<T | undefined> =>
    (await d.appPool.query<{ v: T }>(sql, args)).rows[0]?.v;

  return async (a: HookArgs): Promise<HookReply> => {
    const sid = a.ctx.sessionId ?? null;
    if (!sid) return gone();
    // ① 体の形（DB にも預かり先にも触る前）
    const p = parseResolve(a.input, await rawBody(a));
    if (isReply(p)) return p;
    // ② 取り出してよいか（その PC の動いている仕事・持ち主か範囲の人・生きている情報）
    let v: (Partial<Allowed> & { error?: unknown }) | undefined;
    try {
      v = await call<Partial<Allowed> & { error?: unknown }>("select app.bridge_credential_for_job($1, $2, $3) as v", [
        sid,
        p.job,
        p.credential,
      ]);
    } catch (e) {
      console.error(`[credentials] 取り出しの判定ができなかった（${kindOf(e)}）`);
      return unavailable();
    }
    if (!v) return unavailable();
    const err = typeof v.error === "string" ? ERROR_REPLIES[v.error] : undefined;
    if (err) return err();
    if (typeof v.vault_ref !== "string" || typeof v.tenant_id !== "string" || typeof v.member !== "string")
      return unavailable();
    // ③ 使える場所の合わせ（入口の前の字の宛先で）。外なら止めて持ち主に知らせる（知らせが残せなくても止める）
    if (p.host === null) return forbidden("E-CRED-016"); // 名前に読めない宛先：名前が無いので知らせも証跡も残さない
    if (!hostAllowed(p.destination, Array.isArray(v.destinations) ? v.destinations : [])) {
      try {
        await d.appPool.query("select app.credential_wrong_place($1, $2, $3, $4)", [sid, p.job, p.credential, p.host]);
      } catch (e) {
        console.error(`[credentials] 使える場所の外の知らせを残せなかった（情報 ${p.credential}・${kindOf(e)}）`);
      }
      return forbidden("E-CRED-016");
    }
    const kind: "login" | "key" = v.kind_id === "api_key" ? "key" : "login";
    // ④ 預かり先から読む（関門 C8・実行器として）
    const o = await d.secrets.resolve(v.vault_ref, {
      tenantId: v.tenant_id,
      userId: v.member,
      role: "member",
      caller: "executor",
    });
    if (o.status !== "done") return vaultFailed(o);
    // ⑤ 中身を読む（読めなければ預け直す）
    const plain = payloadOf(kind, o.value);
    if (plain === null) return forbidden("E-CRED-011");
    // ⑥ 使った記録（記録できない取り出しはしない）
    try {
      await d.appPool.query("select app.credential_used($1, $2, $3)", [sid, p.job, p.credential]);
    } catch (e) {
      console.error(`[credentials] 取り出しの記録を残せなかった（情報 ${p.credential}・${kindOf(e)}）`);
      return unavailable();
    }
    // ⑦ 封じて返す。平文はこの関数の中だけ（封じた後は答えに封だけが載り、戻れば参照は無くなる）
    const sealed = seal(p.executor, plain, p.job, p.credential);
    return {
      status: 201,
      body: {
        data: {
          credential_id: p.credential,
          kind,
          name: typeof v.name === "string" ? v.name : "",
          destinations: Array.isArray(v.destinations) ? v.destinations : [],
          two_factor: typeof v.two_factor_id === "string" ? v.two_factor_id : "none",
          expires_at: expiresOf(v.expires_at),
          ...sealed,
        },
      },
    };
  };
}
