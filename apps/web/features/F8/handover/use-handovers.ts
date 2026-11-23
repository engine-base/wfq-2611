// 渡す・配る（F8・段 9）が getTicket の答えから読む純な関数と型（K-400）。口を呼ばない・役の名前を見ない。
//   値は getTicket の答えの `handover`（今の渡し 1 件＝待っている渡しが在ればそれ、無ければ最後に決まった渡し・K-405 の TicketHandover と同じ形）と
//   `handover_kinds`（見ている人ができる種類・下見の kinds と同じ）だけ。詳細の口の数は 6 のまま（記録の読む口は記録を開いたときだけ）。
//   帯・担当者の欄・入口（▾／申し出）の分け方はここ 1 か所。本物の区画のファイルを書く葉は、ここを使うだけで分け方を自分で決めない。
import type { SlotDetail, SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import type { HandoverBandKind } from "./views";

/** 渡しの種類（見ている人ができる種類・渡しそのものの種類。上へ上げる escalate はこの段では切らない） */
export type HandoverKind = "pass" | "offer" | "distribute";
export type HandoverState = "waiting" | "accepted" | "declined" | "withdrawn";

export interface HandoverWho {
  member_id: string;
  display_name: string;
}
export interface HandoverScope {
  id: string;
  name: string;
  code: string;
}

/** 渡しの 1 件（K-405 の TicketHandover・画面の試験の道具 tests/k/handover-mock.ts の HView と同じ形） */
export interface HandoverView {
  id: string;
  kind: HandoverKind | "escalate";
  state: HandoverState;
  /** 渡した人・申し出た人・配った人 */
  from: HandoverWho;
  /** 相手（申し出のときは担当者）。グループ宛ての配りは null（受けた人が入る） */
  to: HandoverWho | null;
  to_scope: HandoverScope | null;
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
  /** チケットの今のグループ */
  ticket_scope: HandoverScope;
}

/** 入口：担当者の ▾（pass・distribute）・題名の下の申し出のボタン（offer） */
export type HandoverEntry = "pass" | "distribute" | "offer";

/** 区画のファイルが「本物にした」と言える種類（READY に足す）。offer-entry は題名の下の申し出のボタン（帯ではない入口） */
export type HandoverBandKey = HandoverBandKind | "offer-entry";

/** 帯の区画のファイルが受ける値（handover が null なのは read-failed＝渡しの形が読めないときだけ） */
export interface BandSectionProps {
  handover: HandoverView | null;
  kind: HandoverBandKind;
  ticket: SlotTicket;
}

const KINDS: readonly HandoverKind[] = ["pass", "offer", "distribute"];
const STATES: readonly HandoverState[] = ["waiting", "accepted", "declined", "withdrawn"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isHandover(v: unknown): v is HandoverView {
  if (!isRecord(v)) return false;
  const from = v["from"];
  return (
    typeof v["id"] === "string" &&
    (KINDS as readonly unknown[]).concat("escalate").includes(v["kind"]) &&
    (STATES as readonly unknown[]).includes(v["state"]) &&
    isRecord(from) &&
    typeof from["member_id"] === "string"
  );
}

/**
 * getTicket の答えから今の渡しと、見ている人ができる種類を読む。
 * 鍵が無ければ渡しなし・できる種類なし（前からの答えには無い＝何もできない詳細）。
 * 渡しが在るのに形が違うときだけ invalid（帯 read-failed・本文はそのまま読める）
 */
export function handoverOf(detail: SlotDetail): {
  handover: HandoverView | null;
  kinds: HandoverKind[];
  invalid: boolean;
} {
  const rawKinds = detail["handover_kinds"];
  const kinds = Array.isArray(rawKinds)
    ? rawKinds.filter((k): k is HandoverKind => (KINDS as readonly unknown[]).includes(k))
    : [];
  const raw = detail["handover"];
  if (raw === undefined || raw === null) return { handover: null, kinds, invalid: false };
  return isHandover(raw) ? { handover: raw, kinds, invalid: false } : { handover: null, kinds, invalid: true };
}

/** 担当者の member_id（getTicket の assignee.id。無ければ null） */
export function assigneeIdOf(detail: SlotDetail): string | null {
  const a = detail["assignee"];
  return isRecord(a) && typeof a["id"] === "string" ? a["id"] : null;
}

/**
 * 入口を決める（役の名前を見ない・できる種類 kinds と担当者かどうかだけ）：
 * 担当者本人で pass → pass（▾・引き継いでもらう）／担当者でなく distribute → distribute（▾・配る）／
 * 担当者でなく offer だけ → offer（題名の下の申し出のボタン）／ほか → null（何も出さない）
 */
export function entryOf(kinds: readonly HandoverKind[], isAssignee: boolean): HandoverEntry | null {
  if (isAssignee && kinds.includes("pass")) return "pass";
  if (isAssignee) return null;
  if (kinds.includes("distribute")) return "distribute";
  if (kinds.length > 0 && kinds.every((k) => k === "offer")) return "offer";
  return null;
}

/** 担当者の下の「→ 〇〇（返事待ち）」の〇〇。待っていない・申し出は null */
export function waitingNoteOf(handover: HandoverView | null, meId: string | null): string | null {
  if (!handover || handover.state !== "waiting" || handover.kind === "offer") return null;
  if (handover.to) return handover.to.member_id === meId ? "あなた" : handover.to.display_name;
  return handover.to_scope ? `グループ「${handover.to_scope.name}」` : null;
}

/** 帯の種類を決める（state・kind・from・to・overdue と、見ている人の member_id から）。出す帯が無ければ null */
export function bandKindOf(handover: HandoverView | null, meId: string | null): HandoverBandKind | null {
  if (!handover || meId === null) return null;
  const isFrom = handover.from.member_id === meId;
  const isTo = handover.to?.member_id === meId;
  const { kind, state } = handover;
  if (kind === "offer") {
    if (state === "waiting") return isFrom ? "offering" : isTo || handover.can.answer ? "offered" : null;
    if (state === "accepted") return isFrom ? "offer-accepted" : isTo ? "taken" : null;
    if (state === "declined") return isFrom ? "offer-declined" : null;
    return null;
  }
  if (kind !== "pass" && kind !== "distribute") return null;
  const toGroup = kind === "distribute" && handover.to === null && handover.to_scope !== null;
  if (state === "waiting") {
    if (toGroup) return isFrom ? "group" : null;
    if (isFrom) return handover.overdue ? "overdue" : "sending";
    return isTo ? "receiving" : null;
  }
  if (state === "accepted") {
    if (kind === "distribute") return isTo ? "distributed" : null;
    return isTo ? "accepted" : isFrom ? "taken" : null;
  }
  if (state === "declined") return isFrom ? "declined" : null;
  return isTo && !toGroup ? "gone" : null;
}

/** 1 回だけ出す帯（受けた側の「担当者になりました」・渡した側の「引き継ぎました」・配られた・申し出の結果・取り消された）。端末ごとに 1 回（D-148.35・D-148.41） */
export const ONCE_KINDS: ReadonlySet<HandoverBandKind> = new Set<HandoverBandKind>([
  "accepted",
  "taken",
  "distributed",
  "offer-accepted",
  "offer-declined",
  "gone",
]);

const SEEN_PREFIX = "kaname.hnd.seen.";
const CLOSED_PREFIX = "kaname.hnd.closed.";

/** 手元の覚えを読む。読めない（私的な窓・データを消した・禁止）ときは「覚えていない」＝出す */
function remembered(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** 手元の覚えを書く。書けなくても出し続けるだけで画面は壊れない */
function remember(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // 書けない：次に開いたときも出る（出し損ねるよりよい）
  }
}

/** この端末で、この渡しの 1 回だけの帯をもう出したか */
export const wasSeen = (handoverId: string): boolean => remembered(SEEN_PREFIX + handoverId);
export const markSeen = (handoverId: string): void => remember(SEEN_PREFIX + handoverId);
/** 断られた帯（渡した人）は、閉じるか別の人に渡すまで出す（D-148.34）。閉じたか */
export const wasClosed = (handoverId: string): boolean => remembered(CLOSED_PREFIX + handoverId);
export const markClosed = (handoverId: string): void => remember(CLOSED_PREFIX + handoverId);

/** 承認待ちの行の渡しの種類（行の kind が handover のとき handover_kind に入る・K-405）。無い・知らない字は null */
export function rowHandoverKindOf(row: object): HandoverKind | null {
  const k = (row as Record<string, unknown>)["handover_kind"];
  return (KINDS as readonly unknown[]).includes(k) ? (k as HandoverKind) : null;
}
