"use client";
// やり取りを読む器（K-392）。口を呼ぶのはこのファイルだけ（区画のファイルは口を呼ばず、ここの値と関数を使う）。
//   読み方の器 timelineQuery は、先読み（thread/prefetch.ts）と useTimeline が同じ物を使う（同じ鍵・同じ読み方・詳細を開いたときに 1 回だけ）。
//   書いた・直した・消した行を一覧に足す・替える口（appendItem・replaceItem・setStar）は、問い合わせの答えを書き替える（区画をまたぐのは問い合わせの鍵だけ）。
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { runsKey } from "@/features/F5/delegate/use-run";
import type { RunView as DelegateRun } from "@/features/F5/delegate/use-run";
import type { PersonRow, TimelineItem } from "./to-items";
import { THREAD_PAGE, type Filter } from "./views";

export type { Filter };

/** 1 回の答え（古い順の行と、数の meta） */
export interface TimelinePage {
  items: TimelineItem[];
  meta: TimelineMeta;
}
export interface TimelineMeta {
  older_count: number;
  new_count: number;
  mine_count: number;
  post_count: number;
  people?: PersonRow[];
}

const SCREEN = "tickets";

/** 問い合わせの鍵。絞り込みを付けなければ、その詳細のやり取りの全部（読み直しの印に使える・K-398） */
export function timelineKey(id: string, filter?: Filter): readonly string[] {
  return filter ? ["ticket-timeline", id, filter] : ["ticket-timeline", id];
}

/** 読めなかった答え（状態を持つ） */
class ReadError extends Error {
  constructor(readonly status: number) {
    super(`timeline ${status}`);
  }
}

const metaOf = (m: Record<string, unknown>): TimelineMeta => {
  const n = (k: string): number => (typeof m[k] === "number" ? (m[k] as number) : 0);
  return {
    older_count: n("older_count"),
    new_count: n("new_count"),
    mine_count: n("mine_count"),
    post_count: n("post_count"),
    ...(Array.isArray(m["people"]) ? { people: m["people"] as PersonRow[] } : {}),
  };
};

const queryOf = (filter: Filter, before?: TimelineItem) => ({
  limit: THREAD_PAGE,
  ...(filter !== "all" ? { filter } : {}),
  ...(before ? { before_at: before.at, before_id: before.id } : {}),
});

async function readPage(id: string, filter: Filter): Promise<TimelinePage> {
  const r = await call("listTicketTimeline", { params: { id }, query: queryOf(filter), screenId: SCREEN });
  if (!r.ok) throw new ReadError(r.status);
  return { items: r.data as unknown as TimelineItem[], meta: metaOf(r.meta) };
}

/** 読み方の器。先読みの答えを付いたときに読み直さず、先読みが失敗した後に付いても既定の読み直しをしない */
export function timelineQuery(id: string, filter: Filter = "all") {
  return {
    queryKey: timelineKey(id, filter),
    queryFn: () => readPage(id, filter),
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
  } as const;
}

// ---------------------------------------------------------------- 一覧を書き替える（書く・直す・消す・☆）
type Cache = TimelinePage | undefined;
const touchAll = (qc: QueryClient, id: string, fn: (p: TimelinePage, filter: Filter) => TimelinePage) => {
  for (const f of ["all", "talk", "mine"] as const)
    qc.setQueryData<Cache>(timelineKey(id, f), (p) => (p ? fn(p, f) : p));
};

/** 書いた行を、いちばん新しい所に足す（話だけとすべてへ。自分あてには足さない） */
export function appendItem(qc: QueryClient, id: string, item: TimelineItem): void {
  touchAll(qc, id, (p, f) => ({
    items: f === "mine" ? p.items : [...p.items, item],
    meta: { ...p.meta, post_count: p.meta.post_count + (item.kind === "post" ? 1 : 0) },
  }));
}
/** 直した・消した行で、同じ id の行を替える */
export function replaceItem(qc: QueryClient, id: string, itemId: string, item: TimelineItem): void {
  touchAll(qc, id, (p) => ({ ...p, items: p.items.map((x) => (x.id === itemId ? item : x)) }));
}
/** ☆ の数と自分が押しているかを替える */
export function setStar(qc: QueryClient, id: string, itemId: string, stars: number, starred: boolean): void {
  touchAll(qc, id, (p) => ({
    ...p,
    items: p.items.map((x) => (x.id === itemId && x.message ? { ...x, message: { ...x.message, stars, starred } } : x)),
  }));
}

// ---------------------------------------------------------------- 最後に開いた時刻
const seenKey = (id: string) => ["ticket-timeline-seen", id] as const;
/** 最後に開いた時刻を書く。1 回開いた画面では 1 回だけ。失敗しても画面には何も出さない（次に開いたときにもう一度） */
export function markSeen(qc: QueryClient, id: string, at: string): void {
  if (qc.getQueryData(seenKey(id))) return;
  qc.setQueryData(seenKey(id), true);
  void call("markTicketTimelineSeen", { params: { id }, body: { seen_at: at }, screenId: SCREEN }).catch(
    () => undefined,
  );
}

// ---------------------------------------------------------------- 画面の器
export interface TimelineState {
  filter: Filter;
  setFilter: (f: Filter) => void;
  /** 古い順の行（まだ読めていなければ null） */
  items: TimelineItem[] | null;
  /** 読めなかった */
  failed: boolean;
  meta: TimelineMeta | null;
  /** そのチケットを見られる人（書く欄の候補） */
  people: PersonRow[];
  /** 「もう一度読む」 */
  retry: () => void;
  older: () => void;
  olderBusy: boolean;
  olderError: string | null;
  /** タブを開いたとき：いちばん新しい行の時刻を書く（行が無ければ何もしない） */
  seen: () => void;
  append: (item: TimelineItem) => void;
  replace: (itemId: string, item: TimelineItem) => void;
  star: (itemId: string, stars: number, starred: boolean) => void;
}

const OLDER_FAILED = "やり取りを読み込めませんでした";

/** 詳細（頁）のやり取り。layout が page のときだけ読む */
export function useTimeline(id: string, enabled: boolean): TimelineState {
  const qc = useQueryClient();
  const [filter, setFilterState] = useState<Filter>("all");
  const q = useQuery({ ...timelineQuery(id, filter), enabled });
  // タブの数・自分あて・飛び先の数と見られる人は、どの絞り込みで読んでも同じ。読めた最後の物を持ち続ける（絞り込みを替えている間も消さない）
  const [meta, setMeta] = useState<TimelineMeta | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const data = q.data;
  useEffect(() => {
    if (!data) return;
    setMeta(data.meta);
    if (data.meta.people?.length) setPeople(data.meta.people);
  }, [data]);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const busy = useRef(false);
  const items = data?.items ?? null;

  const setFilter = useCallback(
    (f: Filter) => {
      if (f === filter) return;
      // 覚えている答えを使わず、替えるたびに読む
      qc.removeQueries({ queryKey: timelineKey(id, f), exact: true });
      setOlderError(null);
      setFilterState(f);
    },
    [qc, id, filter],
  );
  const retry = useCallback(() => {
    void q.refetch();
  }, [q]);
  const older = useCallback(() => {
    const first = data?.items[0];
    if (!first || busy.current) return;
    busy.current = true;
    setOlderBusy(true);
    setOlderError(null);
    void call("listTicketTimeline", { params: { id }, query: queryOf(filter, first), screenId: SCREEN })
      .then((r) => {
        if (!r.ok) {
          setOlderError(OLDER_FAILED);
          return;
        }
        const rows = r.data as unknown as TimelineItem[];
        const left = metaOf(r.meta).older_count;
        qc.setQueryData<Cache>(timelineKey(id, filter), (p) =>
          p ? { items: [...rows, ...p.items], meta: { ...p.meta, older_count: left } } : p,
        );
      })
      .catch(() => setOlderError(OLDER_FAILED))
      .finally(() => {
        busy.current = false;
        setOlderBusy(false);
      });
  }, [data, id, filter, qc]);
  const seen = useCallback(() => {
    const all = qc.getQueryData<Cache>(timelineKey(id, "all")) ?? data;
    const newest = all?.items[all.items.length - 1];
    if (newest) markSeen(qc, id, newest.at);
  }, [qc, id, data]);

  return {
    filter,
    setFilter,
    items,
    failed: q.isError,
    meta,
    people,
    retry,
    older,
    olderBusy,
    olderError,
    seen,
    append: (item) => appendItem(qc, id, item),
    replace: (itemId, item) => replaceItem(qc, id, itemId, item),
    star: (itemId, stars, starred) => setStar(qc, id, itemId, stars, starred),
  };
}

/** 実行の一覧（詳細が読んだ答え）。AI の実行の 1 枚を押したときに出す板が使う。ここでは読み込まず、同じ鍵の答えを見るだけ */
export function useRunList(id: string): DelegateRun[] | null {
  const q = useQuery<DelegateRun[]>({ queryKey: runsKey(id), enabled: false });
  return q.data ?? null;
}
