// K-638「リンクが無いとき、口は 409・E-PAGE-006」の画面の試験（実 Chrome）。行 ID（K638-UI-…）は 11_tickets/K-638.md の表と 1 対 1。
//   口（POST /api/v1/auth/password/reset・GET /api/v1/me）は網の手前で差し替える。本人の Bridge（127.0.0.1:38617）にも届かせない。
//   画面は状態コードでなく、答えの番号（E-PAGE-006・E-AUTH-006）で「正しくない」「もう使えない」を出し分ける。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ERRORS = JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
  errors: { id: string; message: string }[];
};
const msg = (id: string): string => {
  const e = ERRORS.errors.find((x) => x.id === id);
  if (!e) throw new Error(`errors.json に ${id} が無い`);
  return e.message;
};
const ROOT_SEL = '[data-auth="reset"]';
const TOKEN = "k638-dummy-link-for-the-screen-test";
const NEW_PW = "brand-new-password-638";
const DEAD_TEXT = "このリンクはもう使えません。もう一度、再設定メールを送ってください";

async function open(page: Page, reply: { status: number; body: unknown }): Promise<void> {
  const resets: unknown[] = [];
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route, req) => {
    const p = new URL(req.url()).pathname;
    let r = { status: 404, body: { code: "NOT_FOUND" } as unknown };
    if (req.method() === "POST" && p === "/api/v1/auth/password/reset") {
      resets.push(req.postDataJSON());
      r = reply;
    } else if (req.method() === "GET" && p === "/api/v1/me") {
      r = { status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } };
    } else if (p === "/api/auth/get-session") {
      r = { status: 200, body: { session: null, user: null } };
    }
    await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/password-reset?token=${TOKEN}`);
  await expect(page.locator(ROOT_SEL)).toHaveAttribute("data-state", "p");
  await page.getByLabel("新しいパスワード", { exact: true }).fill(NEW_PW);
  await page.getByLabel("もう一度", { exact: true }).fill(NEW_PW);
  await page.getByRole("button", { name: "パスワードを決める", exact: true }).click();
  await expect.poll(() => resets.length).toBe(1);
}

test("K638-UI-001 口が 409・E-PAGE-006（リンクが無い）：data-state invalid・正本 E-PAGE-006 の文。「もう使えない」の文は出ない", async ({
  page,
}) => {
  await open(page, { status: 409, body: { error: "not_found", code: "E-PAGE-006", message: msg("E-PAGE-006") } });
  const root = page.locator(ROOT_SEL);
  await expect(root).toHaveAttribute("data-state", "invalid");
  await expect(root).toContainText(msg("E-PAGE-006"));
  await expect(root).not.toContainText(DEAD_TEXT);
});

test("K638-UI-002 口が 410・E-AUTH-006（期限切れ・使い終わった）：data-state dead のまま（変えない）・「もう使えません」の文", async ({
  page,
}) => {
  await open(page, { status: 410, body: { error: "gone", code: "E-AUTH-006", message: msg("E-AUTH-006") } });
  const root = page.locator(ROOT_SEL);
  await expect(root).toHaveAttribute("data-state", "dead");
  await expect(root).toContainText(DEAD_TEXT);
});
