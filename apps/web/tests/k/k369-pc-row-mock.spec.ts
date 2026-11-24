// K-369「PC の行の部品とモック（/dev/mock/f3-pc の 31 の状態）を本線に入れる」の試験（実 Chrome と、ファイルと検査の道具を読む試験・実装より先に積む）。
//   的：開発用の置き場 /dev/mock/f3-pc（索引）と /dev/mock/f3-pc/<状態>（1 つの状態）。
//   モックは本番と同じ部品（features/F3/connect-pc/pc-row-parts.tsx・components/k）を決めた値で並べたもの（段 4 の下絵・2026-11-19 まとめ役。代表の OK は聞いている最中）。
//   見ること：31 の状態が全部描ける・幅 375／768／1440 で横のはみ出し 0・状態の持ち主は画面の葉（K-361・K-373・K-368・K-363・K-374・K-375）・部品は見た目だけ・正本の値の検査が緑・
//   部品の字と役（Claude Code の直し方・AI が使うブラウザ・その場の一手・「…」のメニュー・外す小窓・OS の警告の越え方・Bridge を入れ直す一手）。
//   OS の警告の越え方（pc-os-warning*）と入れ直す一手（pc-bridge-*）は代表の答え answer=7cf148a79dc9（2026-11-19）で足した 7 つ
//   代表の OK（2026-11-19）を受けた形。下絵の字と形が正
//   口は呼ばない（モックは値を決めて並べるだけ）。本人の Bridge（127.0.0.1:38617）にも届かせない（網の手前で 404）。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { isBuilt } from "../../lib/built-routes";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const WEB = join(HERE, "../..");
const MOCKS_SRC = join(WEB, "app/(dev)/dev/mock/f3-pc/mocks.tsx");
const PARTS_SRC = join(WEB, "features/F3/connect-pc/pc-row-parts.tsx");
const PARTS_CSS = join(WEB, "features/F3/connect-pc/pc-row-parts.css");
const SHOTS = join(ROOT, "07_functional/段4-F3/shots-pc");
const ERRORS = (
  JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
    errors: { id: string; message: string }[];
  }
).errors;
const msg = (id: string): string => ERRORS.find((e) => e.id === id)?.message ?? `(${id} が errors.json に無い)`;

/** 画面の葉と、その葉が本物にするモックの状態（11_tickets/K-361.md・K-373.md・K-368.md・K-363.md・K-374.md・K-375.md の頭の欄 mock: と同じ・31 個） */
const LEAVES: Record<string, readonly string[]> = {
  "K-361": [
    "pc-claude-missing",
    "pc-claude-installing",
    "pc-claude-install-error",
    "pc-claude-broken",
    "pc-claude-login",
    "pc-claude-code",
    "pc-claude-code-error",
    "pc-claude-done",
    "pc-claude-other-device",
    "pc-asleep",
  ],
  "K-373": ["pc-phone"],
  "K-368": [
    "pc-browser-pick",
    "pc-browser-saved",
    "pc-browser-fix",
    "pc-browser-checking",
    "pc-browser-ok",
    "pc-browser-still",
    "pc-browser-timeout",
    "pc-browser-asleep",
  ],
  "K-363": ["pc-menu", "pc-remove", "pc-remove-stepup", "pc-removed", "pc-remove-error"],
  "K-374": ["pc-os-warning", "pc-os-warning-mac", "pc-os-warning-win"],
  "K-375": ["pc-bridge-outdated", "pc-bridge-reinstalling", "pc-bridge-reinstall-error", "pc-bridge-outdated-phone"],
};
const ALL = Object.values(LEAVES).flat();
const OWNER = new Map(Object.entries(LEAVES).flatMap(([k, ids]) => ids.map((id) => [id, k] as const)));
const WIDTHS = [375, 768, 1440] as const;
/** 小窓が開いている状態 */
/** つなぐ小窓（ConnectDialog）が開いている状態。小窓の題は h1（開くと後ろが読み上げの木から外れ、読み上げの h1 は小窓の題 1 つ・K-230）なので、頁の h1 は 2 つ */
const CONNECT = ["pc-os-warning", "pc-os-warning-mac", "pc-os-warning-win"];
const DIALOGS = ["pc-remove", "pc-remove-stepup", ...CONNECT];
/** 状態ごとの h1 の並び（頁の見出し・つなぐ小窓の題） */
const h1Of = (id: string): string[] => (CONNECT.includes(id) ? ["PC と使った量", "PC をつなぐ"] : ["PC と使った量"]);
const MAC = "高本の MacBook";
const MINI = "事務所の Mac mini";

function mockEntries(): { id: string; screen: string; ticket: string }[] {
  const src = readFileSync(MOCKS_SRC, "utf8");
  return [
    ...src.matchAll(/\{\s*id: "([^"]+)",\s*screen: "([^"]+)",\s*label: "[^"]*",\s*ticket: "([^"]+)",?\s*\}/g),
  ].map((m) => ({ id: m[1]!, screen: m[2]!, ticket: m[3]! }));
}

async function guard(page: Page) {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\//, (route) => route.fulfill({ status: 599, body: "モックは口を呼ばない" }));
}

async function openState(page: Page, id: string, width: number, height = width === 375 ? 812 : 900) {
  await page.setViewportSize({ width, height });
  const res = await page.goto(`/dev/mock/f3-pc/${id}`);
  expect(res?.status(), `${id} を開けない`).toBe(200);
  await expect(page.locator(`[data-mock="${id}"]`)).toBeVisible();
  await expect(page.locator(".k-shell")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** PC の行（pc-cards.tsx の Row と同じ .k-pc-row） */
const pcRow = (page: Page, name: string) => page.locator(".k-pc-list > li", { hasText: name });

const runPy = (args: string[]) =>
  execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });

// ---- ファイルの突き合わせ（ブラウザ不要） ----

test("K369-MK-001 モックの状態は 31 個で、画面の葉 6 本（K-361・K-373・K-368・K-363・K-374・K-375）が持つ状態の和とちょうど同じ（余りも欠けも重なりも 0）", () => {
  const ids = mockEntries().map((e) => e.id);
  expect(ids.length).toBe(31);
  expect(new Set(ids).size, "同じ id が 2 つある").toBe(ids.length);
  expect([...ids].sort()).toEqual([...ALL].sort());
});

test("K369-MK-002 各状態の持ち主（mocks.tsx の ticket）は K-<数> の字だけで、その状態を本物にする画面の葉（口の葉 K-362・K-364〜K-366 を指さない）・screen はどれも bridge-setup", () => {
  const entries = mockEntries();
  expect(entries.length, "ticket を持つ状態が 31 個ない").toBe(31);
  const bad = entries
    .filter((e) => !/^K-\d+$/.test(e.ticket) || OWNER.get(e.id) !== e.ticket || e.screen !== "bridge-setup")
    .map((e) => `${e.id}：${e.ticket}・${e.screen}（正は ${OWNER.get(e.id) ?? "無い"}・bridge-setup）`);
  expect(bad, bad.join("\n")).toEqual([]);
});

test("K369-MK-003 写しと測り（07_functional/段4-F3/shots-pc）：31 の状態 × 幅 375・768・1440 の 93 枚の写しと measure.json の 93 行がそろい、どれも横のはみ出し 0・小窓のボタンは画面の中・見出しは「PC と使った量」（つなぐ小窓の 3 つは「PC と使った量|PC をつなぐ」）", () => {
  const rows = JSON.parse(readFileSync(join(SHOTS, "measure.json"), "utf8")) as {
    id: string;
    w: number;
    over: number;
    tabsOver: number;
    buttonsSeen: boolean | null;
    h1: string;
  }[];
  expect(rows.length).toBe(ALL.length * WIDTHS.length);
  const want = ALL.flatMap((id) => WIDTHS.map((w) => `${id}@${w}`)).sort();
  expect(rows.map((r) => `${r.id}@${r.w}`).sort()).toEqual(want);
  const bad = rows
    .filter((r) => r.over !== 0 || r.tabsOver !== 0 || r.buttonsSeen === false || r.h1 !== h1Of(r.id).join("|"))
    .map((r) => `${r.id}@${r.w}：over ${r.over}・tabs ${r.tabsOver}・buttons ${r.buttonsSeen}・h1 ${r.h1}`);
  expect(bad, bad.join("\n")).toEqual([]);
  const missing = want.map((k) => k.replace("@", "-") + ".png").filter((f) => !existsSync(join(SHOTS, f)));
  expect(missing, missing.join("\n")).toEqual([]);
});

test("K369-MK-004 部品は見た目だけ：pc-row-parts.tsx は口を呼ばない（fetch・lib/api・useEffect・useRouter・lib/auth を使わない）・生の色や大きさを書かない。pc-row-parts.css も生の色（#・rgb）と px を書かず、値は var(--k-*) だけ", () => {
  const src = readFileSync(PARTS_SRC, "utf8");
  expect(src).not.toMatch(/\bfetch\(|lib\/api|useEffect|useRouter|from "@\/lib\/auth/);
  expect(src).not.toMatch(/style=\{|#[0-9a-fA-F]{3,6}\b|\d+px/);
  const css = readFileSync(PARTS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d+px/);
  expect(css).toMatch(/var\(--k-/);
});

test("K369-MK-005 置き場の道 /dev/mock/f3-pc と /dev/mock/f3-pc/<状態> は作った道の一覧（built-routes.ts・作り手 gen_built_routes.py）に載っている", () => {
  expect(isBuilt("/dev/mock/f3-pc")).toBe(true);
  expect(isBuilt("/dev/mock/f3-pc/pc-menu")).toBe(true);
});

test("K369-EC-001 部品とモックが引く目録の番号（E-CONN-001・E-CONN-011・E-CONN-012・E-CONN-014・E-CONN-016・E-CONN-017・E-PAGE-003。E-CONN-016 はこの画面用のログインしていないときの文・代表の答え 7。E-CONN-017 はほかの端末で見ている行の、ボタンを言わない文・2026-11-19 PM。E-CONN-012 は入れ直す区画の題・E-CONN-014 は受け取れなかったモックの文・answer=7cf148a79dc9）は errors.json に在り、ソースが引く番号はこの 7 つだけ", () => {
  const used = new Set(
    [readFileSync(PARTS_SRC, "utf8"), readFileSync(MOCKS_SRC, "utf8")].flatMap((s) =>
      [...s.matchAll(/errorText\("([A-Z]+-[A-Z]+-\d+)"\)/g)].map((m) => m[1]!),
    ),
  );
  expect([...used].sort()).toEqual([
    "E-CONN-001",
    "E-CONN-011",
    "E-CONN-012",
    "E-CONN-014",
    "E-CONN-016",
    "E-CONN-017",
    "E-PAGE-003",
  ]);
  for (const id of used)
    expect(
      ERRORS.some((e) => e.id === id),
      `${id} が errors.json に無い`,
    ).toBe(true);
});

test("K369-DS-001 design_gate の D1〜D7（--part --scales --usage）が緑：PC の行の部品の CSS が正本の値だけを使う", () => {
  const out = runPy([
    "scripts/ci/design_gate.py",
    "--design",
    "04_design/DESIGN-kaname.md",
    "--mocks",
    "apps/web/components/k",
    "apps/web/features",
    "--css",
    "apps/web/styles/k-tokens.css",
    "--part",
    "--scales",
    "--usage",
    "apps/web",
    "apps/bridge/src",
  ]);
  expect(out).not.toMatch(/\bFAIL\b/);
});

// ---- 実ブラウザ：モックの全部の状態が描ける ----

test("K369-UI-001 索引 /dev/mock/f3-pc：見出し bridge-setup と 31 のリンクが出て、各リンクの先は /dev/mock/f3-pc/<状態>", async ({
  page,
}) => {
  await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await page.goto("/dev/mock/f3-pc"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 2, name: "bridge-setup" })).toBeVisible();
  const hrefs = await page.locator("main li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect([...hrefs].sort()).toEqual(ALL.map((id) => `/dev/mock/f3-pc/${id}`).sort());
});

for (const [row, width] of [
  ["K369-UI-002", 375],
  ["K369-UI-003", 768],
  ["K369-UI-004", 1440],
] as const) {
  test(`${row} 幅 ${width}：31 の状態が 200 で開き、「この状態はありません」が無く、h1 は「PC と使った量」の 1 つ（つなぐ小窓の 3 つは小窓の題「PC をつなぐ」と 2 つ）、横のはみ出し 0`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await guard(page);
    for (const id of ALL) {
      await openState(page, id, width);
      await expect(page.getByText("この状態はありません"), id).toHaveCount(0);
      await expect(page.locator("h1"), id).toHaveText(h1Of(id));
      expect(await overflowX(page), `${id} の横のはみ出し`).toBe(0);
    }
  });
}

test("K369-UI-005 31 の状態を開いても、ページの誤り（pageerror）と描き直しの食い違い（hydration）の知らせが 0", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (/hydrat/i.test(m.text())) errs.push(m.text());
  });
  await guard(page);
  for (const id of ALL) await openState(page, id, 1440);
  expect(errs, errs.join("\n")).toEqual([]);
});

// ---- 実ブラウザ：部品の字と役 ----

test("K369-UI-006 Claude Code の区画（幅 1440）：入っていない／本体が無い／ログインしていない の題とボタン、ログインの途中の入口とコードの欄、ほかの PC と眠っている PC は押せるボタンが無い", async ({
  page,
}) => {
  await guard(page);
  const part = (name: string) => pcRow(page, name).locator('section[aria-label="Claude Code"]');

  await openState(page, "pc-claude-missing", 1440);
  await expect(part(MAC).locator(".k-pc-part-title")).toHaveText("Claude Code が入っていません");
  await expect(part(MAC).getByRole("button", { name: "Claude Code を入れる" })).toBeEnabled();

  await openState(page, "pc-claude-broken", 1440);
  await expect(part(MAC).locator(".k-pc-part-title")).toHaveText(msg("E-CONN-011"));
  await expect(part(MAC).getByRole("button", { name: "Claude Code を取り直す" })).toBeEnabled();

  await openState(page, "pc-claude-login", 1440);
  await expect(part(MAC).locator(".k-pc-part-title")).toHaveText(msg("E-CONN-016"));
  await expect(part(MAC).getByRole("button", { name: "ログインする" })).toBeEnabled();

  await openState(page, "pc-claude-code", 1440);
  const entry = part(MAC).getByRole("link", { name: "この入口" });
  await expect(entry).toHaveAttribute("href", /^https:\/\/claude\.ai\//);
  await expect(entry).toHaveAttribute("target", "_blank");
  await expect(entry).toHaveAttribute("rel", /noopener/);
  await expect(part(MAC).getByLabel("ブラウザに出たコード")).toHaveValue("");
  await expect(part(MAC).getByRole("button", { name: "決定" })).toBeDisabled();
  await expect(part(MAC).getByRole("button", { name: "ログインする" })).toHaveCount(0);

  await openState(page, "pc-claude-other-device", 1440);
  await expect(part(MINI)).toContainText("Bridge が入っている PC でこの画面を開いてください");
  await expect(part(MINI).getByRole("button")).toHaveCount(0);

  await openState(page, "pc-asleep", 1440);
  await expect(part(MINI)).toContainText("11/15 09:00 の報告");
  await expect(part(MINI).getByRole("button")).toHaveCount(0);

  // ほかの端末で見ている行が login：押せるボタンが無いので、題はボタンを言わない E-CONN-017（E-CONN-016 の「下の『ログインする』を押して」は出さない）
  await openState(page, "pc-phone", 1440);
  await expect(part(MINI).locator(".k-pc-part-title")).toHaveText(msg("E-CONN-017"));
  await expect(part(MINI)).not.toContainText("ログインする");
  await expect(part(MINI)).toContainText("Bridge が入っている PC でこの画面を開いてください");
  await expect(part(MINI).getByRole("button")).toHaveCount(0);
});

test("K369-UI-018 スマホで開いた画面（pc-phone・幅 375）：見出しの行の「＋ PC をつなぐ」（AddPcButton）は押せない形で、すぐ下に理由の 1 行（AddPcReason・.k-pc-add-reason「つなぐ PC で、この画面を開いてください」）。ボタンの aria-describedby が理由の 1 行を指す。PC の画面（pc-browser-pick）では押せて理由は出ない", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "pc-phone", 375);
  const add = page.locator('[data-act="add-pc"]');
  await expect(add).toHaveCount(1);
  await expect(add).toHaveText("＋ PC をつなぐ");
  await expect(add).toBeDisabled();
  const reason = page.locator(".k-pc-add-reason");
  await expect(reason).toHaveCount(1);
  await expect(reason).toBeVisible();
  await expect(reason).toHaveText("つなぐ PC で、この画面を開いてください");
  const by = await add.getAttribute("aria-describedby");
  expect(by, "押せない理由を読み上げに結ぶ").toBeTruthy();
  expect(await reason.getAttribute("id")).toBe(by);

  await openState(page, "pc-browser-pick", 375);
  await expect(page.locator('[data-act="add-pc"]')).toBeEnabled();
  await expect(page.locator(".k-pc-add-reason")).toHaveCount(0);
});

test("K369-UI-007 行の中の知らせの役（幅 1440）：入れている途中と、ログインできた は status、入れられなかった・コードが違った は alert で、文がその中に出る", async ({
  page,
}) => {
  await guard(page);
  const mac = () => pcRow(page, MAC);
  await openState(page, "pc-claude-installing", 1440);
  await expect(mac().getByRole("status")).toContainText("Claude Code を入れています（1〜2 分）");
  await openState(page, "pc-claude-install-error", 1440);
  await expect(mac().getByRole("alert")).toContainText("この PC の Bridge に届きませんでした");
  await openState(page, "pc-claude-code-error", 1440);
  await expect(mac().getByRole("alert")).toContainText("ログインできませんでした");
  await expect(mac().getByLabel("ブラウザに出たコード")).toHaveValue("K361-BAD-CODE");
  await openState(page, "pc-claude-done", 1440);
  await expect(mac().getByRole("status")).toHaveText("ログインできました。これで仕事を渡せます");
});

test("K369-UI-008 AI が使うブラウザを選ぶ欄（幅 1440）：見出し「AI が使うブラウザ」の組に 3 つ（自分の Chrome（既定）・Bridge 専用のブラウザ・使わない）。選ぶ前は自分の Chrome、選んだ後は Bridge 専用で「変えました。次の仕事から使います」", async ({
  page,
}) => {
  await guard(page);
  const group = () => pcRow(page, MAC).getByRole("group", { name: "AI が使うブラウザ" });
  await openState(page, "pc-browser-pick", 1440);
  const radios = group().getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(group().locator(".k-pc-choice-label")).toHaveText([
    "自分の Chrome（既定）",
    "Bridge 専用のブラウザ",
    "使わない",
  ]);
  await expect(group().getByRole("radio", { name: /自分の Chrome/ })).toBeChecked();
  await openState(page, "pc-browser-saved", 1440);
  await expect(group().getByRole("radio", { name: /Bridge 専用のブラウザ/ })).toBeChecked();
  await expect(group().getByRole("status")).toHaveText("変えました。次の仕事から使います");
});

test("K369-UI-009 Chrome とつながらないときのその場の一手（幅 1440）：題・つなぎ方（公式の入口）・もう一度確かめる・Bridge 専用に切り替える。確かめている間は押せず、結果の文は alert。眠っている PC では起こしてから押す文", async ({
  page,
}) => {
  await guard(page);
  const fix = (name = MAC) => pcRow(page, name).locator('section[aria-label="AI が使うブラウザの直し方"]');
  await openState(page, "pc-browser-fix", 1440);
  await expect(fix().locator(".k-pc-part-title")).toHaveText("AI が Chrome を使えません。");
  const store = fix().getByRole("link", { name: "Chrome ウェブストアで開く" });
  await expect(store).toBeVisible();
  await expect(store).toHaveAttribute("href", /^https:\/\/chromewebstore\.google\.com\/detail\/claude\//);
  await expect(store).toHaveAttribute("rel", /noopener/);
  await expect(fix().getByRole("button", { name: "もう一度確かめる" })).toBeEnabled();
  await expect(fix().getByRole("button", { name: "Bridge 専用に切り替える" })).toBeEnabled();

  await openState(page, "pc-browser-checking", 1440);
  await expect(fix().getByRole("button", { name: /確かめています/ })).toBeVisible();
  await expect(fix().getByRole("button", { name: "Bridge 専用に切り替える" })).toBeDisabled();
  await expect(fix().getByRole("status")).toHaveText("確かめています（1 分ほどかかります）…");

  await openState(page, "pc-browser-still", 1440);
  await expect(fix().getByRole("alert")).toContainText("まだつながっていません");
  await openState(page, "pc-browser-timeout", 1440);
  await expect(fix().getByRole("alert")).toContainText("結果が返ってきませんでした");
  await openState(page, "pc-browser-asleep", 1440);
  await expect(fix(MINI).getByRole("alert")).toContainText("Bridge を起こしてから押してください");
});

test("K369-UI-010 行の「…」のメニュー（pc-menu・幅 1440）：「…（高本の MacBook の操作）」で開いたメニューの項目は「この PC を外す」の 1 つ", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "pc-menu", 1440);
  await expect(pcRow(page, MAC).getByRole("button", { name: `…（${MAC} の操作）` })).toBeVisible();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["この PC を外す"]);
});

test("K369-UI-011 外す確かめの小窓（pc-remove・幅 1440）：題「「高本の MacBook」を外しますか？」、本文に取り出せなくなること・待っている仕事は消えないこと、ボタンは やめる と 外す、開いたときの焦点は やめる", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "pc-remove", 1440);
  const dlg = page.getByRole("alertdialog", { name: `「${MAC}」を外しますか？` });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("預けたログイン情報もこの PC からは取り出せなくなります");
  await expect(dlg).toContainText("待っている仕事は消えません");
  await expect(dlg.locator(".k-dialog-actions").getByRole("button")).toHaveText(["やめる", "外す"]);
  await expect(dlg.getByRole("button", { name: "やめる" })).toBeFocused();
});

test("K369-UI-012 外す前の本人確認の取り直し（pc-remove-stepup・幅 1440）：小窓「本人か確かめます」に理由「PC を外す前に、本人か確かめます」とパスワードの欄、ボタンは やめる と 確かめる", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "pc-remove-stepup", 1440);
  const dlg = page.getByRole("dialog", { name: "本人か確かめます" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("PC を外す前に、本人か確かめます");
  await expect(dlg.getByLabel("パスワード", { exact: true })).toBeVisible();
  await expect(dlg.locator(".k-dialog-actions").getByRole("button")).toHaveText(["やめる", "確かめる"]);
});

test("K369-UI-013 外した後と外せなかったとき（幅 1440）：外した は一覧の上に「外しました。…」の知らせで一覧は事務所の Mac mini だけ。外せなかった は E-PAGE-003 の文で一覧は 2 台のまま", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "pc-removed", 1440);
  await expect(page.locator("#k-main")).toContainText(
    "外しました。もう一度つなぐときは、この画面からつなぎ直してください",
  );
  await expect(page.locator(".k-pc-list > li")).toHaveCount(1);
  await expect(pcRow(page, MINI)).toBeVisible();
  await openState(page, "pc-remove-error", 1440);
  await expect(page.locator("#k-main")).toContainText(msg("E-PAGE-003"));
  await expect(page.locator(".k-pc-list > li")).toHaveCount(2);
});

test("K369-UI-014 キーボード（pc-removed・幅 1440）：「…」に焦点 → Enter でメニューが開き項目に焦点 → Esc で閉じて焦点は「…」に戻る", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "pc-removed", 1440);
  const trigger = pcRow(page, MINI).getByRole("button", { name: `…（${MINI} の操作）` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "この PC を外す" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("K369-UI-015 押せる物の大きさ（幅 375・pc-claude-code・pc-browser-fix・pc-browser-pick・pc-removed）：部品の中のボタン・選ぶ行と「…」は幅も高さも 24px 以上（文の中のリンクは WCAG 2.5.8 の例外で見ない）", async ({
  page,
}) => {
  await guard(page);
  const small: string[] = [];
  for (const id of ["pc-claude-code", "pc-browser-fix", "pc-browser-pick", "pc-removed"]) {
    await openState(page, id, 375);
    const boxes = await page.locator(".k-pc-part button, .k-pc-choice, .k-pc-more-on").evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { t: (e.textContent ?? "").trim().slice(0, 20), w: r.width, h: r.height };
        }),
    );
    expect(boxes.length, `${id} に押せる物が無い`).toBeGreaterThan(0);
    small.push(...boxes.filter((b) => b.w < 24 || b.h < 24).map((b) => `${id}：${b.t} ${b.w}×${b.h}`));
  }
  expect(small, small.join("\n")).toEqual([]);
});

test("K369-UI-016 小窓の 5 つ（pc-remove・pc-remove-stepup・pc-os-warning・pc-os-warning-mac・pc-os-warning-win）：幅 375 で高さ 812 と 560 のどちらでも、頭（題）と足（ボタン）は画面の中", async ({
  page,
}) => {
  await guard(page);
  for (const height of [812, 560]) {
    for (const id of DIALOGS) {
      await openState(page, id, 375, height);
      const dlg = page.locator(".k-dialog");
      await expect(dlg, id).toBeVisible();
      const m = await dlg.evaluate((d) => {
        const head = d.querySelector(".k-dialog-head")!.getBoundingClientRect();
        const act = d.querySelector(".k-dialog-actions")!.getBoundingClientRect();
        return { headTop: head.top, actTop: act.top, actBottom: act.bottom, inner: window.innerHeight };
      });
      const where = `${id} 高さ ${height}`;
      expect(m.headTop, `${where} 頭が上にはみ出す`).toBeGreaterThanOrEqual(0);
      expect(m.actTop, `${where} 足が上にはみ出す`).toBeGreaterThanOrEqual(0);
      expect(m.actBottom, `${where} 足が下にはみ出す`).toBeLessThanOrEqual(m.inner);
    }
  }
});

test("K369-UI-019 OS の警告の越え方（幅 1440）：受け取った後のつなぐ小窓の 1 段目は ✓ で、受け取るの字のリンクの下に越え方。pc-os-warning は閉じた形で見出し「「開いていません」「PC が保護されました」と出たとき」、pc-os-warning-mac は開いて Mac の 4 つの手順（「このまま開く」を含む）だけ、pc-os-warning-win は開いて Windows の 2 つの手順だけ", async ({
  page,
}) => {
  await guard(page);
  const step1 = () => page.locator(".k-dialog .k-steps > li").first();
  const w = () => step1().locator("[data-os-warning]");
  await openState(page, "pc-os-warning", 1440);
  await expect(step1().locator(".k-step-dot")).toHaveText("✓");
  await expect(w()).toHaveCount(1);
  await expect(w().locator("summary")).toHaveText("「開いていません」「PC が保護されました」と出たとき");
  expect(await w().evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  await expect(page.locator(".k-dialog").getByRole("status")).toContainText("ダウンロードを始めました");

  await openState(page, "pc-os-warning-mac", 1440);
  expect(await w().evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
  await expect(w()).toContainText("中身の問題ではありません");
  await expect(w().locator('[data-os-warning-os="mac"] li')).toHaveCount(4);
  await expect(w().locator('[data-os-warning-os="mac"]')).toContainText("このまま開く");
  await expect(w().locator('[data-os-warning-os="win"]')).toHaveCount(0);

  await openState(page, "pc-os-warning-win", 1440);
  await expect(w().locator('[data-os-warning-os="win"] li')).toHaveText(["「詳細情報」を押す", "「実行」を押す"]);
  await expect(w().locator('[data-os-warning-os="mac"]')).toHaveCount(0);
});

test("K369-UI-020 Bridge を入れ直す一手（幅 1440・375）：題は E-CONN-012 の文。pc-bridge-outdated は「Mac 用を受け取る」「Windows 用を受け取る」が押せ、同じ行にブラウザを選ぶ欄は無い。pc-bridge-reinstalling は role=status「受け取りを始めました。…」と閉じた越え方（Mac の分）。pc-bridge-reinstall-error は role=alert に E-CONN-014 の文。pc-bridge-outdated-phone（幅 375）はボタン 0 で「その PC でこの画面を開いて、入れ直してください」", async ({
  page,
}) => {
  await guard(page);
  const part = () => pcRow(page, MAC).locator('section[aria-label="Bridge を入れ直す"]');
  await openState(page, "pc-bridge-outdated", 1440);
  await expect(part().locator(".k-pc-part-title")).toHaveText(msg("E-CONN-012"));
  await expect(part().getByRole("button", { name: "Mac 用を受け取る" })).toBeEnabled();
  await expect(part().getByRole("button", { name: "Windows 用を受け取る" })).toBeEnabled();
  await expect(pcRow(page, MAC).locator("[data-browser-pick]")).toHaveCount(0);

  await openState(page, "pc-bridge-reinstalling", 1440);
  await expect(part().getByRole("status")).toHaveText(
    "受け取りを始めました。受け取った Kaname Bridge を開いて入れ直すと、このお知らせは自分で消えます",
  );
  await expect(part().locator('[data-os-warning] [data-os-warning-os="mac"]')).toHaveCount(1);
  await expect(part().locator('[data-os-warning] [data-os-warning-os="win"]')).toHaveCount(0);

  await openState(page, "pc-bridge-reinstall-error", 1440);
  await expect(part().getByRole("alert")).toHaveText(msg("E-CONN-014"));

  await openState(page, "pc-bridge-outdated-phone", 375);
  await expect(part().getByRole("button")).toHaveCount(0);
  await expect(part()).toContainText("その PC でこの画面を開いて、入れ直してください");
});
