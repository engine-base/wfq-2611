// 段 7 のやり取り（チケットの詳細の右のパネルのタブ「やり取り」）の画面の試験の共通の道具（K-392 が持つ。K-393・K-394・K-396 の試験が読むだけで使う）。
//   詳細の画面は前からの土台 tests/features/F5/approve-complete.harness.ts（mockApi・openTicket・ticketOf）で開き、
//   やり取りの口（読む・最後に開いた時刻を書く・書く・直す・消す・☆）だけを、その後に足した差し替えで答える（後に足した差し替えが先に効く）。
//   答えの形は口の葉 K-383（読む）・K-384（最後に開いた時刻）・K-385（書く）・K-386（直す・消す・☆）・K-389（書き込みと一緒に段を変える）の md の
//   「答えの形」に合わせる（切る段で合わせた・名前が変わったら、ここだけを直す）。
//   見本の値はモック /dev/mock/f6 の talk-* の状態と同じ（名前・時刻・本文）。日付の曜日をモックの字（10/28（火）・10/30（木）・11/01（土））に合わせるため、
//   見本の時刻は 2025 年に置く（画面は年を出さない・時刻は日本時間で出す）。
//   固定の待ちは使わない（答えと移り終わりを待つ）。書く口の答えは hold() で止めておき、返した関数を呼ぶと答える（時間で待たない）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, type Locator, type Page, type Request, type Route } from "@playwright/test";
import type { FidelityPair } from "../../../../scripts/ci/fidelity_compare.mjs";
import {
  ME,
  TICKET,
  mockApi,
  openTicket,
  ticketOf,
  withBand,
  type Band,
  type Mock,
} from "../features/F5/approve-complete.harness";

export { ME, TICKET };

// ---------------------------------------------------------------- 人（そのチケットを見られる人＝答えの meta.people）
export const SUZU = "11111111-0000-4000-8000-000000000003";
export const SATO = "11111111-0000-4000-8000-000000000004";
export const KEN = "11111111-0000-4000-8000-000000000005";
/** そのチケットを見られない人（候補に出てはいけない） */
export const OUTSIDER = "11111111-0000-4000-8000-000000000006";

export interface Who {
  member_id: string;
  display_name: string;
  call_name: string | null;
}
export const TAKA_W: Who = { member_id: ME, display_name: "高本 聖斗", call_name: "高本" };
export const SUZU_W: Who = { member_id: SUZU, display_name: "鈴木 一郎", call_name: "鈴木" };
export const SATO_W: Who = { member_id: SATO, display_name: "佐藤 花子", call_name: "佐藤" };
export const KEN_W: Who = { member_id: KEN, display_name: "鈴木 健", call_name: null };

export interface PersonRow extends Who {
  /** 候補の右の小さな字（担当者・承認する人・グループの名前） */
  label: string;
  is_assignee: boolean;
  is_approver: boolean;
}
/** 見られる人（見ている人 高本 を含む）。担当者＝鈴木・承認する人＝佐藤（モックの DEFAULT_NOTIFY と同じ） */
export const PEOPLE: PersonRow[] = [
  { ...TAKA_W, label: "経理グループ", is_assignee: false, is_approver: false },
  { ...SUZU_W, label: "担当者", is_assignee: true, is_approver: false },
  { ...SATO_W, label: "承認する人", is_assignee: false, is_approver: true },
  { ...KEN_W, label: "経理グループ", is_assignee: false, is_approver: false },
];

// ---------------------------------------------------------------- やり取りの 1 件（TimelineItem・K-383）
/** 日本時間の「YYYY-MM-DD HH:MM」を ISO（UTC）に */
export const jstAt = (s: string) => new Date(`${s.replace(" ", "T")}:00+09:00`).toISOString();

export interface MessageView {
  body: string;
  mentions: Who[];
  notified: Who[];
  quote: { id: string; excerpt: string } | null;
  edited_at: string | null;
  stars: number;
  starred: boolean;
  is_new: boolean;
  decided: boolean;
  can_edit: boolean;
  can_delete: boolean;
}
export interface TimelineItem {
  id: string;
  kind: "post" | "change" | "system" | "run" | "deleted";
  at: string;
  actor: Who | null;
  message: MessageView | null;
  changes: { field: string; from: string | null; to: string | null; note?: string | null }[] | null;
  run: {
    id: string;
    summary: string;
    started_at: string;
    finished_at: string | null;
    minutes: number | null;
    result: string;
  } | null;
  deleted: { by: Who; author: Who; by_manager: boolean } | null;
}

let seq = 0;
const nid = () => `0193c5a0-0000-7000-8000-${String(++seq).padStart(12, "0")}`;

export function post(
  who: Who,
  at: string,
  body: string,
  o: Partial<MessageView> & { id?: string; changes?: TimelineItem["changes"] } = {},
): TimelineItem {
  const { id, changes, ...m } = o;
  return {
    id: id ?? nid(),
    kind: "post",
    at: jstAt(at),
    actor: who,
    message: {
      body,
      mentions: [],
      notified: [],
      quote: null,
      edited_at: null,
      stars: 0,
      starred: false,
      is_new: false,
      decided: false,
      can_edit: who.member_id === ME,
      can_delete: who.member_id === ME,
      ...m,
    },
    changes: changes ?? null,
    run: null,
    deleted: null,
  };
}
export const change = (who: Who, at: string, changes: NonNullable<TimelineItem["changes"]>): TimelineItem => ({
  id: nid(),
  kind: "change",
  at: jstAt(at),
  actor: who,
  message: null,
  changes,
  run: null,
  deleted: null,
});
export const system = (who: Who | null, at: string, body: string): TimelineItem => ({
  id: nid(),
  kind: "system",
  at: jstAt(at),
  actor: who,
  message: {
    body,
    mentions: [],
    notified: [],
    quote: null,
    edited_at: null,
    stars: 0,
    starred: false,
    is_new: false,
    decided: false,
    can_edit: false,
    can_delete: false,
  },
  changes: null,
  run: null,
  deleted: null,
});
/** result は実行の状態の鍵（done・running・asking・stopped・cancelled・failed・K-383）。字（通った など）にするのは画面 */
export const runItem = (
  who: Who,
  start: string,
  end: string,
  minutes: number,
  summary: string,
  result = "done",
): TimelineItem => ({
  id: nid(),
  kind: "run",
  at: jstAt(start),
  actor: who,
  message: null,
  changes: null,
  run: { id: nid(), summary, started_at: jstAt(start), finished_at: jstAt(end), minutes, result },
  deleted: null,
});
export const deleted = (by: Who, author: Who, at: string, byManager = false): TimelineItem => ({
  id: nid(),
  kind: "deleted",
  at: jstAt(at),
  actor: by,
  message: null,
  changes: null,
  run: null,
  deleted: { by, author, by_manager: byManager },
});

// ---------------------------------------------------------------- 見本のやり取り（モックの THREAD_FULL・THREAD_PS0 と同じ）
export const P_TAKA_ID = "0193c5a0-0000-7000-8000-0000000f0001";
export const P_SUZU_ID = "0193c5a0-0000-7000-8000-0000000f0002";
export const P_SATO_ID = "0193c5a0-0000-7000-8000-0000000f0003";
export const P_TAKA = () =>
  post(TAKA_W, "2025-10-28 14:02", "山田様から、支払期日は月末締め翌月末でよいと返事がありました。", {
    id: P_TAKA_ID,
    notified: [SUZU_W],
    stars: 1,
    decided: true,
  });
export const P_SUZU = () =>
  post(
    SUZU_W,
    "2025-11-01 10:20",
    "10/19 の追加対応は無償にした件、反映が要るかもしれません。@高本 さん確認お願いします",
    {
      id: P_SUZU_ID,
      mentions: [TAKA_W],
      notified: [TAKA_W, SATO_W],
    },
  );
export const P_SATO_NEW = () =>
  post(SATO_W, "2025-11-01 10:41", "無償で合意済みなら外して OK です。今日中に出せると助かります", {
    id: P_SATO_ID,
    notified: [TAKA_W, SUZU_W],
    is_new: true,
    changes: [{ field: "stage", from: "作業中", to: "保留" }],
  });
export const CREATED = () => system(TAKA_W, "2025-10-30 17:44", "高本 がチケットを作った");
export const THREAD_FULL = (): TimelineItem[] => [
  P_TAKA(),
  CREATED(),
  change(TAKA_W, "2025-10-30 17:50", [{ field: "stage", from: "未着手", to: "作業中" }]),
  runItem(TAKA_W, "2025-11-01 09:00", "2025-11-01 09:12", 12, "請求書を作り、確認を流した"),
  P_SUZU(),
  P_SATO_NEW(),
];
export const THREAD_PS0 = (): TimelineItem[] => [CREATED()];

export interface Page1Meta {
  limit: number;
  older_count: number;
  new_count: number;
  mine_count: number;
  post_count: number;
  people?: PersonRow[];
}
export const meta = (o: Partial<Page1Meta> = {}): Page1Meta => ({
  limit: 20,
  older_count: 0,
  new_count: 0,
  mine_count: 0,
  post_count: 0,
  people: PEOPLE,
  ...o,
});

// ---------------------------------------------------------------- 口の差し替え
export type Reply = { status: number; body: unknown };
export const ok = (data: unknown, m: Record<string, unknown> = {}): Reply => ({ status: 200, body: { data, meta: m } });
export const err = (status: number, code: string): Reply => ({ status, body: { error: code.toLowerCase(), code } });

export interface ThreadMock {
  /** 読む口の問い合わせ（道の後ろの ?… を URLSearchParams で） */
  reads: URLSearchParams[];
  seen: number;
  posts: { body: Record<string, unknown>; key: string | undefined }[];
  edits: { id: string; body: Record<string, unknown> }[];
  deletes: string[];
  stars: string[];
  /** 書く口（書く・直す・消す・☆）の答えを止める。返した関数を呼ぶと答える */
  hold: () => () => void;
  on: {
    timeline: (q: URLSearchParams) => Reply | Promise<Reply>;
    seen: () => Reply | Promise<Reply>;
    post: (body: Record<string, unknown>) => Reply | Promise<Reply>;
    edit: (id: string, body: Record<string, unknown>) => Reply | Promise<Reply>;
    del: (id: string) => Reply | Promise<Reply>;
    star: (id: string) => Reply | Promise<Reply>;
  };
  /** 土台の差し替え（詳細・実行・/me） */
  base: Mock;
}

export interface ThreadOptions {
  band?: Band;
  /** 詳細の答えに重ねる値（can.progress など・K-387） */
  extra?: Record<string, unknown>;
  items?: TimelineItem[];
  meta?: Partial<Page1Meta>;
}

/** 詳細を開く前に呼ぶ。詳細の答えは土台の ticketOf に extra を重ねる */
export async function mockThread(page: Page, o: ThreadOptions = {}): Promise<ThreadMock> {
  const band = o.band ?? { stage: "doing" };
  const base = await mockApi(page, band);
  const detail = ticketOf(band) as unknown as Record<string, unknown>;
  base.on.ticket = () => ({ status: 200, body: { data: withBand(band, { ...detail, ...(o.extra ?? {}) }) } });
  const items = o.items ?? THREAD_FULL();
  const m1 = meta({ post_count: items.filter((i) => i.kind === "post").length, ...(o.meta ?? {}) });
  let gate = Promise.resolve();
  const t: ThreadMock = {
    reads: [],
    seen: 0,
    posts: [],
    edits: [],
    deletes: [],
    stars: [],
    hold: () => {
      let open = () => {};
      gate = new Promise<void>((r) => (open = r));
      return () => open();
    },
    on: {
      timeline: () => ok(items, m1 as unknown as Record<string, unknown>),
      seen: () => ({ status: 201, body: { data: { ticket_id: TICKET, seen_at: new Date().toISOString() } } }),
      post: (b) =>
        ({
          status: 201,
          body: { data: post(TAKA_W, "2025-11-01 11:02", String(b["body"] ?? ""), { notified: [SUZU_W, SATO_W] }) },
        }) as Reply,
      edit: (id, b) => ({
        status: 200,
        body: {
          data: post(TAKA_W, "2025-11-01 11:02", String(b["body"] ?? ""), { id, edited_at: jstAt("2025-11-01 11:05") }),
        },
      }),
      del: (id) => ({ status: 200, body: { data: { ...deleted(TAKA_W, TAKA_W, "2025-11-01 11:09"), id } } }),
      star: (id) => ({ status: 200, body: { data: { id, stars: 2, starred: true } } }),
    },
    base,
  };
  const reply = async (route: Route, r: Reply) =>
    route.fulfill({
      status: r.status,
      contentType: "application/json",
      body: r.status === 204 ? "" : JSON.stringify(r.body),
    });
  await page.route(new RegExp(`/api/v1/tickets/${TICKET}/timeline(\\?|$)`), async (route, req) => {
    const q = new URL(req.url()).searchParams;
    t.reads.push(q);
    return reply(route, await t.on.timeline(q));
  });
  await page.route(new RegExp(`/api/v1/tickets/${TICKET}/timeline/seen$`), async (route) => {
    t.seen++;
    return reply(route, await t.on.seen());
  });
  await page.route(new RegExp(`/api/v1/tickets/${TICKET}/messages$`), async (route, req: Request) => {
    if (req.method() !== "POST") return route.fallback();
    const b = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    t.posts.push({ body: b, key: req.headers()["idempotency-key"] });
    await gate;
    return reply(route, await t.on.post(b));
  });
  await page.route(/\/api\/v1\/ticket_messages\/[^/]+(\/star)?$/, async (route, req: Request) => {
    const p = new URL(req.url()).pathname;
    const id = p.split("/")[4]!;
    if (req.method() === "POST" && p.endsWith("/star")) {
      t.stars.push(id);
      await gate;
      return reply(route, await t.on.star(id));
    }
    if (req.method() === "PATCH") {
      const b = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      t.edits.push({ id, body: b });
      await gate;
      return reply(route, await t.on.edit(id, b));
    }
    if (req.method() === "DELETE") {
      t.deletes.push(id);
      await gate;
      return reply(route, await t.on.del(id));
    }
    return route.fallback();
  });
  return t;
}

// ---------------------------------------------------------------- 画面の場所
export const panel = (page: Page) => page.getByRole("complementary", { name: "チケットのパネル" });
export const tabs = (page: Page) => panel(page).getByRole("navigation", { name: "パネルのタブ" });
export const talkTab = (page: Page) => tabs(page).getByRole("button", { name: /^やり取り/ });
export const feed = (page: Page) => panel(page).getByRole("feed", { name: "やり取り" });
export const postOf = (page: Page, name: string, time: string) =>
  panel(page).getByRole("article", { name: `${name} ${time}`, exact: true });
export const box = (page: Page) => panel(page).getByRole("textbox", { name: "書き込み", exact: true });
export const sendBtn = (page: Page) => panel(page).locator(".k-talk-send button").last();

/** 詳細を開く（土台の openTicket）。読む口の最初の答えが届くまで返らない */
export async function openDetail(page: Page, width = 1440): Promise<void> {
  const read = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/v1/tickets/${TICKET}/timeline` && r.request().method() === "GET",
  );
  await openTicket(page, width);
  await read;
}
/** 詳細を開いてタブ「やり取り」を押す。一覧（か空・読めない）が出るまで返らない */
export async function openThread(page: Page, width = 1440): Promise<void> {
  await openDetail(page, width);
  await talkTab(page).click();
  await expect(talkTab(page)).toHaveAttribute("aria-current", "page");
  await expect(panel(page).locator(".k-talk-thread").first()).toBeVisible();
}

// ---------------------------------------------------------------- モックと本番の突き合わせ（共通の道具 matchMock・base /dev/mock/f6）
export const MOCK_BASE = "/dev/mock/f6";
const BOX = ["width", "height", "x", "y", "background-color", "border-top-color", "border-top-left-radius"];
const TXT = ["font-size", "font-weight", "color", "line-height", "texts"];
const P = "aside.k-detail-panel";
/** 狭い幅（1023 以下）はパネルが本文の下に回り、本文の長さ（モックと本番で区画が違う）で上下が変わるので、y はパネルの上端から読む */
const Y_FROM = {
  max_width: 1440,
  canvas: P,
  app: P,
  why: "パネルの上の本文の区画の数がモックと本番で違う（決定ログの区画・実施事項）ので、パネルの中の上下だけを比べる",
};
export const pair = (name: string, sel: string, props: string[], yFrom = true): FidelityPair =>
  ({ name, role: name, canvas: sel, app: sel, props, ...(yFrom ? { y_from: Y_FROM } : {}) }) as FidelityPair;
/** 読む側の役（K-392） */
export const READ_PAIRS: FidelityPair[] = [
  pair("talk-tabs", `${P} .k-detail-tabs button`, ["x", "y", "font-size", "color", "texts"]),
  pair("talk-count", `${P} .k-talk-count`, [...BOX, "font-size", "color", "texts"]),
  pair("talk-chip", `${P} .k-talk-chip`, [...BOX, "font-size", "color", "texts"]),
  pair("talk-order", `${P} .k-talk-order`, ["x", "y", "font-size", "color", "texts"]),
  pair("talk-more", `${P} .k-talk-more`, [...BOX, "font-size", "texts"]),
  pair("talk-day", `${P} .k-talk-day`, ["x", "y", ...TXT]),
  pair("talk-post", `${P} .k-talk-post`, ["width", "x", "y"]),
  pair("talk-post-head", `${P} .k-talk-post-head`, ["x", "y", ...TXT]),
  pair("talk-body", `${P} .k-talk-body`, ["x", "y", "width", ...TXT]),
  pair("talk-new", `${P} .k-talk-new`, [...BOX, "font-size", "color", "texts"]),
  pair("talk-changes", `${P} .k-talk-changes`, ["x", "y", "font-size", "color", "texts"]),
  pair("talk-acts", `${P} .k-talk-act`, ["x", "y", "font-size", "color", "texts"]),
  pair("talk-line", `${P} .k-talk-line`, ["x", "y", "width", ...TXT]),
  pair("talk-run", `${P} .k-talk-run`, [...BOX, "texts"]),
  pair("talk-center", `${P} .k-talk-center`, ["x", "y", "width", "font-size", "color", "texts"]),
  pair("talk-jump", ".k-talk-jump", ["width", "height", "x", "font-size", "color", "texts"], false),
];
/** 書く欄の役（K-393・K-396） */
export const COMPOSE_PAIRS: FidelityPair[] = [
  pair("talk-composer", `${P} .k-talk-composer`, ["width", "x", "y", "background-color", "border-top-color"]),
  pair("talk-box", `${P} .k-talk-box`, [...BOX]),
  pair("talk-textarea", `${P} .k-talk-box textarea`, ["width", "height", "x", "y", "font-size", "color"]),
  pair("talk-tools", `${P} .k-talk-tools button`, ["x", "y", "font-size", "texts"]),
  pair("talk-mentions", `${P} .k-talk-mentions`, [...BOX, "texts"]),
  pair("talk-hold", `${P} .k-talk-hold label`, ["x", "y", ...TXT]),
  pair("talk-notify", `${P} .k-talk-notify-who`, [...BOX, "font-size", "texts"]),
  pair("talk-send", `${P} .k-talk-send button`, [
    "width",
    "height",
    "x",
    "y",
    "font-size",
    "color",
    "background-color",
    "texts",
  ]),
  pair("talk-callout", `${P} .k-talk-composer [role="alert"], ${P} .k-talk-composer .k-callout`, [
    "x",
    "y",
    "width",
    "font-size",
    "color",
    "texts",
  ]),
  pair("talk-sub", `${P} .k-talk-composer > p.k-talk-sub`, ["x", "y", "font-size", "color", "texts"]),
];
/** 直す・消すの役（K-394）。小窓は頁の上に出るので y はそのまま */
export const EDIT_PAIRS: FidelityPair[] = [
  pair("talk-menu", ".k-talk-menu", ["width", "background-color", "texts"], false),
  pair("talk-edit-acts", `${P} .k-talk-edit-acts button`, ["x", "y", "width", "height", "font-size", "texts"]),
  pair("dlg", ".k-dialog", [...BOX], false),
  pair("dlg-title", ".k-dialog .k-dialog-title", ["x", "y", ...TXT], false),
  pair("dlg-quote", ".k-dialog .k-talk-quote", ["x", "y", "width", ...TXT], false),
  pair("dlg-btn", ".k-dialog .k-dialog-actions button", ["x", "y", "width", "height", "font-size", "texts"], false),
];

/** 横溢れ（scrollWidth − clientWidth） */
export const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** 要素の計算後の値 */
export const cssOf = (loc: Locator, prop: string) =>
  loc.first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
