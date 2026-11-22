// 偽の Kaname の「取り出しの口」（K-354・POST /api/v1/bridge/credentials/resolve）の封の作り方。Bridge の試験が使う（K-354 が持ち込む）。
//   契約の正本は apps/api/test/features/F3/credential-device.harness.ts の説明と同じ：
//   PC の公開の鍵（executor_key・X25519 の SPKI の DER の base64）とその回だけの鍵で共有の鍵を出し、
//   HKDF-SHA256（塩は空・info "kaname.credential.v1:<job_id>:<credential_id>"・32 バイト）→ AES-256-GCM（AAD "<job_id>:<credential_id>"）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const RESOLVE_PATH = "/api/v1/bridge/credentials/resolve";
export const reportPath = (credentialId: string): string => `/api/v1/bridge/credentials/${credentialId}/check-result`;

export interface SealMeta {
  kind?: "login" | "key";
  name?: string;
  destinations?: string[];
  two_factor?: "none" | "totp" | "sms" | "email" | "push";
  expires_at?: string | null;
}

/** 取り出しの口の 201 の data を作る（body は PC が送った体）。payload は封じる中身（ログインなら { login, password, totp_secret }） */
export function sealedAnswer(
  body: Record<string, unknown>,
  payload: Record<string, unknown>,
  meta: SealMeta = {},
): Record<string, unknown> {
  const jobId = String(body["job_id"]);
  const credentialId = String(body["credential_id"]);
  const executor = createPublicKey({
    key: Buffer.from(String(body["executor_key"]), "base64"),
    format: "der",
    type: "spki",
  });
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: executor });
  const key = Buffer.from(
    hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from(`kaname.credential.v1:${jobId}:${credentialId}`), 32),
  );
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`${jobId}:${credentialId}`));
  const data = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return {
    credential_id: credentialId,
    kind: meta.kind ?? "login",
    name: meta.name ?? "発注ナビ",
    destinations: meta.destinations ?? ["127.0.0.1"],
    two_factor: meta.two_factor ?? "none",
    expires_at: meta.expires_at ?? null,
    server_key: eph.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    ciphertext_for_executor: data.toString("base64"),
  };
}

/** 別の鍵に封じた答え（開けられないはず） */
export function sealedForStranger(
  body: Record<string, unknown>,
  payload: Record<string, unknown>,
  meta: SealMeta = {},
): Record<string, unknown> {
  const stranger = generateKeyPairSync("x25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return sealedAnswer({ ...body, executor_key: stranger }, payload, meta);
}
