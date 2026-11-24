"use client";
// 相手を選ぶ小窓 → 引き継いでもらうの小窓の一続き（K-411・口は K-401 の previewTicketHandover と K-402 の createTicketHandover）。
//   部品は views.tsx（PickDialog・HandoverDialog）をそのまま使い、値と動きを渡すだけ。口は「開いた時に下見 1 回」「送るとき 1 回」だけ（押し直しは同じ冪等の鍵）。
//   断りは状態でなく答えの code で出し分ける（E-HND-007・008 はその欄の下／006・014 は相手の欄の下／004・003 と残りは小窓の上）。書いた中身は消さない。
//   K-413 の「別の人にする」は replaces（今待っている渡しの id）を渡して同じ一続きを使う。
//   K-415：mode が distribute（担当者でなく、配る権限の人・getTicket の handover_kinds に distribute）なら、押して読んだ下見の kinds に distribute が在るとき
//   小窓を配るの形（1 行の文・グループの並び）で開き、人もグループも選んだ後は配る小窓（distribute-dialog.tsx）。下見に distribute が無ければ（権限を外された直後）
//   E-HND-002 の文で選ばせない。担当者本人のとき（mode pass）も、下見に groups が在ればグループの並びを足し、グループを押すと配る小窓（人を押す道は変えない）
import { useEffect, useMemo, useRef, useState } from "react";
import { useNotify } from "@/components/k";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { call } from "@/lib/api/call";
import { DistributeFlow, type DistributeDest } from "./distribute-dialog";
import {
  HandoverDialog,
  PickDialog,
  type CarryItem,
  type HandoverErrors,
  type HandoverValues,
  type PickGroup,
  type PickMember,
} from "./views";

// ---------------------------------------------------------------- 日本時間の日時（ブラウザの時差に左右されない）
const JST_MS = 9 * 3600_000;
const WEEK = ["日", "月", "火", "水", "木", "金", "土"] as const;
const pad = (n: number): string => String(n).padStart(2, "0");

/** ISO（UTC）→ datetime-local の値（日本時間・YYYY-MM-DDTHH:mm） */
export function jstInputOf(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + JST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** datetime-local の値（日本時間）→ ISO（UTC）。読めなければ null */
export function isoOfJstInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - JST_MS;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** 帯・小窓に出す期限の字（11/23（月）18:00・日本時間） */
export function formatDue(iso: string | null): string {
  const t = iso === null ? NaN : Date.parse(iso);
  if (Number.isNaN(t)) return "なし";
  const d = new Date(t + JST_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 姓（display_name の最初の空白の前・空白が無ければ全体） */
export const surnameOf = (displayName: string): string => displayName.trim().split(/\s+/)[0] ?? displayName;

// ---------------------------------------------------------------- 下見（K-401 の HandoverPreview）の読み
interface Candidate {
  id: string;
  name: string;
  email: string | null;
  group: { id: string; name: string; code: string };
  manager: boolean;
  week: number;
  state: "active" | "suspended" | "invited";
  self: boolean;
  current: boolean;
  in_group: boolean;
}
type RuleMode = "ask" | "always" | "never";
export interface Preview {
  /** 見ている人がこのチケットでできる種類（K-401 の下見の kinds） */
  kinds: string[];
  /** 配る先のグループ（kinds に distribute が在るとき、または担当者がそのグループを管理する人のとき） */
  groups: PickGroup[];
  blocked: "closed" | "ai_running" | "approval" | "waiting" | null;
  waitingName: string | null;
  defaultReplyDue: string;
  rules: { target: string; mode: RuleMode }[];
  children: { mine: number; others: number };
  links: { mine: number; others: number };
  group: { id: string; name: string; code: string };
  candidates: Candidate[];
}

export const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function readGroup(v: unknown): { id: string; name: string; code: string } | null {
  const g = rec(v);
  const id = str(g?.["id"]);
  const name = str(g?.["name"]);
  return id !== null && name !== null ? { id, name, code: str(g?.["code"]) ?? "" } : null;
}

function readCandidate(v: unknown): Candidate | null {
  const c = rec(v);
  const id = str(c?.["id"]);
  const name = str(c?.["name"]);
  const group = readGroup(c?.["group"]);
  const state = c?.["state"];
  if (!c || id === null || name === null || group === null) return null;
  if (state !== "active" && state !== "suspended" && state !== "invited") return null;
  return {
    id,
    name,
    email: str(c["email"]),
    group,
    manager: c["manager"] === true,
    week: num(c["week"]),
    state,
    self: c["self"] === true,
    current: c["current"] === true,
    in_group: c["in_group"] !== false,
  };
}

const BLOCKS = ["closed", "ai_running", "approval", "waiting"] as const;

/** 口の答えを形で確かめて読む（形が違えば null＝読めなかったことにする） */
export function readPreview(raw: unknown): Preview | null {
  const o = rec(raw);
  const group = readGroup(o?.["group"]);
  const list = o && Array.isArray(o["candidates"]) ? o["candidates"].map(readCandidate) : null;
  if (!o || group === null || list === null || list.some((c) => c === null)) return null;
  const blocked = BLOCKS.find((b) => b === o["blocked"]) ?? null;
  const w = rec(o["waiting"]);
  const waitTo = rec(w?.["to"]);
  const waitScope = rec(w?.["to_scope"]);
  const count = (v: unknown) => ({ mine: num(rec(v)?.["mine"]), others: num(rec(v)?.["others"]) });
  const rules = (Array.isArray(o["rules"]) ? o["rules"] : []).flatMap((r): { target: string; mode: RuleMode }[] => {
    const x = rec(r);
    const target = str(x?.["target"]);
    const mode = x?.["mode"];
    return target !== null && (mode === "ask" || mode === "always" || mode === "never") ? [{ target, mode }] : [];
  });
  const groups = (Array.isArray(o["groups"]) ? o["groups"] : []).flatMap((g) => {
    const x = readGroup(g);
    return x ? [x] : [];
  });
  return {
    kinds: Array.isArray(o["kinds"]) ? o["kinds"].filter((k): k is string => typeof k === "string") : [],
    groups,
    blocked,
    waitingName: surnameOrNull(str(waitTo?.["name"])) ?? str(waitScope?.["name"]),
    defaultReplyDue: str(o["default_reply_due"]) ?? "",
    rules,
    children: count(o["children"]),
    links: count(o["links"]),
    group,
    candidates: list.filter((c): c is Candidate => c !== null),
  };
}
const surnameOrNull = (n: string | null): string | null => (n === null ? null : surnameOf(n));

// ---------------------------------------------------------------- 文と欄
const INTRO = "選んだ人に「引き継いでもらう」を頼みます。相手が受けるまで担当者はあなたのままです";
const DISTRIBUTE_INTRO =
  "あなたはこのグループのマネージャーなので、選ぶと「配る」になります（相手の合意なしで担当者が替わります）";
const NO_POWER_INTRO = "いまの権限では、担当者を変えられません";
const BLOCKED_INTRO = "AI が動いている・承認を待っているあいだは、担当者を変えられません";

/** 答えの detail の値を {名前}・{訳} に入れる（画面で文を作らない・正本の文の穴埋めだけ） */
export const fill = (message: string, detail: Record<string, unknown> | null): string =>
  message.replace(/\{([^}]+)\}/g, (_, k: string) => String(detail?.[k] ?? ""));

type CarryKey = "children" | "links" | "group";
interface CarryRow extends CarryItem {
  key: CarryKey;
}
const modeOf = (p: Preview, target: CarryKey): RuleMode => p.rules.find((r) => r.target === target)?.mode ?? "ask";

/** 一緒に切り替える物の行（D-148.11）。never は出さない・always は印ありで外せない・ask は既定の印（子・関連は付き・グループは付かない） */
function carryRows(p: Preview, who: Candidate | null, over: Partial<Record<CarryKey, boolean>>): CarryRow[] {
  const rows: CarryRow[] = [];
  const add = (key: CarryKey, label: string, def: boolean) => {
    const mode = modeOf(p, key);
    if (mode === "never") return;
    const fixed = mode === "always";
    rows.push({ key, label, fixed, checked: fixed ? true : (over[key] ?? def) });
  };
  const rest = (n: number) => (n > 0 ? `（ほかの人の ${n} 件はそのまま）` : "");
  if (p.children.mine > 0) add("children", `子チケット ${p.children.mine} 件も渡す${rest(p.children.others)}`, true);
  if (p.links.mine > 0) add("links", `つながり ${p.links.mine} 件も渡す${rest(p.links.others)}`, true);
  if (who && !who.in_group) add("group", `グループを「${p.group.name}」から「${who.group.name}」に移す`, false);
  return rows;
}

export const memberOf = (c: Candidate): PickMember => ({
  id: c.id,
  name: c.name,
  sub: `${c.group.name}${c.manager ? " マネージャー" : ""}`,
  week: c.week,
  email: c.email ?? "",
  ...(c.self ? { self: true } : {}),
  ...(c.current ? { current: true } : {}),
  ...(c.state === "suspended" ? { unavailable: "選べません（止まっています）" } : {}),
  ...(c.state === "invited" ? { unavailable: "選べません（招待中）" } : {}),
});

/** 渡せない訳（小窓の上の橙の字）。AI が動いている・承認待ち・別の渡しの返事待ち・閉じたチケット */
function blockedText(p: Preview): string | undefined {
  switch (p.blocked) {
    case "ai_running":
    case "approval":
      return catalogMessage("E-HND-003");
    case "waiting":
      return fill(catalogMessage("E-HND-004"), { 名前: p.waitingName ?? "" });
    case "closed":
      return catalogMessage("E-HND-009");
    default:
      return undefined;
  }
}

/** 小窓の頭の下の対象の行（「EG-119 問い合わせ（山田様）に一次返信する」）。getTicket の ticket の番号と題名 */
function targetOf(detail: SlotTicket["detail"]): string | null {
  const t = rec(detail["ticket"]);
  const number = str(t?.["number"]);
  const title = str(t?.["title"]);
  return number !== null && title !== null ? `${number} ${title}` : null;
}

export const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const without = (e: HandoverErrors, key: keyof HandoverErrors): HandoverErrors => {
  const { [key]: _drop, ...rest } = e;
  void _drop;
  return rest;
};

export interface PassFlowProps {
  ticket: SlotTicket;
  /** 入口の種類：pass＝担当者本人（引き継いでもらう）・distribute＝担当者でなく配る権限の人（配る・K-415）。既定は pass */
  mode?: "pass" | "distribute";
  open: boolean;
  /** 閉じる（やめる・× ・Esc・渡せた後） */
  onClose: () => void;
  /** 渡せた（201・詳細を読み直した後） */
  onDone?: () => void;
  /** 今待っている渡しの id（K-413 の「別の人にする」・口が取り消しと新しい渡しを 1 回でする） */
  replaces?: string;
}

const EMPTY_VALUES: HandoverValues = { reason: "", ask: "", due: "" };

/** 相手を選ぶ小窓から引き継いでもらうの小窓までの一続き。開くと下見を 1 回読み、読めてから相手を選ぶ小窓を出す */
export function PassFlow({ ticket, mode = "pass", open, onClose, onDone, replaces }: PassFlowProps) {
  const notify = useNotify();
  const [phase, setPhase] = useState<"loading" | "pick" | "pass" | "distribute">("loading");
  const [pv, setPv] = useState<Preview | null>(null);
  const [query, setQuery] = useState("");
  const [whoId, setWhoId] = useState<string | null>(null);
  /** 配る先：人（whoId）かグループ（groupId）。配る小窓の「変える」で相手を選ぶ小窓に戻っても理由は残る */
  const [dest, setDest] = useState<"member" | "group">("member");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [values, setValues] = useState<HandoverValues>(EMPTY_VALUES);
  const [over, setOver] = useState<Partial<Record<CarryKey, boolean>>>({});
  const [notifyManagers, setNotifyManagers] = useState(false);
  const [errors, setErrors] = useState<HandoverErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const started = useRef(false);
  const gen = useRef(0);
  const sending = useRef(false);
  const key = useRef("");

  /** 下見を 1 回読む。読めなければ相手を選ぶ小窓の中に知らせと「もう一度読む」を出す（書き直さず読み直す） */
  const read = async (mine: number) => {
    const failed = (code: string) => {
      setLoadError(catalogMessage(code));
      setPhase("pick");
    };
    try {
      const r = await call("previewTicketHandover", { params: { id: ticket.id }, screenId: "tickets" });
      if (gen.current !== mine) return;
      if (!r.ok) return r.status === 401 ? onClose() : failed(errorCodeOf(r));
      const p = readPreview(r.data);
      if (p === null) return failed(PAGE_ERROR.loadFailed);
      setPv(p);
      setValues((v) => ({ ...v, due: jstInputOf(p.defaultReplyDue) }));
      setPhase("pick");
    } catch {
      if (gen.current === mine) failed(PAGE_ERROR.offline);
    }
  };
  const retry = () => {
    const mine = ++gen.current;
    setLoadError(null);
    setPhase("loading");
    void read(mine);
  };

  useEffect(() => {
    if (!open) {
      started.current = false;
      gen.current += 1;
      return;
    }
    if (started.current) return;
    started.current = true;
    const mine = ++gen.current;
    key.current = newKey();
    setPhase("loading");
    setPv(null);
    setQuery("");
    setWhoId(null);
    setDest("member");
    setGroupId(null);
    setValues(EMPTY_VALUES);
    setOver({});
    setNotifyManagers(false);
    setErrors({});
    setNotice(null);
    setCallout(null);
    setLoadError(null);
    setBusy(false);
    void read(mine);
    // 開いた時に 1 回だけ読む（notify・onClose・ticket の描き直しで読み直さない）
  }, [open]);

  const who = useMemo(() => pv?.candidates.find((c) => c.id === whoId) ?? null, [pv, whoId]);
  const rows = useMemo(() => (pv ? carryRows(pv, who, over) : []), [pv, who, over]);
  const members = useMemo(() => (pv ? pv.candidates.map(memberOf) : []), [pv]);
  // 入口が配る（担当者でない人）：下見に distribute が在れば配るの形、無ければ（権限を外された直後）E-HND-002 の文で選ばせない
  const asManager = mode === "distribute" && pv !== null && pv.kinds.includes("distribute");
  const noPower = mode === "distribute" && pv !== null && !pv.kinds.includes("distribute");
  const group = useMemo(() => pv?.groups.find((g) => g.id === groupId) ?? null, [pv, groupId]);
  // グループの並び：配るの形はいつも（空でも探す欄の名前を替える）・引き継いでもらうの形は在るときだけ（別の人にする K-413 では出さない）
  const groups = pv && (mode === "distribute" || (pv.groups.length > 0 && !replaces)) ? pv.groups : undefined;
  const blocked = noPower ? catalogMessage("E-HND-002") : pv ? blockedText(pv) : undefined;
  const target = targetOf(ticket.detail);
  const aiBlocked = pv?.blocked === "ai_running" || pv?.blocked === "approval";

  const pick = (id: string) => {
    setWhoId(id);
    setDest("member");
    setOver({});
    setErrors((e) => without(e, "to"));
    setNotice(null);
    setPhase(asManager ? "distribute" : "pass");
  };
  const pickGroup = (id: string) => {
    setGroupId(id);
    setDest("group");
    setPhase("distribute");
  };

  const change = (patch: Partial<HandoverValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) =>
      patch.reason !== undefined ? without(e, "reason") : patch.due !== undefined ? without(e, "due") : e,
    );
  };

  /** 口が断った（答えの code で出し分ける）。どれも書いた中身は消さない */
  const refuse = (code: string, detail: Record<string, unknown> | null, fallback: string) => {
    const text = fill(catalogMessage(code), detail);
    switch (code) {
      case "E-HND-007":
        return setErrors({ reason: text });
      case "E-HND-008":
        return setErrors({ due: text });
      case "E-HND-006":
      case "E-HND-014":
        return setErrors({ to: text });
      case "E-HND-003":
        return setCallout(text);
      case "E-HND-004":
        return setNotice(text);
      default:
        return setNotice(fallback);
    }
  };

  const submit = async () => {
    if (sending.current || pv === null || who === null) return;
    const local: HandoverErrors = {};
    if (!values.reason.normalize("NFKC").trim()) local.reason = catalogMessage("E-HND-007");
    const dueText = values.due.trim();
    const due = dueText === "" ? null : isoOfJstInput(dueText);
    if (dueText !== "" && (due === null || Date.parse(due) <= Date.now())) local.due = catalogMessage("E-HND-008");
    if (local.reason || local.due) {
      setErrors(local);
      setNotice(null);
      return setCallout(null);
    }
    setErrors({});
    setNotice(null);
    setCallout(null);
    sending.current = true;
    setBusy(true);
    try {
      const r = await call("createTicketHandover", {
        params: { id: ticket.id },
        idempotencyKey: key.current,
        screenId: "tickets",
        body: {
          kind: "pass",
          to_member_id: who.id,
          to_scope_id: null,
          reason: values.reason,
          ask: values.ask.trim() === "" ? null : values.ask,
          reply_due: due,
          switch: {
            children: rows.some((x) => x.key === "children" && x.checked),
            links: rows.some((x) => x.key === "links" && x.checked),
            group: rows.some((x) => x.key === "group" && x.checked),
            axes: [],
          },
          notify_managers: notifyManagers,
          ...(replaces ? { replaces } : {}),
        },
      });
      if (r.ok) {
        onClose();
        notify(`${surnameOf(who.name)}さんに渡しました`);
        await ticket.reload();
        return onDone?.();
      }
      if (r.status === 401) return; // 入り直し（共通の扱い）
      const detail = rec(r.body["detail"]);
      refuse(r.code, detail, catalogMessage(errorCodeOf(r)));
    } catch {
      setNotice(catalogMessage(PAGE_ERROR.offline));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const distDest: DistributeDest =
    dest === "group" && group
      ? { kind: "group", id: group.id, name: group.name, done: `${group.name}に配りました` }
      : {
          kind: "member",
          id: who?.id ?? "",
          name: who?.name ?? "",
          done: `${surnameOf(who?.name ?? "")}さんに配りました`,
        };

  return (
    <>
      <PickDialog
        open={open && phase === "pick"}
        members={members}
        intro={noPower ? NO_POWER_INTRO : aiBlocked ? BLOCKED_INTRO : asManager ? DISTRIBUTE_INTRO : INTRO}
        query={query}
        onQueryChange={setQuery}
        onPick={pick}
        onPickGroup={pickGroup}
        onClose={onClose}
        {...(groups ? { groups } : {})}
        {...(target ? { target } : {})}
        {...(blocked ? { blocked } : {})}
        {...(loadError ? { notice: loadError, onRetry: retry } : {})}
      />
      <HandoverDialog
        open={open && phase === "pass"}
        to={who?.name ?? ""}
        values={values}
        errors={errors}
        carry={rows}
        notifyManagers={notifyManagers}
        busy={busy}
        dueType="datetime-local"
        onChange={change}
        onCarryChange={(i, checked) => {
          const row = rows[i];
          if (row) setOver((o) => ({ ...o, [row.key]: checked }));
        }}
        onNotifyChange={setNotifyManagers}
        onChangeTo={() => setPhase("pick")}
        onSubmit={() => void submit()}
        onClose={onClose}
        {...(target ? { target } : {})}
        {...(notice ? { notice } : {})}
        {...(callout ? { callout } : {})}
      />
      <DistributeFlow
        ticket={ticket}
        open={open && phase === "distribute"}
        dest={distDest}
        reason={values.reason}
        ask={values.ask}
        onChange={change}
        onChangeTo={() => setPhase("pick")}
        onClose={onClose}
        {...(onDone ? { onDone } : {})}
        {...(target ? { target } : {})}
      />
    </>
  );
}
