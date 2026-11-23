// 決定ログの画面の試験の道具（K-397 が持つ。K-398 も読む・替えない）。網の手前の差し替えと、詳細を開く手順と、区画の引き方。
//   詳細の口は前からの土台 tests/features/F5/approve-complete.harness.ts の mockApi で差し替え、本文に「決定ログ」の区画（鍵 decisions）を足す。
//   決定の口の形（正は口の葉 K-390・K-391 の md。K-397.md の「画面が読む値・送る値」）：
//     GET   /api/v1/tickets/:id/decisions   → { data: Decision[]（K-390 の 12 の鍵・source は {id, at, deleted}）, meta: { can_write } }
//     POST  /api/v1/tickets/:id/decisions   ← { text, reason, decided_by_member_id, decided_note, source_message_id? } → 201 { data: { decision, message_id } }
//     PATCH /api/v1/ticket_decisions/:id    ← { action: "revise", text, reason } | { action: "cancel", reason } → 200 { data: { decision, previous, message_id } }（K-398）
//   決めた人の候補は前からの口 GET /api/v1/members（scope_id は付けない・limit 200＝同じ会社の今のメンバー・作る画面の tickets-page.tsx と同じ読み方）。本人の Bridge（127.0.0.1:38617）には届かせない（土台が止める）。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, type Page, type Route } from "@playwright/test";
import { ME, TICKET, mockApi, ticketOf, withBand, type Band, type Mock } from "../features/F5/approve-complete.harness";

export { ME, TICKET };
export const SUZUKI = "11111111-0000-4000-8000-0000000000a2";
export const SATO = "11111111-0000-4000-8000-0000000000a3";
export const PEOPLE = [
  { id: ME, display_name: "高本 聖斗" },
  { id: SUZUKI, display_name: "鈴木 一郎" },
  { id: SATO, display_name: "佐藤 花子" },
];
export const MSG_ID = "0193c5a0-0000-7000-8000-0000000b0001";
export const MSG_ID2 = "0193c5a0-0000-7000-8000-0000000b0002";
/** 書いたときに口が返すやり取りの 1 行の id（K-390・K-391 の答えの message_id） */
export const MSG_LINE = "0193c5a0-0000-7000-8000-0000000b0099";

export interface Who {
  id: string;
  display_name: string;
}
/** K-390 の決定の答えの形（12 の鍵）。source は {id, at（元の書き込みの時刻）, deleted}（K-390.md・K390-API-006） */
export interface Decision {
  id: string;
  ticket_id: string;
  text: string;
  reason: string | null;
  decided_by: Who | null;
  decided_note: string | null;
  decided_at: string;
  source: { id: string; at: string; deleted: boolean } | null;
  revises_id: string | null;
  superseded_by_id: string | null;
  cancelled: { at: string; by: Who; reason: string } | null;
  promoted_to: "ticket";
}
export const who = (id: string): Who => ({ id, display_name: PEOPLE.find((p) => p.id === id)!.display_name });
/** 決定の状態（答えに status は無い：取り消したか・改められたかで決まる） */
export const statusOf = (d: Decision): "live" | "revised" | "cancelled" =>
  d.cancelled ? "cancelled" : d.superseded_by_id ? "revised" : "live";
export const dec = (o: Partial<Decision> & { id: string; text: string }): Decision => ({
  ticket_id: TICKET,
  reason: null,
  decided_by: who(ME),
  decided_note: null,
  decided_at: "2026-11-01T01:00:00Z",
  source: null,
  revises_id: null,
  superseded_by_id: null,
  cancelled: null,
  promoted_to: "ticket",
  ...o,
});
/** モック dec-log と同じ 4 件（生きている 2・改められた 1・取り消した 1）。口の順はわざと崩す（並べるのは画面） */
export const D3 = dec({
  id: "0193c5a0-0000-7000-8000-0000000d0003",
  text: "10/19 の追加対応は無償。11 月分の請求から外す",
  reason: "先方の都合による作業のため",
  decided_by: who(SUZUKI),
  decided_note: "先方と合意",
  decided_at: "2026-11-01T02:00:00Z",
  source: { id: MSG_ID, at: "2026-11-01T01:20:00Z", deleted: false }, // 日本時間 11/01 10:20
});
export const D2 = dec({
  id: "0193c5a0-0000-7000-8000-0000000d0002",
  text: "支払期日は月末締め翌月末",
  reason: "山田様から了承",
  decided_at: "2026-10-28T05:02:00Z",
  source: { id: MSG_ID2, at: "2026-10-28T05:02:00Z", deleted: false }, // 10/28 14:02
  revises_id: "0193c5a0-0000-7000-8000-0000000d0001",
});
export const D1 = dec({
  id: "0193c5a0-0000-7000-8000-0000000d0001",
  text: "支払期日は月末締め翌々月 10 日",
  decided_at: "2026-10-20T01:00:00Z",
  superseded_by_id: D2.id,
});
export const D0 = dec({
  id: "0193c5a0-0000-7000-8000-0000000d0000",
  text: "請求書は郵送もする",
  decided_by: who(SATO),
  decided_at: "2026-10-21T01:00:00Z",
  cancelled: { at: "2026-10-22T01:00:00Z", by: who(SATO), reason: "先方がメールだけでよいと言ったため" },
});
export const FOUR = [D1, D0, D3, D2];

export interface Reply {
  status: number;
  body: unknown;
}
export interface DecOptions {
  list?: Decision[];
  canWrite?: boolean;
  /** 作るときに「決定ログ」に書いた字（null は区画が空・"none" は種別に区画が無い） */
  intro?: string | null | "none";
  stage?: string;
  /** モックと同じ題名・番号・区画にする（見比べ） */
  asMock?: boolean;
}
export interface DecMock {
  m: Mock;
  list: Decision[];
  canWrite: boolean;
  reads: number;
  memberReads: number;
  /** 人の一覧の口の問い合わせ（URL の search。scope_id が無いことを見る） */
  memberQueries: URLSearchParams[];
  posts: Record<string, unknown>[];
  patches: { id: string; body: Record<string, unknown> }[];
  /** 次の答え（順に使う）。"abort" は網の切れ */
  failRead: (Reply | "abort")[];
  failWrite: (Reply | "abort")[];
  failMembers: Reply[];
  /** 書く口の答えを止める。返した関数を呼ぶと答える（時間で待たない） */
  hold: () => () => void;
  /** 書いた後に一覧へ入れる（試験が答えを替えたいとき） */
  afterWrite?: (d: DecMock) => void;
}

export function detailWithDecisions(o: DecOptions): object {
  const b: Band = { stage: o.stage ?? "doing", can_complete: false };
  const base = ticketOf(b) as unknown as Record<string, unknown> & {
    ticket: Record<string, unknown>;
    sections: unknown[];
  };
  const intro = o.intro === undefined ? "支払いは銀行振込" : o.intro;
  const decisions =
    intro === "none"
      ? []
      : [{ key: "decisions", label: "決定ログ", body: intro === null ? null : { text: intro }, version: 1 }];
  const sections = o.asMock
    ? [
        {
          key: "purpose",
          label: "目的",
          body: { text: "セイコー様に 11 月分の請求書を、期日までに PDF で送る。" },
          version: 1,
        },
        {
          key: "done",
          label: "完了の条件",
          body: { text: "請求書の PDF を作り、先方の担当（山田様）にメールで送ったこと。" },
          version: 1,
        },
        ...decisions,
      ]
    : [...base.sections, ...decisions];
  return withBand(b, {
    ...base,
    ticket: {
      ...base.ticket,
      start_on: "2026-10-30",
      created_at: "2026-10-30T08:44:00Z",
      ...(o.asMock ? { number: "EG-128", title: "セイコー様へ 11 月分の請求書を送る" } : {}),
    },
    kind: { name: "タスク", color: "#22345C" },
    stage: { key: o.stage ?? "doing", name: "作業中" },
    sections,
  });
}

const json = (route: Route, r: Reply) =>
  route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });

/** 詳細と決定の口と人の一覧の口を差し替える（後から足した差し替えが先に当たる。合わない物は土台へ回す） */
export async function decisionsApi(page: Page, o: DecOptions = {}): Promise<DecMock> {
  const m = await mockApi(page, { stage: o.stage ?? "doing" });
  let gate: Promise<void> = Promise.resolve();
  const d: DecMock = {
    m,
    list: [...(o.list ?? FOUR)],
    canWrite: o.canWrite ?? true,
    reads: 0,
    memberReads: 0,
    memberQueries: [],
    posts: [],
    patches: [],
    failRead: [],
    failWrite: [],
    failMembers: [],
    hold: () => {
      let open = () => {};
      gate = new Promise<void>((r) => (open = r));
      return () => open();
    },
  };
  m.on.ticket = () => ({ status: 200, body: { data: detailWithDecisions(o) } });
  await page.route(`**/api/v1/tickets/${TICKET}/decisions`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "GET") {
      d.reads++;
      const f = d.failRead.shift();
      if (f === "abort") return route.abort("failed");
      if (f) return json(route, f);
      return json(route, { status: 200, body: { data: d.list, meta: { can_write: d.canWrite } } });
    }
    if (req.method() !== "POST") return route.fallback();
    const body = req.postDataJSON() as Record<string, unknown>;
    d.posts.push(body);
    await gate;
    const f = d.failWrite.shift();
    if (f === "abort") return route.abort("failed");
    if (f) return json(route, f);
    const made = dec({
      id: `0193c5a0-0000-7000-8000-0000000e${String(d.posts.length).padStart(4, "0")}`,
      text: String(body["text"]),
      reason: (body["reason"] as string | null) ?? null,
      decided_by: who(String(body["decided_by_member_id"])),
      decided_note: (body["decided_note"] as string | null) ?? null,
      decided_at: new Date().toISOString(),
      source:
        typeof body["source_message_id"] === "string"
          ? { id: body["source_message_id"], at: "2026-11-01T01:20:00Z", deleted: false }
          : null,
    });
    d.list = [made, ...d.list];
    d.afterWrite?.(d);
    return json(route, { status: 201, body: { data: { decision: made, message_id: MSG_LINE } } });
  });
  await page.route("**/api/v1/ticket_decisions/*", async (route: Route) => {
    const req = route.request();
    if (req.method() !== "PATCH") return route.fallback();
    const id = new URL(req.url()).pathname.split("/").at(-1)!;
    const body = req.postDataJSON() as Record<string, unknown>;
    d.patches.push({ id, body });
    await gate;
    const f = d.failWrite.shift();
    if (f === "abort") return route.abort("failed");
    if (f) return json(route, f);
    const old = d.list.find((x) => x.id === id)!;
    if (body["action"] === "cancel") {
      const done: Decision = {
        ...old,
        cancelled: { at: new Date().toISOString(), by: who(ME), reason: String(body["reason"]) },
      };
      d.list = d.list.map((x) => (x.id === id ? done : x));
      d.afterWrite?.(d);
      return json(route, { status: 200, body: { data: { decision: done, previous: null, message_id: MSG_LINE } } });
    }
    const next = dec({
      id: `0193c5a0-0000-7000-8000-0000000f${String(d.patches.length).padStart(4, "0")}`,
      text: String(body["text"]),
      reason: (body["reason"] as string | null) ?? null,
      decided_at: new Date().toISOString(),
      revises_id: id,
    });
    d.list = [next, ...d.list.map((x) => (x.id === id ? { ...x, superseded_by_id: next.id } : x))];
    d.afterWrite?.(d);
    return json(route, {
      status: 200,
      body: { data: { decision: next, previous: { ...old, superseded_by_id: next.id }, message_id: MSG_LINE } },
    });
  });
  await page.route("**/api/v1/members*", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    d.memberReads++;
    d.memberQueries.push(new URL(route.request().url()).searchParams);
    const f = d.failMembers.shift();
    if (f) return json(route, f);
    return json(route, { status: 200, body: { data: PEOPLE, meta: { limit: 200 } } });
  });
  return d;
}

export const openDetail = async (page: Page, width = 1440) => {
  await page.setViewportSize({ width, height: 1000 });
  const res = await page.goto(`/tickets/${TICKET}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};
/** 本文の決定ログの区画（見出しの id は sec-decisions） */
export const logSec = (page: Page) =>
  page.locator("section:has(> .k-dec-head #sec-decisions), section:has(#sec-decisions)").first();
export const items = (page: Page) => logSec(page).locator(".k-dec-item");
export const addBtn = (page: Page) => logSec(page).getByRole("button", { name: "＋ 決定を足す" });
export const addDialog = (page: Page) => page.getByRole("dialog", { name: "決定を足す" });
/** 小窓の中の欄（決めたこと・決めた人・ひとこと・理由） */
export const textBox = (page: Page, dialogName: string) =>
  page.getByRole("dialog", { name: dialogName }).getByRole("textbox", { name: /決めたこと/ });
