// 預けたらその場で 1 回ログインだけ試す（T-B-38・D-117.1・D-117.6）の Bridge 側を、本物の Chrome（headless）と偽の Kaname・偽のサービスで通す。
//   入れたらそのまま出る／パスワードが違う／2 段階／CAPTCHA／開けない／欄が無い／2 段の画面 を 1 つずつ実際に出す。値は結果にもディスクにも残らない
//   K-354 で、取り出しを契約の口（封の形）に、開く先を仕事の prompt に替えた（切る段で替えた・carry）
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { playwright, runLoginCheck, targetUrl } from "../src/login-check";
import { RESOLVE_PATH, sealedAnswer } from "./fake-kaname-vault";
// 作り物の秘密の値は apps/bridge/test/_fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K354_PASSWORD, K354_WRONG_PASSWORD } from "./_fake/secrets";

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
/** 偽サービスが通さない値 */
const WRONG_PASSWORD = K354_WRONG_PASSWORD;
const JOB = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";
let site: Server;
let siteBase = "";
let kaname: Server;
let kanameBase = "";
let serviceName = "";
let resolves: Record<string, unknown>[] = [];
let dataDir = "";

/** 偽のサービス：ブラウザの中で動く小さなログイン画面（JS で判定する・本物のサービスと同じく画面が変わる） */
const page = (mode: string): string => {
  const captcha =
    mode === "captcha"
      ? '<div class="g-recaptcha" style="border:1px solid #999;padding:8px">私はロボットではありません</div>'
      : "";
  if (mode === "noform") return "<h1>テスト用サービス</h1><p>ログインの欄はありません</p>";
  const twostep = mode === "twostep";
  return `<h1>ログイン</h1>
<form id="f">
  <label>メール <input name="email" type="email" autocomplete="username"></label>
  <label id="pw-wrap" ${twostep ? "hidden" : ""}>パスワード <input name="password" type="password" autocomplete="current-password"></label>
  ${captcha}
  <p id="err" role="alert"></p>
  <button type="submit">${twostep ? "次へ" : "ログイン"}</button>
</form>
<script>
  let step = ${twostep ? '"login"' : '"password"'};
  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.querySelector('[name=email]').value, pw = document.querySelector('[name=password]').value;
    if (step === "login") { step = "password"; document.getElementById("pw-wrap").hidden = false; document.querySelector('button').textContent = "ログイン"; return; }
    const rev = (x) => x.split("").reverse().join("");
    if (email !== ${JSON.stringify(LOGIN)} || rev(pw) !== ${JSON.stringify(PASSWORD.split("").reverse().join(""))}) { document.getElementById("err").textContent = "メールアドレスかパスワードが違います"; return; }
    if (${JSON.stringify(mode)} === "2fa") { document.body.innerHTML = '<h1>認証コード</h1><input name="otp" autocomplete="one-time-code" maxlength="6">'; return; }
    history.pushState({}, "", "/home"); document.body.innerHTML = '<h1>ようこそ</h1><p data-logged-in>ログインしました</p>';
  });
</script>`;
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "kaname-bridge-lc-"));
  site = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8">${page(u.searchParams.get("mode") ?? "ok")}`);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const a = site.address();
  siteBase = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
  kaname = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      resolves.push({ path: req.url, ...body, session: req.headers["x-bridge-session"] });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: sealedAnswer(
            body,
            { login: LOGIN, password: PASSWORD, totp_secret: null },
            { destinations: ["127.0.0.1"] },
          ),
        }),
      );
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
const deps = (over: Partial<{ apiBase: string; timeoutMs: number }> = {}) => ({
  apiBase: kanameBase,
  sessionId: () => "sess-1",
  dataDir,
  headless: true,
  timeoutMs: 60_000,
  ...over,
});
const run = async (mode: string) => {
  serviceName = `${siteBase}/?mode=${mode}`;
  resolves = [];
  return runLoginCheck(deps(), JOB, CRED, serviceName);
};
/** Bridge の置き場（ログインの状態）に値が書かれていない */
function filesContain(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (p: string): void => {
    for (const f of readdirSync(p)) {
      const q = join(p, f);
      try {
        const st = statSync(q);
        if (st.isDirectory()) walk(q);
        else if (st.size < 50 * 1024 * 1024 && readFileSync(q).includes(needle)) hits.push(q);
      } catch {
        /* ロックされている等 */
      }
    }
  };
  walk(dir);
  return hits;
}

describe("CHT-38-001 預けたら 1 回ログインし、入れたらそのまま出る。ほかの操作はしない", () => {
  it("targetUrl：仕事の prompt が http(s) の URL ならそのまま。名前だけなら https://<名前>/。空・ほかの形は null", () => {
    // K-354：開く先は仕事の prompt（K-355 が https://<使える場所の 1 つ目>/ を入れる）
    expect(targetUrl("https://example.com/login")).toBe("https://example.com/login");
    expect(targetUrl("hacchu-navi.jp")).toBe("https://hacchu-navi.jp/");
    expect(targetUrl("")).toBeNull();
    expect(targetUrl("javascript:alert(1)")).toBeNull();
  });
  it("playwright-core を @playwright/mcp から借りられる（Bridge 専用のブラウザと同じ部品）", () => {
    expect(playwright()).not.toBeNull();
  });
  it.skipIf(!HAS_CHROME)(
    "CHT-38-001 正しい値 → ok。Kaname には Bridge の鍵と仕事の id で 1 回だけ頼む。開いたブラウザは閉じる",
    async () => {
      const r = await run("ok");
      expect(r).toEqual({ state: "ok", detail: "ログインできました（入れたらそのまま出ました）" });
      expect(resolves).toHaveLength(1);
      expect(resolves[0]).toMatchObject({
        path: RESOLVE_PATH,
        job_id: JOB,
        credential_id: CRED,
        destination: "127.0.0.1",
        session: "sess-1",
      });
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-38-001 2 段の画面（先にログイン名 → 次へ → パスワード）でも入れる",
    async () => {
      expect((await run("twostep")).state).toBe("ok");
    },
    60_000,
  );
});

describe("CHT-38-002 入れなければ理由を出す（パスワードが違う／2 段階が要る／CAPTCHA／開けない／欄が無い）。何度も試さない", () => {
  it.skipIf(!HAS_CHROME)(
    "CHT-38-002 サービスが受け付けない（偽の Kaname が違うパスワードを返す）→ bad_password と預け直しの一手。1 回で止める",
    async () => {
      // 偽の Kaname が返す値を「違うパスワード」にする（偽サービスは me@example.com / S3cret-Plain! しか通さない）
      const wrong = createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: sealedAnswer(
                JSON.parse(raw) as Record<string, unknown>,
                { login: LOGIN, password: WRONG_PASSWORD, totp_secret: null },
                { destinations: ["127.0.0.1"] },
              ),
            }),
          );
        });
      });
      await new Promise<void>((r) => wrong.listen(0, "127.0.0.1", r));
      const a = wrong.address();
      try {
        const r = await runLoginCheck(
          deps({ apiBase: `http://127.0.0.1:${(a as { port: number }).port}` }),
          JOB,
          CRED,
          `${siteBase}/?mode=ok`,
        );
        expect(r.state).toBe("bad_password");
        expect(r.detail).toContain("預け直して");
        expect(r.detail).not.toContain("wrong-pass");
      } finally {
        await new Promise<void>((r) => wrong.close(() => r()));
      }
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-38-002 2 段階認証のコードを求められた → needs_2fa（コードは入れない）",
    async () => {
      const r = await run("2fa");
      expect(r.state).toBe("needs_2fa");
      expect(r.detail).toContain("2 段階");
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-38-002 CAPTCHA がある → captcha。入力せずに止める（Kaname には頼んでいるが、欄には入れない）",
    async () => {
      const r = await run("captcha");
      expect(r.state).toBe("captcha");
      expect(r.detail).toContain("CAPTCHA");
    },
    60_000,
  );
  it.skipIf(!HAS_CHROME)(
    "CHT-38-002 ログインの欄が無い → no_form。開けない → unreachable",
    async () => {
      expect((await run("noform")).state).toBe("no_form");
      serviceName = "http://127.0.0.1:9/";
      const r = await runLoginCheck(deps(), JOB, CRED, serviceName);
      expect(r.state).toBe("unreachable");
      expect(r.detail).toContain("開けません");
    },
    90_000,
  );
  it("CHT-38-002 Kaname に届かない（鍵を受け取れない）→ stopped と理由。ブラウザは開かない", async () => {
    const r = await runLoginCheck(
      deps({ apiBase: "http://127.0.0.1:9", timeoutMs: 5_000 }),
      JOB,
      CRED,
      `${siteBase}/?mode=ok`,
    );
    expect(r.state).toBe("stopped");
    expect(r.detail).toContain("受け取れません");
  }, 20_000);
});

describe("CHT-38-003 鍵は実行の間だけ受け取り、入力したら捨てる。ディスクにも AI にも渡らない", () => {
  it.skipIf(!HAS_CHROME)(
    "CHT-38-003 結果の文・Bridge の置き場（ログインの状態）のどこにも、パスワードが残っていない。AI（Claude Code）は起こしていない",
    async () => {
      const r = await run("ok");
      expect(JSON.stringify(r)).not.toContain(PASSWORD);
      const hits = filesContain(dataDir, PASSWORD).map((x) => x.replace(dataDir, ""));
      expect(hits, `値が残っている: ${hits.join(", ")}`).toEqual([]);
      // 鍵を扱うのは vault.ts と login-check.ts だけ。AI を起こす runner には渡らない
      const src = readFileSync(join(__dirname, "..", "src", "login-check.ts"), "utf8");
      expect(src).not.toMatch(/runClaude|console\.|appendFile/);
      // ディスクに書くのは Chrome の設定（パスワードの保存を切る）1 か所だけ。値は書かない
      expect(src.match(/writeFileSync\(/g)).toHaveLength(1);
      expect(src).toContain("writeFileSync(file, JSON.stringify(next))");
    },
    60_000,
  );
});
