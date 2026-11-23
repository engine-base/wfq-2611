"use client";
// 決定ログの区画が読む・足す口のつなぎ（K-397）。口は契約の listTicketDecisions・createTicketDecision と、前からの listMembers だけ。
//   一覧の問い合わせの器 decisionsQuery は先読み（prefetch.ts）と区画が同じ物を使う（先読みの答えを読み直さない・失敗の後に既定の読み直しをしない）
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { PAGE_ERROR } from "@/components/k/error-of";
import { catalogMessage, messageOf } from "@/features/F5/approve-complete/message";
import { call } from "@/lib/api/call";
import { me } from "@/lib/auth/ext";
import type { DecisionFormValues, PersonOption } from "./views";
import type { DecisionRow } from "./to-view";

const SCREEN = "tickets";
const ONCE = { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
/** 決めた人の候補を読めなかったときの欄の下の文（仮・代表に聞くことに書いた） */
export const PEOPLE_FAILED = "ほかのメンバーを読み込めませんでした（自分を選べます）";

export interface DecisionsAnswer {
  rows: DecisionRow[];
  canWrite: boolean;
}

export const decisionsKey = (id: string) => ["f6", "decisions", id] as const;

export function decisionsQuery(id: string): UseQueryOptions<DecisionsAnswer, Error> {
  return {
    queryKey: decisionsKey(id),
    queryFn: async () => {
      const r = await call("listTicketDecisions", { params: { id }, query: {}, screenId: SCREEN });
      if (!r.ok) throw new Error(`決定を読めませんでした（${r.status}）`);
      return { rows: r.data as unknown as DecisionRow[], canWrite: r.meta["can_write"] === true };
    },
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}

export interface DecisionsRead {
  status: "loading" | "failed" | "ready";
  rows: readonly DecisionRow[];
  canWrite: boolean;
  /** 読み直す（「もう一度読む」・足した後） */
  reload: () => Promise<unknown>;
}

export function useDecisions(id: string): DecisionsRead {
  const q = useQuery(decisionsQuery(id));
  const { refetch } = q;
  const reload = useCallback(() => refetch(), [refetch]);
  const status = q.data ? "ready" : q.isError ? "failed" : "loading";
  return { status, rows: q.data?.rows ?? [], canWrite: q.data?.canWrite ?? false, reload };
}

interface Member {
  id: string;
  display_name: string;
  deleted_at?: string | null;
  suspended_at?: string | null;
  kind_id?: string;
}

export interface AddDecision {
  open: boolean;
  busy: boolean;
  errors: { text?: string; by?: string } | undefined;
  /** 小窓の上の知らせ */
  notice: string | undefined;
  /** 区画の頭の知らせ（書けなくなった・消されたなど） */
  sectionNotice: string | undefined;
  by: string;
  people: PersonOption[];
  peopleFailed: string | undefined;
  start: () => void;
  cancel: () => void;
  submit: (v: DecisionFormValues) => Promise<void>;
}

/** 「＋ 決定を足す」の小窓の流れ。reload は決定の一覧を 1 回読み直す・onClosed は小窓を閉じた後（焦点を戻す） */
export function useAddDecision(
  ticketId: string,
  myName: string,
  reload: () => Promise<unknown>,
  onClosed: () => void,
): AddDecision {
  const [open, setOpen] = useState(false);
  const [wantMembers, setWantMembers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<AddDecision["errors"]>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [sectionNotice, setSectionNotice] = useState<string | undefined>(undefined);
  const sending = useRef(false); // 答えが来るまで 2 本目を送らない
  const who = useQuery({ queryKey: ["me"], queryFn: me, ...ONCE });
  // 同じ会社の今のメンバー（scope_id は付けない・作る画面と同じ読み方）。小窓を初めて開いたときに 1 回
  const members = useQuery({
    queryKey: ["f6", "decision-members"],
    enabled: wantMembers,
    queryFn: async () => {
      const r = await call("listMembers", { query: { limit: 200 }, screenId: SCREEN });
      if (!r.ok) throw new Error(`メンバーを読めませんでした（${r.status}）`);
      return r.data as unknown as Member[];
    },
    ...ONCE,
  });
  const meId = who.data?.member_id ?? "";
  const meName = who.data?.display_name ?? myName;
  const self: PersonOption[] = meId ? [{ value: meId, label: meName }] : [];
  const listed: PersonOption[] = (members.data ?? [])
    .filter((m) => !m.deleted_at && !m.suspended_at && (m.kind_id ?? "human") === "human")
    .map((m) => ({ value: m.id, label: m.display_name }));
  const people = members.isSuccess ? (listed.some((p) => p.value === meId) ? listed : [...self, ...listed]) : self;

  const close = useCallback(() => {
    setOpen(false);
    onClosed();
  }, [onClosed]);

  const submit = async (v: DecisionFormValues) => {
    if (sending.current) return;
    if (!v.text.trim()) return setErrors({ text: catalogMessage("E-VAL-042") });
    sending.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const r = await call("createTicketDecision", {
        params: { id: ticketId },
        body: {
          text: v.text,
          reason: v.reason.trim() ? v.reason : null,
          decided_by_member_id: v.by || null,
          decided_note: v.note.trim() ? v.note : null,
        },
        screenId: SCREEN,
      });
      if (r.ok) {
        close();
        await reload();
        return;
      }
      if (r.status === 401) return; // 入り直し（共通の扱い）
      // 決めた人が今のメンバーでない（404 E-PAGE-001・欄つき・drift 2026-11-20 16:51）も 422 と同じく小窓の中に出す
      if (r.status === 422 || (r.status === 404 && r.fields["decided_by_member_id"])) {
        const text = r.fields["text"];
        const by = r.fields["decided_by_member_id"];
        if (text || by) return setErrors({ ...(text ? { text } : {}), ...(by ? { by } : {}) });
        return setNotice(r.message ?? messageOf(r));
      }
      if (r.status === 403 || r.status === 404) {
        close();
        setSectionNotice(messageOf(r));
        await reload();
        return;
      }
      setNotice(messageOf(r));
    } catch {
      setNotice(catalogMessage(PAGE_ERROR.loadFailed)); // 網の切れ
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return {
    open,
    busy,
    errors,
    notice,
    sectionNotice,
    by: meId,
    people,
    peopleFailed: members.isError ? PEOPLE_FAILED : undefined,
    start: () => {
      setErrors(undefined);
      setNotice(undefined);
      setSectionNotice(undefined);
      setWantMembers(true);
      setOpen(true);
    },
    cancel: () => {
      if (!sending.current) close();
    },
    submit,
  };
}
