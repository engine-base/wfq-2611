// K-320「再設定の画面を契約の口につなぐ」の画面の試験（実 Chrome・実装より先に積む）。行 ID（K320-UI-…）は 11_tickets/K-320.md の表と 1 対 1。
//   正の絵：モック /dev/mock/f1/<状態>（本番と同じ部品 features/F1/password-reset/views.tsx の PasswordReset）。
//   口（POST /api/v1/auth/password/forgot・/reset・GET /api/v1/me）は網の手前で差し替える。本人の Bridge（127.0.0.1:38617）にも届かせない（網の手前で 404）。
//   部品の道を閉じたこと（K320-UI-023）だけは本物の口（API_BASE）を叩く。
//   答えの形は K-313・K-314 の表のとおり：forgot 201 { data: { accepted: true } }／reset 201 { data: { reset: true } }・410 { code: E-AUTH-006 }・409 { code: E-PAGE-006 }・
//   422 { code, field: new_password }・429 { retry_after_sec }・500 { code: E-PAGE-003 }
//   文言は正本（07_qa/test-specs/errors.json）と部品（views.tsx）の文。実装から書かない
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { api, pwToggle } from "../_lib/api";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ERRORS = JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
  errors: { id: string; message: string }[];
};
const msg = (id: string) => {
  const e = ERRORS.errors.find((x) => x.id === id);
  if (!e) throw new Error(`errors.json に ${id} が無い`);
  return e.message;
};
const ROOT_SEL = '[data-auth="reset"]';
const EMAIL = "takamoto@engine-base.example"; // モックと同じメール（写しを比べるため）
const TOKEN = "rp_k320_0123456789abcdefghijklmnopqrstuv";
const NEW_PW = "brand-new-password-320";
const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const SENT_TEXT = (e: string) => `登録されていれば、${e} に作り直しのリンクを送りました`;
const DEAD_TEXT = "このリンクはもう使えません。もう一度、再設定メールを送ってください";
const INVALID_TEXT = msg("E-PAGE-006"); // 正本 E-PAGE-006 の文（K-340）
const MISMATCH = "2 つのパスワードが違います";
const OTHER_ACCOUNT = "別のアカウントでログイン中です。新しいパスワードで入るには、ログアウトしてください";

type Reply = { status: number; body: unknown; delayMs?: number; abort?: boolean };
interface Mock {
  forgots: Record<string, unknown>[];
  resets: Record<string, unknown>[];
  urls: string[];
  on: { forgot: (n: number) => Reply; reset: (n: number) => Reply; me: () => Reply };
}

async function mockApi(page: Page): Promise<Mock> {
  const m: Mock = {
    forgots: [],
    resets: [],
    urls: [],
    on: {
      forgot: () => ({ status: 201, body: { data: { accepted: true } } }),
      reset: () => ({ status: 201, body: { data: { reset: true } } }),
      me: () => ({ status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } }),
    },
  };
  page.on("request", (r) => m.urls.push(r.url()));
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route, req: Request) => {
    const p = new URL(req.url()).pathname;
    let r: Reply = { status: 404, body: { code: "NOT_FOUND" } };
    if (req.method() === "POST" && p === "/api/v1/auth/password/forgot") {
      m.forgots.push((req.postDataJSON() as Record<string, unknown>) ?? {});
      r = m.on.forgot(m.forgots.length);
    } else if (req.method() === "POST" && p === "/api/v1/auth/password/reset") {
      m.resets.push((req.postDataJSON() as Record<string, unknown>) ?? {});
      r = m.on.reset(m.resets.length);
    } else if (req.method() === "GET" && p === "/api/v1/me") r = m.on.me();
    else if (p === "/api/auth/get-session") r = { status: 200, body: { session: null, user: null } };
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    if (r.abort) return route.abort("failed");
    await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  return m;
}
const signedIn = (page: Page) => page.addInitScript(() => window.localStorage.setItem("kaname.token", "tok-k320"));
const root = (page: Page) => page.locator(ROOT_SEL);
const emailField = (page: Page) => page.getByLabel("メールアドレス");
const pw1 = (page: Page) => page.getByLabel("新しいパスワード", { exact: true });
const pw2 = (page: Page) => page.getByLabel("もう一度", { exact: true });
const sendBtn = (page: Page) => page.getByRole("button", { name: "再設定メールを送る" });
const saveBtn = (page: Page) => page.getByRole("button", { name: "パスワードを決める" });
const openAsk = async (page: Page, w = 1440) => {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto("/password-reset");
  await expect(root(page)).toHaveAttribute("data-state", "n");
};
const openNew = async (page: Page, w = 1440) => {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(`/password-reset?token=${TOKEN}`);
  await expect(root(page)).toHaveAttribute("data-state", "p");
};
const fillNew = async (page: Page, a: string, b = a) => {
  await pw1(page).fill(a);
  await pw2(page).fill(b);
};

test("K320-UI-001 /password-reset を開く：data-state n・h1「パスワードを作り直す」・欄「メールアドレス」・主「再設定メールを送る」・戻るで /login", async ({
  page,
}) => {
  await mockApi(page);
  await openAsk(page);
  await expect(root(page).locator("h1")).toHaveText("パスワードを作り直す");
  await expect(emailField(page)).toBeVisible();
  await expect(sendBtn(page)).toBeEnabled();
  await root(page).getByRole("link", { name: "← ログインに戻る" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("K320-UI-002 空・形が違うメール：欄の下に E-VAL-004 の文・aria-invalid。口は 0 回。form は noValidate", async ({
  page,
}) => {
  const m = await mockApi(page);
  await openAsk(page);
  await expect(page.locator(`form${ROOT_SEL}`)).toHaveAttribute("novalidate", "");
  for (const v of ["", "takamoto@engine-base"]) {
    await emailField(page).fill(v);
    await sendBtn(page).click();
    await expect(root(page)).toContainText(msg("E-VAL-004"));
    await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
  }
  expect(m.forgots).toHaveLength(0);
});

test("K320-UI-003 正しいメール（前後の全角の空白つき）で送る：口に 1 回・email は空白を除いた形。送りましたの画面と「60 秒あとから」の押せないボタン", async ({
  page,
}) => {
  const m = await mockApi(page);
  await page.clock.install();
  await openAsk(page);
  // eslint-disable-next-line no-irregular-whitespace -- 全角の空白を意図して入れる
  await emailField(page).fill(`　${EMAIL} `);
  await sendBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "s");
  expect(m.forgots).toEqual([{ email: EMAIL }]);
  await expect(root(page)).toContainText(SENT_TEXT(EMAIL));
  const again = root(page).getByRole("button", { name: /もう一度送る/ });
  await expect(root(page).locator('[data-part="resend"]')).toHaveText("もう一度送る（1 分あとから）"); // 60 秒は「1 分」（キャンバス AuthReset・K-638）
  await expect(again).toHaveText("もう一度送る");
  await expect(again).toBeDisabled();
});

test("K320-UI-004 送ってから 59 秒では押せない（1 秒あとから）。60 秒で「もう一度送る」が押せ、押すと口に 2 回目", async ({
  page,
}) => {
  const m = await mockApi(page);
  await page.clock.install();
  await openAsk(page);
  await emailField(page).fill(EMAIL);
  await sendBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "s");
  const again = root(page).getByRole("button", { name: /もう一度送る/ });
  await page.clock.fastForward(59_000);
  await expect(root(page).locator('[data-part="resend"]')).toHaveText("もう一度送る（1 秒あとから）");
  await expect(again).toBeDisabled();
  await page.clock.fastForward(1_000);
  await expect(again).toHaveText("もう一度送る");
  await expect(again).toBeEnabled();
  await again.click();
  await expect.poll(() => m.forgots.length).toBe(2);
});

test("K320-UI-005 「再設定メールを送る」を続けて 2 回押す（口の答えを遅らせる）：口は 1 回", async ({ page }) => {
  const m = await mockApi(page);
  m.on.forgot = () => ({ status: 201, body: { data: { accepted: true } }, delayMs: 800 });
  await openAsk(page);
  await emailField(page).fill(EMAIL);
  await sendBtn(page).dblclick();
  await expect(root(page)).toHaveAttribute("data-state", "s");
  expect(m.forgots).toHaveLength(1);
});

test("K320-UI-006 口が 429（retry_after_sec 37）：ask のまま E-LIM-005 の文（37 秒）。入れたメールは残る", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.forgot = () => ({ status: 429, body: { error: "rate_limited", code: "RATE_LIMITED", retry_after_sec: 37 } });
  await openAsk(page);
  await emailField(page).fill(EMAIL);
  await sendBtn(page).click();
  await expect(root(page)).toContainText(msg("E-LIM-005").replace("{秒}", "37"));
  await expect(root(page)).toHaveAttribute("data-state", "n");
  await expect(emailField(page)).toHaveValue(EMAIL);
});

test("K320-UI-007 1 回目は網が切れる・2 回目は口が 500（遅らせる）：どちらも ask のまま E-PAGE-003 の文。2 回目は待つ間に文が消え、答えの後にまた出る。入れたメールは残る", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.forgot = (n) =>
    n === 1
      ? { status: 0, body: null, abort: true }
      : { status: 500, body: { error: "internal", code: "E-PAGE-003" }, delayMs: 1500 };
  await openAsk(page);
  await emailField(page).fill(EMAIL);
  await sendBtn(page).click();
  await expect(root(page)).toContainText(msg("E-PAGE-003"));
  await expect(root(page)).toHaveAttribute("data-state", "n");
  await expect(emailField(page)).toHaveValue(EMAIL);
  await sendBtn(page).click();
  await expect(root(page).getByText(msg("E-PAGE-003"))).toHaveCount(0);
  await expect(root(page)).toContainText(msg("E-PAGE-003"));
  await expect(root(page)).toHaveAttribute("data-state", "n");
  await expect(emailField(page)).toHaveValue(EMAIL);
  expect(m.forgots).toHaveLength(2);
});

test("K320-UI-008 ログイン中（印があり getMe が 200）に開く：案内「ログイン中は ログインと安全 から変えられます」（/mfa-setup）。メールの欄と主は出たまま", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.me = () => ({ status: 200, body: { data: { member_id: "m1", tenant_id: "t1", display_name: "高本" } } });
  await signedIn(page);
  await openAsk(page);
  await expect(root(page)).toContainText("ログイン中は ログインと安全 から変えられます");
  await expect(root(page).getByRole("link", { name: "ログインと安全" })).toHaveAttribute("href", "/mfa-setup");
  await expect(emailField(page)).toBeVisible();
  await expect(sendBtn(page)).toBeVisible();
});

test("K320-UI-009 ?token= を開く：data-state p・h1「新しいパスワードを決める」。開いた直後に URL の search が空・履歴の今の項目にも手がかりが無い", async ({
  page,
}) => {
  await mockApi(page);
  await openNew(page);
  await expect(root(page).locator("h1")).toHaveText("新しいパスワードを決める");
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe("");
  expect(page.url()).not.toContain(TOKEN);
  expect(await page.evaluate(() => window.location.href)).not.toContain("token");
});

test("K320-UI-010 新しいパスワードの画面で再読み込み：画面はそのまま・URL に手がかりが無い。決めると口に元の手がかりが渡る", async ({
  page,
}) => {
  const m = await mockApi(page);
  await openNew(page);
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe("");
  await page.reload();
  await expect(root(page)).toHaveAttribute("data-state", "p");
  expect(page.url()).not.toContain(TOKEN);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  expect(m.resets).toEqual([{ token: TOKEN, new_password: NEW_PW }]);
});

test("K320-UI-011 2 つのパスワードが違う：「2 つのパスワードが違います」。口は 0 回", async ({ page }) => {
  const m = await mockApi(page);
  await openNew(page);
  await fillNew(page, NEW_PW, `${NEW_PW}-x`);
  await saveBtn(page).click();
  await expect(root(page)).toContainText(MISMATCH);
  expect(m.resets).toHaveLength(0);
});

test("K320-UI-012 11 文字で 2 つそろえる：E-VAL-005 の文。口は 0 回", async ({ page }) => {
  const m = await mockApi(page);
  await openNew(page);
  await fillNew(page, "a".repeat(11));
  await saveBtn(page).click();
  await expect(root(page)).toContainText(msg("E-VAL-005"));
  expect(m.resets).toHaveLength(0);
});

test("K320-UI-013 12 文字以上でそろえて決める：口に 1 回・done・「ログインする」で /login。手がかりが残らない。同じ人でログイン中だったなら画面の印が消える", async ({
  page,
}) => {
  const m = await mockApi(page);
  let done = false;
  m.on.reset = () => ((done = true), { status: 201, body: { data: { reset: true } } });
  m.on.me = () =>
    done
      ? { status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } }
      : { status: 200, body: { data: { member_id: "m1", tenant_id: "t1", display_name: "高本" } } };
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("k320-seeded")) {
      window.sessionStorage.setItem("k320-seeded", "1");
      window.localStorage.setItem("kaname.token", "tok-k320");
    }
  });
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  await expect(root(page).locator("h1")).toHaveText("パスワードを作り直しました");
  expect(m.resets).toEqual([{ token: TOKEN, new_password: NEW_PW }]);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("kaname.token"))).toBeNull();
  const left = await page.evaluate(() => JSON.stringify({ ...window.sessionStorage }));
  expect(left).not.toContain(TOKEN);
  await root(page).getByRole("link", { name: "ログインする" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("K320-UI-014 別のアカウントでログイン中に決める（getMe が前も後も 200）：済んだに別のアカウントの案内。画面の印はそのまま", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.me = () => ({ status: 200, body: { data: { member_id: "other", tenant_id: "t9", display_name: "木村" } } });
  await signedIn(page);
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  await expect(root(page)).toContainText(OTHER_ACCOUNT);
  expect(await page.evaluate(() => window.localStorage.getItem("kaname.token"))).toBe("tok-k320");
});

test("K320-UI-015 口が 410・E-AUTH-006：dead・正本の文。パスワードの欄は無い。「再設定メールを送り直す」で ask。再読み込みしても new に戻らない", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.reset = () => ({ status: 410, body: { error: "gone", code: "E-AUTH-006", message: msg("E-AUTH-006") } });
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "dead");
  await expect(root(page)).toContainText(DEAD_TEXT);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.reload();
  await expect(root(page)).toHaveAttribute("data-state", "n");
  await page.goto(`/password-reset?token=${TOKEN}`);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "dead");
  await root(page).getByRole("link", { name: "再設定メールを送り直す" }).click();
  await expect(root(page)).toHaveAttribute("data-state", "n");
});

test("K320-UI-016 口が 409・E-PAGE-006：invalid・正本 E-PAGE-006 の文「このリンクは使えなくなりました…」。メールアドレスは出さない", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.reset = () => ({ status: 409, body: { error: "not_found", code: "E-PAGE-006", message: msg("E-PAGE-006") } });
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "invalid");
  await expect(root(page)).toContainText(INVALID_TEXT);
  await expect(root(page)).not.toContainText("@");
});

test("K320-UI-017 口が 422・E-VAL-011（漏れたパスワード）：new のまま欄の下に E-VAL-011 の文", async ({ page }) => {
  const m = await mockApi(page);
  m.on.reset = () => ({
    status: 422,
    body: { error: "validation_failed", code: "E-VAL-011", field: "new_password", message: msg("E-VAL-011") },
  });
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toContainText(msg("E-VAL-011"));
  await expect(root(page)).toHaveAttribute("data-state", "p");
});

test("K320-UI-018 1 回目は網が切れる・2 回目は口が 500（遅らせる）・3 回目は 201：1・2 回目は new のまま E-PAGE-003 の文（2 回目は待つ間に消えてまた出る）。3 回目で done。3 回とも同じ手がかり", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.reset = (n) =>
    n === 1
      ? { status: 0, body: null, abort: true }
      : n === 2
        ? { status: 500, body: { error: "internal", code: "E-PAGE-003" }, delayMs: 1500 }
        : { status: 201, body: { data: { reset: true } } };
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toContainText(msg("E-PAGE-003"));
  await expect(root(page)).toHaveAttribute("data-state", "p");
  await saveBtn(page).click();
  await expect(root(page).getByText(msg("E-PAGE-003"))).toHaveCount(0);
  await expect(root(page)).toContainText(msg("E-PAGE-003"));
  expect(m.resets).toHaveLength(2);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  expect(m.resets.map((b) => b["token"])).toEqual([TOKEN, TOKEN, TOKEN]);
});

test("K320-UI-019 パスワードを見る・隠す（D-087）：2 つの欄とも既定は隠す・押すと見える・的は 24px 以上", async ({
  page,
}) => {
  await mockApi(page);
  await openNew(page);
  await expect(pw2(page)).toHaveAttribute("type", "password");
  await pwToggle(page, "新しいパスワード");
  const toggles = page.getByRole("button", { name: "パスワードを表示" });
  await expect(toggles).toHaveCount(2);
  await toggles.nth(1).click();
  await expect(pw2(page)).toHaveAttribute("type", "text");
});

test("K320-UI-020 「パスワードを決める」を続けて 2 回押す：口は 1 回", async ({ page }) => {
  const m = await mockApi(page);
  m.on.reset = () => ({ status: 201, body: { data: { reset: true } }, delayMs: 800 });
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).dblclick();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  expect(m.resets).toHaveLength(1);
});

test("K320-UI-021 ログインの画面から来た（sessionStorage kaname.reset-email）：欄に入っている・読んだら消える・URL にメールが無い", async ({
  page,
}) => {
  await mockApi(page);
  await openAsk(page);
  await page.evaluate((e) => window.sessionStorage.setItem("kaname.reset-email", e), EMAIL);
  await page.reload();
  await expect(emailField(page)).toHaveValue(EMAIL);
  expect(await page.evaluate(() => window.sessionStorage.getItem("kaname.reset-email"))).toBeNull();
  expect(page.url()).not.toContain("engine-base");
});

test("K320-UI-022 部品の口を呼ばない：網に /api/auth/request-password-reset・/api/auth/reset-password が出ない。呼ぶのは契約の口だけ", async ({
  page,
}) => {
  const m = await mockApi(page);
  await openAsk(page);
  await emailField(page).fill(EMAIL);
  await sendBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "s");
  await page.goto(`/password-reset?token=${TOKEN}`);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  expect(m.urls.filter((u) => /\/api\/auth\/(request-password-reset|reset-password)/.test(u))).toEqual([]);
  expect(m.urls.some((u) => u.includes("/api/v1/auth/password/forgot"))).toBe(true);
  expect(m.urls.some((u) => u.includes("/api/v1/auth/password/reset"))).toBe(true);
});

test("K320-UI-023 部品の道を閉じた（本物の口）：request-password-reset・reset-password（末尾の / つきも）・reset-password/ で始まる道が全部 404", async () => {
  const body = { email: "k320-closed@example.com", redirectTo: "/password-reset", newPassword: NEW_PW, token: "x" };
  for (const path of [
    "/api/auth/request-password-reset",
    "/api/auth/request-password-reset/",
    "/api/auth/reset-password",
    "/api/auth/reset-password/",
  ])
    expect((await api(path, body)).status, `POST ${path}`).toBe(404);
  for (const path of ["/api/auth/reset-password/x", "/api/auth/reset-password/x/y"])
    expect((await api(path)).status, `GET ${path}`).toBe(404);
});

// ---- モックの写しと本番の写し（共通の道具 stage2-match.ts の matchMock・写しは test-results/stage2-match/ に残る） ----
/** 本番の画面をモックの状態にする */
const PROD: Record<string, (page: Page) => Promise<void>> = {
  "reset-ask": async (page) => {
    await mockApi(page);
    await page.goto("/password-reset");
  },
  "reset-ask-error": async (page) => {
    await mockApi(page);
    await page.goto("/password-reset");
    await emailField(page).fill("takamoto@engine-base");
    await sendBtn(page).click();
    await expect(root(page)).toContainText(msg("E-VAL-004"));
  },
  "reset-sent": async (page) => {
    await mockApi(page);
    await page.clock.install();
    await page.goto("/password-reset");
    await emailField(page).fill(EMAIL);
    await sendBtn(page).click();
    await expect(root(page)).toHaveAttribute("data-state", "s");
    await page.clock.fastForward(12_000); // モックは「48 秒あとから」
    await expect(root(page).locator('[data-part="resend"]')).toHaveText("もう一度送る（48 秒あとから）");
  },
  "reset-signed-in": async (page) => {
    const m = await mockApi(page);
    m.on.me = () => ({ status: 200, body: { data: { member_id: "m1", tenant_id: "t1", display_name: "高本" } } });
    await signedIn(page);
    await page.goto("/password-reset");
    await expect(root(page)).toContainText("ログイン中は");
  },
  "reset-new": async (page) => {
    await mockApi(page);
    await page.goto(`/password-reset?token=${TOKEN}`);
    await expect(root(page)).toHaveAttribute("data-state", "p");
  },
  "reset-new-error": async (page) => {
    await mockApi(page);
    await page.goto(`/password-reset?token=${TOKEN}`);
    await fillNew(page, NEW_PW, `${NEW_PW}-x`);
    await saveBtn(page).click();
    await expect(root(page)).toContainText(MISMATCH);
  },
  "reset-done": async (page) => {
    await mockApi(page);
    await page.goto(`/password-reset?token=${TOKEN}`);
    await fillNew(page, NEW_PW);
    await saveBtn(page).click();
    await expect(root(page)).toHaveAttribute("data-state", "done");
  },
  "reset-done-other": async (page) => {
    const m = await mockApi(page);
    m.on.me = () => ({ status: 200, body: { data: { member_id: "other", tenant_id: "t9", display_name: "木村" } } });
    await signedIn(page);
    await page.goto(`/password-reset?token=${TOKEN}`);
    await fillNew(page, NEW_PW);
    await saveBtn(page).click();
    await expect(root(page)).toContainText(OTHER_ACCOUNT);
  },
  "reset-dead": async (page) => {
    const m = await mockApi(page);
    m.on.reset = () => ({ status: 410, body: { error: "gone", code: "E-AUTH-006", message: msg("E-AUTH-006") } });
    await page.goto(`/password-reset?token=${TOKEN}`);
    await fillNew(page, NEW_PW);
    await saveBtn(page).click();
    await expect(root(page)).toHaveAttribute("data-state", "dead");
  },
  "reset-invalid": async (page) => {
    const m = await mockApi(page);
    m.on.reset = () => ({ status: 409, body: { error: "not_found", code: "E-PAGE-006", message: msg("E-PAGE-006") } });
    await page.goto(`/password-reset?token=${TOKEN}`);
    await fillNew(page, NEW_PW);
    await saveBtn(page).click();
    await expect(root(page)).toHaveAttribute("data-state", "invalid");
  },
};

for (const id of Object.keys(PROD)) {
  for (const w of MATCH_WIDTHS) {
    test(`K320-UI-024 ${id} 幅 ${w}：本番の値（箱・見出し・文・知らせ・欄・ボタン）と読み込んだ書体がモックと同じ（共通の道具 stage2-match.ts・px は ±2）`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(browser, id, w, PROD[id]!, { blur: true });
      expect(rows.length, "比べた行がある").toBeGreaterThan(3);
      expect(bad).toEqual([]);
    });
  }
}
test("K320-UI-025 幅 320・375・768・1024・1440（ask・sent・new・done・dead）：横溢れ 0・見出しの 1 文字目が画面の中", async ({
  browser,
}) => {
  for (const id of ["reset-ask", "reset-sent", "reset-new", "reset-done", "reset-dead"]) {
    for (const w of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } });
      await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
      await PROD[id]!(page);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over, `${id} 幅 ${w}`).toBe(0);
      const left = await page.locator(`${ROOT_SEL} h1`).evaluate((h) => {
        const range = document.createRange();
        range.setStart(h.firstChild ?? h, 0);
        range.setEnd(h.firstChild ?? h, 1);
        return range.getBoundingClientRect().left;
      });
      expect(left, `${id} 幅 ${w} の見出し`).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThan(w);
      await page.close();
    }
  }
});

test("K320-UI-026 外への読み込み：手がかりのある画面を開いて決めるまで、網は自分の出どころと口（/api/）のほかに出ない", async ({
  page,
  baseURL,
}) => {
  const m = await mockApi(page);
  await openNew(page);
  await fillNew(page, NEW_PW);
  await saveBtn(page).click();
  await expect(root(page)).toHaveAttribute("data-state", "done");
  const own = new URL(baseURL!).origin;
  const outside = m.urls.filter(
    (u) => !u.startsWith(own) && !/^(data|blob):/.test(u) && !/\/api\//.test(new URL(u).pathname),
  );
  expect(outside).toEqual([]);
});
