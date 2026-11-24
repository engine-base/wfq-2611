// K-375「Bridge が古い PC の行に、入れ直す一手（受け取る・OS の警告の越え方）を出す」の画面の試験（実 Chrome・実装より先に積む）。
//   画面：/setup/bridge（K-57 の features/F3/connect-pc）。正のモック：/dev/mock/f3-pc の pc-bridge-outdated・pc-bridge-reinstalling・pc-bridge-reinstall-error・pc-bridge-outdated-phone
//   （本番と同じ部品 apps/web/features/F3/connect-pc/pc-row-parts.tsx の BridgeReinstall・OsWarning。K-369 が本線に入れる）。
//   代表の答え answer=7cf148a79dc9（2026-11-19）：前の「PC をつなぐ」画面（K-367 が消す）にだけあった「Bridge が古いとき入れ直す口」を、新しい画面の PC の行に足す。
//   会話の帯（E-CONN-012・components/ai/agent-chat.tsx）の「PC の状態を見る」は /setup/bridge へ来るので、来た先で入れ直せる。
//   「古い」は一覧 listMyDevices の自己診断 health の fix=update の行（ok false・口が約束の版より前の Bridge の知らせに足す・K-57 の OUTDATED_CHECK）。
//   口（listMyDevices・downloadBridgeRelease）は網の手前（page.route）で差し替える。本人の Bridge（127.0.0.1:38617）には届かせない。
//   固定の待ち（waitForTimeout）は使わない：答えを待たせる行は約束で止めて放す。テストはチケットを切る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import type { FidelityPair } from "../../../../scripts/ci/fidelity_compare.mjs";
import { MATCH_WIDTHS, matchMock, type MatchOptions } from "./stage2-match";
// 作り物の秘密の値は apps/web/test/_fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K375_WEB_TOKEN } from "../../test/_fake/secrets";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const BODY = 'section[aria-labelledby="pc-list-title"]';
const MAC = "高本の MacBook";
const MINI = "事務所の Mac mini";
const D1 = "11111111-0000-4000-8000-000000000375";
const D2 = "22222222-0000-4000-8000-000000000375";
const REINSTALL_TEXT = "書いたことは溜めておき、入れ直した後に順に片づけます。";
const ON_PC = "その PC でこの画面を開いて、入れ直してください";
const TAKEN = "受け取りを始めました。受け取った Kaname Bridge を開いて入れ直すと、このお知らせは自分で消えます";
const SUMMARY = "「開いていません」「PC が保護されました」と出たとき";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** 文は正本（07_qa/test-specs/errors.json）から引く */
const ERRORS = (
  JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
    errors: { id: string; message: string }[];
  }
).errors;
const msg = (id: string): string => ERRORS.find((e) => e.id === id)?.message ?? `(${id} が errors.json に無い)`;

type Check = { name: string; ok: boolean; detail: string; fix?: string | null; code?: string };
/** 口が古い Bridge の知らせに足す 1 行（apps/api/src/features/F3/connect-pc/hooks.ts の OUTDATED_CHECK と同じ形） */
const OUTDATED: Check = {
  name: "Bridge が新しい",
  ok: false,
  detail: "この PC の Bridge が古いので、自分のAI に仕事を渡せません。Bridge を入れ直してください",
  fix: "update",
  code: "E-CONN-012",
};
const CLAUDE_MISSING: Check = {
  name: "本人のサブスクの Claude Code がある",
  ok: false,
  detail: "この PC にありません",
  fix: "install",
};
const CHROME_NG: Check = {
  name: "AI が Chrome を使える（Claude in Chrome）",
  ok: false,
  detail: "つながっていません",
};

interface Dev {
  id: string;
  device_label: string;
  state: "live" | "asleep" | "waiting";
  last_seen_at: string | null;
  connected_at: string;
  version: string | null;
  health: Check[];
  health_at: string | null;
  browser?: "chrome" | "dedicated" | "off";
  revoke_reason: null;
}
/** モックの行と同じ補足の字になる値（11/02 につないだ ・ Kaname の常駐アプリ v0.8.1） */
const dev = (id: string, label: string, o: Partial<Dev> = {}): Dev => ({
  id,
  device_label: label,
  state: "live",
  last_seen_at: new Date().toISOString(),
  connected_at: "2026-11-02T01:00:00Z",
  version: "0.8.1",
  health: [OUTDATED],
  health_at: "2026-11-19T01:00:00Z",
  browser: "chrome",
  revoke_reason: null,
  ...o,
});
const fresh = (id: string, label: string, o: Partial<Dev> = {}) =>
  dev(id, label, { version: "0.9.4", health: [], ...o });
const mini = (o: Partial<Dev> = {}) => fresh(D2, MINI, { state: "asleep", last_seen_at: "2026-11-15T00:02:00Z", ...o });

interface Mock {
  devices: Dev[];
  reads: number;
  downloads: string[];
  /** 受け取りの口の答え（null＝200 でファイル） */
  download: { status: number; code: string } | null;
  /** 立てると、受け取りの口の答えを release() まで止める */
  hold: { release: () => void } | null;
}

async function mockApi(page: Page, devices: Dev[]): Promise<Mock> {
  const m: Mock = { devices: structuredClone(devices), reads: 0, downloads: [], download: null, hold: null };
  await page.addInitScript((t) => window.localStorage.setItem("kaname.token", t), K375_WEB_TOKEN);
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route, req: Request) => {
    const p = new URL(req.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/v1/bridge/devices" && req.method() === "GET") {
      m.reads += 1;
      return json(200, { data: m.devices, meta: {} });
    }
    const d = /^\/api\/v1\/bridge\/releases\/(\w+)\/file$/.exec(p);
    if (d) {
      m.downloads.push(d[1]!);
      const h = m.hold;
      if (h) await new Promise<void>((go) => (h.release = go));
      if (m.download) return json(m.download.status, { error: m.download.code.toLowerCase(), code: m.download.code });
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body: "Kaname-Bridge" });
    }
    return json(404, { error: "not_found", code: "NOT_FOUND" });
  });
  return m;
}
async function open(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  const res = await page.goto("/setup/bridge");
  expect(res?.status()).toBe(200);
  await expect(page.locator(`${BODY} .k-pc-row`).first()).toBeVisible();
}
const row = (page: Page, name = MAC) => page.locator(`${BODY} .k-pc-row`, { hasText: name });
const part = (page: Page, name = MAC) => row(page, name).locator('[data-part="bridge-reinstall"]');
const btn = (page: Page, os: "mac" | "win", name = MAC) => part(page, name).locator(`[data-reinstall="${os}"]`);
const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------------------------------------------------------------- 出し分け

test("K375-UI-002 Bridge が古い（自己診断に fix=update の ✗）つながっている PC の行：入れ直す区画が 1 つ（題は E-CONN-012 の文・「書いたことは溜めておき…」・「Mac 用を受け取る」「Windows 用を受け取る」が押せる）。同じ行に Claude Code の直し方・ブラウザを選ぶ欄・その場の一手は出さない（先に直す物だけ）。古くない行は今のまま", async ({
  page,
}) => {
  await mockApi(page, [dev(D1, MAC, { health: [OUTDATED, CLAUDE_MISSING, CHROME_NG] }), fresh(D2, MINI)]);
  await open(page);
  await expect(part(page)).toHaveCount(1);
  await expect(part(page).locator(".k-pc-part-title")).toHaveText(msg("E-CONN-012"));
  await expect(part(page)).toContainText(REINSTALL_TEXT);
  await expect(btn(page, "mac")).toHaveText("Mac 用を受け取る");
  await expect(btn(page, "mac")).toBeEnabled();
  await expect(btn(page, "win")).toHaveText("Windows 用を受け取る");
  await expect(btn(page, "win")).toBeEnabled();
  for (const sel of ['[data-part="claude-fix"]', "[data-browser-pick]", '[data-part="browser-fix"]'])
    await expect(row(page).locator(sel), `古い行に ${sel} は出さない`).toHaveCount(0);
  await expect(part(page, MINI)).toHaveCount(0);
  await expect(row(page, MINI).locator("[data-browser-pick]")).toHaveCount(1);
});

test("K375-UI-003 古くない PC（health が空・fix=update の行が ok・fix=update の無い ✗ だけ）の行には入れ直す区画を出さない", async ({
  page,
}) => {
  await mockApi(page, [
    fresh(D1, MAC),
    fresh(D2, MINI, { health: [{ ...OUTDATED, ok: true }] }),
    fresh("33333333-0000-4000-8000-000000000375", "会社の Windows", { health: [CHROME_NG] }),
  ]);
  await open(page);
  await expect(page.locator(`${BODY} .k-pc-row`)).toHaveCount(3);
  await expect(page.locator(`${BODY} [data-part="bridge-reinstall"]`)).toHaveCount(0);
});

test("K375-UI-004 「Mac 用を受け取る」：口 downloadBridgeRelease（GET /api/v1/bridge/releases/mac/file）をちょうど 1 回。行に role=status「受け取りを始めました。…」と、閉じた形の越え方（Mac の分だけ）。ボタンはまた押せる", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  await open(page);
  await btn(page, "mac").click();
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  expect(m.downloads).toEqual(["mac"]);
  const w = part(page).locator("[data-os-warning]");
  await expect(w).toHaveCount(1);
  await expect(w.locator("summary")).toHaveText(SUMMARY);
  expect(await w.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  await expect(w.locator('[data-os-warning-os="mac"]')).toHaveCount(1);
  await expect(w.locator('[data-os-warning-os="win"]')).toHaveCount(0);
  await expect(btn(page, "mac")).toBeEnabled();
  await expect(btn(page, "win")).toBeEnabled();
});

test("K375-UI-005 「Windows 用を受け取る」：口（win）を 1 回。開いた越え方は Windows の 2 つの手順（「詳細情報」→「実行」）だけ", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  await open(page);
  await btn(page, "win").click();
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  expect(m.downloads).toEqual(["win"]);
  const w = part(page).locator("[data-os-warning]");
  await w.locator("summary").click();
  await expect(w.locator('[data-os-warning-os="win"] li')).toHaveText(["「詳細情報」を押す", "「実行」を押す"]);
  await expect(w.locator('[data-os-warning-os="mac"]')).toHaveCount(0);
});

test("K375-UI-006 受け取りの口が 404・E-CONN-014（まだ配布していない）：行の role=alert に E-CONN-014 の文。受け取りの知らせと越え方は出ない。ボタンは押せる", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  m.download = { status: 404, code: "E-CONN-014" };
  await open(page);
  await btn(page, "mac").click();
  await expect(part(page).getByRole("alert")).toHaveText(msg("E-CONN-014"));
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toHaveCount(0);
  await expect(part(page).locator("[data-os-warning]")).toHaveCount(0);
  await expect(btn(page, "mac")).toBeEnabled();
});

test("K375-UI-007 受け取りの口が 503・E-PAGE-007：行の role=alert に E-PAGE-007 の文。もう一度押して受け取れたら、失敗の文は消え受け取りの知らせが出る（口は 2 回）", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  m.download = { status: 503, code: "E-PAGE-007" };
  await open(page);
  await btn(page, "mac").click();
  await expect(part(page).getByRole("alert")).toHaveText(msg("E-PAGE-007"));
  m.download = null;
  await btn(page, "mac").click();
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  await expect(part(page).getByRole("alert")).toHaveCount(0);
  expect(m.downloads).toEqual(["mac", "mac"]);
});

test("K375-UI-008 受け取りの口が 401（ログインが切れた）：入り直しの道 /login?next=%2Fsetup%2Fbridge へ移る", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  m.download = { status: 401, code: "UNAUTHENTICATED" };
  await open(page);
  await btn(page, "mac").click();
  await expect(page).toHaveURL(/\/login\?next=%2Fsetup%2Fbridge$/);
});

test("K375-UI-009 2 回押し：答えを待つ間（口を止めている）は 2 つのボタンとも押せない。もう 1 つ押しても口は 1 回のまま。答えが来たら押せて知らせ", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  m.hold = { release: () => undefined };
  await open(page);
  await btn(page, "mac").click();
  await expect.poll(() => m.downloads.length).toBe(1);
  await expect(btn(page, "mac")).toBeDisabled();
  await expect(btn(page, "win")).toBeDisabled();
  await btn(page, "win").click({ force: true });
  m.hold.release();
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  await expect(btn(page, "mac")).toBeEnabled();
  expect(m.downloads).toEqual(["mac"]);
});

test("K375-UI-010 入れ直した直後：次の一覧の読みで自己診断から fix=update の行が消えたら、読み直さずに入れ直す区画が消え、その行に AI が使うブラウザを選ぶ欄が出る（G-12）", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  await open(page);
  await btn(page, "mac").click();
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  m.devices[0] = fresh(D1, MAC);
  const reads = m.reads;
  await expect.poll(() => m.reads, { timeout: 15_000 }).toBeGreaterThan(reads);
  await expect(part(page)).toHaveCount(0);
  await expect(row(page).locator("[data-browser-pick]")).toHaveCount(1);
  await expect(row(page)).toContainText("v0.9.4");
});

test("K375-UI-011 眠っている PC の古い報告（fix=update が残っている）：その行も入れ直す区画を出す（起きても古いまま）。眠っている行の直し方の箱と「Bridge を起こす」はそのまま", async ({
  page,
}) => {
  await mockApi(page, [fresh(D1, MAC), mini({ health: [OUTDATED] })]);
  await open(page);
  await expect(part(page, MINI)).toHaveCount(1);
  await expect(btn(page, "mac", MINI)).toBeEnabled();
  await expect(row(page, MINI).locator('[data-act="wake"]')).toBeVisible();
  await expect(part(page)).toHaveCount(0);
});

test("K375-UI-012 スマホ（iPhone の端末・幅 375）：古い行の区画に受け取るボタンは無く「その PC でこの画面を開いて、入れ直してください」。受け取りの口は呼ばない", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 375, height: 812 }, hasTouch: true });
  const page = await ctx.newPage();
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  await open(page, 375, 812);
  await expect(part(page).locator(".k-pc-part-title")).toHaveText(msg("E-CONN-012"));
  await expect(part(page)).toContainText(ON_PC);
  await expect(part(page).getByRole("button")).toHaveCount(0);
  expect(m.downloads).toEqual([]);
  await ctx.close();
});

test("K375-UI-013 守り：PC 2 台とも古く 2 台目で受け取る：知らせと越え方は 2 台目の行だけ。1 台目の行は押す前のまま", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), dev(D2, MINI)]);
  await open(page);
  await btn(page, "win", MINI).click();
  await expect(part(page, MINI).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  expect(m.downloads).toEqual(["win"]);
  await expect(part(page, MINI).locator("[data-os-warning]")).toHaveCount(1);
  await expect(part(page).getByRole("status")).toHaveCount(0);
  await expect(part(page).locator("[data-os-warning]")).toHaveCount(0);
});

test("K375-UI-014 入口：会話の帯（components/ai/agent-chat.tsx の [data-bridge-outdated]・E-CONN-012）の「PC の状態を見る」の行き先は /setup/bridge で、そこへ来ると古い行に入れ直す区画が出る", async ({
  page,
}) => {
  const src = readFileSync(join(ROOT, "apps/web/components/ai/agent-chat.tsx"), "utf8");
  const band = src.slice(src.indexOf("data-bridge-outdated"));
  const href = /<Link href="([^"]+)">PC の状態を見る<\/Link>/.exec(band)?.[1];
  expect(href, "古いの帯に「PC の状態を見る」がある").toBe("/setup/bridge");
  await mockApi(page, [dev(D1, MAC), mini()]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto(href!))?.status()).toBe(200);
  await expect(part(page)).toHaveCount(1);
  await expect(btn(page, "mac")).toBeEnabled();
});

test("K375-UI-015 キーボード：「Mac 用を受け取る」に焦点 → Enter で受け取る（口 1 回）。越え方の見出しに焦点 → Enter で開く", async ({
  page,
}) => {
  const m = await mockApi(page, [dev(D1, MAC), mini()]);
  await open(page);
  await btn(page, "mac").focus();
  await page.keyboard.press("Enter");
  await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
  expect(m.downloads).toEqual(["mac"]);
  const summary = part(page).locator("[data-os-warning] > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      part(page)
        .locator("[data-os-warning]")
        .evaluate((d) => (d as HTMLDetailsElement).open),
    )
    .toBe(true);
});

test("K375-UI-016 幅 320・375・768・1024・1440 で受け取って越え方を開いた形：どの幅も横のはみ出し 0。ボタンは幅も高さも 24px 以上", async ({
  page,
}) => {
  test.setTimeout(180_000); // 幅 5 つで開き直す（台が混んでも時間切れで落とさない）
  await mockApi(page, [dev(D1, MAC), mini()]);
  const bad: string[] = [];
  for (const width of [320, 375, 768, 1024, 1440]) {
    await open(page, width);
    await btn(page, "mac").click();
    await expect(part(page).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
    await part(page).locator("[data-os-warning] > summary").click();
    const o = await overflowX(page);
    if (o !== 0) bad.push(`幅 ${width}：横のはみ出し ${o}`);
    for (const os of ["mac", "win"] as const) {
      const r = (await btn(page, os).boundingBox())!;
      if (r.width < 24 || r.height < 24) bad.push(`幅 ${width}：${os} のボタン ${r.width}×${r.height}`);
    }
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

// ---------------------------------------------------------------- モックとの突き合わせ（共通の道具 matchMock・置き場は /dev/mock/f3-pc・K-369 が本線に入れる）
//   入れ直す区画の中だけを、行の上端からの y で比べる（行より上の物＝見出しの行の「＋ PC をつなぐ」と理由の 1 行は K-361・K-373 の受け持ち）

const BOX = ["width", "height", "x", "background-color", "border-top-color", "border-top-left-radius"];
const TXT = ["font-size", "font-weight", "color", "line-height", "texts"];
const CTRL = ["width", "height", "x", "font-size", "color", "background-color", "border-top-color", "opacity", "texts"];
function pairs(): FidelityPair[] {
  const R = `${BODY} .k-pc-row:nth-child(1)`;
  const yFrom = {
    max_width: 1440,
    canvas: R,
    app: R,
    why: "行より上の物（見出しの行のボタン・押せない理由の 1 行）の受け持ちは別の葉。行の中の区画の並びだけを行の上端から比べる（K-375）",
  };
  const p = (name: string, sel: string, props: string[]): FidelityPair =>
    ({ name, role: name, canvas: sel, app: sel, props: [...props, "y"], y_from: yFrom }) as FidelityPair;
  const S = `${R} [data-part="bridge-reinstall"]`;
  return [
    p("detail", `${R} .k-pc-detail`, ["x", ...TXT]),
    p("reinstall", S, BOX),
    p("reinstall-title", `${S} .k-pc-part-title`, ["x", ...TXT]),
    p("reinstall-text", `${S} .k-pc-part-text`, ["x", ...TXT]),
    p("reinstall-meta", `${S} .k-pc-part-meta`, ["x", ...TXT]),
    p("reinstall-mac", `${S} [data-reinstall="mac"]`, CTRL),
    p("reinstall-win", `${S} [data-reinstall="win"]`, CTRL),
    p("reinstall-note", `${S} .k-pc-part-note`, ["x", "width", ...TXT]),
    p("os-summary", `${S} [data-os-warning] > summary`, ["x", ...TXT]),
  ];
}
interface Drive {
  phone?: boolean;
  download?: Mock["download"];
  act?: (p: Page) => Promise<void>;
}
const DRIVE: Record<string, Drive> = {
  "pc-bridge-outdated": {},
  "pc-bridge-reinstalling": {
    act: async (p) => {
      await btn(p, "mac").click();
      await expect(part(p).getByRole("status").filter({ hasText: TAKEN })).toBeVisible();
    },
  },
  "pc-bridge-reinstall-error": {
    download: { status: 404, code: "E-CONN-014" },
    act: async (p) => {
      await btn(p, "mac").click();
      await expect(part(p).getByRole("alert")).toBeVisible();
    },
  },
  "pc-bridge-outdated-phone": { phone: true },
};
for (const [id, c] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K375-UI-001 ${id} 幅 ${w}：古い行の補足と入れ直す区画（箱・題・文・ボタン・知らせ・越え方の見出し・行の上端からの位置）の値がモック /dev/mock/f3-pc/${id} と同じ（共通の道具 matchMock）`, async ({
      browser,
    }) => {
      const opts = { pairs: pairs(), base: "/dev/mock/f3-pc", blur: true } as MatchOptions & { base: string };
      const { rows, bad } = await matchMock(
        browser,
        id,
        w,
        async (page) => {
          if (c.phone) {
            // matchMock が開いた頁の UA は替えられないので、見分けの値（navigator）だけを iPhone にする
            await page.addInitScript((ua) => {
              Object.defineProperty(navigator, "userAgent", { get: () => ua });
              Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
            }, IPHONE_UA);
          }
          const m = await mockApi(page, [dev(D1, MAC), mini()]);
          m.download = c.download ?? null;
          await open(page, w, w === 375 ? 812 : 900);
          if (c.act) await c.act(page);
          await page.evaluate(() => window.scrollTo(0, 0));
        },
        opts,
      );
      expect(new Set(rows.map((r) => r.part)), "入れ直す区画を比べた").toContain("reinstall");
      expect(bad).toEqual([]);
    });
  }
}
