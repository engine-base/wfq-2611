"use client";
// 右のパネルのタブと題名の下の差し込み口の先（K-392）。頁の詳細（layout が page）だけがやり取りを読む。
//   口を呼ぶのは use-timeline.ts（器）だけ。ここは器の値を部品 views.tsx に渡して描く入れ物。
//   一覧の右に開く詳細（layout が side）はパネルを描かないので、読みもしない（先読みも page のときだけ）。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { RunLogDialog } from "@/features/F5/delegate/run-log";
import { usePanelTab } from "../scope";
import { TalkComposer } from "./composer";
import { FromMessageAction } from "./from-message";
import { MessageMenu } from "./message-menu";
import { readOrder, writeOrder } from "./order";
import { quoteOf, toItems, type QuoteRef } from "./to-items";
import { useRunList, useTimeline } from "./use-timeline";
import { Post, TalkJump, TalkTabs, ThreadEmpty, ThreadFailed, ThreadFilters, ThreadList, type Order } from "./views";

/** 右のパネルのタブと中身（attrs＝今の属性の中身・children＝今のタブと中身） */
export function PanelTabsSlot({
  ticket,
  attrs,
  children,
}: {
  ticket: SlotTicket;
  children: ReactNode;
  attrs: ReactNode;
}): ReactNode {
  if (ticket.layout !== "page") return <>{children}</>;
  return <PagePanel ticket={ticket} attrs={attrs} />;
}

function PagePanel({ ticket, attrs }: { ticket: SlotTicket; attrs: ReactNode }): ReactNode {
  const scope = usePanelTab();
  const tab = scope?.tab ?? "attr";
  const tl = useTimeline(ticket.id, true);
  const runs = useRunList(ticket.id);
  const [order, setOrder] = useState<Order>(readOrder);
  const [quote, setQuote] = useState<QuoteRef | null>(null);
  const [runLogOpen, setRunLogOpen] = useState(false);
  const openRun = useCallback(() => setRunLogOpen(true), []);
  const items = useMemo(() => toItems(tl.items ?? [], openRun), [tl.items, openRun]);
  const rowById = useMemo(() => new Map((tl.items ?? []).map((r) => [r.id, r])), [tl.items]);
  // タブ「やり取り」を開いたら最後に開いた時刻を書く（読めてから。1 回開いた画面で 1 回）
  const ready = tl.items !== null;
  const seen = tl.seen;
  useEffect(() => {
    if (tab === "talk" && ready) seen();
  }, [tab, ready, seen]);
  const pickOrder = (o: Order) => {
    setOrder(o);
    writeOrder(o);
  };
  const count = tl.meta?.new_count;
  return (
    <>
      <TalkTabs active={tab} me={ticket.me} {...(count ? { count } : {})} onTab={(t) => scope?.setTab(t)} />
      {tab === "attr" ? (
        attrs
      ) : (
        <div className="k-talk" id="ticket-talk">
          <ThreadFilters
            active={tl.filter}
            {...(tl.meta?.mine_count ? { mineCount: tl.meta.mine_count } : {})}
            onFilter={tl.setFilter}
            order={order}
            onOrder={pickOrder}
          />
          {tl.failed ? (
            <ThreadFailed onRetry={tl.retry} />
          ) : tl.items === null ? (
            <div className="k-talk-thread" aria-busy="true">
              <div className="k-talk-center">
                <p>読み込んでいます</p>
              </div>
            </div>
          ) : tl.items.length === 0 ? (
            <ThreadEmpty />
          ) : (
            <ThreadList
              items={items}
              order={order}
              {...(tl.meta?.older_count ? { olderCount: tl.meta.older_count } : {})}
              onOlder={tl.older}
              olderBusy={tl.olderBusy}
              {...(tl.olderError ? { olderError: tl.olderError } : {})}
              renderPost={(post) => {
                const row = rowById.get(post.id);
                if (!row) return <Post post={post} />;
                return (
                  <MessageMenu
                    ticket={ticket}
                    item={row}
                    post={post}
                    people={tl.people}
                    onQuote={() => setQuote(quoteOf(row))}
                    decideSlot={<FromMessageAction ticket={ticket} item={row} post={post} />}
                  />
                );
              }}
            />
          )}
          <TalkComposer
            ticket={ticket}
            people={tl.people}
            quote={quote}
            onClearQuote={() => setQuote(null)}
            onPosted={tl.append}
          />
          <RunLogDialog runs={runs} open={runLogOpen} onOpenChange={setRunLogOpen} />
        </div>
      )}
    </>
  );
}

/** 題名の行のすぐ下（スマホの「やり取り N ↓」の飛び先） */
export function TitleSlot({ ticket }: { ticket: SlotTicket }): ReactNode {
  const scope = usePanelTab();
  const page = ticket.layout === "page";
  const tl = useTimeline(ticket.id, page);
  const posts = tl.meta?.post_count ?? 0;
  if (!page || posts < 1) return null;
  return (
    <TalkJump
      count={posts}
      onJump={() => {
        scope?.setTab("talk");
        // タブが替わって一覧が描かれてから、パネルのやり取りまで動く
        requestAnimationFrame(() => document.getElementById("ticket-talk")?.scrollIntoView({ block: "start" }));
      }}
    />
  );
}
