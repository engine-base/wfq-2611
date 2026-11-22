// 鍵を受け取る（T-B-05・D-102.2）の Bridge 側を、偽の Kaname（HTTP）で通す。
//   K-354 で契約の口（POST /api/v1/bridge/credentials/resolve）と封（PC の鍵でしか開けない形・D-128.57 ④）に替えた（切る段で替えた・carry）。
//   値は use の中だけ・終わったら消える・ディスクに書かない・ログに出ない。途中で切れた／欠けた／届かない は成功にしない
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CredentialError, redact, withCredential, type Credential } from "../src/vault";
import { RESOLVE_PATH, sealedAnswer } from "./fake-kaname-vault";

type Mode = "ok" | "empty" | "cut" | "missing_password" | "401" | "403" | "404" | "502" | "hang";
let server: Server;
let base = "";
let mode: Mode = "ok";
let seen: { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] =
  [];
const JOB = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";
const VALUE = {
  login: "me@example.com",
  password: "S3cret-Plain!",
  totp_secret: "JBSWY3DPEHPK3PXP",
};
const REQ = { jobId: JOB, credentialId: CRED, destination: "hacchu-navi.example" };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({
        path: req.url ?? "",
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      switch (mode) {
        case "ok":
          return send(201, { data: sealedAnswer(seen[seen.length - 1]!.body, VALUE, { name: "発注ナビ" }) });
        case "empty":
          return send(200, { data: null });
        case "missing_password":
          return send(201, {
            data: sealedAnswer(seen[seen.length - 1]!.body, {
              login: "me@example.com",
              password: "",
              totp_secret: null,
            }),
          });
        case "cut": {
          // 途中で切る（G-15）：JSON の半分だけ送って接続を閉じる
          res.writeHead(200, { "content-type": "application/json" });
          res.flushHeaders();
          res.write('{"data":{"login":"me@exa');
          setTimeout(() => res.destroy(), 30);
          return;
        }
        case "401":
          return send(401, { code: "UNAUTHENTICATED", message: "この Bridge は分かりません" });
        case "403":
          return send(403, {
            code: "E-CRED-010",
            message: "動いている仕事のためにだけ受け取れます",
            handoff: "仕事を始めてから",
          });
        case "404":
          return send(404, { code: "NOT_FOUND", message: "預けたログイン情報が見つかりません" });
        case "502":
          return send(502, { code: "E-SEC-001", message: "預かり先に届きません", handoff: "少し待ってからもう一度" });
        case "hang":
          return; // 返さない（届かないのと同じ。timeoutMs で切る）
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
const deps = (over: Partial<{ sessionId: () => string | null; timeoutMs: number; apiBase: string }> = {}) => ({
  apiBase: base,
  sessionId: () => "sess-1",
  timeoutMs: 800,
  ...over,
});
const fail = async (p: Promise<unknown>): Promise<CredentialError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CredentialError);
    return e as CredentialError;
  }
  throw new Error("成功してはいけない");
};

describe("BRG-05-004 鍵を受け取る：値は use の中だけ。終わったら消える。Kaname には Bridge の鍵と仕事の id で頼む", () => {
  it("BRG-05-004 use の中では値が使え、戻ったら login・password・totp が空になっている（失敗して戻っても同じ）", async () => {
    mode = "ok";
    seen = [];
    let held: Credential | null = null;
    const out = await withCredential(deps(), REQ, async (c) => {
      held = c;
      expect(c).toEqual({
        kind: "login",
        login: "me@example.com",
        password: "S3cret-Plain!",
        totpSecret: "JBSWY3DPEHPK3PXP",
        value: null,
        name: "発注ナビ",
        destinations: ["127.0.0.1"],
        twoFactor: "none",
      });
      return `${c.login.length}`;
    });
    expect(out).toBe("14");
    expect(held).toEqual({
      kind: "login",
      login: "",
      password: "",
      totpSecret: null,
      value: null,
      name: "発注ナビ",
      destinations: ["127.0.0.1"],
      twoFactor: "none",
    });
    // 頼み方：Bridge の鍵がヘッダに・仕事と資格情報の id と入れる場所とその回の公開の鍵が本文に。値は送っていない
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe(RESOLVE_PATH);
    expect(seen[0]!.headers["x-bridge-session"]).toBe("sess-1");
    expect(seen[0]!.body).toMatchObject({ job_id: JOB, credential_id: CRED, destination: "hacchu-navi.example" });
    expect(Object.keys(seen[0]!.body).sort()).toEqual(["credential_id", "destination", "executor_key", "job_id"]);
    // use が投げても消える
    let held2: Credential | null = null;
    await expect(
      withCredential(deps(), REQ, async (c) => {
        held2 = c;
        throw new Error("入力に失敗");
      }),
    ).rejects.toThrow("入力に失敗");
    expect(held2).toMatchObject({ login: "", password: "", totpSecret: null });
  });

  it("BRG-05-004 ディスクに書かない・ログに出さない：vault.ts は fs・console・electron の保存を一度も呼ばない。伏せ字は値を消す", () => {
    const src = readFileSync(join(__dirname, "..", "src", "vault.ts"), "utf8");
    expect(src).not.toMatch(/from "node:fs|from "fs"|writeFile|appendFile|console\.|electron|localStorage|safeStorage/);
    // 値を参照 ID として AI に渡す道（道具）にも、値を書く口が無い
    const srcDir = join(__dirname, "..", "src");
    // 値を扱ってよいのは vault.ts と、1 回だけログインを試す login-check.ts（T-B-38・自分の試験で fs／console を呼ばないことを確かめる）
    const others = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && f !== "vault.ts" && f !== "login-check.ts");
    for (const f of others)
      expect(readFileSync(join(srcDir, f), "utf8"), `${f} が資格情報の値を扱っている`).not.toMatch(
        /withCredential\(|\.password\b/,
      );
    expect(
      redact("入力: me@example.com / S3cret-Plain! / JBSWY3DPEHPK3PXP", {
        login: "me@example.com",
        password: "S3cret-Plain!",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).toBe("入力: ＊＊＊ / ＊＊＊ / ＊＊＊");
  });

  it("BRG-05-004 Bridge の鍵が無い・形が違う id は、Kaname に頼む前に止まる（値を取りに行かない）", async () => {
    mode = "ok";
    seen = [];
    expect((await fail(withCredential(deps({ sessionId: () => null }), REQ, async () => 1))).kind).toBe("gone");
    expect((await fail(withCredential(deps(), { ...REQ, credentialId: "sec_123" }, async () => 1))).kind).toBe(
      "notfound",
    );
    expect(seen).toHaveLength(0);
  });

  it("BRG-05-004 Kaname が断る（401 切れた・403 仕事が動いていない・404 無い）→ 理由と一手をそのまま持って失敗。use は呼ばれない", async () => {
    const cases: [Mode, string, string | null][] = [
      ["401", "gone", null],
      ["403", "denied", "仕事を始めてから"],
      ["404", "notfound", "預け直す"],
    ];
    for (const [m, kind, handoff] of cases) {
      mode = m;
      let called = false;
      const e = await fail(withCredential(deps(), REQ, async () => void (called = true)));
      expect(e.kind, m).toBe(kind);
      expect(e.handoff, m).toBe(handoff);
      expect(e.message.length, m).toBeGreaterThan(5);
      expect(called, m).toBe(false);
    }
  });
});

describe("BRG-05-005 外部リソースの実在（G-11）：Kaname に届かない・返ってこない → 成功にしない。理由に値は無い", () => {
  it("BRG-05-005 つなぎ先が無い → unreachable と「届かない」の理由。返ってこない → 上限で切って unreachable。502 → 預かり先の理由を持つ", async () => {
    const e1 = await fail(withCredential(deps({ apiBase: "http://127.0.0.1:9" }), REQ, async () => 1));
    expect(e1.kind).toBe("unreachable");
    expect(e1.message).toContain("届かない");
    mode = "hang";
    const t0 = Date.now();
    const e2 = await fail(withCredential(deps({ timeoutMs: 300 }), REQ, async () => 1));
    expect(e2.kind).toBe("unreachable");
    expect(Date.now() - t0).toBeLessThan(3000);
    mode = "502";
    const e3 = await fail(withCredential(deps(), REQ, async () => 1));
    expect(e3.kind).toBe("unreachable");
    expect(e3.message).toBe("預かり先に届きません");
    expect(e3.handoff).toBe("少し待ってからもう一度");
  });
});

describe("BRG-05-006 信号なし終了（G-15）：途中で切れた・空・欠けた応答を成功にしない", () => {
  it("BRG-05-006 途中で切れる → incomplete。空（data: null）→ incomplete。password が空 → incomplete。use はどれも呼ばれない", async () => {
    for (const m of ["cut", "empty", "missing_password"] as Mode[]) {
      mode = m;
      let called = false;
      const e = await fail(withCredential(deps(), REQ, async () => void (called = true)));
      expect(e.kind, m).toBe("incomplete");
      expect(called, m).toBe(false);
      expect(e.message, m).toMatch(/切れました|欠けていた/);
    }
  });
});
