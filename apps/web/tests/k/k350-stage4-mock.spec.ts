// K-350「段 4 の外枠・自分の設定・小窓の直しと、預けたログイン情報の部品とモックを本線に入れる」の試験（実 Chrome と、ファイルと検査の道具を読む試験・実装より先に積む）。
//   的：開発用の置き場 /dev/mock/f3（索引）と /dev/mock/f3/<状態>（1 つの状態）・外枠の見本 /dev/k/shell。
//   モックは本番と同じ部品（features/F3/credentials/views.tsx・components/k）を決めた値で並べたもの（代表 OK answer=0a262be577b2・範囲 answer=ac0813ee7c21）。
//   見ること：14 の状態が全部描ける・幅 375／768／1440 で横のはみ出し 0・状態の持ち主は画面の葉（K-356・K-372・K-357）・
//   スマホにも上の帯（会社の印と名前・探す・知らせ・自分のアイコン。2026-11-18 代表）・自分の設定はスマホでボタン 1 つの一覧・
//   小窓は頭と足（ボタン）を残して中身だけスクロール・本文の見出しの右の鈴（ShellBell）が無い・正本の値の検査が緑。
//   口は呼ばない（モックは値を決めて並べるだけ）。本人の Bridge（127.0.0.1:38617）にも届かせない（網の手前で 404）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { isBuilt } from "../../lib/built-routes";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const WEB = join(HERE, "../..");
const MOCKS_SRC = join(WEB, "app/(dev)/dev/mock/f3/mocks.tsx");
const VIEWS_SRC = join(WEB, "features/F3/credentials/views.tsx");
const SHOTS_SRC = join(ROOT, "07_functional/段4-F3/mock-shots.mjs");
const DECISIONS = join(ROOT, "01_hearing/決定ログ_進行中.md");
const DESIGN = join(ROOT, "04_design/DESIGN-kaname.md");
const CANVAS = join(ROOT, "04_design/canvas");
const K57 = join(ROOT, "11_tickets/K-57.md");

/** 画面の葉と、その葉が本物にするモックの状態（07_functional/段4-F3/機能分解.md の W1・W2 と 11_tickets/K-350.md の表のとおり・14 個。W1 の預ける小窓は K-372 に分けた） */
const LEAVES: Record<string, readonly string[]> = {
  "K-356": ["cred-list", "cred-empty", "cred-personal", "cred-failed"],
  "K-372": ["cred-add-login", "cred-add-key", "cred-add-error", "cred-stepup"],
  "K-357": ["cred-checking", "cred-no-pc", "cred-forbidden", "cred-edit", "cred-remove", "cred-code"],
};
const ALL = Object.values(LEAVES).flat();
const OWNER = new Map(Object.entries(LEAVES).flatMap(([k, ids]) => ids.map((id) => [id, k] as const)));
/** 小窓が開いている状態 */
const DIALOGS = [
  "cred-add-login",
  "cred-add-key",
  "cred-add-error",
  "cred-stepup",
  "cred-edit",
  "cred-remove",
  "cred-code",
];
const SUB = 'aside[aria-label="自分の設定の中"]';

function mockEntries(): { id: string; screen: string; ticket: string }[] {
  const src = readFileSync(MOCKS_SRC, "utf8");
  return [
    ...src.matchAll(/\{\s*id: "([^"]+)",\s*screen: "([^"]+)",\s*label: "[^"]*",\s*ticket: "([^"]+)",?\s*\}/g),
  ].map((m) => ({ id: m[1]!, screen: m[2]!, ticket: m[3]! }));
}

/** dir の下の .ts・.tsx・.css を全部（node_modules と .next は見ない） */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

async function guard(page: Page) {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\//, (route) => route.fulfill({ status: 599, body: "モックは口を呼ばない" }));
}

async function openState(page: Page, id: string, width: number, height = width === 375 ? 812 : 900) {
  await page.setViewportSize({ width, height });
  const res = await page.goto(`/dev/mock/f3/${id}`);
  expect(res?.status(), `${id} を開けない`).toBe(200);
  await expect(page.locator(`[data-mock="${id}"]`)).toBeVisible();
  await expect(page.locator(".k-shell")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function openShell(page: Page, width: number) {
  await page.setViewportSize({ width, height: 860 });
  const res = await page.goto("/dev/k/shell?built=all");
  expect(res?.status()).toBe(200);
  await expect(page.locator(".k-shell")).toBeVisible();
}

const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** 見えている見出し（h1 と帯の題）の数 */
const visibleTitles = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("h1, .k-bar-title")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden";
      }).length,
  );

const runPy = (args: string[]) =>
  execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });

// ---- ファイルの突き合わせ（ブラウザ不要） ----

test("K350-MK-001 モックの状態は 14 個で、画面の葉 3 本（K-356・K-372・K-357）が持つ状態の和とちょうど同じ（余りも欠けも重なりも 0）", () => {
  const ids = mockEntries().map((e) => e.id);
  expect(ids.length).toBe(14);
  expect(new Set(ids).size, "同じ id が 2 つある").toBe(ids.length);
  expect([...ids].sort()).toEqual([...ALL].sort());
});

test("K350-MK-002 各状態の持ち主（mocks.tsx の ticket）は、その状態を本物にする画面の葉（口の葉 K-351〜K-355 を指さない）・screen はどれも credentials", () => {
  const entries = mockEntries();
  expect(entries.length, "ticket を持つ状態が 14 個ない").toBe(14);
  const bad = entries
    .filter((e) => OWNER.get(e.id) !== e.ticket || e.screen !== "credentials")
    .map((e) => `${e.id}：${e.ticket}・${e.screen}（正は ${OWNER.get(e.id) ?? "無い"}・credentials）`);
  expect(bad, bad.join("\n")).toEqual([]);
});

test("K350-MK-003 写しを撮る台本（mock-shots.mjs）は f3 の mocks.tsx の状態を全部、幅 375・768・1440 で、3441 の /dev/mock から撮る", () => {
  const src = readFileSync(SHOTS_SRC, "utf8");
  expect(src).toContain("app/(dev)/dev/mock/${dir}/mocks.tsx");
  expect(src).toContain('process.argv[3] ?? "f3"');
  expect(src).toContain("localhost:3441/dev/mock/");
  expect(src).toMatch(/for \(const w of \[375, 768, 1440\]\)/);
});

test("K350-MK-004 部品は見た目だけ：views.tsx は口を呼ばない（fetch・lib/api・useEffect・useRouter・lib/auth を使わない）・生の色や大きさを書かない（style= と #色 と px が無い）・自分の CSS を持たない", () => {
  const src = readFileSync(VIEWS_SRC, "utf8");
  expect(src).not.toMatch(/\bfetch\(|lib\/api|useEffect|useRouter|from "@\/lib\/auth/);
  expect(src).not.toMatch(/style=\{|#[0-9a-fA-F]{3,6}\b|\d+px/);
  expect(src).not.toMatch(/import "\.\/[^"]+\.css"/);
});

test("K350-MK-005 本文の見出しの右の鈴（ShellBell・.k-bell-inline）と引き出しの自分のメニュー（.k-sheet-me）は、画面のコードのどこにも無い（呼ぶ所も外した）", () => {
  const hits = [join(WEB, "components"), join(WEB, "features"), join(WEB, "app")]
    .flatMap(sources)
    .filter((f) => /ShellBell|k-bell-inline|k-sheet-me/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(WEB.length + 1));
  expect(hits, hits.join("\n")).toEqual([]);
});

// ---- 正本の値と決定（CI の static の段と同じ命令・ファイル） ----

test("K350-DS-001 design_gate の D1〜D7（--part --scales --usage）が緑：段 4 の部品と外枠・自分の設定・小窓の CSS が正本の値だけを使う", () => {
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

test("K350-DC-001 決定と正本：決定ログにスマホの上の帯の節（answer=0a262be577b2 を結ぶ）があり、D-128.12 の「知らせは各画面の見出しの右のベル」は superseded。DESIGN-kaname.md は「幅 767 以下も上の帯を出す」と書く", () => {
  const log = readFileSync(DECISIONS, "utf8");
  // 節（「## <番号>. …」から次の「## 」の前まで）のうち、題に「スマホ」と「上の帯」を持つもの
  const sections = log.split(/\n(?=## \d+\. )/).filter((s) => /^## \d+\. [^\n]*スマホ[^\n]*上の帯/.test(s));
  expect(sections.length, "題に「スマホ」「上の帯」を持つ決定の節が無い").toBe(1);
  const sec = sections[0]!;
  expect(sec).toMatch(/<!-- decision: D-\d+[\s\S]*?status: confirmed[\s\S]*?-->/);
  expect(sec).toContain("answer=0a262be577b2");
  const row = log.split("\n").find((l) => l.startsWith("| D-128.12 |"));
  expect(row, "D-128.12 の行が無い").toBeTruthy();
  expect(row!).toContain("superseded");
  expect(readFileSync(DESIGN, "utf8")).toContain("幅 767 以下も上の帯を出す");
});

test("K350-DC-002 K-57（PC をつなぐ）を閉じる：stage は 完了 で、閉じた訳に K-350 と PM の決め（2026-11-18）を書く", () => {
  const src = readFileSync(K57, "utf8");
  expect(src).toMatch(/^stage: 完了$/m);
  expect(src).toContain("K-350");
  expect(src).toContain("pm-decisions-2026-11-18");
});

test("K350-CV-001 キャンバスの絵も決めに合わせる：どの絵も幅 767 以下で上の帯を隠さず（.kn-bar{display:none が無い）、承認待ちの見出しの右の鈴の場所（main header>div::after）も無い", () => {
  const files = readdirSync(CANVAS).filter((f) => f.endsWith(".dc.html"));
  expect(files.length).toBeGreaterThan(0);
  const hidden = files.filter((f) => readFileSync(join(CANVAS, f), "utf8").includes(".kn-bar{display:none"));
  expect(hidden, hidden.join("\n")).toEqual([]);
  for (const f of ["Approvals.dc.html", "ApEmpty.dc.html"])
    expect(readFileSync(join(CANVAS, f), "utf8"), f).not.toContain("main header>div::after");
});

test("K350-SC-001 作り物の秘密の置き場 2 つ（apps/bridge/test/_fake/secrets.ts・apps/e2e/_fake/secrets.ts）が在り、頭の注は api・web の置き場と同じ（本物の秘密ではない・.gitleaks.toml が外す）で、葉ごとの区切りの見出しを持つ", () => {
  for (const rel of ["apps/bridge/test/_fake/secrets.ts", "apps/e2e/_fake/secrets.ts"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const head = src.split("\n").slice(0, 3).join("\n");
    expect(head, rel).toContain("本物の秘密ではない");
    expect(head, rel).toContain(".gitleaks.toml");
    expect(head, rel).toBe(
      readFileSync(join(ROOT, "apps/api/test/_fake/secrets.ts"), "utf8").split("\n").slice(0, 3).join("\n"),
    );
    expect(src, rel).toContain("// ---- 段 4 の葉ごとの区切り");
  }
});

test("K350-SC-002 秘密の検査の設定（.gitleaks.toml）は既定の規則のまま、全体で外す道は試験の作り物の置き場 4 つ（api・web・bridge・e2e）だけで、ほかの道には当たらない。例外は規則 generic-api-key の中の 1 つだけ：契約の型の 4 ファイルの openapi.yaml の要約（16 けたの 16 進）を、道と値の両方がそろうときだけ外す（K-362・代表の答え answer=2fd73e54782f）", () => {
  const conf = readFileSync(join(ROOT, ".gitleaks.toml"), "utf8");
  expect(conf).toMatch(/^useDefault = true$/m);
  // 全体（最初の [[rules]] より前）と、規則の中（[[rules]] から後）に分けて見る
  const at = conf.search(/^\[\[rules\]\]$/m);
  const top = at < 0 ? conf : conf.slice(0, at);
  const rules = at < 0 ? "" : conf.slice(at);
  // 全体：allowlists はちょうど 1 つで、道だけ（値の正規表現・止め語・コミット・条件では外さない）
  //   全体の [[allowlists]] は [[rules]] の後ろにも書けて全体に効くので、ファイル全体で数えて 1 つ・規則の側には 0 にする
  expect(conf.match(/^\[\[allowlists\]\]$/gm) ?? []).toHaveLength(1);
  expect(top.match(/^\[\[allowlists\]\]$/gm) ?? []).toHaveLength(1);
  expect(rules.match(/^\[\[allowlists\]\]$/gm) ?? []).toHaveLength(0);
  expect(top).not.toMatch(/^(regexes|stopwords|commits|condition|regexTarget)\s*=/m);
  const listOf = (part: string, key: string): string[] => {
    const line = part.split("\n").find((l) => l.startsWith(`${key} = `));
    expect(line, `${key} の行が無い`).toBeTruthy();
    return [...line!.matchAll(/'''([^']+)'''/g)].map((m) => m[1]!);
  };
  const paths = listOf(top, "paths");
  expect([...paths].sort()).toEqual(
    ["^apps/api/test/_fake/", "^apps/bridge/test/_fake/", "^apps/e2e/_fake/", "^apps/web/test/_fake/"].sort(),
  );
  const hit = (p: string): boolean => paths.some((r) => new RegExp(r).test(p));
  for (const p of [
    "apps/api/test/_fake/secrets.ts",
    "apps/web/test/_fake/secrets.ts",
    "apps/bridge/test/_fake/secrets.ts",
    "apps/e2e/_fake/secrets.ts",
  ])
    expect(hit(p), p).toBe(true);
  for (const p of [
    "apps/bridge/test/login-check.test.ts",
    "apps/bridge/src/_fake/x.ts",
    "apps/bridge/test/_fake2/x.ts",
    "apps/e2e/journeys/j02.spec.ts",
    "apps/e2e/journeys/_fake/x.ts",
    "x/apps/e2e/_fake/x.ts",
  ])
    expect(hit(p), p).toBe(false);
  // 規則の中の例外：[[rules]] は generic-api-key の 1 つ・その allowlists も 1 つだけ。規則そのもの（式・鍵の語・乱雑さ）は既定のまま上書きしない
  expect(conf.match(/^\[\[rules\]\]$/gm) ?? []).toHaveLength(1);
  expect(conf.match(/^\[\[rules\.allowlists\]\]$/gm) ?? []).toHaveLength(1);
  expect(rules).toMatch(/^id = "generic-api-key"$/m);
  expect(rules).not.toMatch(/^(regex|keywords|entropy|path|secretGroup|stopwords|commits|regexTarget)\s*=/m);
  expect(rules).toMatch(/^condition = "AND"$/m);
  const onlyPaths = listOf(rules, "paths");
  const values = listOf(rules, "regexes");
  expect(onlyPaths).toEqual(["^packages/contracts/src/(ops|registry|schemas|types)\\.ts$"]);
  expect(values).toEqual(["^(openapi:)?[0-9a-f]{16}$"]);
  const pathRe = new RegExp(onlyPaths[0]!);
  // 契約の型の 4 ファイルは、規則の中の例外の道には当たり、全体の外す道には当たらない（道は組み立てる：字のままだと範囲の検査が「読む物」と取り違える）
  for (const f of ["ops", "registry", "schemas", "types"]) {
    expect(pathRe.test(`packages/contracts/src/${f}.ts`), f).toBe(true);
    expect(hit(`packages/contracts/src/${f}.ts`), f).toBe(false);
  }
  for (const p of [
    "packages/contracts/src/index.ts",
    "packages/contracts/src/x/ops.ts",
    "packages/contracts/src/opsXts",
    "x/packages/contracts/src/ops.ts",
    "apps/api/src/ops.ts",
  ])
    expect(pathRe.test(p), p).toBe(false);
  // 値：16 けたの 16 進（と openapi: の頭）だけ。本物の鍵の形（sk- で始まる値・32 けた以上・大文字・長さ違い）は当たらない。
  //   鍵の形は秘密の検査に当たらないよう、ここで組み立てる（ファイルに字として書かない）
  const valueRe = new RegExp(values[0]!);
  const hex16 = "0123456789abcdef";
  expect(valueRe.test(hex16)).toBe(true);
  expect(valueRe.test(`openapi:${hex16}`)).toBe(true);
  for (const v of [
    `sk-${hex16.repeat(3)}`,
    `sk-proj-${hex16}`,
    hex16.repeat(2),
    hex16.repeat(4),
    hex16.slice(1),
    `${hex16}0`,
    hex16.toUpperCase(),
    `openapi:${hex16.repeat(2)}`,
    `x${hex16}`,
  ])
    expect(valueRe.test(v), v).toBe(false);
});

// ---- 実ブラウザ：モックの全部の状態が描ける ----

test("K350-UI-001 索引 /dev/mock/f3：見出し credentials と 14 のリンクが出て、各リンクの先は /dev/mock/f3/<状態>", async ({
  page,
}) => {
  await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await page.goto("/dev/mock/f3"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 2, name: "credentials" })).toBeVisible();
  const hrefs = await page.locator("main li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect([...hrefs].sort()).toEqual(ALL.map((id) => `/dev/mock/f3/${id}`).sort());
});

for (const [row, width] of [
  ["K350-UI-002", 375],
  ["K350-UI-003", 768],
  ["K350-UI-004", 1440],
] as const) {
  test(`${row} 幅 ${width}：14 の状態が 200 で開き、「この状態はありません」が無く、h1 はちょうど 1 つで「預けたログイン情報」、横のはみ出し 0`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await guard(page);
    for (const id of ALL) {
      await openState(page, id, width);
      await expect(page.getByText("この状態はありません"), id).toHaveCount(0);
      await expect(page.locator("h1"), id).toHaveCount(1);
      await expect(page.locator("h1"), id).toHaveText("預けたログイン情報");
      expect(await overflowX(page), `${id} の横のはみ出し`).toBe(0);
    }
  });
}

test("K350-UI-005 14 の状態を開いても、ページの誤り（pageerror）と描き直しの食い違い（hydration）の知らせが 0", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (/hydrat/i.test(m.text())) errs.push(m.text());
  });
  await guard(page);
  for (const id of ALL) await openState(page, id, 1440);
  expect(errs, errs.join("\n")).toEqual([]);
});

test("K350-UI-006 小窓の 7 つの状態：幅 375 で高さ 812 と 560 のどちらでも、小窓の頭（題）と足（ボタン）は画面の中にあり、はみ出す中身は本文（.k-dialog-body）の中だけがスクロールする", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await guard(page);
  for (const height of [812, 560]) {
    for (const id of DIALOGS) {
      await openState(page, id, 375, height);
      const dlg = page.locator(".k-dialog");
      await expect(dlg, id).toBeVisible();
      const m = await dlg.evaluate((d) => {
        const head = d.querySelector(".k-dialog-head")!.getBoundingClientRect();
        const act = d.querySelector(".k-dialog-actions")!.getBoundingClientRect();
        const body = d.querySelector(".k-dialog-body") as HTMLElement;
        return {
          headTop: head.top,
          actTop: act.top,
          actBottom: act.bottom,
          inner: window.innerHeight,
          dlgOverflowY: getComputedStyle(d).overflowY,
          bodyOverflowY: getComputedStyle(body).overflowY,
        };
      });
      const where = `${id} 高さ ${height}`;
      expect(m.headTop, `${where} 頭が上にはみ出す`).toBeGreaterThanOrEqual(0);
      expect(m.actTop, `${where} 足が上にはみ出す`).toBeGreaterThanOrEqual(0);
      expect(m.actBottom, `${where} 足が下にはみ出す`).toBeLessThanOrEqual(m.inner);
      expect(m.dlgOverflowY, `${where} 小窓そのものはスクロールしない`).toBe("hidden");
      expect(m.bodyOverflowY, `${where} 本文だけがスクロールする`).toBe("auto");
    }
  }
  // 高さ 560 の「ログイン情報を預ける」は中身が収まらず、本文がスクロールする（足のボタンは押せる）
  await openState(page, "cred-add-login", 375, 560);
  const body = page.locator(".k-dialog-body");
  expect(await body.evaluate((b) => b.scrollHeight > b.clientHeight)).toBe(true);
  await expect(page.locator(".k-dialog-actions").getByRole("button", { name: "本人確認して保存" })).toBeInViewport();
});

test("K350-UI-007 一覧（cred-list・幅 1440）：4 行の名前が GMAIL_WORK・HACCHU_NAVI_LOGIN・FREEE_API_KEY・SEIKO_PORTAL の順で、札が 使える・コードが要る・期限が近い・パスワードが違う。タブはワークスペース（選んでいる）と自分だけ", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "cred-list", 1440);
  const main = page.locator("#k-main");
  await expect(main.locator("code")).toHaveText(["GMAIL_WORK", "HACCHU_NAVI_LOGIN", "FREEE_API_KEY", "SEIKO_PORTAL"]);
  for (const label of ["使える", "コードが要る", "期限が近い", "パスワードが違う"])
    await expect(main.getByText(label, { exact: true })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "預ける先" });
  await expect(tabs.getByRole("tab", { name: "ワークスペース" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "自分だけ" })).toHaveAttribute("aria-selected", "false");
});

test("K350-UI-009 HTML の形（cred-list・cred-empty・cred-personal・幅 1440）：本文の注（SettingNote・li.k-set-note）はどれも ul か ol の中にある（タブの下の注が ul の外に出ていない）。注の字は前と同じに見える", async ({
  page,
}) => {
  await guard(page);
  for (const id of ["cred-list", "cred-empty", "cred-personal"]) {
    await openState(page, id, 1440);
    const main = page.locator("#k-main");
    await expect(main.locator("li.k-set-note").first(), id).toBeVisible();
    const parents = await main
      .locator("li")
      .evaluateAll((els) => els.map((e) => `${e.className}:${e.parentElement?.tagName ?? "なし"}`));
    expect(parents.length, `${id} の li の数`).toBeGreaterThan(0);
    const bad = parents.filter((x) => !/:(UL|OL)$/.test(x));
    expect(bad, `${id} の ul・ol の外の li`).toEqual([]);
    await expect(main.getByText("同じ名前が両方にあれば、自分だけの方を使います"), id).toBeVisible();
  }
});

// ---- 実ブラウザ：外枠の上の帯（スマホにも出す・2026-11-18 代表） ----

test("K350-SH-001 幅 375（モック cred-list）：上の帯が高さ 48 で出て、左に会社の印「E」と名前「ENGINE BASE」、右に 探す（グレー）・知らせ（グレー）・自分のメニュー。いまの場所と帯の題は出さず、見える題は本文の h1 だけ", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "cred-list", 375);
  const bar = page.locator("header.k-bar");
  await expect(bar).toBeVisible();
  expect(Math.round((await bar.boundingBox())!.height)).toBe(48);
  await expect(bar.locator(".k-bar-ws")).toHaveText("E");
  await expect(bar.locator(".k-bar-ws-name")).toHaveText("ENGINE BASE");
  await expect(page.getByRole("navigation", { name: "いまの場所" })).toBeHidden();
  expect(await visibleTitles(page)).toBe(1);
  const search = bar.getByRole("button", { name: "探す（準備中）" });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("aria-disabled", "true");
  const bell = bar.locator(".k-bell");
  await expect(bell).toBeVisible();
  await expect(bell).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".k-bell")).toHaveCount(1);
  await expect(bar.getByRole("button", { name: "自分のメニュー" })).toBeVisible();
});

test("K350-SH-002 幅 375（外枠の見本・探せる）：虫眼鏡を押すと探す欄が帯の幅いっぱいに開いて字が入り（会社の名前と鈴は隠れる）、Enter で探し、× で元の帯に戻る", async ({
  page,
}) => {
  await openShell(page, 375);
  const bar = page.locator("header.k-bar");
  await bar.getByRole("button", { name: "探す", exact: true }).click();
  const box = bar.getByRole("search").locator("input");
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  await expect(bar.locator(".k-bar-ws-name")).toBeHidden();
  await expect(bar.locator(".k-bell")).toBeHidden();
  const [b, f] = await Promise.all([bar.boundingBox(), bar.getByRole("search").boundingBox()]);
  expect(f!.width, "探す欄は帯の幅の 8 割以上").toBeGreaterThan(b!.width * 0.8);
  const fontPx = await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx, "探す欄の字は 16px 以上（iPhone の Safari が焦点で画面を拡大しない）").toBeGreaterThanOrEqual(16);
  await box.fill("請求");
  await box.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "「請求」を探す" })).toBeVisible();
  await bar.getByRole("button", { name: "探すを閉じる" }).click();
  await expect(box).toBeHidden();
  await expect(bar.locator(".k-bar-ws-name")).toBeVisible();
  await expect(bar.locator(".k-bell")).toBeVisible();
  expect(await overflowX(page)).toBe(0);
});

test("K350-SH-003 幅 375（モック・探せない）：グレーの虫眼鏡を押しても、Enter でも、⌘K（Ctrl+K）でも探す欄は開かず、帯はそのまま", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "cred-list", 375);
  const bar = page.locator("header.k-bar");
  const open = bar.getByRole("button", { name: "探す（準備中）" });
  await open.click({ force: true });
  await open.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(bar.getByRole("search")).toBeHidden();
  await expect(bar.locator(".k-bar-ws-name")).toBeVisible();
  await expect(bar).not.toHaveAttribute("data-searching", /.*/);
});

test("K350-SH-004 幅 375（外枠の見本）：自分のメニューは上の帯から開き（名前「高本」とログアウト）、下のタブの「メニュー」の引き出しには自分のメニューが無い", async ({
  page,
}) => {
  await openShell(page, 375);
  await page.locator("header.k-bar").getByRole("button", { name: "自分のメニュー" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("高本");
  await expect(menu.getByRole("menuitem", { name: "ログアウト" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.getByRole("navigation", { name: "下のタブ" }).getByRole("button", { name: "メニュー" }).click();
  const sheet = page.getByRole("navigation", { name: "メニュー（全部）" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "自分のメニュー" })).toHaveCount(0);
});

test("K350-SH-005 幅 1440（外枠の見本）：広い帯は前のまま（いまの場所・探す欄・鈴・自分のメニューが見え、帯の会社の印と名前・虫眼鏡のボタンは出ない）", async ({
  page,
}) => {
  await openShell(page, 1440);
  const bar = page.locator("header.k-bar");
  await expect(page.getByRole("navigation", { name: "いまの場所" })).toBeVisible();
  await expect(bar.getByRole("search").locator("input")).toBeVisible();
  await expect(bar.locator(".k-bell")).toBeVisible();
  await expect(bar.getByRole("button", { name: "自分のメニュー" })).toBeVisible();
  await expect(bar.locator(".k-bar-ws")).toBeHidden();
  await expect(bar.locator(".k-bar-ws-name")).toBeHidden();
  await expect(bar.locator(".k-bar-search-open")).toHaveCount(0);
});

test("K350-SH-006 幅 320・375・768：外枠の見本とモック cred-list で横のはみ出し 0・帯の中の押せる物は 24px 以上", async ({
  page,
}) => {
  await guard(page);
  for (const w of [320, 375, 768]) {
    for (const go of [() => openShell(page, w), () => openState(page, "cred-list", w)]) {
      await go();
      expect(await overflowX(page), `幅 ${w} ${page.url()}`).toBe(0);
      const small = await page.$$eval("header.k-bar a[href], header.k-bar button", (els) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
          })
          .map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim()),
      );
      expect(small, `幅 ${w} ${page.url()} の 24px 未満の的`).toEqual([]);
    }
  }
});

test("K350-SH-007 幅 375（外枠の見本・探せる）の探す欄の閉じ方と焦点：× で閉じると焦点は虫眼鏡のボタンに戻り、開いた欄で Esc を押しても閉じて焦点が戻り（変換中の Esc では閉じない）、⌘K（Ctrl+K）でも欄が開いて焦点が入る", async ({
  page,
}) => {
  await openShell(page, 375);
  const bar = page.locator("header.k-bar");
  const open = bar.getByRole("button", { name: "探す", exact: true });
  const box = bar.getByRole("search").locator("input");
  // × で閉じる：欄も × も消えるので、焦点は虫眼鏡のボタンへ戻る（焦点を見失わない）
  await open.click();
  await expect(box).toBeFocused();
  await bar.getByRole("button", { name: "探すを閉じる" }).click();
  await expect(box).toBeHidden();
  await expect(open).toBeFocused();
  // キーボードで開き（虫眼鏡に焦点 → Enter）、Esc で閉じる
  await page.keyboard.press("Enter");
  await expect(box).toBeFocused();
  // 変換中（日本語を打っている途中）の Esc は変換をやめるためのキー：欄は閉じず、焦点も欄のまま
  await box.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(bar).toHaveAttribute("data-searching", "true");
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(bar).not.toHaveAttribute("data-searching", /.*/);
  await expect(bar.locator(".k-bar-ws-name")).toBeVisible();
  await expect(open).toBeFocused();
  // ⌘K（Ctrl+K）：スマホの帯でも欄が開いて焦点が入る
  await page.keyboard.press("ControlOrMeta+k");
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
});

// ---- 実ブラウザ：自分の設定の第 2 ナビ（スマホはボタン 1 つの一覧） ----

test("K350-MS-001 幅 375（モック cred-list）：第 2 ナビはボタン「自分の設定 › 預けたログイン情報 ▾」1 つ（項目の列は隠れる・読み上げの名前も見える字で始まる）。押すと縦の一覧で、作った画面は押せるリンク・作っていない画面は押せない・いまの項目に aria-current", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "cred-list", 375);
  const sub = page.locator(SUB);
  const pick = sub.getByRole("button", { name: "自分の設定の中を選ぶ" });
  await expect(pick).toBeVisible();
  await expect(pick).toHaveText("自分の設定 › 預けたログイン情報 ▾");
  // 読み上げと声の操作の名前は、見えている字（自分の設定 › いまの項目）で始まる（見える字と名前が食い違わない）
  await expect(pick).toHaveAccessibleName(/^自分の設定 › 預けたログイン情報/);
  await expect(sub.locator(".k-me-sub-t").first()).toBeHidden();
  const [s, h] = await Promise.all([sub.boundingBox(), page.locator("#k-main h1").boundingBox()]);
  expect(s!.y + s!.height, "第 2 ナビは見出しの上").toBeLessThanOrEqual(h!.y);
  await pick.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const items = menu.getByRole("menuitem");
  const all = await items.evaluateAll((els) =>
    els.map((e) => ({
      text: (e.textContent ?? "").trim(),
      href: e.getAttribute("href"),
      disabled: e.getAttribute("aria-disabled") === "true" || e.hasAttribute("data-disabled"),
      current: e.getAttribute("aria-current"),
    })),
  );
  expect(all.map((x) => x.text)).toEqual([
    "プロフィール",
    "ログインと安全",
    "PC と使った量",
    "預けたログイン情報",
    "お知らせ",
  ]);
  const hrefOf: Record<string, string> = {
    プロフィール: "/account",
    ログインと安全: "/mfa-setup",
    "PC と使った量": "/setup/bridge",
    預けたログイン情報: "/settings/credentials",
    お知らせ: "/notifications",
  };
  for (const x of all) {
    if (x.text === "預けたログイン情報") {
      expect(x.current).toBe("page");
      expect(x.href).toBe(hrefOf[x.text]);
    } else if (isBuilt(hrefOf[x.text]!)) {
      expect(x.href, x.text).toBe(hrefOf[x.text]);
      expect(x.disabled, x.text).toBe(false);
    } else {
      expect(x.href, x.text).toBeNull();
      expect(x.disabled, x.text).toBe(true);
    }
  }
  expect(await overflowX(page)).toBe(0);
});

test("K350-MS-002 幅 768 と 1440：スマホのボタンは隠れ、第 2 ナビは前のまま（768 は 64px で絵だけ・1440 は 232px で項目の字が 5 つ）", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "cred-list", 768);
  const sub = page.locator(SUB);
  await expect(sub.getByRole("button", { name: "自分の設定の中を選ぶ" })).toBeHidden();
  expect(Math.round((await sub.boundingBox())!.width)).toBe(64);
  await openState(page, "cred-list", 1440);
  await expect(sub.getByRole("button", { name: "自分の設定の中を選ぶ" })).toBeHidden();
  expect(Math.round((await sub.boundingBox())!.width)).toBe(232);
  await expect(sub.locator(".k-me-sub-t")).toHaveCount(5);
});

test("K350-MS-003 幅 375 のキーボード：Tab でボタンに届き、Enter で一覧が開き、↓ で項目を移り、Esc で閉じてボタンに戻る", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "cred-list", 375);
  const pick = page.locator(SUB).getByRole("button", { name: "自分の設定の中を選ぶ" });
  await pick.focus();
  await expect(pick).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(pick).toBeFocused();
});
