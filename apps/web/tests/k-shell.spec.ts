// 新しい外枠の操作（K-25）：/dev/k/shell が的。?built=all で全部の画面を「作った」として見る
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, width: number, q = "?built=all") => {
  await page.setViewportSize({ width, height: 860 });
  const res = await page.goto(`/dev/k/shell${q}`);
  expect(res?.status()).toBe(200);
  await expect(page.locator(".k-shell")).toBeVisible();
};
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("KN105-001 375・768・1024・1440 で横にはみ出さない。押せるものは 24px 以上", async ({ page }) => {
  for (const w of [375, 768, 1024, 1440]) {
    await open(page, w);
    expect(await overflow(page), `幅 ${w}`).toBeLessThanOrEqual(0);
    const small = await page.$$eval(".k-shell a[href], .k-shell button", (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && !e.classList.contains("k-skip");
        })
        .map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim()),
    );
    expect(small, `幅 ${w} の 24px 未満の的`).toEqual([]);
  }
});

test("KN105-002 左のバー：役割の主ナビが出て、いまの場所に aria-current。承認待ちの数", async ({ page }) => {
  await open(page, 1440);
  const nav = page.getByRole("navigation", { name: "メニュー", exact: true });
  for (const name of ["チケット", "承認待ち", "高本のAI", "ナレッジ", "ワークスペースの管理"])
    await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^チケット/ })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: /承認待ち/ })).toContainText("2");
  await expect(nav.getByText("PC つながっている")).toBeVisible();
});

test("KN105-003 まだ作っていない画面は押せない（指を置くと準備中・目に見える「準備中」の字は出さない・D-144.1）", async ({
  page,
}) => {
  await open(page, 1440, "?built=none");
  const nav = page.getByRole("navigation", { name: "メニュー", exact: true });
  // 押せるリンクは無い。読み上げには「使えないリンク」として届く（role=link・aria-disabled・K-138）
  await expect(nav.getByRole("link", { name: /ナレッジ/, disabled: false })).toHaveCount(0);
  const item = nav.getByRole("link", { name: /ナレッジ/, disabled: true });
  await expect(item).toHaveCount(1);
  expect(await item.getAttribute("title")).toContain("準備中");
  expect(await nav.innerText()).not.toContain("準備中");
});

test("KN105-004 左のバーを畳むと 56 のレールになり、開き直しても畳んだまま", async ({ page }) => {
  await open(page, 1440);
  const nav = page.getByRole("navigation", { name: "メニュー", exact: true });
  await page.getByRole("button", { name: "メニューを畳む" }).click();
  await expect.poll(() => nav.evaluate((e) => e.getBoundingClientRect().width)).toBe(56);
  await page.reload();
  await expect(page.getByRole("button", { name: "メニューを開く" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect.poll(() => nav.evaluate((e) => e.getBoundingClientRect().width)).toBe(216);
});

test("KN105-005 上の帯：いまの場所・探す・お知らせの数・自分のメニュー（設定と見た目）", async ({ page }) => {
  await open(page, 1440);
  const crumbs = page.getByRole("navigation", { name: "いまの場所" });
  await expect(crumbs.getByRole("link", { name: "チケット" })).toHaveAttribute("href", "/tickets");
  await expect(crumbs.getByText("自分に関わるもの")).toHaveAttribute("aria-current", "page");
  // 帯の題は見出し（h1）にしない（1 画面の h1 は本文の 1 つだけ・K-138）
  await expect(page.locator("header.k-bar .k-bar-title")).toHaveText("自分に関わるもの");
  await expect(page.locator("header.k-bar h1")).toHaveCount(0);
  const box = page.getByRole("searchbox", { name: "探す" });
  await box.fill("請求");
  await box.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "「請求」を探す" })).toBeVisible();
  await expect(page.getByRole("button", { name: "お知らせ（3 件）" })).toBeVisible();
  await page.getByRole("button", { name: "自分のメニュー" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "自分の設定" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "ログアウト" })).toBeVisible();
  await expect(menu.getByRole("radio", { name: "暗い" })).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("KN105-006 右のパネル：広い画面は既定で開き、閉じると本文が広がる。開き直しても閉じたまま", async ({ page }) => {
  await open(page, 1440);
  const panel = page.getByRole("complementary", { name: "自分の AI" });
  await expect(panel).toBeVisible();
  const before = await page.locator("#k-main").evaluate((e) => e.getBoundingClientRect().width);
  expect(before, "パネルを開いても本文は 720 以上（D-070）").toBeGreaterThanOrEqual(720);
  await page.getByRole("button", { name: "自分の AI のパネルを閉じる" }).click();
  await expect(panel).toBeHidden();
  expect(await page.locator("#k-main").evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(before);
  await page.reload();
  await expect(page.getByRole("complementary", { name: "自分の AI" })).toBeHidden();
  await page.getByRole("button", { name: "自分の AI のパネルを開く" }).click();
  await expect(page.getByRole("complementary", { name: "自分の AI" })).toBeVisible();
});

test("KN105-007 スマホ：左のバーは無く、下のタブ（チケット・承認・作る・AI・メニュー）。メニューで全部が出る", async ({
  page,
}) => {
  await open(page, 375);
  await expect(page.getByRole("navigation", { name: "メニュー", exact: true })).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "下のタブ" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: /チケット/ })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("button", { name: "チケットを作る" })).toBeVisible();
  await expect(page.locator("header.k-bar .k-bar-title")).toHaveText("自分に関わるもの");
  await expect(page.locator("header.k-bar h1")).toHaveCount(0);
  await tabs.getByRole("button", { name: "メニュー" }).click();
  const sheet = page.getByRole("navigation", { name: "メニュー（全部）" });
  await expect(sheet.getByRole("link", { name: /ワークスペースの管理/ })).toBeVisible();
  await expect(sheet.getByRole("link", { name: /営業/ })).toBeVisible();
});

test("KN105-008 キーボード：最初の Tab で「本文へ」が出て、押すと本文に移る", async ({ page }) => {
  await open(page, 1440);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "本文へ" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#k-main")).toBeFocused();
});

test("KN105-009 役割で主ナビが変わる（クライアントはクライアントの場所だけ・運営は運営だけ）", async ({ page }) => {
  await open(page, 1440, "?built=all&role=R4");
  const nav = page.getByRole("navigation", { name: "メニュー", exact: true });
  await expect(nav.getByRole("link", { name: /クライアントの場所/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /チケット/ })).toHaveCount(0);
  await open(page, 1440, "?built=all&role=R6");
  await expect(nav.getByRole("link", { name: /運営/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /ワークスペースの管理/ })).toHaveCount(0);
});
