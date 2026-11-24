// 外枠の並べ方（K-25）：flow.json の生成物（lib/nav.ts）から、役割ごとに左のバー・自分のメニュー・下のタブを決める
import { describe, expect, it } from "vitest";
import { navFor } from "../components/k/nav-model";
import { NAV } from "../lib/nav";

const ALL = Object.values(NAV.screens).map((s) => s.route);
const keys = (xs: { key: string }[]) => xs.map((x) => x.key);

describe("外枠の並べ方（K-25）", () => {
  it("代表（R1）：主ナビはチケット・承認待ち・AI・ナレッジ（取引先は持たない・answer=4961f0280e9a）。ワークスペースの管理は下、自分のメニューは右上", () => {
    const n = navFor("R1", { memberName: "高本", built: ALL, screen: "tickets" });
    expect(keys(n.main)).toEqual(["tickets", "approvals", "ai", "knowledge"]);
    expect(keys(n.bottom)).toEqual(["company"]);
    expect(n.main.find((x) => x.key === "ai")!.label).toBe("高本のAI");
    expect(n.main.filter((x) => x.current).map((x) => x.key)).toEqual(["tickets"]);
    expect(keys(n.me)).toEqual(expect.arrayContaining(["account", "notices"]));
    expect(keys(n.tabs)).toEqual(["tickets", "approvals", "ai"]);
  });
  it("どの役にも取引先が無い。クライアント（R4）はクライアントの場所だけ。運営（R6）は運営だけ", () => {
    for (const r of ["R1", "R2", "R3"] as const)
      expect(keys(navFor(r, { memberName: "a", built: ALL }).main), r).not.toContain("clients");
    const r4 = navFor("R4", { memberName: "a", built: ALL });
    expect(keys(r4.main)).toEqual(["portal"]);
    expect(r4.bottom).toEqual([]);
    expect(keys(navFor("R6", { memberName: "a", built: ALL }).main)).toEqual(["admin"]);
  });
  it("行き先は、その役割が入れる画面のうち、まとまりの先頭（入れない画面へは連れて行かない）", () => {
    const r1 = navFor("R1", { memberName: "a", built: ALL });
    const company = r1.bottom[0]!;
    const allowed = NAV.byRole["R1"]!;
    const target = Object.values(NAV.screens).find((s) => s.route === company.href)!;
    expect(allowed).toContain(target.id);
    for (const it of [...r1.main, ...r1.bottom, ...r1.me])
      expect(
        Object.values(NAV.screens).some((s) => s.route === it.href),
        it.key,
      ).toBe(true);
  });
  it("まだ作っていない画面は「準備中」（押させない）。数は渡したものだけ出る", () => {
    const n = navFor("R1", { memberName: "a", built: ["/tickets"], badges: { approvals: 2 } });
    expect(n.main.find((x) => x.key === "tickets")!.pending).toBe(false);
    expect(n.main.find((x) => x.key === "approvals")!.pending).toBe(true);
    expect(n.main.find((x) => x.key === "approvals")!.badge).toBe(2);
    expect(n.main.find((x) => x.key === "tickets")!.badge).toBeUndefined();
  });
});
