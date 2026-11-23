// K-235「速さ：画面の最初の読み込みの直列の段を 1 にし、同じ口を 2 回呼ばない」の画面の試験（実 Chrome）。
//   行 ID（K235-UI-…）は 11_tickets/K-235.md の表と 1 対 1。口は網の手前で差し替える（tests/k/list-mock.ts を読むだけで使う）。
//   段の数え方：口の答えを全部止めた（どの答えも画面に届いていない）間に出た要求が 1 段目。止めを外した後に出た要求は、
//   前の答えを待ってから出した要求＝2 段目以降。目印の口（その画面の本文が要る口）が全部出たのを見てから止めを外す。
//   見た目はキャンバスとの突き合わせ（入れた組・G70）が持つ。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, test, type Locator, type Page } from "@playwright/test";
import { item, mockList, ok, open } from "./list-mock";

/** 正式な uuid（最後の組が 12 桁）。list-mock の idOf は最後の組が 11 桁で、詳細の入口の確かめ（isUuid・D-129.42）に落ちて口を呼ばない */
const idOf = (i: number) => `0193c5a0-0000-7000-8000-${String(1_000_000_000_000 + i).slice(1)}`;
/** 一覧の行（id だけ正式な uuid にした list-mock の行） */
const rows = (n: number) => Array.from({ length: n }, (_, k) => item(k + 1, { id: idOf(k + 1) }));

const API_RE = /\/api\/(v1|auth-ext|auth)\//;
const TICKET = idOf(7);

interface Load {
  /** 止めている間に出た要求（方法 道?問い合わせ） */
  before: string[];
  /** 止めを外した後に出た要求 */
  after: string[];
  release: () => void;
}
/** 口の答えを止める。後から足した道の差し替えが先に動くので、list-mock の差し替えより後に呼ぶ（答えは list-mock に渡す） */
async function hold(page: Page, failing: Record<string, number> = {}): Promise<Load> {
  const st = { held: true };
  const before: string[] = [];
  const after: string[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  await page.route(API_RE, async (route, req) => {
    if (req.method() === "OPTIONS") return route.fallback();
    const u = new URL(req.url());
    const key = `${req.method()} ${u.pathname}${u.search}`;
    (st.held ? before : after).push(key);
    if (st.held) await gate;
    const fail = failing[u.pathname];
    if (fail) return route.fulfill({ status: fail, contentType: "application/json", body: '{"error":"x","code":"X"}' });
    return route.fallback();
  });
  return {
    before,
    after,
    release: () => {
      st.held = false;
      open();
    },
  };
}
const path = (k: string) => k.split(" ")[1]!.split("?")[0]!;
const dups = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
/** 目印の口（方法と道・問い合わせは見ない）が全部出るまで待つ（答えは止めたまま） */
async function waitMarks(l: Load, marks: string[]) {
  await expect
    .poll(() => marks.filter((m) => !l.before.some((k) => k.split("?")[0] === m)), { timeout: 30_000 })
    .toEqual([]);
}
/** 本文の出来上がり（止めを外した後に、答えを使って描いた所）。これが見えてから、外した後に出た口を数える */
type Ready = "list" | "create" | "detail" | "approvals";
const READY: Record<Ready, (page: Page) => Locator> = {
  list: (page) => page.getByRole("table", { name: "チケットの一覧" }).locator("tbody tr[data-ticket]").first(),
  create: (page) => page.locator("header.k-page-head h1", { hasText: "チケットを作る" }),
  detail: (page) => page.locator("header.k-page-head h1", { hasText: "チケット 7" }),
  approvals: (page) => page.locator("header.k-page-head h1", { hasText: "承認待ち" }),
};
async function firstLoad(
  page: Page,
  url: string,
  marks: string[],
  ready: Ready,
  o: { failing?: Record<string, number>; width?: number } = {},
) {
  await mockList(page, { list: () => ok(rows(3), { next_cursor: null }) });
  const l = await hold(page, o.failing ?? {});
  await open(page, url, o.width ?? 1440);
  await waitMarks(l, marks);
  l.release();
  await expect(READY[ready](page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  return l;
}

test("K235-UI-001 一覧（/tickets）：答えの前に /me と一覧の口が出る・答えの後に出た口 0・同じ口 2 回 0・/me は 1 回", async ({
  page,
}) => {
  const l = await firstLoad(page, "/tickets", ["GET /api/auth-ext/me", "GET /api/v1/tickets"], "list");
  const all = [...l.before, ...l.after];
  expect(l.after).toEqual([]);
  expect(dups(all)).toEqual([]);
  expect(all.filter((k) => path(k) === "/api/auth-ext/me")).toHaveLength(1);
});

test("K235-UI-002 作る画面（/tickets?new=1）：答えの前に種別・人・書きかけ・/me が出る・答えの後に出た口 0・同じ口 2 回 0", async ({
  page,
}) => {
  const l = await firstLoad(
    page,
    "/tickets?new=1",
    ["GET /api/auth-ext/me", "GET /api/v1/ticket_kinds", "GET /api/v1/members", "GET /api/v1/me/ticket-drafts"],
    "create",
  );
  expect(l.after).toEqual([]);
  expect(dups([...l.before, ...l.after])).toEqual([]);
});

test("K235-UI-003 詳細（/tickets/:id）：答えの前に詳細と実行の一覧とやり取りの最初の 20 件（K-392）と /me が出る・答えの後に出た口 0・同じ口 2 回 0・口は 8 本以下（K-397 の決定の一覧を含む）", async ({
  page,
}) => {
  const l = await firstLoad(
    page,
    `/tickets/${TICKET}`,
    [
      `GET /api/v1/tickets/${TICKET}`,
      `GET /api/v1/tickets/${TICKET}/runs`,
      `GET /api/v1/tickets/${TICKET}/timeline`, // K-392：タブの読んでいない数を出すため、詳細の答えを待たずに同時に読む
      "GET /api/auth-ext/me",
    ],
    "detail",
  );
  const all = [...l.before, ...l.after];
  expect(l.after).toEqual([]);
  expect(dups(all)).toEqual([]);
  // K-392 がやり取りの読む口を 1 本（台帳 perf_budget.json は 7）・K-397 が決定の一覧の口を 1 本（台帳 8）足す。どちらも詳細と同時に出す（上の l.after が空）。
  // 決定の一覧は K-397 の後だけ出るので目印には入れない。同じ試験を 2 つの葉の版で持たないため、上限は K-397 の分も含めて 8
  expect(all.length, all.join("\n")).toBeLessThanOrEqual(8);
});

test("K235-UI-004 承認待ち（/approvals）：答えの前に承認待ちと /me が出る・答えの後に出た口 0・同じ口 2 回 0・口は 4 本以下", async ({
  page,
}) => {
  const l = await firstLoad(page, "/approvals", ["GET /api/v1/approvals/queue", "GET /api/auth-ext/me"], "approvals");
  const all = [...l.before, ...l.after];
  expect(l.after).toEqual([]);
  expect(dups(all)).toEqual([]);
  expect(all.length, all.join("\n")).toBeLessThanOrEqual(4);
});

test("K235-UI-005 幅 768 で一覧の行の題名を押して詳細へ移る：URL が /tickets/<id>・/me とグループの口を呼び直さない（画面の中で移る）", async ({
  page,
}) => {
  const l = await firstLoad(page, "/tickets", ["GET /api/auth-ext/me", "GET /api/v1/tickets"], "list", { width: 768 });
  const seen = l.before.length + l.after.length;
  await page
    .getByRole("table", { name: "チケットの一覧" })
    .locator("tbody tr[data-ticket]")
    .first()
    .getByRole("link", { name: "チケット 1" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${idOf(1)}$`));
  await expect(page.locator("header.k-page-head h1", { hasText: "チケット 1" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const later = [...l.before, ...l.after].slice(seen);
  expect(later.filter((k) => ["/api/auth-ext/me", "/api/v1/scopes"].includes(path(k)))).toEqual([]);
});

test("K235-UI-006 /me の口が 500：一覧の口は /me の答えを待たずに出る・/me は読み直さない（1 回）", async ({
  page,
}) => {
  const l = await firstLoad(page, "/tickets", ["GET /api/auth-ext/me", "GET /api/v1/tickets"], "list", {
    failing: { "/api/auth-ext/me": 500 },
  });
  const all = [...l.before, ...l.after];
  expect(all.filter((k) => path(k) === "/api/auth-ext/me")).toHaveLength(1);
  expect(l.before.some((k) => k.startsWith("GET /api/v1/tickets"))).toBe(true);
});

test("K235-UI-007 口へ先につなぐ：/tickets の HTML の頭に、口が画面と別の出どころならその出どころへの preconnect（crossorigin つき）がちょうど 1 つ。同じ出どころ（K-262 の④の後）なら画面の出どころを指す preconnect は 0", async ({
  page,
}) => {
  // 画面が実際に呼ぶ口の出どころ（NEXT_PUBLIC_API_BASE の origin）を、開いたときの要求から読む
  await firstLoad(page, "/tickets", ["GET /api/auth-ext/me", "GET /api/v1/tickets"], "list");
  const origins = new Set<string>();
  page.on("request", (r) => {
    if (API_RE.test(r.url())) origins.add(new URL(r.url()).origin);
  });
  await page.reload();
  await expect(READY.list(page)).toBeVisible();
  expect(origins.size).toBe(1);
  const api = [...origins][0]!;
  const self = new URL(page.url()).origin;
  // サーバーが返した HTML（JS が動く前）の頭を読む
  const html = await (await page.request.get("/tickets")).text();
  const head = html.slice(0, html.indexOf("</head>"));
  const links = [...head.matchAll(/<link\b[^>]*rel="preconnect"[^>]*>/g)].map((m) => m[0]);
  if (api === self) {
    // 画面と口が同じ住所：先につなぐ物は要らない
    expect(
      links.filter((x) => x.includes(`href="${self}"`)),
      links.join("\n"),
    ).toEqual([]);
    return;
  }
  const mine = links.filter((x) => x.includes(`href="${api}"`));
  expect(mine, links.join("\n")).toHaveLength(1);
  expect(mine[0]).toMatch(/\scrossorigin(="[^"]*")?[\s/>]/);
});
