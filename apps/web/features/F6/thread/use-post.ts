"use client";
// 書き込む器（K-393）。書く欄の口を呼ぶのはこのファイルだけ（区画のファイル composer.tsx は口を呼ばず、ここの値と関数を使う）。
//   送る値は本文・@ の人・知らせる人・引用元の 4 つだけ（K-385）。送っている間は 2 本目を送らない。冪等キーは送る中身が同じ間は同じ物を使う。
//   失敗の文：網の切れ・5xx（正本に無い番号）は部品の字（views.tsx の Composer の既定）・正本の番号はその文・422 は項目の理由・
//   404 E-PAGE-001（選べない人・引用元）は部品の字「選べない人がいます…」を出し、読む口を 1 回読み直す（候補と知らせる人から居なくなった人を外す）。
//   401 は前からの共通の扱い（call が入り直しへ送る・書きかけは端末に残る）。409 は詳細を読み直すだけ（afterPost・reset しない）
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CATALOG } from "@kaname/errors/catalog";
import { useCallback, useMemo, useRef, useState } from "react";
import { errorCodeOf, errorText } from "@/components/k/error-of";
import { call } from "@/lib/api/call";
import { getToken } from "@/lib/api/client";
import { me } from "@/lib/auth/ext";
import type { ComposerStageState } from "./composer-stage";
import { excerpt } from "./mention";
import type { QuoteRef, TimelineItem } from "./to-items";
import { timelineKey, type TimelinePage } from "./use-timeline";

const SCREEN = "tickets";
const ONCE = { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
/** 404 E-PAGE-001 を書く口が返した（@ の人・知らせる人・引用元が選べない）ときの字（K-385 の申し送り・どの欄かは言えない） */
export const UNPICKABLE_TEXT = "選べない人がいます。選び直してください（書いた字は残っています）";
/** 段の欄（K-396 の状態 ▾ が受ける項目） */
const STAGE_FIELDS = ["hold_reason", "resume_condition", "stage_key"] as const;
const UNPICKABLE_CODE = "E-PAGE-001";

/** 見ている人の id（自分を候補・知らせる人に出さない）。前からの鍵 ["me"] の答えを使う（二重に読まない） */
export function useMeId(): string | null {
  const signedIn = typeof window !== "undefined" && Boolean(getToken());
  const who = useQuery({ queryKey: ["me"], queryFn: me, enabled: signedIn, ...ONCE });
  return who.isSuccess ? who.data.member_id : null;
}

/** 引用の頭の字（頭の 2 行・3 行目からは「…」）。元の書き込みの本文を一覧の答えから引き、無ければ渡された頭の字 */
export function useQuoteText(ticketId: string, quote: QuoteRef | null): string | null {
  const qc = useQueryClient();
  return useMemo(() => {
    if (!quote) return null;
    for (const f of ["all", "talk", "mine"] as const) {
      const page = qc.getQueryData<TimelinePage>(timelineKey(ticketId, f));
      const row = page?.items.find((x) => x.id === quote.id);
      if (row?.message) return excerpt(row.message.body);
    }
    return quote.excerpt;
  }, [qc, ticketId, quote]);
}

export interface PostInput {
  body: string;
  mentionIds: string[];
  notifyIds: string[];
  quoteId: string | null;
}
export type PostResult = { ok: true; item: TimelineItem } | { ok: false };

export interface PostState {
  sending: boolean;
  /** 部品に渡す失敗の字（null なら出さない） */
  error: string | null;
  /** 部品の既定の字（送れませんでした…）を出す */
  failed: boolean;
  send: (input: PostInput) => Promise<PostResult>;
}

const keyOf = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/** 正本の番号の文（正本に無ければ答えの種類から選ぶ） */
const catalogText = (r: Parameters<typeof errorCodeOf>[0]): string => errorText(errorCodeOf(r)).entry.message;

export function usePost(ticketId: string, stage: ComposerStageState): PostState {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const idem = useRef<{ sig: string; key: string } | null>(null);

  const keyFor = (sig: string): string => {
    if (idem.current?.sig !== sig) idem.current = { sig, key: keyOf() };
    return idem.current.key;
  };
  const fail = (text: string | null) => {
    setError(text);
    setFailed(text === null);
  };

  const send = useCallback(
    async (input: PostInput): Promise<PostResult> => {
      if (busy.current) return { ok: false };
      const extra = stage.fields();
      if (!extra.ok) return { ok: false };
      const body = {
        body: input.body,
        mention_member_ids: input.mentionIds,
        notify_member_ids: input.notifyIds,
        quote_of_id: input.quoteId,
        ...extra.body,
      };
      const idempotencyKey = keyFor(JSON.stringify(body));
      busy.current = true;
      setSending(true);
      try {
        const r = await call("createTicketMessage", {
          params: { id: ticketId },
          body,
          idempotencyKey,
          screenId: SCREEN,
        });
        if (r.ok) {
          setError(null);
          setFailed(false);
          idem.current = null;
          await stage.afterPost();
          stage.reset();
          return { ok: true, item: r.data as unknown as TimelineItem };
        }
        if (r.status === 401) {
          setError(null);
          setFailed(false);
          return { ok: false };
        }
        if (r.status === 404 && r.code === UNPICKABLE_CODE) {
          fail(UNPICKABLE_TEXT);
          // 見られる人を読み直す（候補と知らせる人の札から居なくなった人を外す）。送り直さない
          void qc.refetchQueries({ queryKey: timelineKey(ticketId), type: "active" });
          return { ok: false };
        }
        if (r.status === 409) {
          fail(catalogText(r));
          await stage.afterPost();
          return { ok: false };
        }
        if (r.status === 422) {
          const staged = Object.fromEntries(
            Object.entries(r.fields).filter(([k]) => (STAGE_FIELDS as readonly string[]).includes(k)),
          );
          if (Object.keys(staged).length) stage.setErrors(staged);
          const reason = r.fields["body"] ?? Object.values(r.fields)[0];
          fail(reason ?? catalogText(r));
          return { ok: false };
        }
        // 5xx で正本に無い番号は部品の既定の字（送れませんでした…）
        if (r.status >= 500 && !(r.code in CATALOG)) {
          fail(null);
          return { ok: false };
        }
        fail(catalogText(r));
        return { ok: false };
      } catch {
        // 網の切れ（答えが届かない）
        fail(null);
        return { ok: false };
      } finally {
        busy.current = false;
        setSending(false);
      }
    },
    // keyFor・fail は ref と state の setter だけを触る
    [ticketId, stage, qc],
  );

  return { sending, error, failed, send };
}
