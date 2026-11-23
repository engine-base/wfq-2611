// K-942「段 13 の部品 2：受信箱・お知らせ・請求・配るもの の部品（features/F12/ops2）と、下絵の置き場 /dev/mock/f12-ops2（23 状態）を本線に入れる
//   （K-72 の葉・W0）」の試験（実 Chrome と、ファイル・検査を読む試験・実装より先に積む）。
//   的：開発用の置き場 /dev/mock/f12-ops2（索引と 23 状態）。運営の外枠・表・選ぶ欄の並び・試験の道具は K-941 が運んだ物を読む。
//   見ること：23 状態が全部描ける・幅 375／768／1440 で横のはみ出し 0・運営の画面は運営の外枠（会社の側の 13-9 だけ顧客の外枠）・
//   配るものは 操作・ひな形・プラン の 3 つ（業務の型は無い）・書き出し・取引先の字が無い・部品は口を呼ばない・デザインの検査（G37・G72）が緑。
//   画面に出す字と並びは下絵が正。テストはチケットを作る人が書き、実装する人は変えない
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BUILT_ROUTES } from "../../lib/built-routes";
import {
  F12,
  FORBIDDEN,
  ROOT,
  dialogOf,
  entries,
  guard,
  mockDir,
  openState,
  overflowX,
  read,
  sources,
  strip,
} from "./f12-mock-kit";

const DIR = "f12-ops2" as const;
const MOCK = mockDir(DIR);
const OPS2 = join(F12, "ops2");
/** 状態と持ち主の葉（切り方 1 章の画面の葉）。運ぶ（描く）のはこの葉 */
const OWNER: Readonly<Record<string, string>> = {
  "oq-inbox": "K-976",
  "oq-inbox-thread": "K-976",
  "oq-inbox-empty": "K-976",
  "oq-inbox-taken": "K-976",
  "oq-notices": "K-980",
  "oq-notice-new": "K-1015",
  "oq-notice": "K-980",
  "oq-notice-publish": "K-1015",
  "oq-notice-edit": "K-1015",
  "oq-bills": "K-984",
  "oq-bills-issue": "K-984",
  "oq-pay": "K-984",
  "oq-pay-diff": "K-984",
  "oq-plans": "K-991",
  "oq-plan-edit": "K-991",
  "oq-plan-review": "K-991",
  "oq-plan-self": "K-991",
  "oq-plan-log": "K-991",
  "oq-templates": "K-994",
  "oq-template-release": "K-1111",
  "op-template-edit": "K-1111",
  "oq-operations": "K-994",
  "oq-template-update": "K-1016",
};
const IDS = Object.keys(OWNER);
const COMPANY_SIDE = "oq-template-update";

// ---- ファイルの突き合わせ（ブラウザ不要） ----

test("K942-MK-001 状態の一覧が 23 件で、持ち主は切り方 1 章の画面の葉（ticket と leaf は同じ K-番号・重なり 0）", () => {
  const rows = entries(DIR);
  const ids = rows.map((r) => r.id);
  expect(new Set(ids).size, "同じ id が 2 つある").toBe(ids.length);
  expect([...ids].sort()).toEqual([...IDS].sort());
  for (const r of rows) {
    expect(r.ticket, `${r.id} の持ち主`).toBe(OWNER[r.id]);
    expect(r.leaf, `${r.id} の leaf は ticket と同じ`).toBe(r.ticket);
  }
  expect(rows.length, "機械が読めない行がある").toBe([...read(join(MOCK, "mocks.tsx")).matchAll(/\bid: "/g)].length);
});

test("K942-MK-002 画面の字に「取引先」「業務の型」「書き出」「エクスポート」「CSV」が 0 件（features/F12/ops2・mock/f12-ops2 の注を除く中身）", () => {
  for (const d of [OPS2, MOCK])
    for (const f of sources(d)) expect(strip(read(f)), `${f} に出してはいけない字がある`).not.toMatch(FORBIDDEN);
});

test("K942-MK-003 部品は口を呼ばない（features/F12/ops2 の .tsx に fetch・/api/v1 が 0）", () => {
  for (const f of sources(OPS2).filter((p) => p.endsWith(".tsx")))
    expect(strip(read(f)), `${f} が口を呼ぶ`).not.toMatch(/\bfetch\(|apiFetch|\/api\/v1/);
});

test("K942-MK-004 一覧と描き手が分かれている：mocks.tsx は部品を読まず、render.tsx が 23 状態を 1 つずつ描き、知らない id は「まだありません」", () => {
  expect(strip(read(join(MOCK, "mocks.tsx"))), "一覧が部品を読んでいる").not.toMatch(
    /from "@\/features|from "\.\/render/,
  );
  const render = strip(read(join(MOCK, "render.tsx")));
  for (const id of IDS) expect(render, `${id} を描く所が無い`).toContain(`case "${id}"`);
  expect(render).toContain("この状態はまだありません");
  expect(read(join(MOCK, "[id]/page.tsx"))).toMatch(/from "\.\.\/render"/);
});

test("K942-MK-005 運営の外枠・小物・表は K-941 の物を読む（ops2 が自分の外枠と表を持たない：ops-shell・ops-parts・shared/resp-table から読み、<table を組まない）", () => {
  expect(strip(read(join(MOCK, "render.tsx")))).toMatch(/from "@\/features\/F12\/ops\/ops-shell"/);
  const src = sources(OPS2)
    .filter((p) => p.endsWith(".tsx"))
    .map((p) => strip(read(p)))
    .join("\n");
  expect(src).toMatch(/from "@\/features\/F12\/ops\/ops-parts"/);
  expect(src).toMatch(/from "@\/features\/F12\/shared\/resp-table"/);
  expect(src).not.toMatch(/<table\b|function OpsShell/);
});

test("K942-RT-001 道の一覧に /dev/mock/f12-ops2 と /dev/mock/f12-ops2/:id が在る（機械生成 scripts/ci/gen_built_routes.py）", () => {
  expect(BUILT_ROUTES).toContain("/dev/mock/f12-ops2");
  expect(BUILT_ROUTES).toContain("/dev/mock/f12-ops2/:id");
});

test("K942-CG-001 画面の持ち主の検査（canvas_field_gate.py）が置き場の状態を読める形で読む（読めない・重複の語が出ない）", () => {
  const out = execFileSync("python3", ["scripts/ci/canvas_field_gate.py", "--no-base"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  expect(out).not.toMatch(/読めない|MOCKS の並びが無い|状態が 1 つも無い|が 2 つある/);
});

test("K942-DS-001 デザインの検査 G37（D1〜D7）が緑：features の色・書体・角丸・文字・部品の値が正本に在る", () => {
  const out = execFileSync(
    "python3",
    [
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
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 300_000 },
  );
  expect(out).toMatch(/PASS/);
});

test("K942-DS-002 デザインの検査 G72（D8 生の長さ）で、F12 の ops2 と mock/f12-ops2 に台帳に無い生の値が 0 件", () => {
  let out: string;
  try {
    out = execFileSync(
      "python3",
      [
        "scripts/ci/design_gate.py",
        "--design",
        "04_design/DESIGN-kaname.md",
        "--mocks",
        "apps/web/components/k",
        "apps/web/features",
        "--css",
        "apps/web/styles/k-tokens.css",
        "--part",
        "--no-components",
        "--raw-lengths",
        "--no-base",
      ],
      { cwd: ROOT, encoding: "utf8", timeout: 300_000 },
    );
  } catch (e) {
    // 出力を読むのは、検査が指摘を出して 0 でない値で終わったときだけ。python3 が無い・時間切れ・検査が出力なしで落ちたときは、0 件と数えずそのまま赤にする
    const x = e as { stdout?: unknown; status?: unknown };
    if (typeof x.status !== "number" || typeof x.stdout !== "string" || x.stdout.trim() === "") throw e;
    out = x.stdout;
  }
  const mine = out
    .split("\n")
    .filter((l) => /D8 apps\/web\/(features\/F12\/ops2|app\/\(dev\)\/dev\/mock\/f12-ops2)\//.test(l));
  expect(mine, mine.join("\n")).toEqual([]);
});

// ---- 実ブラウザ ----

test("K942-UI-001 索引 /dev/mock/f12-ops2 に 23 件が並び、どの状態も頁が開く（200・状態の入れ物が出る）", async ({
  page,
}) => {
  await guard(page);
  await page.goto("/dev/mock/f12-ops2");
  await expect(page.locator("main li a")).toHaveCount(23);
  for (const id of IDS) await openState(page, DIR, id, 1440);
});

// 行 ID：K942-UI-002・K942-UI-003・K942-UI-004
for (const [n, w] of [
  ["002", 375],
  ["003", 768],
  ["004", 1440],
] as const) {
  test(`K942-UI-${n} 23 状態が幅 ${w} で開き、横のはみ出しが 0`, async ({ page }) => {
    await guard(page);
    for (const id of IDS) {
      await openState(page, DIR, id, w);
      expect(await overflowX(page), `${id} が幅 ${w} で横にはみ出す`).toBeLessThanOrEqual(0);
    }
  });
}

test("K942-UI-005 暗いテーマでも 23 状態が幅 375 で開き、横にはみ出さない", async ({ page, context }) => {
  await guard(page);
  await context.addCookies([{ name: "k-theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
  for (const id of IDS) {
    await openState(page, DIR, id, 375);
    expect(await overflowX(page), `${id} が暗いテーマで横にはみ出す`).toBeLessThanOrEqual(0);
  }
});

test("K942-UI-006 23 状態のどれを開いても、口（/api/）を 1 回も呼ばず、本人の Bridge にも届かない", async ({
  page,
}) => {
  const calls = await guard(page);
  let bridge = 0;
  page.on("request", (r) => {
    if (/127\.0\.0\.1:38617/.test(r.url())) bridge += 1;
  });
  for (const id of IDS) await openState(page, DIR, id, 1440);
  expect(calls).toEqual([]);
  expect(bridge).toBe(0);
});

test("K942-UI-007 運営の 20 状態は運営の外枠で、左のメニューの今の印が場所に合う（受信箱→問い合わせ・お知らせ→お知らせ・請求→請求・プラン→配るもの）。会社の側（oq-template-update）だけ顧客の外枠", async ({
  page,
}) => {
  await guard(page);
  for (const id of IDS.filter((i) => i !== COMPANY_SIDE)) {
    await openState(page, DIR, id, 1440);
    await expect(page.locator(".k-op-shell"), `${id} が運営の外枠に入っていない`).toHaveCount(1);
  }
  const nav = page.getByRole("navigation", { name: "運営のメニュー", exact: true });
  for (const [id, label] of [
    ["oq-inbox", "問い合わせ"],
    ["oq-notices", "お知らせ"],
    ["oq-bills", "請求"],
    ["oq-plans", "配るもの"],
  ] as const) {
    await openState(page, DIR, id, 1440);
    await expect(nav.locator('a[aria-current="page"] .k-nav-label'), id).toHaveText(label);
  }
  await openState(page, DIR, COMPANY_SIDE, 1440);
  await expect(page.locator(".k-op-shell")).toHaveCount(0);
  await expect(page.locator(".k-shell")).toHaveCount(1);
});

test("K942-UI-008 受信箱：見出し「問い合わせ」と組「箱」「種類」が出る。箱が空（oq-inbox-empty）は「この箱に問い合わせはありません」", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-inbox", 1440);
  await expect(page.getByRole("heading", { level: 1, name: "問い合わせ", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "箱", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "種類", exact: true })).toBeVisible();
  await openState(page, DIR, "oq-inbox-empty", 1440);
  await expect(page.getByText("この箱に問い合わせはありません", { exact: true })).toBeVisible();
});

test("K942-UI-009 1 件（oq-inbox-thread）：担当・状態・後で の選ぶ欄と「済みにする」「社内メモにする」「返して返事待ちにする」「返す」が押せる形で、社内メモの行に「社内メモ ・ 先方には見えない」", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-inbox-thread", 1440);
  for (const l of ["担当", "状態", "後で"]) await expect(page.getByLabel(l, { exact: true })).toBeEnabled();
  for (const b of ["済みにする", "社内メモにする", "返して返事待ちにする", "返す"]) {
    const btn = page.getByRole("button", { name: b, exact: true });
    await expect(btn).toBeVisible();
    await expect(btn).not.toHaveAttribute("aria-disabled", "true");
  }
  await expect(page.getByText("社内メモ ・ 先方には見えない", { exact: true })).toBeVisible();
});

test("K942-UI-010 ほかの人が担当（oq-inbox-taken）：「佐野 さんが担当になりました」が出て、選ぶ欄は使えず、「返す」は押せない形（aria-disabled）", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-inbox-taken", 1440);
  await expect(page.getByText("佐野 さんが担当になりました", { exact: true })).toBeVisible();
  await expect(page.getByLabel("担当", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "返す", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("K942-UI-011 お知らせ：一覧の見出し「お知らせ」。作る（oq-notice-new）は見出し「お知らせを書く」と、誰に の 3 つ（全部のワークスペース・プランで選ぶ・ワークスペースを選ぶ）", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-notices", 1440);
  await expect(page.getByRole("heading", { level: 1, name: "お知らせ", exact: true })).toBeVisible();
  await openState(page, DIR, "oq-notice-new", 1440);
  await expect(page.getByRole("heading", { level: 1, name: "お知らせを書く", exact: true })).toBeVisible();
  for (const t of ["全部のワークスペース", "プランで選ぶ", "ワークスペースを選ぶ"])
    await expect(page.getByText(t, { exact: true })).toBeVisible();
});

test("K942-UI-012 障害の 1 件（oq-notice）：状態の並びが 調べている・原因が分かった・様子を見ている・直った の 4 つで 2 つ目が今。出す確かめ（oq-notice-publish）の題は「このお知らせを出す」", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-notice", 1440);
  const steps = page.getByRole("list", { name: "状態", exact: true }).getByRole("listitem");
  await expect(steps).toHaveText([/調べている$/, /原因が分かった$/, /様子を見ている$/, /直った$/]);
  await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
  await openState(page, DIR, "oq-notice-publish", 1440);
  await expect(dialogOf(page, "このお知らせを出す")).toBeVisible();
});

test("K942-UI-013 請求：見出し「請求」と組「絞り込み」。まとめて出す確かめ（oq-bills-issue）の題は「10 月分の請求書をまとめて出す」、入金（oq-pay・oq-pay-diff）は小窓「入金を記録」", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-bills", 1440);
  await expect(page.getByRole("heading", { level: 1, name: "請求", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "絞り込み", exact: true })).toBeVisible();
  await openState(page, DIR, "oq-bills-issue", 1440);
  await expect(dialogOf(page, "10 月分の請求書をまとめて出す")).toBeVisible();
  for (const id of ["oq-pay", "oq-pay-diff"]) {
    await openState(page, DIR, id, 1440);
    await expect(dialogOf(page, "入金を記録"), id).toBeVisible();
  }
});

test("K942-UI-014 配るもの：中の行き先「配るものの中」は 操作・ひな形・プラン の 3 つだけ（業務の型は無い・D-156.7）で、開いている物が今の印", async ({
  page,
}) => {
  await guard(page);
  for (const [id, label] of [
    ["oq-operations", "操作"],
    ["oq-templates", "ひな形"],
    ["oq-plans", "プラン"],
  ] as const) {
    await openState(page, DIR, id, 1440);
    const sub = page.getByRole("navigation", { name: "配るものの中", exact: true }).getByRole("link");
    await expect(sub).toHaveCount(3);
    await expect(sub).toHaveText([/^操作/, /^ひな形/, /^プラン/]);
    await expect(sub.filter({ hasText: label }), id).toHaveAttribute("aria-current", "page");
  }
});

test("K942-UI-015 値段の案（oq-plan-edit）：見出し「チームの値段を変える案」と、いまの顧客の扱い 2 つ（90 日たってから・ずっと今の値段）。自分の案（oq-plan-self）は決めるボタンが押せない形で「自分の案は自分で決められません」", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-plan-edit", 1440);
  await expect(page.getByRole("heading", { level: 1, name: "チームの値段を変える案", exact: true })).toBeVisible();
  await expect(page.getByText("お知らせから 90 日たってから新しい値段", { exact: true })).toBeVisible();
  await expect(page.getByText("ずっと今の値段のまま", { exact: true })).toBeVisible();
  await openState(page, DIR, "oq-plan-self", 1440);
  await expect(page.locator('[title="自分の案は自分で決められません"][aria-disabled="true"]').first()).toBeVisible();
});

test("K942-UI-016 操作（oq-operations）は読むだけ：「ブラウザで操作する」と「v1.4 ・ 読むだけ」が出て、足すボタンは押せない形。ひな形の版を出す確かめ（oq-template-release）は題「ひな形「種別」の新しい版（v4）を出す」で、新しく入る会社は最新で始まり、既定から変えた会社には知らせないと書いてある（D-156.56）", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, "oq-operations", 1440);
  await expect(page.getByText("ブラウザで操作する", { exact: true })).toBeVisible();
  await expect(page.getByText("v1.4 ・ 読むだけ", { exact: true })).toBeVisible();
  await expect(page.locator('[title="まだ使えません"]').first()).toHaveAttribute("aria-disabled", "true");
  await openState(page, DIR, "oq-template-release", 1440);
  const dlg = dialogOf(page, "ひな形「種別」の新しい版（v4）を出す");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText("新しく入るワークスペースは、すぐ v4 で始まる", { exact: true })).toBeVisible();
  await expect(
    dlg.getByText("既定から変えたワークスペース 17 か所には知らせない（そのまま残る）", { exact: true }),
  ).toBeVisible();
});

test("K942-UI-017 会社の側（oq-template-update）：見出し「ひな形がこう変わります」・帯「自分で変えた所は、ここに出ません」・ボタン「そのままにする」「変える」が出て、「取り込む」の字が無い（D-156.20）", async ({
  page,
}) => {
  await guard(page);
  await openState(page, DIR, COMPANY_SIDE, 1440);
  await expect(page.getByRole("heading", { level: 1, name: "ひな形がこう変わります", exact: true })).toBeVisible();
  await expect(page.getByText("自分で変えた所は、ここに出ません", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "そのままにする", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "変える", exact: true })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/取り込/);
});

test("K942-UI-018 23 状態のどこにも「書き出す」のボタン・リンクが無い（押せない形でも出さない・D-156.13）", async ({
  page,
}) => {
  await guard(page);
  for (const id of IDS) {
    await openState(page, DIR, id, 1440);
    await expect(page.getByRole("button", { name: /書き出/ }), id).toHaveCount(0);
    await expect(page.getByRole("link", { name: /書き出/ }), id).toHaveCount(0);
  }
});
