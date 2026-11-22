// 2 段階認証つきの 1 回のログイン（T-B-39）を、本物の Chrome（headless）・偽の Kaname（鍵・頼む・答え）・偽のサービスで通す。
//   認証アプリ（鍵から自動）／SMS（本人に頼む・覚えておく）／スマホで承認／返事が無い を 1 つずつ実際に出す
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoginCheck } from "../src/login-check";
import { totpCode } from "../src/two-factor";
import { RESOLVE_PATH, reportPath, sealedAnswer } from "./fake-kaname-vault";
// 作り物の秘密の値は apps/bridge/test/_fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K354_PASSWORD, K354_RFC_KEY } from "./_fake/secrets";

// Bridge は本人の Google Chrome を使う（channel: "chrome"）。Chrome の無い手元の PC では飛ばし、CI（Chrome が入っている）では必ず流す
const HAS_CHROME =
  process.platform === "darwin"
    ? existsSync("/Applications/Google Chrome.app")
    : process.platform === "linux"
      ? ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].some((p) =>
          existsSync(p),
        )
      : true;
if (process.env["CI"] && !HAS_CHROME)
  throw new Error("CI には Google Chrome が要る（Bridge のログインの確認は本人の Chrome で動く）");
const LOGIN = "me@example.com";
const PASSWORD = K354_PASSWORD;
const SECRET = "JBSWY3DPEHPK3PXP";
const SMS_CODE = "246810";
const JOB = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";
let site: Server;
let siteBase = "";
let kaname: Server;
let kanameBase = "";
let twoFactor: "none" | "totp" | "sms" | "email" | "push" = "none";
let totpSecret: string | null = null;
let serviceName = "";
let asks: Record<string, unknown>[] = [];
let answer: string | null = null;
let dataDir = "";

/** 偽のサービス：パスワードの後に 2 段階（種類は mode）。sms は通ったら Cookie で端末を覚える。push は 3 秒後に承認されたことにする */
const page = (mode: string, expectedTotp: string[]): string => `<h1>ログイン</h1>
<form id="f">
  <label>メール <input name="email" type="email" autocomplete="username"></label>
  <label>パスワード <input name="password" type="password" autocomplete="current-password"></label>
  <p id="err" role="alert"></p>
  <button type="submit">ログイン</button>
</form>
<script>
  const rev = (x) => x.split("").reverse().join("");
  const trusted = document.cookie.split(";").some((c) => c.trim() === "trusted=1");
  const done = () => { history.pushState({}, "", "/home"); document.body.innerHTML = '<h1>ようこそ</h1><p data-logged-in>ログインしました</p>'; };
  const otpScreen = (title, ok, remember) => {
    document.body.innerHTML = '<h1>' + title + '</h1><form id="o"><input name="otp" autocomplete="one-time-code" maxlength="6"><p id="err2" role="alert"></p><button>確認</button></form>';
    document.getElementById("o").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = document.querySelector('[name=otp]').value;
      if (!ok.includes(v)) { document.getElementById("err2").textContent = "コードが違います"; return; }
      if (remember) document.cookie = "trusted=1; path=/; max-age=86400";
      done();
    });
  };
  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.querySelector('[name=email]').value, pw = document.querySelector('[name=password]').value;
    if (email !== ${JSON.stringify(LOGIN)} || rev(pw) !== ${JSON.stringify(PASSWORD.split("").reverse().join(""))}) { document.getElementById("err").textContent = "メールアドレスかパスワードが違います"; return; }
    const mode = ${JSON.stringify(mode)};
    if (mode === "totp") return otpScreen("認証アプリのコード", ${JSON.stringify(expectedTotp)}, false);
    if (mode === "sms") { if (trusted) return done(); return otpScreen("SMS のコード", [${JSON.stringify(SMS_CODE)}], true); }
    if (mode === "push") { document.body.innerHTML = '<h1>スマホで承認してください</h1><p>通知を送りました</p>'; setTimeout(done, 3000); return; }
    done();
  });
</script>`;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "kaname-bridge-2fa-"));
  site = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const now = Date.now();
    res.end(
      `<!doctype html><meta charset="utf-8">${page(u.searchParams.get("mode") ?? "ok", [totpCode(SECRET, now), totpCode(SECRET, now - 30_000), totpCode(SECRET, now + 30_000)])}`,
    );
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const a = site.address();
  siteBase = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
  kaname = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      // K-354：取り出しは契約の口（封の形）、頼む・待つは確かめの口の asking・waiting（切る段で替えた・carry）
      const path = req.url ?? "";
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ data }));
      };
      if (path === RESOLVE_PATH)
        return send(
          201,
          sealedAnswer(
            body,
            { login: LOGIN, password: PASSWORD, totp_secret: totpSecret },
            { destinations: ["127.0.0.1"], two_factor: twoFactor },
          ),
        );
      if (path === reportPath(CRED) && body["state"] === "asking") {
        asks.push(body);
        return send(201, { accepted: true, code: null });
      }
      if (path === reportPath(CRED) && body["state"] === "waiting") {
        const c = answer;
        answer = null;
        return send(201, { accepted: true, code: c });
      }
      send(404, null);
    });
  });
  await new Promise<void>((r) => kaname.listen(0, "127.0.0.1", r));
  const b = kaname.address();
  kanameBase = typeof b === "object" && b ? `http://127.0.0.1:${b.port}` : "";
});
afterAll(async () => {
  await new Promise<void>((r) => site.close(() => r()));
  await new Promise<void>((r) => kaname.close(() => r()));
});
const run = async (
  mode: string,
  tf: typeof twoFactor,
  opts: { secret?: string | null; answerWaitMs?: number } = {},
) => {
  serviceName = `${siteBase}/?mode=${mode}`;
  twoFactor = tf;
  totpSecret = opts.secret ?? null;
  asks = [];
  return runLoginCheck(
    {
      apiBase: kanameBase,
      sessionId: () => "sess-1",
      dataDir,
      headless: true,
      answerWaitMs: opts.answerWaitMs ?? 8_000,
      pollMs: 200,
    },
    JOB,
    CRED,
    serviceName,
  );
};

describe("CHT-39-001 認証アプリは鍵から自動（D-017.2）", () => {
  it.skipIf(!HAS_CHROME)(
    "CHT-39-001 鍵を預かっていれば Bridge が 6 桁を作って入れ、本人に頼まない → ok",
    async () => {
      const r = await run("totp", "totp", { secret: SECRET });
      expect(r.state).toBe("ok");
      expect(r.detail).toContain("認証アプリ");
      expect(asks).toHaveLength(0);
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-39-001 鍵が違う → bad_code と預け直しの一手。種類を選んでいない（none）のにコードを求められた → needs_2fa",
    async () => {
      const wrong = await run("totp", "totp", { secret: K354_RFC_KEY });
      expect(wrong.state).toBe("bad_code");
      expect(wrong.detail).toContain("預け直して");
      const none = await run("totp", "none");
      expect(none.state).toBe("needs_2fa");
      expect(asks).toHaveLength(0);
    },
    90_000,
  );
});

describe("CHT-39-002 SMS・メール・スマホ承認は Bridge が止まって本人に頼む（D-117.3）", () => {
  it.skipIf(!HAS_CHROME)(
    "CHT-39-002 SMS：コードの画面で止まり、Kaname に「コードを入れてください」と頼み、本人が入れたコードで通る。結果の文にコードは無い",
    async () => {
      setTimeout(() => (answer = SMS_CODE), 1_500);
      const r = await run("sms", "sms");
      expect(r.state).toBe("ok");
      expect(r.detail).toContain("入れてもらったコード");
      expect(asks).toHaveLength(1);
      expect(asks[0]).toMatchObject({ job_id: JOB, ask_kind: "code" });
      expect(String(asks[0]!["text"])).toContain("SMSのコードを入れてください");
      expect(JSON.stringify(r)).not.toContain(SMS_CODE);
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-39-002 入れたコードが通らない → bad_code と「もう一度試す」の一手（勝手に 2 回目は頼まない）",
    async () => {
      // 前の試験で端末を覚えているので Cookie を消す：別の置き場で
      setTimeout(() => (answer = "000000"), 1_500);
      const prev = dataDir;
      dataDir = mkdtempSync(join(tmpdir(), "kaname-bridge-2fa-b-"));
      try {
        const r = await run("sms", "sms");
        expect(r.state).toBe("bad_code");
        expect(r.detail).toContain("もう一度試す");
        expect(asks).toHaveLength(1);
      } finally {
        dataDir = prev;
      }
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-39-002 スマホで承認：「承認してください」で止まり、本人が「承認した」と言ったらサービスが進むのを待って ok",
    async () => {
      setTimeout(() => (answer = "approved"), 1_500);
      const r = await run("push", "push");
      expect(r.state).toBe("ok");
      expect(r.detail).toContain("スマホで承認");
      expect(asks[0]).toMatchObject({ ask_kind: "approve" });
    },
    60_000,
  );
});

describe("CHT-39-003 通したログインの状態を本人の PC に残し、毎回は聞かない（D-117.4）", () => {
  it.skipIf(!HAS_CHROME)(
    "CHT-39-003 SMS で一度通したサービスは、次はコードを聞かれずに入れる（頼まない）",
    async () => {
      // 1 回目（上の試験と同じ置き場＝端末を覚えている Cookie が残っている）
      const r = await run("sms", "sms");
      expect(r.state).toBe("ok");
      expect(asks).toHaveLength(0);
    },
    60_000,
  );
});

describe("CHT-39-004 10 分返事が無ければ、その仕事は理由つきで止め、次に本人がいる時間に回す（D-117.5）", () => {
  it.skipIf(!HAS_CHROME)(
    "CHT-39-004 コードを頼んだまま返事が無い → no_answer（理由と「もう一度試す」の一手）。頼むのは 1 回。ブラウザは閉じる",
    async () => {
      answer = null;
      dataDir = mkdtempSync(join(tmpdir(), "kaname-bridge-2fa-c-"));
      const r = await run("sms", "sms", { answerWaitMs: 2_000 });
      expect(r.state).toBe("no_answer");
      expect(r.detail).toContain("10 分");
      expect(r.detail).toContain("もう一度試す");
      expect(asks).toHaveLength(1);
    },
    60_000,
  );
});
