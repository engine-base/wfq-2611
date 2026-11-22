// 2 段階認証（T-B-39・D-117.2〜D-117.5・D-017.2・D-017.4）。
//   認証アプリ：預かった鍵から Bridge が 6 桁を作る（鍵は withCredential の中だけ）。
//   SMS・メール・スマホで承認：Bridge がコードの画面で止まり、Kaname を通して本人に頼む（仕事は asking）。
//   本人が入れたコードは Kaname の答えの行に一時的に置かれ、Bridge が取った時点で消える（AI の会話にも記録にも出ない）。
//   10 分返事が無ければ頼むのをやめる（null）。呼ぶ側が理由つきで止める。勝手に何度も頼まない
//   頼む・待つは契約の口（POST /api/v1/bridge/credentials/:id/check-result の asking・waiting・K-354 でつなぎ替えた）。
//   頼みの印は request_ref（代表の答え answer=cf9e0174b6fb）。体は決めた欄だけ（口は知らない欄を 422 で止める）
import { createHmac, randomUUID } from "node:crypto";
import { BRIDGE_UA } from "./pairing";

/** RFC 6238 の TOTP（SHA-1・30 秒・6 桁）。鍵は Base32 */
export function totpCode(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  const key = Buffer.from(bytes.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const off = h[h.length - 1]! & 0xf;
  const code =
    ((h[off]! & 0x7f) << 24) | ((h[off + 1]! & 0xff) << 16) | ((h[off + 2]! & 0xff) << 8) | (h[off + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export interface AskDeps {
  apiBase: string;
  sessionId: () => string | null;
  /** 返事を待つ上限（既定 10 分・D-117.5） */
  answerWaitMs?: number;
  /** 取りに行く間隔（既定 2 秒） */
  pollMs?: number;
}
export const ANSWER_WAIT_MS = 10 * 60_000;
const POLL_MS = 2_000;

/** 確かめの口に途中を知らせる。断られた・届かない・切れた → null */
async function report(
  d: AskDeps,
  credentialId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const sid = d.sessionId();
  if (!sid) return null;
  try {
    const r = await fetch(`${d.apiBase}/api/v1/bridge/credentials/${encodeURIComponent(credentialId)}/check-result`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-session": sid, "user-agent": BRIDGE_UA },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return ((await r.json()) as { data?: Record<string, unknown> }).data ?? null;
  } catch {
    return null;
  }
}

/**
 * 本人に頼む：kind=code なら「〇〇のコードを入れてください」、approve なら「〇〇をスマホで承認してください」。
 * 本人の答え（コード・承認）が来たらそれを返す。上限まで来なければ null（頼むのは 1 回。勝手に何度も頼まない）
 */
export async function askPerson(
  d: AskDeps,
  jobId: string,
  credentialId: string,
  kind: "code" | "approve",
  text: string,
): Promise<string | null> {
  const requestRef = randomUUID();
  const asked = await report(d, credentialId, {
    job_id: jobId,
    state: "asking",
    request_ref: requestRef,
    ask_kind: kind,
    text: text.slice(0, 300),
  });
  if (!asked) return null;
  const until = Date.now() + (d.answerWaitMs ?? ANSWER_WAIT_MS);
  const every = d.pollMs ?? POLL_MS;
  while (Date.now() < until) {
    const r = await report(d, credentialId, { job_id: jobId, state: "waiting", request_ref: requestRef });
    const code = r?.["code"];
    if (typeof code === "string" && code) return code;
    await new Promise((res) => setTimeout(res, every));
  }
  return null;
}
