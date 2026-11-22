// K-354 Bridge の取り出しと確かめを契約の口へ（D-128.57 ②④・D-117）。偽の Kaname（HTTP）と偽のサービスで通す。
//   取り出し：POST /api/v1/bridge/credentials/resolve に、仕事・情報・入れる場所・その回だけの公開の鍵を送り、封を自分の秘密の鍵で開ける（平文は受け取らない）。
//   確かめ：途中（コードを頼む asking・答えを待つ waiting）と結果は POST /api/v1/bridge/credentials/:id/check-result。前の道すじ（/api/auth-ext/…）は呼ばない。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CredentialError, hostAllowed, withCredential, type Credential } from "../src/vault";
import { askPerson } from "../src/two-factor";
import { runLoginCheck } from "../src/login-check";
import { startLoop } from "../src/loop";
import { RESOLVE_PATH, reportPath, sealedAnswer, sealedForStranger } from "./fake-kaname-vault";
// 作り物の秘密の値は apps/bridge/test/_fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K354_PASSWORD, K354_TOTP_SECRET } from "./_fake/secrets";

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

const JOB = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";

/** 宛先の判定の表（口の試験 credential-resolve.test.ts と同じ 1 つのファイルを字として読む。片方だけ直って、口と Bridge の判定がずれる事を止める）。
 *  target＝送る宛先、host＝ブラウザが読む行き先の名前（名前として読めない宛先は null）、allowed＝使える場所 destinations に入るか */
type HostCase = { target: string; host: string | null; allowed: boolean; note: string };
const HOST_CASES = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "apps", "api", "test", "features", "F3", "credential-host-cases.json"),
    "utf8",
  ),
) as { destinations: string[]; cases: HostCase[] };
const VALUE = { login: "me@example.com", password: K354_PASSWORD, totp_secret: K354_TOTP_SECRET };

type Mode = "ok" | "stranger" | "plain" | "403" | "404" | "401" | "410" | "502" | "key";
let mode: Mode = "ok";
let seen: { method: string; path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
let answerAfter = 0; // waiting を何回受けたらコードを返すか（0 なら返さない）
let waits = 0;
let kaname: Server;
let base = "";
let site: Server;
let siteBase = "";
let dataDir = "";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "kaname-bridge-k354-"));
  kaname = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const path = req.url ?? "";
      seen.push({ method: req.method ?? "", path, headers: req.headers, body });
      const send = (status: number, b: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(b));
      };
      if (path === RESOLVE_PATH) {
        if (mode === "ok")
          return send(201, {
            data: sealedAnswer(body, VALUE, { destinations: ["127.0.0.1", "hacchu-navi.example"], two_factor: "sms" }),
          });
        if (mode === "key")
          return send(201, { data: sealedAnswer(body, { value: "sk_test_value_0000" }, { kind: "key" }) });
        if (mode === "stranger") return send(201, { data: sealedForStranger(body, VALUE) });
        if (mode === "plain") return send(201, { data: { ...VALUE, service_name: "発注ナビ" } });
        if (mode === "403")
          return send(403, {
            code: "E-CRED-016",
            message: "使える場所の外には入れません",
            handoff: "使える場所を見直す",
          });
        return send(Number(mode), { code: "X", message: `Kaname が ${mode}` });
      }
      if (path === reportPath(CRED)) {
        if (body["state"] === "waiting") {
          waits++;
          return send(201, {
            data: { accepted: true, code: answerAfter > 0 && waits >= answerAfter ? "246810" : null },
          });
        }
        return send(201, { data: { accepted: true, code: null } });
      }
      return send(404, { code: "NOT_FOUND" });
    });
  });
  await new Promise<void>((r) => kaname.listen(0, "127.0.0.1", r));
  const a = kaname.address();
  base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
  // 偽のサービス：127.0.0.1 で開くと、ログインの画面だけ localhost（使える場所の外）へ移す
  site = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/") {
      res.writeHead(302, { location: `http://localhost:${(site.address() as { port: number }).port}/login` });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!doctype html><meta charset="utf-8"><h1>ログイン</h1><form><input name="email" type="email" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>ログイン</button></form>',
    );
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const b = site.address();
  siteBase = typeof b === "object" && b ? `http://127.0.0.1:${b.port}` : "";
});
afterAll(async () => {
  await new Promise<void>((r) => kaname.close(() => r()));
  await new Promise<void>((r) => site.close(() => r()));
});

const deps = (over: Partial<{ sessionId: () => string | null; timeoutMs: number }> = {}) => ({
  apiBase: base,
  sessionId: () => "kpc_session_1",
  timeoutMs: 2000,
  ...over,
});
const req = (destination = "hacchu-navi.example") => ({ jobId: JOB, credentialId: CRED, destination });
const fail = async (p: Promise<unknown>): Promise<CredentialError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CredentialError);
    return e as CredentialError;
  }
  throw new Error("成功してはいけない");
};

describe("K-354 取り出しを契約の口へ（封を開ける）", () => {
  it("K354-BRG-001 契約の口に、PC の印・仕事・情報・入れる場所・その回だけの公開の鍵（X25519 の SPKI・44 バイト）を送り、封を開けて use に渡す。戻ったら値は消える", async () => {
    mode = "ok";
    seen = [];
    let held: Credential | null = null;
    const out = await withCredential(deps(), req(), async (c) => {
      held = c;
      expect(c).toMatchObject({
        kind: "login",
        login: VALUE.login,
        password: VALUE.password,
        totpSecret: VALUE.totp_secret,
        twoFactor: "sms",
      });
      expect(c.destinations).toEqual(["127.0.0.1", "hacchu-navi.example"]);
      return "使った";
    });
    expect(out).toBe("使った");
    expect(held).toMatchObject({ login: "", password: "", totpSecret: null, value: null });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", path: RESOLVE_PATH });
    expect(seen[0]!.headers["x-bridge-session"]).toBe("kpc_session_1");
    expect(Object.keys(seen[0]!.body).sort()).toEqual(["credential_id", "destination", "executor_key", "job_id"]);
    expect(seen[0]!.body).toMatchObject({ job_id: JOB, credential_id: CRED, destination: "hacchu-navi.example" });
    expect(Buffer.from(String(seen[0]!.body["executor_key"]), "base64")).toHaveLength(44);
  });

  it("K354-BRG-002 公開の鍵は回ごとに新しい（2 回の取り出しで違う）。API キーは value で渡り、戻ったら消える", async () => {
    mode = "ok";
    seen = [];
    await withCredential(deps(), req(), async () => 1);
    await withCredential(deps(), req(), async () => 1);
    expect(seen[0]!.body["executor_key"]).not.toBe(seen[1]!.body["executor_key"]);
    mode = "key";
    let held: Credential | null = null;
    await withCredential(deps(), req(), async (c) => {
      held = c;
      expect(c).toMatchObject({ kind: "key", value: "sk_test_value_0000" });
    });
    expect(held).toMatchObject({ value: null });
  });

  it("K354-BRG-003 封が開けられない（ほかの鍵に封じた）・平文の形（前の道すじの答え）は incomplete で失敗し、use は呼ばれない", async () => {
    for (const m of ["stranger", "plain"] as Mode[]) {
      mode = m;
      let called = false;
      const e = await fail(withCredential(deps(), req(), async () => void (called = true)));
      expect(e.kind, m).toBe("incomplete");
      expect(called, m).toBe(false);
      expect(e.message, m).not.toContain(VALUE.password);
    }
  });

  it("K354-BRG-004 断られた：403（使える場所の外）は denied と Kaname の文・一手、404 は notfound、401・410 は gone、502 は unreachable。use は呼ばれない", async () => {
    const cases: [Mode, string][] = [
      ["403", "denied"],
      ["404", "notfound"],
      ["401", "gone"],
      ["410", "gone"],
      ["502", "unreachable"],
    ];
    for (const [m, kind] of cases) {
      mode = m;
      let called = false;
      const e = await fail(withCredential(deps(), req(), async () => void (called = true)));
      expect(e.kind, m).toBe(kind);
      expect(called, m).toBe(false);
    }
    mode = "403";
    const e = await fail(withCredential(deps(), req(), async () => 1));
    expect(e.message).toBe("使える場所の外には入れません");
    expect(e.handoff).toBe("使える場所を見直す");
  });

  it("K354-BRG-005 入れる場所の合わせ方 hostAllowed（名前は new URL の hostname・読む前に字を変えない）：口の試験と同じ表（credential-host-cases.json）の 30 件で、通る・通らないと取り出した名前が表と同じ。全角の区切り（／ ＃ ？ ＼）と小さい形（﹖ ﹟ ﹨）を @ の前に置いた宛先は @ の後ろの名前になり通らない。Bridge だけの行：ポートつきの 127.0.0.1・日本語の名前は通る。localhost・空の文字・空の使える場所は通らない。*.example.com は下の名前だけ（example.com 自身は通らない）", () => {
    const { destinations, cases } = HOST_CASES;
    expect(destinations).toEqual(["hacchu-navi.example"]);
    // 表の中身が減っていない（通る 9・使える場所の外 16・名前として読めない 5）
    expect(cases.filter((c) => c.allowed)).toHaveLength(9);
    expect(cases.filter((c) => !c.allowed && c.host !== null)).toHaveLength(16);
    expect(cases.filter((c) => c.host === null)).toHaveLength(5);
    // K-352 のレビューで見つかった穴の形が表に在る：全角の区切りを @ の前に置いた宛先は、@ の後ろの名前（evil.test）になり通らない
    for (const ch of ["／", "＃", "？", "＼", "﹖", "﹟", "﹨"])
      expect(
        cases.some((c) => c.target.includes(`${ch}@`) && c.host === "evil.test" && !c.allowed),
        `表に ${ch} を @ の前に置いた行が無い`,
      ).toBe(true);
    for (const c of cases) {
      expect(hostAllowed(c.target, destinations), `${c.note}: ${c.target}`).toBe(c.allowed);
      if (c.host === null) {
        // 名前として読めない宛先は、どの使える場所にも当たらない
        expect(hostAllowed(c.target, ["evil.test", "hacchu-navi.example"]), `${c.note}: ${c.target}`).toBe(false);
      } else {
        // 取り出した名前が表の名前ちょうど：その名前には当たり、その下の名前だけの印（*.）には当たらない
        expect(hostAllowed(c.target, [c.host]), `${c.note}: ${c.target} の名前`).toBe(true);
        expect(hostAllowed(c.target, [`*.${c.host}`]), `${c.note}: ${c.target} の名前`).toBe(false);
      }
    }
    // Bridge だけの行（口は使える場所に IP を預かれない・空の宛先は口では 422）
    const d = ["hacchu-navi.example", "127.0.0.1", "xn--r8jz45g.jp"];
    expect(hostAllowed("http://127.0.0.1:5173/?mode=ok", d)).toBe(true);
    expect(hostAllowed("https://ログイン.例え.jp/", d)).toBe(true);
    expect(hostAllowed("http://localhost:5173/login", d)).toBe(false);
    expect(hostAllowed("", d)).toBe(false);
    expect(hostAllowed("hacchu-navi.example", [])).toBe(false);
    const wild = ["*.example.com"];
    expect(hostAllowed("https://login.example.com/", wild)).toBe(true);
    expect(hostAllowed("a.b.example.com", wild)).toBe(true);
    expect(hostAllowed("https://example.com/", wild)).toBe(false);
    expect(hostAllowed("evilexample.com", wild)).toBe(false);
  });

  it("K354-BRG-010 名前の取り出しと合わせ方は口と Bridge で同じ 1 つ：apps/bridge/src/host.ts と apps/api/src/features/F3/credentials/host.ts の区切り（名前の取り出しと合わせ方）の中が 1 字も違わない。どちらも外の部品を import しない", () => {
    const region = (rel: string) => {
      const s = readFileSync(join(__dirname, "..", "..", "..", rel), "utf8");
      const m = /\/\/ ---- 名前の取り出しと合わせ方[^\n]*\n([\s\S]*?)\/\/ ---- ここまで ----/.exec(s);
      expect(m, `${rel} に区切りが無い`).not.toBeNull();
      return m![1]!;
    };
    const bridge = region("apps/bridge/src/host.ts");
    const api = region("apps/api/src/features/F3/credentials/host.ts");
    expect(bridge.length).toBeGreaterThan(0);
    expect(bridge).toBe(api);
    expect(bridge).not.toMatch(/\bimport\b|\brequire\(/);
    expect(bridge).toMatch(/export function hostnameOf\(/);
    expect(bridge).toMatch(/export function hostAllowed\(/);
  });

  it("K354-BRG-006 値をディスクとログに出さない：vault.ts は fs・console・保存の部品を呼ばない。前の道すじ（/api/auth-ext/bridge/credentials）をどのファイルも呼ばない", () => {
    const src = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");
    expect(src("vault.ts")).not.toMatch(
      /from "node:fs|from "fs"|writeFile|appendFile|console\.|electron|localStorage|safeStorage/,
    );
    for (const f of ["vault.ts", "login-check.ts", "two-factor.ts", "loop.ts"]) {
      // 見るのは前の道すじ（auth-ext）の字だけ。新しい道（…/v1/bridge/credentials/resolve）は、どの引用符で書いても落とさない
      expect(src(f), f).not.toContain("auth-ext/bridge/credentials");
      expect(src(f), f).not.toMatch(/["'`]\/bridge\/credentials\/resolve["'`]/);
      expect(src(f), f).not.toMatch(/["'`]\/bridge\/code["'`]/);
      expect(src(f), f).not.toMatch(/["'`]\/bridge\/credentials\/check-result["'`]/);
    }
    expect(src("two-factor.ts")).not.toContain("/api/auth-ext");
  });
});

describe("K-354 確かめの途中を契約の口へ（コードを頼む・待つ）", () => {
  const askDeps = (over: Partial<{ answerWaitMs: number; pollMs: number }> = {}) => ({
    apiBase: base,
    sessionId: () => "kpc_session_1",
    answerWaitMs: 3000,
    pollMs: 50,
    ...over,
  });

  it("K354-BRG-007 頼む：check-result に asking（request_ref・ask_kind code・本人に見せる文）を 1 回だけ送り、waiting で答えを待ち、来たコードを返す", async () => {
    seen = [];
    waits = 0;
    answerAfter = 3;
    const got = await askPerson(askDeps(), JOB, CRED, "code", "発注ナビ から届いた SMS のコードを入れてください");
    expect(got).toBe("246810");
    const asks = seen.filter((s) => s.body["state"] === "asking");
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      path: reportPath(CRED),
      body: { job_id: JOB, ask_kind: "code", text: "発注ナビ から届いた SMS のコードを入れてください" },
    });
    // 体の鍵はちょうどこれだけ（K-355 の口は知らない欄を 422 で止める。request_id を残して送る実装を落とす）
    expect(Object.keys(asks[0]!.body).sort()).toEqual(["ask_kind", "job_id", "request_ref", "state", "text"]);
    const rid = asks[0]!.body["request_ref"];
    expect(typeof rid).toBe("string");
    const ws = seen.filter((s) => s.body["state"] === "waiting");
    expect(ws.length).toBe(3);
    expect(ws.every((s) => s.path === reportPath(CRED) && s.body["request_ref"] === rid)).toBe(true);
    expect(ws.every((s) => Object.keys(s.body).sort().join(",") === "job_id,request_ref,state")).toBe(true);
    expect(seen.every((s) => s.path.startsWith("/api/v1/"))).toBe(true);
  });

  it("K354-BRG-008 返事が来ない：待つ上限で null。頼むのは 1 回だけ（勝手に何度も頼まない）。スマホで承認は ask_kind approve", async () => {
    seen = [];
    waits = 0;
    answerAfter = 0;
    // 壁の時計では比べない（台が混むと落ちる）。上限を守ることは、待つ問い合わせの数で見る：
    //   上限 1 秒・50 ミリ秒ごとなら多くても 21 回ほど。上限を超えて送り続ける実装は 25 回を超える（上限の無い実装は試験の時間の上限で落ちる）
    expect(
      await askPerson(askDeps({ answerWaitMs: 1000, pollMs: 50 }), JOB, CRED, "approve", "スマホで承認してください"),
    ).toBeNull();
    const asks = seen.filter((s) => s.body["state"] === "asking");
    expect(asks).toHaveLength(1);
    expect(asks[0]!.body["ask_kind"]).toBe("approve");
    expect(Object.keys(asks[0]!.body).sort()).toEqual(["ask_kind", "job_id", "request_ref", "state", "text"]);
    const waited = seen.filter((s) => s.body["state"] === "waiting").length;
    expect(waited).toBeGreaterThanOrEqual(3);
    expect(waited).toBeLessThanOrEqual(25);
  });
});

describe("K-354 確かめの 1 回のログイン：使える場所の外では入れない", () => {
  it.skipIf(!HAS_CHROME)(
    "K354-BRG-009 仕事の開く先（prompt）を開き、入れる場所をその名前で頼む。ログインの画面が使える場所の外（localhost）に移ったら入れずに stopped と「使える場所」を含む文",
    async () => {
      mode = "ok";
      seen = [];
      const r = await runLoginCheck(
        { apiBase: base, sessionId: () => "kpc_session_1", dataDir, headless: true, timeoutMs: 60_000 },
        JOB,
        CRED,
        `${siteBase}/`,
      );
      expect(r.state).toBe("stopped");
      expect(r.detail).toContain("使える場所");
      expect(r.detail).not.toContain(VALUE.password);
      const res = seen.filter((s) => s.path === RESOLVE_PATH);
      expect(res).toHaveLength(1);
      expect(res[0]!.body["destination"]).toBe("127.0.0.1");
    },
    120_000,
  );
});

describe("K-354 輪（loop）が確かめの仕事を契約の口へつなぐ", () => {
  it("K354-BRG-011 偽の Kaname が login_check の仕事（開く先の無い prompt）を渡す：輪は Chrome を開かずに結果 unreachable を /api/v1/bridge/credentials/<情報の id>/check-result に { job_id, state, detail } で 1 回送る。取り出しの口と、前の道すじの確かめ・取り出しの口は呼ばない", async () => {
    const got: { path: string; body: Record<string, unknown> }[] = [];
    let handed = false;
    let done: () => void = () => undefined;
    const reported = new Promise<void>((r) => (done = r));
    const fake = createServer((rq, rs) => {
      let raw = "";
      rq.on("data", (c) => (raw += c));
      rq.on("end", () => {
        const path = rq.url ?? "";
        const b = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        got.push({ path, body: b });
        const send = (status: number, data: unknown) => {
          rs.writeHead(status, { "content-type": "application/json" });
          rs.end(JSON.stringify({ data }));
        };
        if (path === "/api/v1/bridge/heartbeat") return send(200, { ok: true });
        if (path === "/api/v1/bridge/jobs/take") {
          const job = handed
            ? null
            : {
                job_id: JOB,
                kind: "login_check",
                credential_id: CRED,
                prompt: "",
                browser: "dedicated",
                conversation_id: null,
              };
          handed = true;
          return send(201, { job, forbidden_domains: [], next_ms: 50, outdated: false });
        }
        if (path === reportPath(CRED)) {
          send(201, { accepted: true, code: null });
          return done();
        }
        return send(201, {});
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const a = fake.address();
    const stop = startLoop({
      apiBase: typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "",
      sessionId: () => "kpc_session_loop",
      health: async () => ({}),
      onChange: () => undefined,
      onGone: () => undefined,
      dataDir,
      loginCheckHeadless: true,
    });
    try {
      await reported; // 結果の知らせが届くまで待つ（固定の待ちは使わない。届かなければ下の時間の上限で落ちる）
    } finally {
      stop();
      await new Promise<void>((r) => fake.close(() => r()));
    }
    const reports = got.filter((g) => g.path === reportPath(CRED));
    expect(reports).toHaveLength(1);
    expect(Object.keys(reports[0]!.body).sort()).toEqual(["detail", "job_id", "state"]);
    expect(reports[0]!.body).toMatchObject({ job_id: JOB, state: "unreachable" });
    expect(got.some((g) => g.path === RESOLVE_PATH)).toBe(false);
    // 前の道すじは、確かめと取り出しの口だけを見る（輪は、まだ契約に移していない口 /api/auth-ext/bridge/mirror-targets などを呼ぶ）
    const OLD_CHECK_ROUTES = [
      "/api/auth-ext/bridge/credentials/resolve",
      "/api/auth-ext/bridge/credentials/check-result",
      "/api/auth-ext/bridge/code",
      "/api/auth-ext/bridge/ask",
    ];
    expect(got.map((g) => g.path).filter((x) => OLD_CHECK_ROUTES.some((o) => x.startsWith(o)))).toEqual([]);
  }, 30_000);
});
