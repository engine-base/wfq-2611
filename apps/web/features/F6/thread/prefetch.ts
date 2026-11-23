// やり取りの先読み（K-392）：詳細を開いたとき、詳細の答えを待たずに最初の 20 件を 1 回読み始める。
//   読み方は use-timeline.ts の timelineQuery と同じ鍵・同じ器なので、後で useTimeline が付いても 2 回目の口を呼ばない。
//   名前と引数は K-382 の置いた形のまま（F6 の prefetch.ts の usePrefetchDetail がこれを呼ぶ）。
//   一覧から同じチケットへ画面の中で戻ったときは、前に開いたときの答え・読めなかった印・最後に開いた時刻の印が
//   QueryClient に残っているので、詳細を開き直したら捨てて読み直す（新しい書き込み・「新しい」の印・読んでいない数を古いままにしない）。
//   いま読んでいる最中・この詳細を開いた後に読んだ答えは捨てない（開いた間にちょうど 1 回）。
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { timelineKey, timelineQuery } from "./use-timeline";

/** この詳細を開く前の答え（読んだ・読めなかった）を捨てる。開いた後の答えと読んでいる最中の物は残す */
function dropOlderThan(qc: QueryClient, id: string, openedAt: number): void {
  const keys = [timelineKey(id), ["ticket-timeline-seen", id] as const];
  for (const queryKey of keys)
    for (const q of qc.getQueryCache().findAll({ queryKey })) {
      const s = q.state;
      if (s.fetchStatus === "fetching") continue;
      if (Math.max(s.dataUpdatedAt, s.errorUpdatedAt) < openedAt)
        qc.removeQueries({ queryKey: q.queryKey, exact: true });
    }
}

export function usePrefetchThread(id: string, enabled: boolean): void {
  const qc = useQueryClient();
  const openedAt = useRef(Date.now());
  useEffect(() => {
    if (!enabled) return;
    dropOlderThan(qc, id, openedAt.current);
    void qc.prefetchQuery(timelineQuery(id));
  }, [qc, id, enabled]);
}
