"use client";
// 承認待ちのスマホのカード（幅 767 以下・K-412・D-148.26・キャンバス MbApprovals）：表を横に送らず、1 件 1 枚のカードを期限の順に縦に並べる。
//   カードは全部の種類をここで描く（AI の成果物・渡された・申し出・グループに配られた。行の kind・handover_kind・primary_action／secondary_action で決める）。
//   区切りの見出しは出さない。幅 767 以下で表を隠しカードを出すのは handover.css（K-400）の決まり。
//   カードの 1 枚ずつは F8.QueueRowSlot で包み、カードの中だと分かる文脈（useQueueLayout）を渡す。申し出（K-414）・グループ（K-415）の行の部品は、
//   この文脈を読んでカードを描き直せる（描き直すまでは、ここで描いたカードが出る）
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, useNotify } from "@/components/k";
import { DeclineFlow } from "@/features/F8/handover/decline-dialog";
import { formatMoment, targetOfRow, useAnswerCall } from "@/features/F8/handover/answer";
import * as F8 from "@/features/F8/handover/detail-slots";
import { rowHandoverKindOf, type HandoverKind } from "@/features/F8/handover/use-handovers";
import { QueueCardMobile, type QueueCardView } from "@/features/F8/handover/views";
import { queueKey, type QueueRow } from "./queue";
import type { RowActs } from "./queue-table";

/** 絞り込みの札（表の道具の行と同じ 6 つ・まとめて段 6 までは押せない・D-148.14） */
export const FILTERS = [
  "AI の成果物",
  "上位の承認",
  "渡された",
  "判断を仰がれた",
  "決まりの例外",
  "やり方を広げる",
] as const;
/** まだ使えない物：在るが押せない（aria-disabled・Tab で止まらない・押しても何もしない） */
export const INERT = { "aria-disabled": true, tabIndex: -1 } as const;

/** 承認待ちの行が今どちらの形で描かれるか（表の行か、スマホのカードか） */
export type QueueLayout = "card" | "table";
const LayoutContext = createContext<QueueLayout>("table");
export const useQueueLayout = (): QueueLayout => useContext(LayoutContext);

// ---------------------------------------------------------------- 渡しの行の欄（K-405 の app.handover_item_json）
export interface HandoverFields {
  kind: HandoverKind | null;
  replyDue: string | null;
  carryChildren: number;
  toScopeName: string | null;
  primary: string | null;
  secondary: string | null;
}
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** 行の渡しの欄を読む（AI の成果物の行は 5 つの鍵が null・前からの行には鍵が無い） */
export function handoverFieldsOf(row: QueueRow): HandoverFields {
  const r = row as unknown as Record<string, unknown>;
  const n = r["carry_children"];
  return {
    kind: rowHandoverKindOf(row),
    replyDue: str(r["reply_due"]),
    carryChildren: typeof n === "number" && Number.isFinite(n) ? n : 0,
    toScopeName: str(r["to_scope_name"]),
    primary: str(r["primary_action"]),
    secondary: str(r["secondary_action"]),
  };
}

/** 行・カードの中身の 1 行の部品（子の数・理由）。空は出さない */
export function carryPart(f: HandoverFields): string | null {
  return f.carryChildren > 0 ? `子チケット ${f.carryChildren} 件も一緒に` : null;
}
/** 理由の初めの 10 字（10 字を超えたら「…」）。理由が無ければ null */
export function reasonPart(note: string | null): string | null {
  if (note === null) return null;
  const chars = Array.from(note);
  return `理由：${chars.slice(0, 10).join("")}${chars.length > 10 ? "…" : ""}`;
}

const LABEL: Record<string, string> = {
  accept: "受ける",
  give: "渡す",
  claim: "自分が持つ",
  decline: "断る",
  assign: "人を決める",
};
// 受ける・渡す・自分が持つ（accept・give・claim）は、どれも答える口に { decision: "accept" } を送る

// ---------------------------------------------------------------- 行・カードが答える（承認待ちの行・カードで共通）
/**
 * 承認待ちの渡しの行が答える流れ。受ける・渡す・自分が持つは小窓を通さずその場で送り、断るは断る小窓を開く。
 * 答えたら承認待ちの問い合わせを読み直す（行が消え、数が減る）。受けて自分が担当者になるときは小さな知らせを 5 秒（D-148.44）
 */
export function useRowAnswer(row: QueueRow) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { busy, send } = useAnswerCall(row.id, "approvals");
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const f = handoverFieldsOf(row);
  const refresh = () => qc.invalidateQueries({ queryKey: queueKey });

  const accept = async () => {
    setError(null);
    const out = await send({ decision: "accept" });
    if (out === null) return; // 送っている間の 2 回目
    if (out.ok) {
      await refresh();
      if (f.primary !== "give") notify(`${row.ticket_number} の担当者になりました`);
      return;
    }
    if (out.unauthorized) return; // 入り直し（共通の扱い）
    if (out.code === "E-HND-005") {
      // もう決まっていた（別のタブで先に答えた・取り消された）：読み直して行を消し、訳を知らせる
      await refresh();
      notify(out.text);
      return;
    }
    setError(out.text); // AI が動いている（E-HND-003）・送れない など：行に残し、行の中に出す
  };

  const dialog = declining ? (
    <DeclineFlow
      handoverId={row.id}
      target={targetOfRow(row)}
      from={row.from_name ?? "相手"}
      screenId="approvals"
      onClose={() => setDeclining(false)}
      onDone={refresh}
      onStale={refresh}
    />
  ) : null;

  return { busy, error, accept: () => void accept(), openDecline: () => setDeclining(true), dialog };
}

// ---------------------------------------------------------------- カードの 1 枚
const hrefOf = (row: QueueRow): string => `/tickets/${row.ticket_id}`;

/** AI の成果物のカード：今の行と同じ「差し戻す」と「承認する」（その場で決める）か「中身を見る」 */
function ArtifactCard({ row, acts }: { row: QueueRow; acts: RowActs }) {
  const { busy, onApprove, onReturn } = acts;
  const card: QueueCardView = {
    id: row.id,
    number: row.ticket_number,
    meta: `${row.from_name ?? "自分"}のAI が作成 ・ 確認 ${row.check_summary}`,
    title: row.title,
    ...(row.note ? { sub: row.note } : {}),
    acts: ["差し戻す", "承認する"],
  };
  return (
    <QueueCardMobile
      card={card}
      href={hrefOf(row)}
      acts={
        <>
          <Button variant="outlined" disabled={busy === row.id} onClick={() => onReturn(row)}>
            差し戻す
          </Button>
          {row.decide_inline ? (
            <Button loading={busy === row.id} disabled={busy !== null} onClick={() => onApprove(row)}>
              承認する
            </Button>
          ) : (
            <a className="k-btn" data-variant="primary" href={hrefOf(row)}>
              中身を見る
            </a>
          )}
        </>
      }
    />
  );
}

/** 渡しのカードの meta・中身・note（種類ごとの決まり） */
function handoverCardOf(row: QueueRow, f: HandoverFields): Omit<QueueCardView, "id" | "number" | "title" | "acts"> {
  const meta = `渡された ・ ${row.from_name ?? ""}さんから`;
  const reply = f.replyDue ? formatMoment(f.replyDue) : "";
  if (f.kind === "offer") {
    return {
      meta,
      ...(row.note ? { sub: `理由：${row.note}` } : {}),
      ...(reply ? { note: `返事の期限 ${reply}` } : {}),
    };
  }
  if (f.kind === "distribute") {
    const day = row.due_on ? `${row.due_on.slice(5, 7)}/${row.due_on.slice(8, 10)}` : "";
    return {
      meta,
      sub: `グループ「${f.toScopeName ?? ""}」に配られました ・ 担当者を決めてください`,
      ...(day ? { note: `期限 ${day}` } : {}),
    };
  }
  const parts = [carryPart(f), reasonPart(row.note)].filter((p): p is string => p !== null);
  return {
    meta,
    ...(parts.length > 0 ? { sub: parts.join(" ・ ") } : {}),
    ...(reply ? { note: `返事の期限 ${reply}` } : {}),
  };
}

/** 渡されたカード（pass・offer・distribute）：ボタンの字は primary_action／secondary_action で決める */
function HandoverCard({ row }: { row: QueueRow }) {
  const f = handoverFieldsOf(row);
  const a = useRowAnswer(row);
  const primary = LABEL[f.primary ?? ""] ?? "受ける";
  const secondary = LABEL[f.secondary ?? ""] ?? "断る";
  const card: QueueCardView = {
    id: row.id,
    number: row.ticket_number,
    title: row.title,
    acts: [secondary, primary],
    ...handoverCardOf(row, f),
  };
  return (
    <>
      <QueueCardMobile
        card={card}
        href={hrefOf(row)}
        {...(a.error ? { error: a.error } : {})}
        acts={
          <>
            {f.secondary === "assign" ? (
              // 人を決める：決める画面がまだ無いので、在るが押せない（D-145.9）
              <Button variant="outlined" {...INERT} title="まだ使えません">
                {secondary}
              </Button>
            ) : (
              <Button variant="outlined" disabled={a.busy} onClick={a.openDecline}>
                {secondary}
              </Button>
            )}
            <Button disabled={a.busy} onClick={a.accept}>
              {primary}
            </Button>
          </>
        }
      />
      {a.dialog}
    </>
  );
}

/** 行 1 件のカード（種類で描き分ける） */
function RowCard({ row, acts }: { row: QueueRow; acts: RowActs }) {
  if (row.kind !== "handover") return <ArtifactCard row={row} acts={acts} />;
  return <HandoverCard row={row} />;
}

/** 承認待ちのスマホの全部のカード。rows は表と同じ並び（期限の順）。区切りの見出しは出さない */
export function QueueCards({ rows, total, acts }: { rows: QueueRow[]; total: number; acts: RowActs }): ReactNode {
  return (
    <section className="k-hnd-mq" aria-label="承認待ちの一覧（スマホ）">
      <div className="k-hnd-mchips" role="group" aria-label="絞り込み">
        <button type="button" className="k-ap-chip" aria-pressed="true">
          すべて {total}
        </button>
        {FILTERS.map((f) => (
          <button key={f} type="button" className="k-ap-chip" aria-pressed="false" {...INERT}>
            {f}
          </button>
        ))}
      </div>
      <LayoutContext.Provider value="card">
        <ul className="k-hnd-mcards">
          {rows.map((r) => (
            <F8.QueueRowSlot key={r.id} row={r} acts={acts}>
              <RowCard row={r} acts={acts} />
            </F8.QueueRowSlot>
          ))}
        </ul>
      </LayoutContext.Provider>
    </section>
  );
}
