// 口の答え（やり取りの 1 行）を、部品 views.tsx が描く値に直す（K-392）。純粋な関数。時刻は日本時間に直す（ブラウザの時間帯に依らない）。
//   答えの形の正は口の葉 K-383（listTicketTimeline）。名前は、書き込みの頭だけ正式な名前、ほかは呼ばれ方（無ければ正式な名前）。
import { createElement as h, Fragment, type ReactNode } from "react";
import { Mention, type Person, type PostView, type ThreadItem, type Tone } from "./views";

export interface Who {
  member_id: string;
  display_name: string;
  call_name: string | null;
}
export interface PersonRow extends Who {
  /** 候補の右の小さな字（担当者・承認する人・グループの名前） */
  label: string;
  is_assignee: boolean;
  is_approver: boolean;
}
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
export interface ChangeView {
  field: string;
  from: string | null;
  to: string | null;
  note?: string | null;
}
export interface RunView {
  id: string;
  summary: string;
  started_at: string;
  finished_at: string | null;
  minutes: number | null;
  result: string;
}
export type TimelineKind = "post" | "change" | "system" | "run" | "deleted";
export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  at: string;
  actor: Who | null;
  message: MessageView | null;
  changes: ChangeView[] | null;
  run: RunView | null;
  deleted: { by: Who; author: Who; by_manager: boolean } | null;
}
/** 引用する書き込み（書く欄の上に出す） */
export interface QuoteRef {
  id: string;
  excerpt: string;
}

// ---------------------------------------------------------------- 日本時間
const PARTS = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
function partsOf(at: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(new Date(at))) out[p.type] = p.value;
  return out;
}
/** 日付が替わる所を見分ける鍵（日本時間の年月日） */
const dayKey = (at: string): string => {
  const p = partsOf(at);
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
};
/** 「HH:MM」 */
export const hhmm = (at: string): string => {
  const p = partsOf(at);
  return `${p["hour"]}:${p["minute"]}`;
};
/** 「MM/DD」 */
const mmdd = (at: string): string => {
  const p = partsOf(at);
  return `${p["month"]}/${p["day"]}`;
};
/** 日付の区切り「MM/DD（曜）」（年は出さない） */
export const dayLabel = (at: string): string => `${mmdd(at)}（${partsOf(at)["weekday"]}）`;

// ---------------------------------------------------------------- 人
const TONES: readonly Tone[] = ["lavender", "indigo", "teal"];
const callOf = (w: Who): string => w.call_name ?? w.display_name;
function personOf(w: Who | null, nameOf: (w: Who) => string): Person {
  if (!w) return { name: "AI", initial: "AI" };
  const sum = [...w.member_id].reduce((n, c) => n + c.charCodeAt(0), 0);
  return { name: nameOf(w), initial: callOf(w).slice(0, 1), tone: TONES[sum % TONES.length] as Tone };
}
const joinNames = (ws: readonly Who[]): string => ws.map(callOf).join("・");

// ---------------------------------------------------------------- 本文
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 本文を字のまま出し、@ の札は答えの mentions に在る人の呼ばれ方だけにする（字の「@」を全部札にしない） */
function bodyOf(m: MessageView): ReactNode {
  const names = [...new Set(m.mentions.map(callOf))].sort((a, b) => b.length - a.length);
  if (!names.length) return m.body;
  const re = new RegExp(`(${names.map((n) => escapeRe(`@${n}`)).join("|")})`);
  return m.body
    .split(re)
    .map((seg, i) => (i % 2 === 1 ? h(Mention, { key: i, children: seg }) : h(Fragment, { key: i }, seg)));
}

// ---------------------------------------------------------------- 変更
const STAGE_FIELD = "stage";
/** 書き込みと一緒に残った変更の小さな 1 行（「状態：作業中 → 保留」） */
function changeNote(c: ChangeView): string {
  switch (c.field) {
    case STAGE_FIELD:
      return `状態：${c.from ?? ""} → ${c.to ?? ""}`;
    case "hold_reason":
      return `保留の理由：${c.to ?? ""}`;
    case "resume_condition":
      return `再開の条件：${c.to ?? ""}`;
    case "actual_minutes":
      return c.to === null ? "実績：空" : `実績：${c.to}`;
    default:
      return `${c.field}：${c.from ?? ""} → ${c.to ?? ""}`;
  }
}
const DECISION_NOTE: Record<string, string> = {
  add: "決定を足した",
  revise: "決定を改めた",
  cancel: "決定を取り消した",
};

/** 変更だけの行の文（名前は頭に 1 回・欄ごとの字を「・」でつなぐ。口の葉 K-387・K-388・K-390・K-391 が書く changes の形） */
function changeParts(changes: readonly ChangeView[]): ReactNode[] {
  const by = new Map(changes.map((c) => [c.field, c]));
  const reason = by.get("hold_reason");
  const resume = by.get("resume_condition");
  const detail = [reason ? `理由：${reason.to ?? ""}` : null, resume ? `再開の条件：${resume.to ?? ""}` : null]
    .filter((s): s is string => s !== null)
    .join("・");
  // 保留への段の変更と一緒なら、理由と再開の条件は「保留にした（…）」に入れる
  const holdAbsorbed = by.get(STAGE_FIELD)?.to === "保留" && detail !== "";
  const parts: ReactNode[] = [];
  let holdDone = false;
  for (const c of changes) {
    if (c.field === STAGE_FIELD) {
      if (c.note === "開き直した") parts.push("開き直した");
      else if (holdAbsorbed) parts.push(`保留にした（${detail}）`);
      else parts.push(h(Fragment, null, "状態を ", h("b", null, `${c.from ?? ""} → ${c.to ?? ""}`), " に変えた"));
    } else if (c.field === "hold_reason" || c.field === "resume_condition") {
      if (holdAbsorbed || holdDone) continue;
      parts.push(`保留の理由を直した（${detail}）`);
      holdDone = true;
    } else if (c.field === "actual_minutes") {
      parts.push(c.to === null ? "実績を空にした" : `実績を ${c.to} に変えた`);
    } else if (c.field === "decision") {
      parts.push(DECISION_NOTE[c.note ?? ""] ?? "決定を変えた");
    } else parts.push(`${c.field}を変えた`);
  }
  return parts;
}
function joinParts(parts: readonly ReactNode[]): ReactNode {
  return parts.map((p, i) => h(Fragment, { key: i }, i ? "・" : null, p));
}

// ---------------------------------------------------------------- 実行の 1 枚
const RUN_RESULT: Record<string, string> = {
  done: "通った",
  running: "動いている",
  asking: "動いている",
  stopped: "止まった",
  failed: "止まった",
  cancelled: "取り消した",
};
function runMeta(r: RunView): string {
  const span = r.finished_at ? `${hhmm(r.started_at)} → ${hhmm(r.finished_at)}` : `${hhmm(r.started_at)} →`;
  return r.minutes === null ? span : `${span} ・ ${r.minutes} 分`;
}

// ---------------------------------------------------------------- 1 行
function postOf(it: TimelineItem, m: MessageView): PostView {
  const who = it.actor;
  return {
    id: it.id,
    who: personOf(who, (w) => w.display_name),
    time: hhmm(it.at),
    body: bodyOf(m),
    ...(m.quote ? { quote: m.quote.excerpt } : {}),
    ...(it.changes?.length ? { changes: it.changes.map(changeNote) } : {}),
    ...(m.notified.length ? { notified: joinNames(m.notified) } : {}),
    ...(m.edited_at ? { edited: `${mmdd(m.edited_at)} ${hhmm(m.edited_at)}` } : {}),
    ...(m.is_new ? { isNew: true } : {}),
    stars: m.stars,
    starred: m.starred,
    decided: m.decided,
    menu: m.can_edit && m.can_delete ? "own" : m.can_delete ? "manager" : "none",
  };
}

function itemOf(it: TimelineItem, openRun?: (runId: string) => void): ThreadItem | null {
  const time = hhmm(it.at);
  switch (it.kind) {
    case "post":
      return it.message ? { kind: "post", post: postOf(it, it.message) } : null;
    case "change": {
      const who = it.actor;
      return {
        kind: "line",
        who: personOf(who, callOf),
        text: h(
          Fragment,
          null,
          h("b", null, who ? callOf(who) : "AI"),
          " が",
          joinParts(changeParts(it.changes ?? [])),
        ),
        time,
      };
    }
    case "system":
      return { kind: "line", who: personOf(it.actor, callOf), text: it.message?.body ?? "", time };
    case "run": {
      const r = it.run;
      if (!r) return null;
      return {
        kind: "run",
        title: h(Fragment, null, h("b", null, `${it.actor ? callOf(it.actor) : ""}のAI`), ` が${r.summary}`),
        meta: runMeta(r),
        result: RUN_RESULT[r.result] ?? r.result,
        ...(openRun ? { onOpen: () => openRun(r.id) } : {}),
      };
    }
    case "deleted": {
      const d = it.deleted;
      if (!d) return null;
      return {
        kind: "line",
        who: personOf(d.by, callOf),
        text: d.by_manager
          ? h(
              Fragment,
              null,
              "マネージャーの ",
              h("b", null, callOf(d.by)),
              " が ",
              h("b", null, callOf(d.author)),
              " の書き込みを消しました",
            )
          : h(Fragment, null, h("b", null, callOf(d.by)), " が書き込みを消しました"),
        time,
      };
    }
  }
}

/** 答え（古い順）を、日付の区切りを入れた並びに直す（古い順のまま。並びの逆は部品が持つ） */
export function toItems(items: readonly TimelineItem[], openRun?: (runId: string) => void): ThreadItem[] {
  const out: ThreadItem[] = [];
  let lastDay = "";
  for (const it of items) {
    const row = itemOf(it, openRun);
    if (!row) continue;
    const day = dayKey(it.at);
    if (day !== lastDay) {
      out.push({ kind: "day", label: dayLabel(it.at) });
      lastDay = day;
    }
    out.push(row);
  }
  return out;
}

/** 引用する書き込みの頭の 1〜2 行 */
export function quoteOf(it: TimelineItem): QuoteRef | null {
  if (!it.message) return null;
  const excerpt = it.message.body.split("\n").slice(0, 2).join("\n").slice(0, 80);
  return { id: it.id, excerpt };
}
