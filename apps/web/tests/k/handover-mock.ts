// 段 9（F8 渡す・配る）の画面の葉（K-411・K-412・K-413・K-414・K-415）が読む試験の道具（K-400 が切る段で作り carry で運ぶ・2026-11-20）。
//   口は網の手前で差し替える。土台は前からの tests/features/F5/approve-complete.harness.ts の mockApi（詳細・承認待ち・me・実行）で、
//   ここはその上に渡しの口だけを足す（後から足した page.route が先に当たる。渡しの道でなければ route.fallback() で土台へ回す）。
//   口の形は口の葉の md（2026-11-20 の切る段で同時に書いた 11_tickets/K-401・K-402・K-403・K-405・K-406・K-407）に合わせた。形が変わったらここだけを直す：
//     GET   /api/v1/tickets/:id/handover-preview → { data: Preview }（K-401 の HandoverPreview・鍵 10）
//     POST  /api/v1/tickets/:id/handovers        ← PassBody（頭 idempotency-key）→ 201 { data: Created }（K-401 の成功の答え・鍵 16・from/to は {id,name}）
//     PATCH /api/v1/ticket_handovers/:id         ← { decision: "accept" } | { decision: "decline", decline_reason } → 200 { data: Created }（K-403・K-408・K-409。
//                                                   グループに配られた渡しの「自分が持つ」も { decision: "accept" }・K-410）
//     GET   /api/v1/tickets/:id/handovers        → { data: HView[], meta: { limit: 50 } }（K-405 の TicketHandover・新しい順・今の渡しが先頭）。
//                                                   詳細を開いたときは呼ばない（記録を開いたときだけ・PM の決め 2026-11-20）
//     GET   /api/v1/tickets/:id（getTicket）       → 前からの答えに handover（今の渡し 1 件・HView か null）と handover_kinds（見ている人が
//                                                   できる種類・下見の kinds と同じ app.handover_kinds）を足す（K-405。詳細の口の数は 6 のまま）。
//                                                   帯・担当者の欄・入口（▾／申し出）は、この 2 つだけで決める（役の名前を見ない・PM の決め）
//     POST  /api/v1/ticket_handovers/:id/withdraw ← {} → 201 { data: { id, state, decided_at } }（K-406）
//     POST  /api/v1/ticket_handovers/:id/remind   ← {} → 201 { data: { id, reminded_at }, meta: { mail: "sent" | "failed" } }（K-406）
//     POST  /api/v1/ticket_handovers/:id/claim    ← { member_id }（人を決める）→ 200 { data: { id, state, ticket_id, assignee_member_id } }（K-410）
//     失敗は KanameError の形 { error, code, message, detail: { 名前, 訳, 状態 … } }（文の {名前} {訳} は detail から入れる）
//     期限切れは読む口の答えの overdue（K-405・K-407）。画面は手元の時計で決めない
//   名前と日付はモック（apps/web/app/(dev)/dev/mock/f8/mocks.tsx）と同じにする（matchMock で字を比べるため）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, type Page, type Request, type Route } from "@playwright/test";
import {
  API_RE,
  ME,
  TICKET,
  mockApi,
  ticketOf,
  withBand,
  type Band,
  type Mock,
  type Reply,
} from "../features/F5/approve-complete.harness";
import type { FidelityPair } from "../../../../scripts/ci/fidelity_compare.mjs";

/** 見ている人の既定（高本・土台と同じ id）。画面の葉の試験が読む */
export { ME };

/** モックの人（mocks.tsx の MEMBERS と同じ名前・メール） */
export const SATO = "11111111-0000-4000-8000-000000000003";
export const SUZUKI = "11111111-0000-4000-8000-000000000004";
export const TANAKA = "11111111-0000-4000-8000-000000000005";
export const KIMURA = "11111111-0000-4000-8000-000000000006";
export const YAMAGUCHI = "11111111-0000-4000-8000-000000000007";
export const HND = "0193c5a0-0000-7000-8000-0000000f0001";
export const HND_OLD = "0193c5a0-0000-7000-8000-0000000f0002";
/** 別の人にしたときの新しい渡し（K-413） */
export const HND_NEXT = "0193c5a0-0000-7000-8000-0000000f0004";

export const NAME: Record<string, string> = {
  [ME]: "高本 聖斗",
  [SATO]: "佐藤 花子",
  [SUZUKI]: "鈴木 一郎",
  [TANAKA]: "田中 美咲",
  [KIMURA]: "木村 誠",
  [YAMAGUCHI]: "山口 健",
};
/** 見ている人の役（本物の /me の role_id＝members.role_id）。会社を作った人は null（0020_signup は入れない）、
 *  招いた人は admin・manager・member・viewer・requester（取引先）。"owner"・"guest" は本物に無いので使わない（精査 2026-11-20）。
 *  画面は役の名前で出し分けない（入口は getTicket の handover_kinds）。役は外枠のナビにだけ効く */
export type Role = null | "admin" | "manager" | "member" | "viewer" | "requester";
/** 見ている人ができる種類（K-401 の app.handover_kinds・getTicket の handover_kinds と下見の kinds） */
export type Kind = "pass" | "offer" | "distribute";

/** モックと同じ字の日付（返事の期限 11/23（月）18:00・決めた時刻 11/20 10:12・取り消し 11/20 11:40・日本時間） */
export const DUE = "2026-11-23T09:00:00.000Z";
export const DUE_PAST = "2026-11-19T09:00:00.000Z";
export const AT = "2026-11-20T01:12:00.000Z";
export const AT_WITHDRAWN = "2026-11-20T02:40:00.000Z";
export const REASON = "先方と面識があるので、佐藤さんから返したほうが早い";
export const ASK = "今日中に一次返信だけお願いします";
export const WHY = "今週は月次の締めで手が空きません";
export const TITLE = "問い合わせ（山田様）に一次返信する";
export const NUMBER = "EG-119";

export type HState = "waiting" | "accepted" | "declined" | "withdrawn";
export interface Who {
  member_id: string;
  display_name: string;
}
/** 渡しの 1 件（K-405 の listTicketHandovers の 1 件 TicketHandover・鍵 17：16 の鍵 ＋ ticket_scope） */
export interface HView {
  id: string;
  kind: "pass" | "offer" | "distribute" | "escalate";
  state: HState;
  from: Who;
  to: Who | null;
  to_scope: { id: string; name: string; code: string } | null;
  reason: string;
  ask: string | null;
  reply_due: string | null;
  overdue: boolean;
  /** 一緒に移す物（子の数・グループを移すか） */
  switch: { children: number; group: boolean };
  decline_reason: string | null;
  decided_at: string | null;
  reminded_at: string | null;
  created_at: string;
  /** 見ている人ができること（口が決める・画面は形だけ見る） */
  can: { answer: boolean; withdraw: boolean; remind: boolean; reassign: boolean };
  /** チケットの今のグループ（受けた後の帯「グループは営業のまま」・K-405 が足す鍵） */
  ticket_scope: { id: string; name: string; code: string };
}
const who = (id: string): Who => ({ member_id: id, display_name: NAME[id] ?? id });
/** モックのグループ（mocks.tsx の GROUPS と同じ名前・札） */
const EG = { id: "0193c5a0-0000-7000-8000-00000000e601", name: "営業", code: "EG" };
const JD = { id: "0193c5a0-0000-7000-8000-00000000e602", name: "受託開発", code: "JD" };
/** 営業のグループ（チケットの今のグループ・既定） */
export const GROUP_EG = EG;

export const hview = (o: Partial<HView> = {}): HView => ({
  id: HND,
  kind: "pass",
  state: "waiting",
  from: who(ME),
  to: who(SATO),
  to_scope: null,
  reason: REASON,
  ask: ASK,
  reply_due: DUE,
  overdue: false,
  switch: { children: 2, group: false },
  decline_reason: null,
  decided_at: null,
  reminded_at: null,
  created_at: "2026-11-20T00:50:00.000Z",
  can: { answer: false, withdraw: true, remind: true, reassign: true },
  ticket_scope: EG,
  ...o,
});
/** 渡された人（佐藤）から見た待っている渡し */
export const incoming = (o: Partial<HView> = {}): HView =>
  hview({ can: { answer: true, withdraw: false, remind: false, reassign: false }, ...o });

/** 書く口の成功の答え（K-401・鍵 16・from/to は {id,name}）。画面は読む口を読み直して描く（この答えでは描かない） */
export const created = (v: HView) => ({
  id: v.id,
  ticket_id: TICKET,
  kind: v.kind,
  state: v.state,
  from: { id: v.from.member_id, name: v.from.display_name },
  to: v.to ? { id: v.to.member_id, name: v.to.display_name } : null,
  to_scope: v.to_scope,
  reason: v.reason,
  ask: v.ask,
  reply_due: v.reply_due,
  switch: { children: v.switch.children > 0, links: false, group: v.switch.group, axes: [] },
  switch_applied: null,
  notify_managers: false,
  decline_reason: v.decline_reason,
  decided_at: v.decided_at,
  created_at: v.created_at,
});

/** 下見の人（K-401 の candidates の 1 人） */
export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  group: { id: string; name: string; code: string };
  manager: boolean;
  week: number;
  state: "active" | "suspended" | "invited";
  self: boolean;
  current: boolean;
  in_group: boolean;
}
export interface Rule {
  target: "children" | "links" | "group" | "axis";
  axis_id: string | null;
  axis_name: string | null;
  mode: "ask" | "always" | "never";
}
/** 下見（K-401 の HandoverPreview・鍵 10） */
export interface Preview {
  kinds: ("pass" | "offer" | "distribute")[];
  blocked: null | "closed" | "ai_running" | "approval" | "waiting";
  waiting: null | {
    id: string;
    kind: string;
    from: { id: string; name: string };
    to: { id: string; name: string } | null;
    to_scope: { id: string; name: string; code: string } | null;
    reply_due: string | null;
  };
  default_reply_due: string;
  rules: Rule[];
  children: { mine: number; others: number };
  links: { mine: number; others: number };
  group: { id: string; name: string; code: string };
  candidates: Candidate[];
  groups: { id: string; name: string; code: string }[];
}
const cand = (id: string, email: string, week: number, o: Partial<Candidate> = {}): Candidate => ({
  id,
  name: NAME[id]!,
  email,
  group: EG,
  manager: false,
  week,
  state: "active",
  self: false,
  current: false,
  in_group: true,
  ...o,
});
/** 既定の下見：担当者＝高本が見る（モックの MEMBERS と同じ 5 人・佐藤はマネージャー） */
export const preview = (o: Partial<Preview> = {}): Preview => ({
  kinds: ["pass"],
  blocked: null,
  waiting: null,
  default_reply_due: DUE,
  rules: [
    { target: "children", axis_id: null, axis_name: null, mode: "ask" },
    { target: "links", axis_id: null, axis_name: null, mode: "ask" },
    { target: "group", axis_id: null, axis_name: null, mode: "ask" },
  ],
  children: { mine: 2, others: 1 },
  links: { mine: 0, others: 0 },
  group: EG,
  candidates: [
    cand(ME, "takamoto@engine-base.example", 7, { self: true, current: true }),
    cand(SUZUKI, "suzuki@engine-base.example", 4),
    cand(SATO, "sato@engine-base.example", 9, { manager: true }),
    cand(TANAKA, "tanaka@engine-base.example", 0, { state: "suspended" }),
    cand(KIMURA, "kimura@engine-base.example", 0, { state: "invited" }),
  ],
  groups: [],
  ...o,
});
/** 受託開発のグループ（相手がチケットのグループの外にいる形を作る） */
export const GROUP_JD = JD;

/** 渡す口が受ける中身（K-401 の TicketHandoverCreateInput。pass＝引き継いでもらう・offer＝申し出・distribute＝配る） */
export interface PassBody {
  kind: "pass" | "offer" | "distribute";
  to_member_id: string | null;
  to_scope_id: string | null;
  reason: string;
  ask: string | null;
  reply_due: string | null;
  switch: { children: boolean; links: boolean; group: boolean; axes: string[] };
  notify_managers: boolean;
  /** 別の人にする（K-413）：今待っている自分の渡しの id。口がその渡しの取り消しと新しい渡しを 1 取引でする（K-401 の入力・K-402 の中身） */
  replaces?: string;
}

/** 承認待ちの渡しの行（K-405 の app.handover_item_json・鍵 20：18 の鍵 ＋ to_scope_name・ticket_scope_name） */
export const handoverRow = (o: Record<string, unknown> = {}) => ({
  kind: "handover",
  handover_kind: "pass",
  id: HND,
  ticket_id: TICKET,
  ticket_number: NUMBER,
  title: TITLE,
  from_member_id: ME,
  from_name: "高本",
  check_summary: "",
  due_on: "2026-11-23",
  reply_due: DUE,
  decide_inline: true,
  irreversible: false,
  primary_action: "accept",
  secondary_action: "decline",
  note: REASON,
  carry_children: 2,
  /** グループ宛ての渡しのグループの名前（人宛ては null・K-405） */
  to_scope_name: null,
  /** チケットの今のグループの名前（K-405） */
  ticket_scope_name: EG.name,
  created_at: "2026-11-20T00:50:00.000Z",
  ...o,
});

export type Handler = (req: Request) => Reply | Promise<Reply>;
export interface HMock {
  /** 渡しの並び（新しい順・先頭が今の渡し）。getTicket の handover は先頭（無ければ null）、記録の読む口はこの並び。
   *  試験が差し替える。書く口の既定の答えもここを書き換える */
  list: HView[];
  /** getTicket の handover_kinds（試験が差し替える） */
  kinds: Kind[];
  passes: { body: PassBody; key: string | undefined }[];
  answers: { id: string; body: Record<string, unknown>; key: string | undefined }[];
  withdraws: string[];
  reminds: string[];
  /** 人を決める（claim）の中身（K-410） */
  claims: { id: string; body: Record<string, unknown>; key: string | undefined }[];
  previewReads: number;
  /** 記録の読む口（listTicketHandovers）の回数。詳細を開いただけでは 0 のまま */
  listReads: number;
  /** getTicket の回数（開き直し・押した後の読み直しを数える） */
  ticketReads: number;
  /** 書く口の答えを止めておく。返した関数を呼ぶと答える（時間で待たない・2 回押しを見る） */
  hold: () => () => void;
  gate: Promise<void>;
  on: {
    preview: Handler;
    pass: Handler;
    answer: Handler;
    withdraw: Handler;
    remind: Handler;
    claim: Handler;
    list: Handler;
  };
}
export interface HOptions {
  /** 見ている人（既定は高本＝担当者） */
  me?: string;
  /** 見ている人の役。既定は null（会社を作った人）。外枠のナビにだけ効く */
  role?: Role;
  /** getTicket の handover_kinds。既定は見ている人が担当者なら ["pass"]、ほかは []（DB が決める物なので試験が渡す） */
  kinds?: Kind[];
  /** 詳細の帯（実行・承認）。既定は作業中で承認も実行も無い */
  band?: Band;
  /** 担当者（既定は高本） */
  assignee?: string | null;
  /** 渡しの並びの最初の値（getTicket の handover は先頭） */
  list?: HView[];
  /** 承認待ちの行（既定は前からの QUEUE のまま） */
  queue?: Record<string, unknown>[];
}
const ok = (data: unknown, status = 200): Reply => ({ status, body: { data } });

/** 詳細・承認待ちの土台（mockApi）に渡しの口を足す。返すのは土台の Mock と渡しの HMock */
export async function mockHandovers(
  page: Page,
  o: HOptions = {},
): Promise<{ api: Mock; h: HMock; setAssignee: (id: string | null) => void }> {
  const me = o.me ?? ME;
  const band: Band = o.band ?? { stage: "doing" };
  const api = await mockApi(page, band);
  let assignee = o.assignee === undefined ? ME : o.assignee;
  /** 受けた後など、getTicket の担当者を替える（次の読み直しから） */
  const setAssignee = (id: string | null) => {
    assignee = id;
  };
  api.on.ticket = () => {
    h.ticketReads++;
    const base = ticketOf(band) as unknown as { ticket: Record<string, unknown> } & Record<string, unknown>;
    return ok(
      withBand(band, {
        ...base,
        ticket: { ...base.ticket, number: NUMBER, title: TITLE },
        assignee: assignee ? { id: assignee, display_name: NAME[assignee] } : null,
        // K-405 が getTicket に足す 2 つ（今の渡し・見ている人ができる種類）
        handover: h.list[0] ?? null,
        handover_kinds: h.kinds,
      }),
    );
  };
  if (o.queue) {
    const rows = o.queue;
    api.on.queue = () => ({ status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } });
  }
  const h: HMock = {
    list: o.list ?? [],
    kinds: o.kinds ?? (me === assignee ? ["pass"] : []),
    passes: [],
    answers: [],
    withdraws: [],
    reminds: [],
    claims: [],
    previewReads: 0,
    listReads: 0,
    ticketReads: 0,
    gate: Promise.resolve(),
    hold: () => {
      let open = () => {};
      h.gate = new Promise<void>((r) => (open = r));
      return () => open();
    },
    on: {
      preview: () => ok(preview({ kinds: h.kinds.length > 0 ? h.kinds : ["pass"] })),
      list: () => ({ status: 200, body: { data: h.list, meta: { limit: 50 } } }),
      pass: (req) => {
        const b = req.postDataJSON() as PassBody;
        const v = hview({
          id: b.replaces ? HND_NEXT : HND,
          kind: b.kind,
          to: b.to_member_id ? who(b.to_member_id) : null,
          reason: b.reason,
          ask: b.ask,
          reply_due: b.reply_due,
        });
        const old = h.list.map((x) =>
          x.id === b.replaces ? { ...x, state: "withdrawn" as const, decided_at: AT } : x,
        );
        h.list = [v, ...old];
        return ok(created(v), 201);
      },
      answer: (req) => {
        const b = req.postDataJSON() as { decision: string; decline_reason?: string };
        const cur = h.list[0] ?? incoming();
        const v: HView = {
          ...cur,
          state: b.decision === "accept" ? "accepted" : "declined",
          decline_reason: b.decline_reason ?? null,
          decided_at: AT,
          can: { answer: false, withdraw: false, remind: false, reassign: false },
        };
        h.list = [v, ...h.list.slice(1)];
        return ok(created(v));
      },
      withdraw: () => {
        const v: HView = { ...(h.list[0] ?? hview()), state: "withdrawn", decided_at: AT_WITHDRAWN };
        h.list = [v, ...h.list.slice(1)];
        return ok({ id: v.id, state: v.state, decided_at: v.decided_at }, 201);
      },
      remind: () => {
        const v: HView = { ...(h.list[0] ?? hview()), reminded_at: AT };
        h.list = [v, ...h.list.slice(1)];
        return { status: 201, body: { data: { id: v.id, reminded_at: v.reminded_at }, meta: { mail: "sent" } } };
      },
      claim: (req) => {
        const b = (req.postDataJSON() ?? {}) as { member_id?: string };
        const cur = h.list[0] ?? hview();
        const v: HView = { ...cur, state: "accepted", to: b.member_id ? who(b.member_id) : cur.to, decided_at: AT };
        h.list = [v, ...h.list.slice(1)];
        return ok({ id: v.id, state: v.state, ticket_id: TICKET, assignee_member_id: b.member_id ?? me });
      },
    },
  };
  const base = `/api/v1/tickets/${TICKET}`;
  await page.route(API_RE, async (route: Route, req: Request) => {
    const p = new URL(req.url()).pathname;
    const m = req.method();
    const key = req.headers()["idempotency-key"];
    let reply: Reply | null = null;
    if (m === "GET" && p === `${base}/handover-preview`) {
      h.previewReads++;
      reply = await h.on.preview(req);
    } else if (m === "GET" && p === `${base}/handovers`) {
      h.listReads++;
      reply = await h.on.list(req);
    } else if (m === "POST" && p === `${base}/handovers`) {
      h.passes.push({ body: req.postDataJSON() as PassBody, key });
      await h.gate;
      reply = await h.on.pass(req);
    } else if (m === "PATCH" && /^\/api\/v1\/ticket_handovers\/[^/]+$/.test(p)) {
      h.answers.push({ id: p.split("/").at(-1)!, body: req.postDataJSON() as Record<string, unknown>, key });
      await h.gate;
      reply = await h.on.answer(req);
    } else if (m === "POST" && /^\/api\/v1\/ticket_handovers\/[^/]+\/withdraw$/.test(p)) {
      h.withdraws.push(p.split("/").at(-2)!);
      await h.gate;
      reply = await h.on.withdraw(req);
    } else if (m === "POST" && /^\/api\/v1\/ticket_handovers\/[^/]+\/remind$/.test(p)) {
      h.reminds.push(p.split("/").at(-2)!);
      await h.gate;
      reply = await h.on.remind(req);
    } else if (m === "POST" && /^\/api\/v1\/ticket_handovers\/[^/]+\/claim$/.test(p)) {
      h.claims.push({ id: p.split("/").at(-2)!, body: (req.postDataJSON() ?? {}) as Record<string, unknown>, key });
      await h.gate;
      reply = await h.on.claim(req);
    } else if (/\/me$/.test(p)) {
      // 本物の /me の形（role_id は members.role_id・既定は会社を作った人の null）。土台の "owner" を上書きする
      const n = NAME[me] ?? "高本";
      reply = ok({
        id: me,
        member_id: me,
        display_name: n.split(" ")[0],
        role_id: o.role === undefined ? null : o.role,
        roles: ["member"],
        name: n.split(" ")[0],
      });
    }
    if (!reply) return route.fallback();
    await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  return { api, h, setAssignee };
}

/** 口の失敗の答え（正本の番号つき・{名前} の差し込みは details に入れる） */
export const errReply = (status: number, code: string, detail: Record<string, unknown> = {}): Reply => ({
  status,
  body: { error: "conflict", code, message: code, detail },
});

/** 詳細を開き、帯の読み込みが終わるまで待つ（見出しが出て、読み込み中の印が消える） */
export async function openDetail(page: Page, width = 1440): Promise<void> {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  const res = await page.goto(`/tickets/${TICKET}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('#k-main [aria-busy="true"]')).toHaveCount(0);
}

/** 詳細の題名の下の帯の区画（承認・実行の帯と同じ .k-detail-bands） */
export const bandsOf = (page: Page) => page.locator(".k-detail-bands");
/** パネルの「担当者」の値（F8 の部品 AssigneeValue の外箱） */
export const assigneeOf = (page: Page) =>
  page.locator('aside[aria-label="チケットのパネル"] .k-detail-field').filter({ hasText: "担当者" });

const BOX = ["width", "height", "background-color", "border-top-color", "border-top-left-radius"];
const TEXT = ["font-size", "font-weight", "color", "line-height", "texts"];
const CTRL = ["width", "height", "font-size", "color", "background-color", "border-top-color", "opacity", "texts"];
/** 段 9 の画面の役（モック /dev/mock/f8 と本番で同じセレクタ・同じ部品）。位置は帯と担当者の欄では比べない（本文の量で上下するため）。
 *  小窓は画面の上に重なるので位置も比べる */
export const HND_PAIRS: FidelityPair[] = [
  ["assignee", ".k-hnd-assignee", ["width", "font-size", "color", "texts"]],
  ["assignee-btn", ".k-hnd-assignee-btn", CTRL],
  ["assignee-note", ".k-hnd-assignee-note", TEXT],
  ["band", ".k-detail-bands .k-band", [...BOX, "texts"]],
  ["band-title", ".k-detail-bands .k-band-title", TEXT],
  ["band-sub", ".k-detail-bands .k-band-sub", TEXT],
  ["band-btn", ".k-detail-bands .k-band-acts button", CTRL],
  ["offer", ".k-hnd-offer button", CTRL],
  ["dialog", ".k-dialog", ["width", "x", "y", "background-color", "border-top-left-radius"]],
  ["dialog-title", ".k-dialog h2", ["x", "y", ...TEXT]],
  ["dialog-notice", ".k-dialog [role='alert']", ["x", "width", "background-color", ...TEXT]],
  ["dialog-callout", ".k-dialog .k-callout", ["x", "width", "background-color", ...TEXT]],
  ["dialog-err", ".k-dialog .k-err", TEXT],
  ["dialog-label", ".k-dialog .k-label", TEXT],
  ["dialog-note", ".k-dialog .k-hnd-note, .k-dialog .k-hnd-intro, .k-dialog .k-hnd-empty", TEXT],
  ["dialog-btn", ".k-dialog button[data-variant]", ["x", "y", ...CTRL]],
  ["pick-item", ".k-hnd-pick-item", ["height", "opacity", "texts"]],
  ["search", ".k-dialog .k-search-field", ["width", "height", "border-top-color"]],
  ["q-row", "tr.k-hnd-row", ["height", "texts"]],
  ["q-row-btn", "tr.k-hnd-row button", CTRL],
  ["mcard", ".k-hnd-mcard", [...BOX, "texts"]],
  ["mcard-btn", ".k-hnd-mcard button", CTRL],
].map(([role, sel, props]) => ({
  name: String(role),
  role: String(role),
  canvas: String(sel),
  app: String(sel),
  props: props as string[],
}));
