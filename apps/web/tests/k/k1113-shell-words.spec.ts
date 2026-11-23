// K-1113「外枠の字をそろえる：名詞の『知らせ』を『お知らせ』に・左の『取引先』を外す」の試験（実 Chrome と、ファイルを読む試験・実装より先に積む）。
//   的：共通の外枠（components/k の Shell の左のメニューと上の帯の鈴）・自分の設定の第 2 ナビ（MeSub）・Bridge の入れ直しの行（pc-row-parts の REINSTALL_TAKEN_TEXT）と、
//     その正の絵（04_design/canvas/*.dc.html・作り手 04_design/canvas_gen）と、並べ方の正（05_flow/phase1.py → flow.json → apps/web/lib/nav.ts）。
//   決め：名詞は「お知らせ」（段 5 のすり合わせの言葉・K-400 と同じ直し）。取引先は持たない（代表の答え answer=4961f0280e9a）ので左の項目から外す
//     （押せない形でも出さない。ゲストはメンバーの画面のタブ＝段 12）。動詞の「知らせる」は変えない。
//   口は呼ばない（モック /dev/mock/f3-pc と見本 /dev/k/showcase・網の手前で 599）。本人の Bridge（127.0.0.1:38617）は 404。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { NAV } from "../../lib/nav";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const WEB = join(HERE, "../..");
const CANVAS = join(ROOT, "04_design/canvas");
const GEN = join(ROOT, "04_design/canvas_gen");
const MAC = "高本の MacBook";
const OLD_BELL = /aria-label="知らせ/;
const OLD_SUB = /<span class="kn-sub-t">知らせ<\/span>/;
const OLD_NOTE = /預けたログイン情報と知らせはワークスペースごと/;
const OLD_NAV = /<a [^>]*title="取引先"[^>]*class="kn-item"|<span class="kn-lbl">取引先<\/span>/;

async function guard(page: Page) {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\//, (route) => route.fulfill({ status: 599, body: "モックは口を呼ばない" }));
}
async function openMock(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  const res = await page.goto(`/dev/mock/f3-pc/${id}`);
  expect(res?.status(), `${id} を開けない`).toBe(200);
  await expect(page.locator(`[data-mock="${id}"]`)).toBeVisible();
  await expect(page.locator(".k-shell")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
const leftNav = (page: Page) => page.getByRole("navigation", { name: "メニュー", exact: true });
const canvasFiles = () => readdirSync(CANVAS).filter((f) => f.endsWith(".dc.html"));

test("K1113-UI-001 左のメニュー（役 R1・幅 1440 と 768 のレール）：項目は チケット・承認待ち・高本のAI・ナレッジ・ワークスペースの管理 の 5 つで、「取引先」は押せない形でも無い（字・title・読み上げのどれにも無い）", async ({
  page,
}) => {
  await guard(page);
  for (const w of [1440, 768]) {
    await openMock(page, "pc-claude-done", w);
    const nav = leftNav(page);
    const items = nav.locator(".k-nav-item:not([data-group]):not(:has(.k-group-mark))");
    const titles = await items.evaluateAll((es) =>
      es.map((e) => (e.getAttribute("title") ?? "").replace(/（準備中）$/, "")),
    );
    expect(titles, `幅 ${w}`).toEqual(["チケット", "承認待ち", "高本のAI", "ナレッジ", "ワークスペースの管理"]);
    await expect(nav.getByRole("link", { name: /取引先/ }), `幅 ${w}`).toHaveCount(0);
    expect(await nav.evaluate((e) => e.outerHTML), `幅 ${w}`).not.toContain("取引先");
  }
});

test("K1113-UI-002 上の帯の鈴：数の無いときの読み上げは「お知らせ」・指を置くと「お知らせ（準備中）」（幅 1440・375）。数のある見本 /dev/k/showcase は「お知らせ（3 件）」で、押すと見本の知らせが出る", async ({
  page,
}) => {
  await guard(page);
  for (const w of [1440, 375]) {
    await openMock(page, "pc-claude-done", w);
    const bell = page.locator(".k-bar .k-bell");
    await expect(bell, `幅 ${w}`).toHaveCount(1);
    await expect(bell, `幅 ${w}`).toHaveAttribute("aria-label", "お知らせ");
    await expect(bell, `幅 ${w}`).toHaveAttribute("title", "お知らせ（準備中）");
    await expect(page.getByRole("button", { name: /^知らせ/ }), `幅 ${w}`).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto("/dev/k/showcase"))?.status()).toBe(200);
  const counted = page.locator(".k-bar").getByRole("button", { name: "お知らせ（3 件）", exact: true });
  await expect(counted).toHaveCount(1);
  await counted.click();
  await expect(page.locator(".k-toast").filter({ hasText: "知らせを開く（見本）" })).toBeVisible();
});

test("K1113-UI-003 自分の設定の第 2 ナビ（/dev/mock/f3-pc・幅 1440）：項目の名前は プロフィール・ログインと安全・PC と使った量・預けたログイン情報・お知らせ の順。注は「アカウントは 1 人 1 つ。預けたログイン情報とお知らせはワークスペースごと」", async ({
  page,
}) => {
  await guard(page);
  await openMock(page, "pc-claude-done", 1440);
  const sub = page.locator('[aria-label="自分の設定の中"]');
  const names = (await sub.locator(".k-me-sub-t").allInnerTexts()).map((x) => x.trim());
  expect(names).toEqual(["プロフィール", "ログインと安全", "PC と使った量", "預けたログイン情報", "お知らせ"]);
  await expect(sub.locator(".k-me-sub-note")).toHaveText(
    "アカウントは 1 人 1 つ。預けたログイン情報とお知らせはワークスペースごと",
  );
});

test("K1113-UI-004 Bridge の入れ直しの行（モック pc-bridge-reinstalling・幅 1440）：受け取りを始めた後の role=status は「…入れ直すと、このお知らせは自分で消えます」", async ({
  page,
}) => {
  await guard(page);
  await openMock(page, "pc-bridge-reinstalling", 1440);
  const part = page.locator(".k-pc-list > li", { hasText: MAC }).locator('section[aria-label="Bridge を入れ直す"]');
  await expect(part.getByRole("status")).toHaveText(
    "受け取りを始めました。受け取った Kaname Bridge を開いて入れ直すと、このお知らせは自分で消えます",
  );
});

test("K1113-UI-005 並べ方の正と生成物：lib/nav.ts の役ごとの主ナビ（sectionsByRole）のどれにも clients が無く、account の第 2 ナビの項目は「お知らせ」（「知らせ」は無い）。並べ方の正 05_flow/phase1.py の NAV_SECTIONS_BY_ROLE にも clients が無い", () => {
  for (const [role, keys] of Object.entries(NAV.sectionsByRole)) expect(keys, role).not.toContain("clients");
  const account = (NAV.subByScreen["account"] ?? []).map((x) => x.label);
  expect(account).toContain("お知らせ");
  expect(account).not.toContain("知らせ");
  const phase1 = readFileSync(join(ROOT, "05_flow/phase1.py"), "utf8");
  const block = phase1.slice(
    phase1.indexOf("NAV_SECTIONS_BY_ROLE = {"),
    phase1.indexOf("}", phase1.indexOf("NAV_SECTIONS_BY_ROLE = {")),
  );
  expect(block).toContain('"R1"');
  expect(block).not.toContain('"clients"');
});

test("K1113-UI-006 画面のコード：外枠（shell.tsx）・第 2 ナビ（me-sub.tsx）・入れ直しの行（pc-row-parts.tsx）の画面に出る字に、名詞の「知らせ」（前に「お」が無く、後ろが「る」でない）が無い", () => {
  const files = ["components/k/shell.tsx", "components/k/me-sub.tsx", "features/F3/connect-pc/pc-row-parts.tsx"];
  for (const f of files) {
    const src = readFileSync(join(WEB, f), "utf8");
    // 注（// と /** */）は画面に出ないので見ない
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/.*$/gm, "");
    const hits = [...code.matchAll(/(?<!お)知らせ(?!る)/g)].map((m) =>
      code.slice(Math.max(0, m.index! - 20), m.index! + 10),
    );
    expect(hits, f).toEqual([]);
  }
});

test("K1113-UI-007 キャンバス（正の絵）：どの絵にも左の「取引先」の項目・鈴の「知らせ」・第 2 ナビの「知らせ」とその注の古い字が無い。EdPC は鈴が「お知らせ（3 件）」・第 2 ナビが「お知らせ」", () => {
  const bad: string[] = [];
  for (const f of canvasFiles()) {
    const s = readFileSync(join(CANVAS, f), "utf8");
    for (const [name, re] of [
      ["取引先の項目", OLD_NAV],
      ["鈴", OLD_BELL],
      ["第 2 ナビ", OLD_SUB],
      ["注", OLD_NOTE],
    ] as const)
      if (re.test(s)) bad.push(`${f}：${name}`);
  }
  expect(bad).toEqual([]);
  const edpc = readFileSync(join(CANVAS, "EdPC.dc.html"), "utf8");
  expect(edpc).toContain('aria-label="お知らせ（3 件）"');
  expect(edpc).toContain('<span class="kn-sub-t">お知らせ</span>');
  expect(edpc).toContain("預けたログイン情報とお知らせはワークスペースごと");
});

test("K1113-UI-008 キャンバスの作り手：絵の写しに shellfix.py（全部の絵にそろえの処理をかける）を回し直しても、絵が 1 バイトも変わらない（作り手に古い字が残っていれば戻る）", () => {
  const tmp = mkdtempSync(join(tmpdir(), "k1113-canvas-"));
  try {
    cpSync(CANVAS, tmp, { recursive: true });
    execFileSync("python3", ["shellfix.py"], {
      cwd: GEN,
      env: { ...process.env, KANAME_CANVAS: `${tmp}/` },
      stdio: "pipe",
    });
    const changed = canvasFiles().filter(
      (f) => readFileSync(join(tmp, f), "utf8") !== readFileSync(join(CANVAS, f), "utf8"),
    );
    expect(changed).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
