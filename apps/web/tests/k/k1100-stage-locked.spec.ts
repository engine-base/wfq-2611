// K-1100「承認待ちの鍵の札が幅 375 で折り返さない・突き合わせの日付を止める」の試験（実 Chrome と、ファイルを読む試験・実装より先に積む）。
//   的：鍵の札（features/F6/progress/views.tsx の StageMenu の locked・progress.css の .k-prog-stage-locked）が、鍵の無い札と同じ幅になり、
//     チケットの詳細の頭の行（開始日・期限・段の札）が幅 375 で次の行へ落ちないこと。キャンバスの突き合わせ（G70・K238-VF-003 ticket-detail）の
//     「今」が止まっていて、期限の字がキャンバスと同じ「11/01（1 日過ぎ）」になること。
//   口は呼ばない（詳細は突き合わせの準備 tests/_lib/fidelity-states.ts の ticket-detail・モックは網の手前で 599）。本人の Bridge（127.0.0.1:38617）は 404。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { FIDELITY_STATES } from "../_lib/fidelity-states";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = join(HERE, "../../features/F6/progress/progress.css");

/** 鍵の札の幅と、同じ字の鍵の無い札（同じ親に置いた .k-detail-stage の複製）の幅・印が札の箱の中か */
async function lockedVsPlain(
  page: Page,
): Promise<{ locked: number; plain: number; iconInside: boolean; hasIcon: boolean }> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const el = document.querySelector<HTMLElement>(".k-prog-stage-locked")!;
    const a = el.getBoundingClientRect();
    const svg = el.querySelector("svg");
    const s = svg?.getBoundingClientRect();
    const plain = document.createElement("span");
    plain.className = "k-detail-stage";
    plain.dataset["stage"] = el.dataset["stage"] ?? "";
    plain.textContent = el.textContent ?? "";
    el.parentElement!.appendChild(plain);
    const b = plain.getBoundingClientRect();
    plain.remove();
    return {
      locked: a.width,
      plain: b.width,
      hasIcon: !!svg,
      iconInside: !!s && s.left >= a.left && s.right <= a.right && s.top >= a.top && s.bottom <= a.bottom,
    };
  });
}

async function openDetail(page: Page): Promise<void> {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await FIDELITY_STATES["ticket-detail"]!(page, "/tickets/{ticket}");
}

for (const w of [375, 1440]) {
  test(`K1100-UI-001 チケットの詳細（承認待ち・鍵の札）幅 ${w}：段の札は期限と同じ行に並び、頭の行は 1 行の高さのまま`, async ({
    browser,
  }) => {
    const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
    await openDetail(page);
    const r = await page.evaluate(() => {
      const side = document.querySelector<HTMLElement>(".k-detail-meta-side")!;
      const kids = [...side.children].map((c) => c.getBoundingClientRect());
      const stage = side.querySelector<HTMLElement>(".k-prog-stage-locked")!.getBoundingClientRect();
      return { centers: kids.map((k) => k.top + k.height / 2), stageCenter: stage.top + stage.height / 2 };
    });
    for (const c of r.centers) expect(Math.abs(c - r.stageCenter)).toBeLessThanOrEqual(2);
    await page.close();
  });

  test(`K1100-UI-002 モック /dev/mock/f6/prog-locked 幅 ${w}：鍵の札は鍵の印を持ち、印は札の箱の中、幅は同じ字の鍵の無い札と同じ（±0.5px）`, async ({
    browser,
  }) => {
    const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
    await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
    await page.route(/\/api\//, (route) => route.fulfill({ status: 599, body: "モックは口を呼ばない" }));
    const res = await page.goto("/dev/mock/f6/prog-locked");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator(".k-prog-stage-locked")).toHaveText("承認待ち");
    const r = await lockedVsPlain(page);
    expect(r.hasIcon).toBe(true);
    expect(r.iconInside).toBe(true);
    expect(Math.abs(r.locked - r.plain)).toBeLessThanOrEqual(0.5);
    await page.close();
  });
}

test("K1100-UI-003 突き合わせの準備 ticket-detail の「今」は止まっていて、期限の字はキャンバスと同じ「11/01（1 日過ぎ）」（今日の日付に依らない）", async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 } });
  await openDetail(page);
  await expect(page.locator(".k-detail-meta-side")).toContainText("期限 11/01（1 日過ぎ）");
  const year = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  expect(year).toBe("2026-11-02");
  await page.close();
});

test("K1100-UI-004 progress.css の鍵の札の規則は、余白と間を正本のトークン（--k-c-detail-stage-locked-pad・-gap）だけで読み、生の長さを書かない", () => {
  const css = readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /\.k-detail-stage\.k-prog-stage-locked\s*\{([^}]*)\}/.exec(css);
  expect(rule, "鍵の札の規則 .k-detail-stage.k-prog-stage-locked が無い").not.toBeNull();
  const body = rule![1]!;
  expect(body).toMatch(/padding:\s*var\(--k-c-detail-stage-locked-pad\)/);
  expect(body).toMatch(/gap:\s*var\(--k-c-detail-stage-locked-gap\)/);
  expect(body).not.toMatch(/\d+(\.\d+)?px/);
});
