// 段 9 のモックを全部の状態 × 幅 375・768・1440 で測り（撮るのは 375 と 1440）、横のはみ出し（scrollWidth − clientWidth）を測る。
//   apps/web の中で: node ../../07_functional/段9-F8/mock-shots.mjs <出す場所> [f8] [id の頭]（モックの置き場を 3449 で立ててから）
//   小窓が開いている状態は、画面の高さのまま撮る（中身だけがスクロールし、ボタンが下に残ることを見るため）。ボタンが画面の中にあるかも測る
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const out = process.argv[2];
const dir = process.argv[3] ?? "f8";
const head = process.argv[4] ?? "";
const src = readFileSync(`app/(dev)/dev/mock/${dir}/mocks.tsx`, "utf8");
const ids = [...src.matchAll(/\{\s*id: "([^"]+)",\s*screen/g)].map((m) => m[1]).filter((id) => id.startsWith(head));
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const res = [];
for (const w of [375, 768, 1440]) {
  const p = await b.newPage({ viewport: { width: w, height: w === 375 ? 812 : 900 } });
  for (const id of ids) {
    await p.goto(`http://localhost:3449/dev/mock/${dir}/${id}`, { waitUntil: "load", timeout: 180000 });
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
      const act = dlg?.querySelector(".k-dialog-actions");
      const r = act?.getBoundingClientRect();
      const tabs = [...document.querySelectorAll(".k-tabs-list")].map((t) => t.scrollWidth - t.clientWidth);
      return {
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tabsOver: Math.max(0, ...tabs),
        dialog: !!dlg,
        buttonsSeen: r ? r.top >= 0 && r.bottom <= innerHeight : null,
        h1: [...document.querySelectorAll("h1")].map((h) => h.textContent).join("|"),
      };
    });
    res.push({ id, w, ...m });
    // 固定の部品（左のメニュー・下のタブ）がページの途中に写らないように、画面の高さをページの高さに合わせてから撮る
    const base = w === 375 ? 812 : 900;
    const full = m.dialog ? base : await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: w, height: Math.max(base, full) });
    await p.waitForTimeout(150);
    if (w !== 768) await p.screenshot({ path: `${out}/${id}-${w}.png` });
    await p.setViewportSize({ width: w, height: base });
  }
  await p.close();
}
await b.close();
writeFileSync(`${out}/measure.json`, JSON.stringify(res, null, 1));
console.log(ids.length, "states;", "overflow>0:", res.filter((r) => r.over > 0 || r.tabsOver > 0).map((r) => `${r.id}@${r.w}:${r.over}/${r.tabsOver}`).join(" ") || "none");
console.log("buttons hidden:", res.filter((r) => r.buttonsSeen === false).map((r) => `${r.id}@${r.w}`).join(" ") || "none");
