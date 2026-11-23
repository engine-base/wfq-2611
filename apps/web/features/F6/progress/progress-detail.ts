// getTicket の答え（SlotTicket.detail）から、段・保留・実績の画面が読む所だけを取り出す（純粋な関数）。
//   欄が無い答え（前からの試験の土台・口の葉より前の答え）でも落ちない：無い欄は「出さない」側に倒す
import { mmddTime } from "@/features/F4/create-ticket/detail-head";
import type { SlotDetail } from "@/features/F4/create-ticket/detail-slots";

export interface HoldView {
  reason: string;
  resume: string;
  at: string | null;
  by: string | null;
}
export interface TimeView {
  estimate: number | null;
  human: number;
  ai: number;
}
export interface SectionView {
  label: string;
  text: string;
  version: number;
}
export interface ProgressView {
  /** 段が読めたか（読めなければ今の字の札のまま） */
  hasStage: boolean;
  /** 段の鍵（会社が足した段は null） */
  stageKey: string | null;
  stageName: string;
  canProgress: boolean;
  canActual: boolean;
  canComplete: boolean;
  hold: HoldView | null;
  time: TimeView | null;
  number: string | null;
  title: string | null;
  todo: SectionView;
  conditions: SectionView;
}

/** 人が変えられない仕組みの段（確認中・承認待ち・実行中・D-125.38） */
export const LOCKED_STAGES: ReadonlySet<string> = new Set(["checking", "awaiting_approval", "running"]);

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function sectionOf(sections: unknown, key: string, fallback: string): SectionView {
  const s = Array.isArray(sections) ? sections.map(obj).find((x) => x?.["key"] === key) : null;
  const body = obj(s?.["body"]);
  return { label: str(s?.["label"]) ?? fallback, text: str(body?.["text"]) ?? "", version: num(s?.["version"]) ?? 0 };
}

export function progressOf(detail: SlotDetail): ProgressView {
  const stage = obj(detail["stage"]);
  const can = obj(detail["can"]);
  const hold = obj(detail["hold"]);
  const time = obj(detail["time"]);
  const ticket = obj(detail["ticket"]);
  const canProgress = can?.["progress"] === true;
  return {
    hasStage: stage !== null,
    stageKey: str(stage?.["key"]),
    stageName: str(stage?.["name"]) ?? "",
    canProgress,
    canActual: can?.["actual"] === true,
    canComplete: can?.["complete"] === true,
    hold: hold
      ? {
          reason: str(hold["reason"]) ?? "",
          resume: str(hold["resume"]) ?? "",
          at: str(hold["at"]),
          by: str(hold["by"]),
        }
      : null,
    time: time
      ? {
          estimate: num(time["estimate_minutes"]),
          human: num(time["human_minutes"]) ?? 0,
          ai: num(time["ai_minutes"]) ?? 0,
        }
      : null,
    number: str(ticket?.["number"]),
    title: str(ticket?.["title"]),
    todo: sectionOf(detail["sections"], "todo", "実施事項"),
    conditions: sectionOf(detail["sections"], "done", "完了の条件"),
  };
}

/** 「11/01 10:41 佐藤 が保留にした」（保留にした人が無ければ「11/01 10:41 に保留にした」・日本時間） */
export function holdByLine(h: HoldView): string {
  const at = mmddTime(h.at);
  return h.by ? `${at} ${h.by} が保留にした` : `${at} に保留にした`;
}
