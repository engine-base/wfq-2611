"use client";
// 承認待ち（K-161・道 /approvals）。自分が決めるもの（承認する人＝今の担当者）だけを、期限で区切って並べる（日本時間の日付・D-128.36）。
//   1 回 20 件。末尾の「もっと見る」で、口がくれた続きの印（meta.cursor）を渡して最後の行の次から読み足す（D-131.9）。
//   見出しの横と左のメニューの「承認待ち」に同じ数（口の meta.counts.total）。文は全部文字として出す（HTML を作らない）。
//   行の「承認する」（K-180）：取り消せる操作で人が見る項目が無い行だけ、その場で承認する。答えが来るまでどの行も押せない。
//   決まっていた（409）・消されていた（404）は知らせ（role=alert）に正本の文を出し、どの答えでも一覧を読み直す。行の「差し戻す」と小窓は K-181（口は K-163）
//   行の「承認する」は確かめの小窓（approve-confirm.tsx・K-229・D-143.4）を開くだけで、口は小窓の主ボタンで呼ぶ
//   形はキャンバス Approvals（K-231）：見出しの帯（「あなたが決めるもの N 件」・続けて裁く）と、本文の箱にカード 1 つ（queue-table.tsx）。
//   空はキャンバス ApEmpty：点線の箱に ✓・見出し・説明・決めた履歴。続けて裁く・決めた履歴の画面はまだ無いので押せない（D-145.9）
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Callout, Empty, Loading, Toaster } from "@/components/k";
import { call, type CallErr } from "@/lib/api/call";
import { messageOf } from "./message";
import { ApproveConfirm } from "./approve-confirm";
import { ReturnDialog } from "./return-dialog";
import { getToken } from "@/lib/api/client";
import { TicketShell } from "@/features/F4/create-ticket/ticket-shell";
import { QueueCard } from "./queue-table";
import "./approve.css";

export interface QueueRow {
  kind: string;
  id: string;
  ticket_id: string;
  ticket_number: string;
  title: string;
  from_member_id: string | null;
  from_name: string | null;
  check_summary: string;
  due_on: string | null;
  decide_inline: boolean;
  irreversible: boolean;
  primary_action: "approve" | "open";
  secondary_action: "return";
  note: string | null;
  created_at: string;
}
interface QueuePage {
  rows: QueueRow[];
  total: number;
  cursor: string | null;
}

export const queueKey = ["k63", "queue"] as const;
const LOAD_FAILED = "承認待ちを読み込めませんでした。もう一度お試しください";

class QueueReadError extends Error {}

async function readPage(cursor: string | null): Promise<QueuePage> {
  const r = await call("listApprovalQueue", {
    query: cursor ? { cursor } : {},
    screenId: "approvals",
  });
  if (!r.ok) throw new QueueReadError(r.code);
  const counts = (r.meta["counts"] ?? {}) as { total?: number };
  const rows = r.data as unknown as QueueRow[];
  return { rows, total: Number(counts.total ?? rows.length), cursor: r.meta.cursor ?? null };
}

export function ApprovalsPage() {
  const q = useInfiniteQuery({
    queryKey: queueKey,
    enabled: typeof window !== "undefined" && !!getToken(),
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readPage(pageParam),
    getNextPageParam: (last) => last.cursor,
  });
  useEffect(() => {
    if (!getToken()) window.location.replace(`/login?next=${encodeURIComponent("/approvals")}`);
  }, []);
  const pages = q.data?.pages ?? [];
  const total = pages.at(-1)?.total ?? 0;
  const rows = pages.flatMap((p) => p.rows);
  return (
    <TicketShell screen="approvals" crumbs={[{ label: "承認待ち" }]} counts={{ approvals: total }}>
      <section className="k-root k-page" aria-labelledby="approvals-title">
        <header className="k-page-head k-ap-head">
          <h1 id="approvals-title">承認待ち</h1>
          {q.data ? (
            <p className="k-page-sub">
              あなたが決めるもの <span className="k63-count">{total} 件</span>
            </p>
          ) : null}
          {q.data && !q.isError && rows.length > 0 ? (
            <Button className="k-ap-next" aria-disabled="true" tabIndex={-1}>{`続けて裁く（${total} 件）`}</Button>
          ) : null}
        </header>
        <div className="k-ap-body">
          {q.isError ? (
            <div className="k-state" role="alert">
              <p className="k-state-body">{LOAD_FAILED}</p>
              <div className="k-state-actions">
                <Button onClick={() => void q.refetch()}>もう一度</Button>
              </div>
            </div>
          ) : !q.data ? (
            <Loading />
          ) : (
            <QueueView
              rows={rows}
              total={total}
              more={q.hasNextPage}
              loadingMore={q.isFetchingNextPage}
              onMore={() => void q.fetchNextPage()}
            />
          )}
        </div>
      </section>
    </TicketShell>
  );
}

interface QueueViewProps {
  rows: QueueRow[];
  total: number;
  more: boolean;
  loadingMore: boolean;
  onMore: () => void;
}

/** 空（ApEmpty）：点線の箱に ✓・見出し・説明・決めた履歴（画面がまだ無いので押せない） */
function NothingToDecide() {
  return (
    <Empty
      icon="✓"
      title="いま決めるものはありません"
      action={
        <Button variant="outlined" aria-disabled="true" tabIndex={-1}>
          決めた履歴
        </Button>
      }
    >
      AI が成果物を作り、確かめが終わると、ここに並びます
    </Empty>
  );
}

function QueueView({ rows, total, more, loadingMore, onMore }: QueueViewProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set()); // 承認した行は、読み直しの前でも一覧から外す
  const sending = useRef(false); // 答えが来るまで 2 本目を送らない（押せない間の click も含む）
  const [returning, setReturning] = useState<QueueRow | null>(null); // 差し戻しの小窓を開いている承認（K-181）
  const [confirming, setConfirming] = useState<QueueRow | null>(null); // 確かめの小窓を開いている承認（K-229）
  const reload = () => qc.invalidateQueries({ queryKey: queueKey });
  const failed = async (r: CallErr) => {
    if (r.status !== 401) setNotice(messageOf(r)); // 409・404：知らせを出して一覧を読み直す（401 は入り直し）
    await reload();
  };
  const approve = async (row: QueueRow) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(row.id);
    setNotice(null);
    try {
      const r = await call("approveApproval", { params: { id: row.id }, body: {}, screenId: "approvals" });
      setConfirming(null);
      if (r.ok) setDone((d) => new Set([...d, row.id]));
      else if (r.status !== 401) setNotice(messageOf(r)); // 401 は入り直し（共通の扱い）
      await qc.invalidateQueries({ queryKey: queueKey });
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };
  const dialog = returning ? (
    <ReturnDialog
      approvalId={returning.id}
      target={`${returning.ticket_number} ${returning.title}`}
      screenId="approvals"
      open
      onOpenChange={(o) => {
        if (!o) setReturning(null);
      }}
      onDone={reload} // 差し戻した行は読み直しで消える（作り直しの後は新しい承認待ちとして並ぶ）
      onFailed={failed}
    />
  ) : null;
  const confirm = (
    <ApproveConfirm
      open={confirming !== null}
      onOpenChange={(o) => {
        if (!o && busy === null) setConfirming(null);
      }}
      irreversible={confirming?.irreversible ?? false}
      cautions={[]}
      busy={busy !== null}
      onConfirm={() => {
        if (confirming) void approve(confirming);
      }}
    />
  );
  const shown = rows.filter((r) => !done.has(r.id));
  return (
    // 小さな知らせ（渡された行を受けた・もう決まっていた・K-412）の置き場。最後の 1 件で空の画面に替わっても消えないよう、一覧の入れ物に置く
    <Toaster>
      {notice ? <Callout tone="danger">{notice}</Callout> : null}
      {dialog}
      {confirm}
      {shown.length === 0 ? (
        <NothingToDecide />
      ) : (
        <QueueCard rows={shown} total={total} acts={{ busy, onApprove: setConfirming, onReturn: setReturning }} />
      )}
      {more && shown.length > 0 ? (
        <Button className="k-ap-more" variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={onMore}>
          もっと見る
        </Button>
      ) : null}
    </Toaster>
  );
}
