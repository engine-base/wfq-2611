// 2 段階認証（T-B-39・D-117.2〜D-117.5・D-017.2・D-017.4）の Bridge 側：認証アプリの 6 桁・本人に頼む・10 分で諦める
//   K-354 で頼む・待つを契約の口（POST /api/v1/bridge/credentials/:id/check-result の asking・waiting）に替えた（切る段で替えた・carry）。
//   下の "ask"・"code" は、その口に送った state（asking・waiting）を前の名前で数えたもの
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANSWER_WAIT_MS, askPerson, totpCode } from "../src/two-factor";
import { reportPath } from "./fake-kaname-vault";
// 作り物の秘密の値は apps/bridge/test/_fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K354_RFC_KEY } from "./_fake/secrets";

let kaname: Server;
let base = "";
let posted: { path: string; body: Record<string, unknown> }[] = [];
let answer: string | null = null;
let askOk = true;

beforeAll(async () => {
  kaname = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const onReport = req.url === reportPath(CRED);
      const path = !onReport
        ? (req.url ?? "")
        : body["state"] === "asking"
          ? "/bridge/ask"
          : body["state"] === "waiting"
            ? "/bridge/code"
            : "/other";
      posted.push({ path, body });
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ data }));
      };
      if (path === "/bridge/ask") return askOk ? send(201, { accepted: true, code: null }) : send(404, null);
      if (path === "/bridge/code") {
        const c = answer;
        answer = null; // 取ったら消える（Kaname 側と同じ振る舞い）
        return send(201, { accepted: true, code: c });
      }
      send(404, null);
    });
  });
  await new Promise<void>((r) => kaname.listen(0, "127.0.0.1", r));
  const a = kaname.address();
  base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
});
afterAll(() => new Promise<void>((r) => kaname.close(() => r())));
const deps = (over: Partial<{ answerWaitMs: number; pollMs: number; sessionId: () => string | null }> = {}) => ({
  apiBase: base,
  sessionId: () => "sess-1",
  answerWaitMs: 3_000,
  pollMs: 100,
  ...over,
});
const JOB = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";

describe("CHT-39-001 認証アプリは鍵から Bridge が 6 桁を作る（D-017.2）", () => {
  it("RFC 6238 の見本（SHA-1・鍵 12345678901234567890）：T=59 → 287082・T=1111111109 → 081804・T=1234567890 → 005924", () => {
    const secret = K354_RFC_KEY; // "12345678901234567890" の Base32
    expect(totpCode(secret, 59 * 1000)).toBe("287082");
    expect(totpCode(secret, 1111111109 * 1000)).toBe("081804");
    expect(totpCode(secret, 1234567890 * 1000)).toBe("005924");
  });
  it("空白・小文字が混ざった鍵でも同じ 6 桁（預けるときに直して通すのと同じ）", () => {
    expect(totpCode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59 * 1000)).toBe("287082");
  });
});

describe("CHT-39-002 SMS・メール・スマホ承認は Bridge が止まって本人に頼む。入れたコードは Bridge だけに渡る", () => {
  it("CHT-39-002 コードを頼む → Kaname に ask（道具 TwoFactorCode・文）→ 本人の答えを取りに行く → 取れたらそれを返す", async () => {
    posted = [];
    answer = null;
    setTimeout(() => (answer = "246810"), 300);
    const code = await askPerson(deps(), JOB, CRED, "code", "発注ナビ から届いたSMSのコードを入れてください");
    expect(code).toBe("246810");
    expect(posted[0]).toMatchObject({
      path: "/bridge/ask",
      body: { job_id: JOB, state: "asking", ask_kind: "code", text: "発注ナビ から届いたSMSのコードを入れてください" },
    });
    expect(typeof posted[0]!.body["request_ref"]).toBe("string");
    // 体の鍵はちょうどこれだけ（契約の口は知らない欄を 422 で止める。request_id を残して送らない）
    expect(Object.keys(posted[0]!.body).sort()).toEqual(["ask_kind", "job_id", "request_ref", "state", "text"]);
    expect(
      posted
        .filter((p) => p.path === "/bridge/code")
        .every((p) => Object.keys(p.body).sort().join(",") === "job_id,request_ref,state"),
    ).toBe(true);
    // 答えが来るまで同じ request_ref で取りに行く（頼むのは 1 回）
    expect(posted.filter((p) => p.path === "/bridge/ask")).toHaveLength(1);
    expect(
      posted
        .filter((p) => p.path === "/bridge/code")
        .every((p) => p.body["request_ref"] === posted[0]!.body["request_ref"]),
    ).toBe(true);
  });
  it("CHT-39-002 スマホで承認は TwoFactorApprove で頼み、「承認した」が来たら進む", async () => {
    posted = [];
    setTimeout(() => (answer = "approved"), 200);
    expect(await askPerson(deps(), JOB, CRED, "approve", "楽楽精算 のログインをスマホで承認してください")).toBe(
      "approved",
    );
    expect(posted[0]).toMatchObject({ path: "/bridge/ask", body: { ask_kind: "approve" } });
  });
  it("CHT-39-002 Kaname が頼みを受け付けない（仕事が動いていない・鍵が無い）→ null。取りに行かない", async () => {
    posted = [];
    askOk = false;
    try {
      expect(await askPerson(deps(), JOB, CRED, "code", "x")).toBeNull();
      expect(posted.filter((p) => p.path === "/bridge/code")).toHaveLength(0);
    } finally {
      askOk = true;
    }
    expect(await askPerson(deps({ sessionId: () => null }), JOB, CRED, "code", "x")).toBeNull();
  });
});

describe("CHT-39-004 10 分返事が無ければ止める（D-117.5）。勝手に何度も頼まない", () => {
  it("既定の上限は 10 分", () => {
    expect(ANSWER_WAIT_MS).toBe(10 * 60_000);
  });
  it("CHT-39-004 上限まで返事が無い → null。頼むのは 1 回だけ（ask は 1 本・code は何度も）", async () => {
    posted = [];
    answer = null;
    const t0 = Date.now();
    const r = await askPerson(deps({ answerWaitMs: 600, pollMs: 100 }), JOB, CRED, "code", "x");
    expect(r).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
    expect(posted.filter((p) => p.path === "/bridge/ask")).toHaveLength(1);
    expect(posted.filter((p) => p.path === "/bridge/code").length).toBeGreaterThanOrEqual(3);
  });
});
