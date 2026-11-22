// 鍵を受け取る（T-B-05・D-102.2・D-017.1・K-354 で契約の口と封の形へつなぎ替えた）。Bridge は Infisical に入らない。
//   Kaname の取り出しの口（POST /api/v1/bridge/credentials/resolve）に、仕事・情報・入れる場所（宛先の名前）と、その回だけの X25519 の公開の鍵を送る。
//   口は平文を返さず、その鍵でしか開けない封で返す（HKDF-SHA256 → AES-256-GCM・契約の正本と同じ）。秘密の鍵はこの関数の中だけで持つ。
//   値は「いま動いている仕事」のためだけに、使う間（use の中）だけ持ち、終わったら捨てる。
//   ディスクに書かない・ログに出さない・AI には渡さない（AI が持つのは参照 ID だけ。道具の引数にも載せない：guard.ts D-107.7）。
//   受け取りが途中で切れた・中身が欠けている・封が開けられない・届かないときは成功にしない（G-15・G-11）。理由は値を含まない文で返す
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from "node:crypto";
import { BRIDGE_UA, UUID_RE } from "./pairing";
export { hostAllowed, hostnameOf } from "./host";

export type TwoFactor = "none" | "totp" | "sms" | "email" | "push";
export interface Credential {
  /** ログイン（ログイン名とパスワード）か API キー（値） */
  kind: "login" | "key";
  login: string;
  password: string;
  /** 認証アプリの秘密鍵（Base32）。無ければ null */
  totpSecret: string | null;
  /** API キーの値。ログインなら null */
  value: string | null;
  /** 預けたときの名前（本人に見せる文に使う） */
  name: string;
  /** 使える場所（宛先の名前。*. は下の名前だけ） */
  destinations: string[];
  /** 2 段階認証の種類（D-117.2）：none／totp（鍵から作る）／sms／email／push（本人に頼む） */
  twoFactor: TwoFactor;
}
export interface VaultDeps {
  apiBase: string;
  sessionId: () => string | null;
  /** 届かないときに待つ上限（既定 15 秒） */
  timeoutMs?: number;
}
/** 取り出しの頼み：仕事・情報・入れる場所（宛先の名前） */
export interface CredentialRequest {
  jobId: string;
  credentialId: string;
  destination: string;
}
export class CredentialError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "denied" | "notfound" | "incomplete" | "gone",
    readonly handoff: string | null = null,
  ) {
    super(message);
  }
}

const RESOLVE_PATH = "/api/v1/bridge/credentials/resolve";
const GONE = "この端末の接続は切れています。つなぎ直してください";
const BROKEN = "受け取ったログイン情報が欠けていたので使いません";
const TWO_FACTORS: readonly TwoFactor[] = ["none", "totp", "sms", "email", "push"];

/** 封（取り出しの口の 201 の data）。平文の欄（login・password・value）を持つ答えは封の形でないので使わない */
interface Sealed {
  kind: unknown;
  name: unknown;
  destinations: unknown;
  two_factor: unknown;
  server_key: string;
  iv: string;
  tag: string;
  ciphertext_for_executor: string;
}
function asSealed(d: unknown): Sealed | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const x = d as Record<string, unknown>;
  if ("login" in x || "password" in x || "value" in x || "totp_secret" in x) return null;
  for (const k of ["server_key", "iv", "tag", "ciphertext_for_executor"])
    if (typeof x[k] !== "string" || !x[k]) return null;
  return x as unknown as Sealed;
}

/** 封を開ける（開けなければ投げる）。共有の鍵は使ったら消す */
function open(
  s: Sealed,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  jobId: string,
  credentialId: string,
): string {
  const server = createPublicKey({ key: Buffer.from(s.server_key, "base64"), format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey, publicKey: server });
  const key = Buffer.from(
    hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from(`kaname.credential.v1:${jobId}:${credentialId}`), 32),
  );
  try {
    const dc = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
    dc.setAAD(Buffer.from(`${jobId}:${credentialId}`));
    dc.setAuthTag(Buffer.from(s.tag, "base64"));
    return Buffer.concat([dc.update(Buffer.from(s.ciphertext_for_executor, "base64")), dc.final()]).toString("utf8");
  } finally {
    key.fill(0);
    shared.fill(0);
  }
}

/** 開けた中身と封の外の欄から、use に渡す形を作る。欠けていれば null */
function credentialOf(s: Sealed, plain: string): Credential | null {
  let v: Record<string, unknown>;
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const kind = s.kind === "key" ? "key" : "login";
  const meta = {
    name: typeof s.name === "string" ? s.name : "",
    destinations: Array.isArray(s.destinations) ? s.destinations.filter((x): x is string => typeof x === "string") : [],
    twoFactor: TWO_FACTORS.includes(s.two_factor as TwoFactor) ? (s.two_factor as TwoFactor) : ("none" as const),
  };
  if (kind === "key") {
    if (typeof v["value"] !== "string" || !v["value"]) return null;
    return { kind, login: "", password: "", totpSecret: null, value: v["value"], ...meta };
  }
  if (typeof v["login"] !== "string" || !v["login"] || typeof v["password"] !== "string" || !v["password"]) return null;
  const totp = typeof v["totp_secret"] === "string" && v["totp_secret"] ? v["totp_secret"] : null;
  return { kind, login: v["login"], password: v["password"], totpSecret: totp, value: null, ...meta };
}

/** 断られたときの理由（値は無い）。401・410 は切れた・404 は無い・403 は Kaname の文と一手・ほかは届かない扱い */
async function refused(r: Response): Promise<CredentialError> {
  if (r.status === 401 || r.status === 410) return new CredentialError(GONE, "gone");
  if (r.status === 404)
    return new CredentialError("預けたログイン情報が見つかりません（消した・失効した）", "notfound", "預け直す");
  const body = (await r.json().catch(() => ({}))) as { message?: unknown; handoff?: unknown };
  return new CredentialError(
    typeof body.message === "string" ? body.message : `Kaname が ${r.status}`,
    r.status === 403 ? "denied" : "unreachable",
    typeof body.handoff === "string" ? body.handoff : null,
  );
}

/** 取り出しの口（Kaname）から 1 件を取る。値はここでしか扱わない。秘密の鍵はこの関数の中だけ */
async function fetchCredential(d: VaultDeps, req: CredentialRequest): Promise<Credential> {
  const sid = d.sessionId();
  if (!sid) throw new CredentialError(GONE, "gone");
  if (!UUID_RE.test(req.credentialId) || !UUID_RE.test(req.jobId))
    throw new CredentialError("資格情報の指定が正しくありません", "notfound");
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const executorKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), d.timeoutMs ?? 15_000);
  let r: Response;
  try {
    r = await fetch(`${d.apiBase}${RESOLVE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-session": sid, "user-agent": BRIDGE_UA },
      body: JSON.stringify({
        job_id: req.jobId,
        credential_id: req.credentialId,
        destination: req.destination,
        executor_key: executorKey,
      }),
      signal: ctl.signal,
    });
  } catch {
    // 届かない（G-11）：黙って失敗せず理由を返す。値は無いので漏れない
    throw new CredentialError(
      "Kaname に届かないので、ログイン情報を受け取れませんでした",
      "unreachable",
      "少し待ってからもう一度",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw await refused(r);
  // 途中で切れた・空・欠け・封でない（G-15）：成功にしない
  let j: { data?: unknown };
  try {
    j = (await r.json()) as typeof j;
  } catch {
    throw new CredentialError("ログイン情報の受け取りが途中で切れました", "incomplete", "もう一度");
  }
  const s = asSealed(j?.data);
  if (!s) throw new CredentialError(BROKEN, "incomplete", "預け直す");
  let plain: string;
  try {
    plain = open(s, privateKey, req.jobId, req.credentialId);
  } catch {
    throw new CredentialError("受け取ったログイン情報を開けなかったので使いません", "incomplete", "もう一度");
  }
  // 開けた中身はこの関数の中だけ（use に渡す形にした後は持たない）
  const c = credentialOf(s, plain);
  if (!c) throw new CredentialError(BROKEN, "incomplete", "預け直す");
  return c;
}

/** 消す：参照を外し、中身を空にする（JS の文字列は書き換えられないので、持っている場所を無くす） */
function wipe(c: Credential): void {
  c.login = "";
  c.password = "";
  c.totpSecret = null;
  c.value = null;
}

/** 値を使う間だけ持つ。use の中でだけ値に触れ、戻ったら（失敗しても）消す。use の外に値を持ち出さない */
export async function withCredential<T>(
  d: VaultDeps,
  req: CredentialRequest,
  use: (c: Credential) => Promise<T>,
): Promise<T> {
  const c = await fetchCredential(d, req);
  try {
    return await use(c);
  } finally {
    wipe(c);
  }
}

/** 文の中に値が紛れていたら伏せる（ログ・証跡・会話に出す前の最後の砦） */
export function redact(
  text: string,
  c: Pick<Credential, "login" | "password" | "totpSecret"> & Partial<Pick<Credential, "value">>,
): string {
  let out = text;
  for (const v of [c.password, c.totpSecret, c.value, c.login])
    if (v && v.length >= 4) out = out.split(v).join("＊＊＊");
  return out;
}
