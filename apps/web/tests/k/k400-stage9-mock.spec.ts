// K-400「段 9 の部品とモック・探す欄の型・招くの部品を本線に入れ、K-380 の差し込み口の先に空の区画をつなぐ」の試験（決定ログ §148 は K-425 に移した）
//   （実 Chrome と、ファイル・検査の道具を読む試験・実装より先に積む）。
//   的：開発用の置き場 /dev/mock/f8（索引）と /dev/mock/f8/<状態>・本番の詳細 /tickets/:id と承認待ち /approvals（口は網の手前で差し替え）。
//   モックは本番と同じ部品（features/F8/handover/views.tsx・features/F10/invite/views.tsx・components/k）を決めた値で並べたもの
//   （代表 OK：2026-11-20 の下絵を見た会話・answer=fabd031f9b37）。
//   見ること：37 の状態が全部描ける・幅 375／768／1440 で横のはみ出し 0・状態の持ち主は画面の葉・区画のファイルが在り差し込み口の先から配られる・
//   渡しが無く何もできない詳細と渡しの行が無い承認待ちは今のまま・正本の値の検査が緑（決定ログの §148・答えの記録・決定の検査の行は K-425 に移した）。
//   SL の行は、後ろの画面の葉（K-411〜K-415）が区画のファイルを本物にしても崩れない形にした（精査 2026-11-20・後ろの葉がこの試験を替えない）。
//   この葉の回だけの「まだ何も出さない」は、作る段の手元の確かめ（md の実施事項）で見る
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { isBuilt } from "../../lib/built-routes";
import { openQueue } from "../features/F5/approve-complete.harness";
import { assigneeOf, bandsOf, mockHandovers, openDetail } from "./handover-mock";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const WEB = join(HERE, "../..");
const F8 = join(WEB, "features/F8/handover");
const MOCKS_SRC = join(WEB, "app/(dev)/dev/mock/f8/mocks.tsx");
const SHOTS_SRC = join(ROOT, "07_functional/段9-F8/mock-shots.mjs");
const DESIGN = join(ROOT, "04_design/DESIGN-kaname.md");
const TOKENS = join(WEB, "styles/k-tokens.css");
const GATE = join(ROOT, "design-gate.json");

/** 画面の葉と、その葉が本物にするモックの状態（11_tickets/K-400.md の MK-001・切り方.md 0 章） */
const LEAVES: Record<string, readonly string[]> = {
  "K-411": [
    "f8-detail-owner",
    "f8-pick",
    "f8-pick-search",
    "f8-pick-none",
    "f8-pass",
    "f8-pass-error",
    "f8-pass-refused",
    "f8-blocked",
    "f8-noperm",
    "f8-failed",
  ],
  "K-412": ["f8-taken-sender", "f8-queue", "f8-waiting-recipient", "f8-decline", "f8-accepted", "f8-gone"],
  "K-413": ["f8-waiting-sender", "f8-reminded", "f8-withdraw", "f8-overdue", "f8-declined-sender"],
  "K-414": ["f8-offer-entry", "f8-offer", "f8-offer-answer", "f8-offer-band"],
  "K-415": [
    "f8-pick-manager",
    "f8-distribute",
    "f8-distribute-group",
    "f8-distributed",
    "f8-group-waiting",
    "f8-group",
  ],
  "K-420": ["inv-members", "inv-dialog", "inv-error", "inv-link", "inv-stepup", "inv-sent"],
};
const ALL = Object.values(LEAVES).flat();
const OWNER = new Map(Object.entries(LEAVES).flatMap(([k, ids]) => ids.map((id) => [id, k] as const)));
const SECTIONS = [
  "assignee-action",
  "band-sender",
  "band-sender-actions",
  "band-recipient",
  "queue-row-pass",
  "offer-action",
  "band-offer",
  "queue-row-offer",
  "band-distributed",
  "queue-row-group",
] as const;
const NAVY = "rgb(34, 52, 92)";

function mockEntries(): { id: string; screen: string; ticket: string }[] {
  const src = readFileSync(MOCKS_SRC, "utf8");
  const arr = /export const MOCKS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? "";
  return [
    ...arr.matchAll(/\{\s*id: "([^"]+)",\s*screen: "([^"]+)",\s*label:\s*"[^"]*",\s*ticket: "([^"]+)"[^{}]*\}/g),
  ].map((m) => ({ id: m[1]!, screen: m[2]!, ticket: m[3]! }));
}

async function guard(page: Page) {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\//, (route) => route.fulfill({ status: 599, body: "モックは口を呼ばない" }));
}

async function openState(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  const res = await page.goto(`/dev/mock/f8/${id}`);
  expect(res?.status(), `${id} を開けない`).toBe(200);
  await expect(page.locator(`[data-mock="${id}"]`)).toBeVisible();
  await expect(page.locator(".k-shell")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const runPy = (args: string[]) =>
  execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });

// ---- ファイルの突き合わせ（ブラウザ不要） ----

test("K400-MK-001 モックの状態は 37 個で、画面の葉 6 本（K-411 10・K-412 6・K-413 5・K-414 4・K-415 6・K-420 6）が持つ状態の和とちょうど同じ（余りも欠けも重なりも 0）", () => {
  const ids = mockEntries().map((e) => e.id);
  expect(ids.length).toBe(37);
  expect(new Set(ids).size, "同じ id が 2 つある").toBe(ids.length);
  expect([...ids].sort()).toEqual([...ALL].sort());
});

test("K400-MK-002 各状態の持ち主は画面の葉（口の葉 K-401〜K-410 を指さない）・screen は tickets／approvals／members。leaf の欄と K-0 の字が無い", () => {
  const entries = mockEntries();
  expect(entries.length, "ticket を持つ状態が 37 個ない").toBe(37);
  const bad = entries
    .filter((e) => OWNER.get(e.id) !== e.ticket || !["tickets", "approvals", "members"].includes(e.screen))
    .map((e) => `${e.id}：${e.ticket}・${e.screen}（正は ${OWNER.get(e.id) ?? "無い"}）`);
  expect(bad, bad.join("\n")).toEqual([]);
  const src = readFileSync(MOCKS_SRC, "utf8");
  expect(src).not.toMatch(/\bleaf:/);
  expect(src).not.toMatch(/\bK-0\b/);
});

test("K400-MK-003 写しを撮る台本（mock-shots.mjs）は f8 の mocks.tsx の状態を全部、幅 375・768・1440 で /dev/mock/f8 から撮る", () => {
  const src = readFileSync(SHOTS_SRC, "utf8");
  expect(src).toMatch(/mock\/f8\/mocks\.tsx|mock\/\$\{[a-z]+\}\/mocks\.tsx/);
  expect(src).toMatch(/\/dev\/mock\/f8|\/dev\/mock\/\$\{/);
  expect(src).toContain('process.argv[3] ?? "f8"');
  expect(src).toMatch(/375[\s\S]{0,20}768[\s\S]{0,20}1440/);
});

test("K400-MK-004 部品は見た目だけ：F8 と F10 の views.tsx と探す欄の型は口を呼ばない（fetch・lib/api・useRouter・lib/auth）・生の色や大きさを書かない（style=・#色・px）", () => {
  for (const f of [
    join(F8, "views.tsx"),
    join(WEB, "features/F10/invite/views.tsx"),
    join(WEB, "components/k/search-field.tsx"),
  ]) {
    const src = readFileSync(f, "utf8");
    expect(src, f).not.toMatch(/\bfetch\(|lib\/api|useRouter|from "@\/lib\/auth/);
    expect(src, f).not.toMatch(/style=\{|#[0-9a-fA-F]{3,6}\b|\d+px/);
  }
});

test("K400-MK-005 道の一覧：/dev/mock/f8 と /dev/mock/f8/f8-pick が作った道", () => {
  expect(isBuilt("/dev/mock/f8")).toBe(true);
  expect(isBuilt("/dev/mock/f8/f8-pick")).toBe(true);
});

test("K400-MK-006 部品は値と動きを受ける任意の口を持つ（後ろの画面の葉が views.tsx を直さない）・空の関数が無い・AI が動いているときの ▾ は押せる形", () => {
  const src = readFileSync(join(F8, "views.tsx"), "utf8");
  const want: [string, string[]][] = [
    ["AssigneeValue", ["onOpen"]],
    ["PickDialog", ["onPick", "onQueryChange", "onClose"]],
    ["HandoverDialog", ["onSubmit", "onChange", "dueType", "onClose", "busy"]],
    ["DeclineDialog", ["onSubmit", "onClose"]],
    ["OfferDialog", ["onSubmit"]],
    ["DistributeDialog", ["onSubmit"]],
    ["WithdrawConfirm", ["onConfirm"]],
    ["OfferEntry", ["onClick"]],
    ["HandoverBand", ["acts", "notice"]],
    ["HandoverRow", ["onAct"]],
    ["QueueCardMobile", ["onAct"]],
  ];
  const bad: string[] = [];
  for (const [part, props] of want) {
    const at = src.search(new RegExp(`export function ${part}\\b`));
    if (at < 0) {
      bad.push(`${part} が無い`);
      continue;
    }
    const next = src.slice(at + 1).search(/\nexport (function|interface|type|const) /);
    const body = next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
    // props の型は関数の引数か、別に書いた interface <部品>Props のどちらか
    const iface = new RegExp(`interface ${part}Props\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? "";
    for (const pr of props) if (!new RegExp(`\\b${pr}\\?:`).test(body + iface)) bad.push(`${part}.${pr}`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
  expect(
    /export function matchesQuery[\s\S]{0,400}normalize\("NFKC"\)/.test(src),
    "探す字を NFKC でそろえていない",
  ).toBe(true);
  expect(src).not.toContain("onOpenChange={() => undefined}");
  expect(src).not.toContain("onConfirm={() => undefined}");
  const blocked = /mode === "blocked" \? \{[^}]*aria-disabled/.test(src);
  expect(blocked, "blocked の ▾ に aria-disabled が残っている（D-148.24）").toBe(false);
});

test("K400-SL-001 差し込み口の先：detail-slots.tsx は K-380 の 4 つの名前（AssigneeSlot・DetailScope・HandoverBandSlot・QueueRowSlot）だけを配り分けの slot-dispatch.tsx から書き出し、slot-dispatch.tsx は区画のファイル 10 個を全部読む。use-handovers.ts は getTicket の今の渡しと種類から帯・入口・返事待ちの字を決める純な関数を書き出す", () => {
  const slots = readFileSync(join(F8, "detail-slots.tsx"), "utf8");
  // 書き出しは export function／export const／export { … } from のどれでもよい（K380-SL-002 と同じ数え方）
  const exported = new Set<string>();
  for (const m of slots.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)) exported.add(m[1]!);
  for (const m of slots.matchAll(/export\s*\{([^}]*)\}/g))
    for (const n of m[1]!.split(",")) {
      const name = n
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (name && !name.startsWith("type ")) exported.add(name);
    }
  expect([...exported].sort()).toEqual(["AssigneeSlot", "DetailScope", "HandoverBandSlot", "QueueRowSlot"]);
  // 中身は書き出しだけ（K380-SL-002 が export function の中身を見る形にしない・配り分けは slot-dispatch.tsx）
  expect(slots).toMatch(/from "\.\/slot-dispatch"/);
  expect(slots).not.toMatch(/export\s+function/);
  const dispatch = readFileSync(join(F8, "slot-dispatch.tsx"), "utf8");
  const missing: string[] = [];
  for (const s of SECTIONS) {
    if (!existsSync(join(F8, `${s}.tsx`))) {
      missing.push(`${s}.tsx が無い`);
      continue;
    }
    if (!new RegExp(`from "\\./${s}"`).test(dispatch)) missing.push(`slot-dispatch.tsx が ${s} を読まない`);
  }
  expect(missing, missing.join("\n")).toEqual([]);
  const reads = readFileSync(join(F8, "use-handovers.ts"), "utf8");
  for (const fn of ["handoverOf", "bandKindOf", "entryOf", "waitingNoteOf"])
    expect(reads, `${fn} を書き出していない`).toMatch(new RegExp(`export function ${fn}\\b`));
  // 帯の種類の名前はこの葉が決める（申し出の分け方も・K-414 は使うだけ）
  for (const kind of [
    "sending",
    "receiving",
    "taken",
    "gone",
    "offered",
    "offering",
    "offer-accepted",
    "offer-declined",
    "group",
  ])
    expect(reads, `bandKindOf の種類 ${kind}`).toContain(`"${kind}"`);
  // 役の名前で出し分けない（入口は getTicket の handover_kinds・PM の決め 2026-11-20）
  expect(reads).not.toMatch(/role_id|"owner"|"guest"|"manager"/);
});

test("K400-SL-004 下絵の頭の横並びの決まりと、当たらなくなった blocked の ▾ の決まりを消した：handover.css に .k-hnd-head・.k-detail-meta-side・.k-hnd-assignee-btn[aria-disabled の字が無い", () => {
  const css = readFileSync(join(F8, "handover.css"), "utf8");
  expect(css).not.toContain(".k-hnd-head");
  expect(css).not.toContain("k-detail-meta-side");
  expect(css).not.toContain(".k-hnd-assignee-btn[aria-disabled");
});

test("K400-SL-005 渡し中の帯のボタン：band-sender-actions.tsx は SenderActions を書き出し、「催促する」「取り消す」「別の人にする」の 3 つを持つ（キャンバスに在る物を隠さない・D-145.9）", () => {
  const src = readFileSync(join(F8, "band-sender-actions.tsx"), "utf8");
  expect(src).toMatch(/export function SenderActions/);
  for (const label of ["催促する", "取り消す", "別の人にする"]) expect(src, label).toContain(label);
});

test("K400-DS-001 正本の値の検査（design_gate --part --scales --usage）に FAIL が無い", () => {
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

test("K400-DS-002 生の長さ（D8・design_gate --raw-lengths）に FAIL が無い（運ぶ F8・F10・探す欄の CSS に生の px が無い）", () => {
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
    "--no-components",
    "--raw-lengths",
    "--no-base",
  ]);
  expect(out).not.toMatch(/\bFAIL\b/);
});

test("K400-DS-003 探す欄の部品 search-focus：正本（2px solid {colors.primary}）・トークン --k-c-search-focus-border・design-gate.json の訳", () => {
  expect(readFileSync(DESIGN, "utf8")).toMatch(/search-focus:[^\n]*\n\s+border: "2px solid \{colors\.primary\}"/);
  expect(readFileSync(TOKENS, "utf8")).toContain("--k-c-search-focus-border: 2px solid var(--k-primary);");
  const gate = JSON.parse(readFileSync(GATE, "utf8")) as { component_exempt?: { part: string; reason: string }[] };
  const row = (gate.component_exempt ?? []).find((r) => r.part === "search-focus");
  expect(row?.reason.trim().length ?? 0).toBeGreaterThan(0);
});

// ---- 本番の詳細と承認待ちは今のまま（区画はまだ何も出さない） ----

test("K400-SL-002 渡しが無く何もできない詳細は今のまま：getTicket の handover が null・handover_kinds が [] なら、渡しの帯も ▾ も申し出のボタンも出ず、担当者の欄は名前だけ・帯の入れ物の data-shown に handover が無い。開いている間に /handovers・/handover-preview を呼ばない", async ({
  page,
}) => {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (/\/handovers|\/handover-preview/.test(new URL(r.url()).pathname)) hits.push(r.url());
  });
  await mockHandovers(page, { kinds: [], list: [] });
  await openDetail(page, 1440);
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(page.locator(".k-hnd-assignee-btn")).toHaveCount(0);
  await expect(page.locator(".k-hnd-offer")).toHaveCount(0);
  await expect(bandsOf(page).locator("[class*='k-hnd-']")).toHaveCount(0);
  await expect(bandsOf(page)).not.toContainText(/渡し中|頼まれています|断られました|申し出/);
  expect((await bandsOf(page).getAttribute("data-shown")) ?? "").not.toContain("handover");
  expect(hits).toEqual([]);
});

test("K400-SL-003 渡しの行が無い承認待ちは今のまま：AI の成果物の行だけの答えでは、渡しの行（tr.k-hnd-row）も見えるカード（.k-hnd-mcard）も 0 で、前からの行の題名が出る（幅 1440）", async ({
  page,
}) => {
  await mockHandovers(page);
  await openQueue(page, 1440);
  await expect(page.getByRole("main").getByText("見積を出す")).toBeVisible();
  await expect(page.locator("tr.k-hnd-row")).toHaveCount(0);
  await expect(page.locator(".k-hnd-mcard").filter({ visible: true })).toHaveCount(0);
});

// ---- モックの置き場（実 Chrome） ----

test("K400-UI-001 索引 /dev/mock/f8 に 37 のリンク（/dev/mock/f8/<状態>）", async ({ page }) => {
  await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await page.goto("/dev/mock/f8"))?.status()).toBe(200);
  const links = page.locator('a[href^="/dev/mock/f8/"]');
  await expect(links).toHaveCount(37);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect([...hrefs].sort()).toEqual(ALL.map((id) => `/dev/mock/f8/${id}`).sort());
});

/** 37 の状態を幅 w で開き、「この状態はありません」と横のはみ出しを数える */
async function allStatesAt(page: Page, w: number) {
  await guard(page);
  const bad: string[] = [];
  for (const id of ALL) {
    await openState(page, id, w);
    if ((await page.getByText("この状態はありません").count()) > 0) bad.push(`${id}：この状態はありません`);
    const o = await overflowX(page);
    if (o !== 0) bad.push(`${id}：横溢れ ${o}px`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
}

test("K400-UI-002 幅 375：37 の状態が開き、「この状態はありません」が無く、横のはみ出し 0", async ({ page }) => {
  await allStatesAt(page, 375);
});

test("K400-UI-003 幅 768：37 の状態が開き、「この状態はありません」が無く、横のはみ出し 0", async ({ page }) => {
  await allStatesAt(page, 768);
});

test("K400-UI-004 幅 1440：37 の状態が開き、「この状態はありません」が無く、横のはみ出し 0", async ({ page }) => {
  await allStatesAt(page, 1440);
});

test("K400-UI-005 37 の状態で pageerror と hydration の知らせが 0", async ({ page }) => {
  await guard(page);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat/i.test(m.text())) errs.push(m.text());
  });
  for (const id of ALL) await openState(page, id, 1440);
  expect(errs).toEqual([]);
});

test("K400-UI-006 探す欄の焦点：f8-pick で入力に焦点を入れると、枠全体（.k-search-field）に紺の輪 2px、入力そのものの輪は 0px", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "f8-pick", 1440);
  const field = page.locator(".k-dialog .k-search-field");
  await field.locator("input").focus();
  await expect(field.locator("input")).toBeFocused();
  const ring = await field.evaluate((e) => {
    const s = getComputedStyle(e);
    return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`;
  });
  expect(ring).toBe(`2px solid ${NAVY}`);
  expect(await field.locator("input").evaluate((e) => getComputedStyle(e).outlineWidth)).toBe("0px");
});

test("K400-UI-007 探す欄の字（幅 375）：f8-pick の探す欄の入力の字は 16px（iPhone が拡大しない・D-144.7）", async ({
  page,
}) => {
  await guard(page);
  await openState(page, "f8-pick", 375);
  expect(await page.locator(".k-dialog .k-search-field input").evaluate((e) => getComputedStyle(e).fontSize)).toBe(
    "16px",
  );
});
