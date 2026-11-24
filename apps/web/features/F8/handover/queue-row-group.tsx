"use client";
// 承認待ちの グループに配られた（distribute）の行・K-415。表の行は HandoverRow、スマホのカード（幅 767 以下・useQueueLayout が "card"）は QueueCardMobile を同じ動きで描く。
//   中身は「グループ「〇〇」に配られました ・ 担当者を決めてください」（〇〇は行の to_scope_name）・期限はチケットの期限（返事の期限は無い）。ボタンは 2 つ：
//   「自分が持つ」は答える口（answerTicketHandover の accept・K-410）をその場で送り、「人を決める」は相手を選ぶ小窓（下見の人・グループの並びなし）で選ぶとすぐ
//   claim の口（claimTicketHandover・K-410）。どちらも終わったら承認待ちの問い合わせを読み直す（行が消え、数が減る）。
//   もう決まっていた（E-HND-005）は読み直して行を消し、文を知らせ（role=alert）に出す。選び直せる断り（E-HND-150・151 など）は小窓の上の赤い箱で行は残す
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNotify } from "@/components/k";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import { jstDay } from "@/features/F5/approve-complete/due";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { handoverFieldsOf, useQueueLayout } from "@/features/F5/approve-complete/queue-card";
import { queueKey, type QueueRow } from "@/features/F5/approve-complete/queue";
import type { RowActs } from "@/features/F5/approve-complete/queue-table";
import { call } from "@/lib/api/call";
import { targetOfRow, useAnswerCall } from "./answer";
import { fill, memberOf, newKey, readPreview, rec, surnameOf, type Preview } from "./pass-dialog";
import { HandoverRow, PickDialog, QueueCardMobile, type QueueCardView } from "./views";

export interface QueueRowSectionProps {
  row: QueueRow;
  acts: RowActs;
  /** 今の行（children） */
  fallback: ReactNode;
}

const ACTS = ["人を決める", "自分が持つ"] as const;
const GONE = "E-HND-005";

/** 「MM/DD」（チケットの期限 YYYY-MM-DD から・読めなければ空） */
const dayOf = (dueOn: string | null): string => (dueOn ? `${dueOn.slice(5, 7)}/${dueOn.slice(8, 10)}` : "");

// ---------------------------------------------------------------- 人を決める：相手を選ぶ小窓（そのチケットの下見の人）
interface AssignFlowProps {
  row: QueueRow;
  groupName: string;
  /** 閉じる（やめる・× ・Esc・決まった後・もう決まっていた後） */
  onClose: () => void;
  /** 承認待ちを読み直す */
  onRefresh: () => Promise<unknown>;
}

/** 置かれた時が「開いた時」。下見を 1 回読み、読めてから選ばせる。選ぶとすぐ claim の口（間に小窓を挟まない） */
function AssignFlow({ row, groupName, onClose, onRefresh }: AssignFlowProps) {
  const notify = useNotify();
  const [pv, setPv] = useState<Preview | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const started = useRef(false);
  const sending = useRef(false);
  const last = useRef<{ memberId: string; key: string } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 下見を 1 回読む。読めなければ小窓の中に知らせと「もう一度読む」を出す */
  const read = async () => {
    setLoadError(undefined);
    const failed = (code: string) => {
      if (!alive.current) return;
      setLoadError(catalogMessage(code));
      setLoaded(true);
    };
    try {
      const r = await call("previewTicketHandover", { params: { id: row.ticket_id }, screenId: "approvals" });
      if (!alive.current) return;
      if (!r.ok) return r.status === 401 ? onClose() : failed(errorCodeOf(r));
      const p = readPreview(r.data);
      if (p === null) return failed(PAGE_ERROR.loadFailed);
      setPv(p);
      setLoaded(true);
    } catch {
      failed(PAGE_ERROR.offline);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void read();
    // 開いた時に 1 回だけ読む
  }, []);

  const members = useMemo(() => (pv ? pv.candidates.map(memberOf) : []), [pv]);
  // この渡し自身が返事待ちなので、下見の「いま返事を待っている」（waiting）では止めない。AI の実行・承認待ち・閉じたチケットは止める
  const blocked = pv && pv.blocked !== null && pv.blocked !== "waiting" ? blockedOf(pv.blocked) : undefined;

  const pick = async (memberId: string) => {
    if (sending.current) return;
    const who = pv?.candidates.find((c) => c.id === memberId);
    if (!who) return;
    sending.current = true;
    setNotice(undefined);
    if (last.current?.memberId !== memberId) last.current = { memberId, key: newKey() };
    try {
      const r = await call("claimTicketHandover", {
        params: { id: row.id },
        idempotencyKey: last.current.key,
        screenId: "approvals",
        body: { member_id: memberId },
      });
      if (r.ok) {
        onClose();
        notify(`${surnameOf(who.name)}さんに配りました`);
        await onRefresh();
        return;
      }
      if (r.status === 401) return; // 入り直し（共通の扱い）
      const code = errorCodeOf(r);
      const text = fill(catalogMessage(code), rec(r.body["detail"]));
      if (code === GONE) {
        onClose();
        notify(text, { type: "error" });
        await onRefresh();
        return;
      }
      if (alive.current) setNotice(text);
    } catch {
      if (alive.current) setNotice(catalogMessage(PAGE_ERROR.offline));
    } finally {
      sending.current = false;
    }
  };

  return (
    <PickDialog
      open={loaded}
      members={members}
      intro={`グループ「${groupName}」の人から担当者を選びます。選ぶとすぐその人が担当者になり、お知らせが届きます`}
      query={query}
      onQueryChange={setQuery}
      onPick={(id) => void pick(id)}
      onClose={onClose}
      target={targetOfRow(row)}
      {...(blocked ? { blocked } : {})}
      {...(loadError ? { notice: loadError, onRetry: () => void read() } : notice ? { notice } : {})}
    />
  );
}

/** 小窓の上の橙の箱の文（AI の実行・承認待ち・閉じたチケット） */
function blockedOf(b: NonNullable<Preview["blocked"]>): string {
  return catalogMessage(b === "closed" ? "E-HND-009" : "E-HND-003");
}

// ---------------------------------------------------------------- 行・カードが共通で使う動き
function useGroupRow(row: QueueRow) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { busy, send } = useAnswerCall(row.id, "approvals");
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: queueKey });
  const f = handoverFieldsOf(row);
  const groupName = f.toScopeName ?? "";

  /** 自分が持つ：答える口に accept（claim は呼ばない） */
  const take = async () => {
    setError(null);
    const out = await send({ decision: "accept" });
    if (out === null) return; // 送っている間の 2 回目
    if (out.ok) {
      await refresh();
      notify(`${row.ticket_number} の担当者になりました`);
      return;
    }
    if (out.unauthorized) return; // 入り直し（共通の扱い）
    if (out.code === GONE) {
      // もう決まっていた（別の人が先に持った・取り消された）：読み直して行を消し、文を知らせる
      await refresh();
      notify(catalogMessage(GONE), { type: "error" });
      return;
    }
    setError(out.text); // 断れない（E-HND-152）・送れない など：行に残し、行の中に出す
  };

  const dialog = assigning ? (
    <AssignFlow row={row} groupName={groupName} onClose={() => setAssigning(false)} onRefresh={refresh} />
  ) : null;

  return {
    busy,
    error,
    groupName,
    dialog,
    onAct: (label: string) => (label === "人を決める" ? setAssigning(true) : void take()),
  };
}

const subOf = (groupName: string): string => `グループ「${groupName}」に配られました ・ 担当者を決めてください`;
const hrefOf = (row: QueueRow): string => `/tickets/${row.ticket_id}`;

/** 表の 1 行 */
function GroupTableRow({ row }: { row: QueueRow }) {
  const a = useGroupRow(row);
  const from = row.from_name ?? "";
  return (
    <>
      <HandoverRow
        row={{
          id: row.id,
          number: row.ticket_number,
          title: row.title,
          sub: subOf(a.groupName),
          from,
          due: dayOf(row.due_on),
          ...(row.due_on !== null && row.due_on < jstDay(0) ? { late: true } : {}),
          acts: ACTS,
        }}
        href={hrefOf(row)}
        busy={a.busy}
        onAct={a.onAct}
        {...(a.error ? { error: a.error } : {})}
      />
      {a.dialog}
    </>
  );
}

/** スマホの 1 枚（K-412 の既定のカードの代わりに出る） */
function GroupCard({ row }: { row: QueueRow }) {
  const a = useGroupRow(row);
  const day = dayOf(row.due_on);
  const card: QueueCardView = {
    id: row.id,
    number: row.ticket_number,
    meta: `渡された ・ ${row.from_name ?? ""}さんから`,
    title: row.title,
    sub: subOf(a.groupName),
    ...(day ? { note: `期限 ${day}` } : {}),
    acts: ACTS,
  };
  return (
    <>
      <QueueCardMobile
        card={card}
        href={hrefOf(row)}
        busy={a.busy}
        onAct={a.onAct}
        {...(a.error ? { error: a.error } : {})}
      />
      {a.dialog}
    </>
  );
}

export function QueueRowGroup({ row, acts, fallback }: QueueRowSectionProps): ReactNode {
  void acts;
  void fallback;
  return useQueueLayout() === "card" ? <GroupCard row={row} /> : <GroupTableRow row={row} />;
}
