"use client";
// 決定の一覧の先読み（K-397）：詳細と同時に決定の一覧を 1 回読む。区画が付いたときに同じ鍵の答えをそのまま使う（読み直さない）。
//   頁の形の詳細は、区画の有無が詳細の答えで決まる前に読む（答えを待ってから読むと直列の 2 段目になる）。区画の無い種別では描かないだけ。
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { decisionsQuery } from "./use-decisions";

export function usePrefetchDecisions(id: string, enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (enabled) void qc.prefetchQuery(decisionsQuery(id));
  }, [qc, id, enabled]);
}
