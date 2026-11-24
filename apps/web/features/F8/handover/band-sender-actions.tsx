"use client";
// 渡した人の帯の動き（渡し中・返事が無い・断られた）と、そのボタン（催促する・取り消す・別の人にする・閉じる）・K-413。
//   帯は getTicket の今の渡し（handover）から出る：種類は use-handovers.ts の bandKindOf が決め、この葉は決めない
//   （返事の期限が過ぎたかは handover.overdue＝口の印。画面は手元の時計で決めない・D-148.9）。
//   口は契約の remindTicketHandover・withdrawTicketHandover（K-406）。別の人にするは K-411 の PassFlow に replaces を渡す
//   （口が取り消しと新しい渡しを 1 取引でする・K-402）。押した後は getTicket を 1 回読み直す（ticket.reload）。
//   帯の中の知らせ（NoticeBox）は 1 つだけ：新しい失敗が前の文を置き換え、成功したら消す
import { useRef, useState, type ReactNode } from "react";
import { Button, useNotify } from "@/components/k";
import { PAGE_ERROR, errorCodeOf } from "@/components/k/error-of";
import { catalogMessage } from "@/features/F5/approve-complete/message";
import { call, type CallErr } from "@/lib/api/call";
import { formatDue, jstInputOf, PassFlow, surnameOf } from "./pass-dialog";
import { markClosed, type BandSectionProps, type HandoverBandKey } from "./use-handovers";
import { HandoverBand, WithdrawConfirm } from "./views";

/** このファイルが本物にした帯の種類（K-413 が overdue・declined を足す。渡し中は band-sender.tsx がこのファイルの帯を使う） */
export const READY: readonly HandoverBandKey[] = ["overdue", "declined"];

/** 口に送る動き（二重に押せない・押し直しは同じ冪等の鍵） */
type SenderOp = "remind" | "withdraw";

const ALREADY_DECIDED = "E-HND-005";

interface SenderActionsProps {
  /** 期限切れの帯の並び（取り消す・別の人にする・催促する＝催促が主） */
  overdue?: boolean;
  /** 答えを待っている動き（そのボタンは処理中・ほかは押せない） */
  busy: SenderOp | null;
  onRemind: () => void;
  onWithdraw: () => void;
  onReassign: () => void;
}

/** 渡し中・期限切れの帯のボタン */
export function SenderActions({
  overdue = false,
  busy,
  onRemind,
  onWithdraw,
  onReassign,
}: SenderActionsProps): ReactNode {
  const idle = busy === null;
  const remind = (variant: "outlined" | "primary") => (
    <Button size="sm" variant={variant} loading={busy === "remind"} disabled={!idle} onClick={onRemind}>
      催促する
    </Button>
  );
  const withdraw = (
    <Button size="sm" variant="outlined" loading={busy === "withdraw"} disabled={!idle} onClick={onWithdraw}>
      取り消す
    </Button>
  );
  const reassign = (
    <Button size="sm" variant="outlined" disabled={!idle} onClick={onReassign}>
      別の人にする
    </Button>
  );
  return overdue ? (
    <>
      {withdraw}
      {reassign}
      {remind("primary")}
    </>
  ) : (
    <>
      {remind("outlined")}
      {withdraw}
      {reassign}
    </>
  );
}

const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/** 決めた時刻の字（11/20 10:12・日本時間）。読めなければ空 */
function formatAt(iso: string | null): string {
  const local = iso === null ? "" : jstInputOf(iso);
  return local === "" ? "" : `${Number(local.slice(5, 7))}/${Number(local.slice(8, 10))} ${local.slice(11)}`;
}

/** 渡した人の帯（渡し中・期限切れ・断られた）。handover が無ければ何も出さない */
export function SenderFollowBand({ handover, kind, ticket }: BandSectionProps): ReactNode {
  const notify = useNotify();
  const [busy, setBusy] = useState<SenderOp | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [closedId, setClosedId] = useState<string | null>(null);
  const sending = useRef(false);
  const keys = useRef<Partial<Record<SenderOp, string>>>({});
  if (handover === null || closedId === handover.id) return null;

  const who = handover.to ? surnameOf(handover.to.display_name) : "";

  /** 口を 1 回呼ぶ（二重に押せない）。答えが出た動きの鍵は捨て、つながらなかった動きの鍵は押し直しに使う */
  const run = async (op: SenderOp, send: (key: string) => Promise<{ ok: true } | CallErr>, done: () => void) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(op);
    setNotice(undefined);
    const key = (keys.current[op] ??= newKey());
    try {
      const r = await send(key);
      delete keys.current[op];
      if (r.ok) {
        done();
        return await ticket.reload();
      }
      if (r.status === 401) return; // 入り直し（共通の扱い）
      setConfirmOpen(false);
      if (r.code === ALREADY_DECIDED && op === "withdraw") {
        notify(catalogMessage(ALREADY_DECIDED));
      } else {
        setNotice(catalogMessage(errorCodeOf(r)));
      }
      if (r.code === ALREADY_DECIDED) await ticket.reload();
    } catch {
      setConfirmOpen(false);
      setNotice(catalogMessage(PAGE_ERROR.offline));
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const remind = () =>
    void run(
      "remind",
      (key) =>
        call("remindTicketHandover", {
          params: { id: handover.id },
          body: {},
          idempotencyKey: key,
          screenId: "tickets",
        }),
      () => notify(`${who}さんに催促しました（同じ渡しは 1 日 1 回まで）`),
    );
  const withdraw = () =>
    void run(
      "withdraw",
      (key) =>
        call("withdrawTicketHandover", {
          params: { id: handover.id },
          body: {},
          idempotencyKey: key,
          screenId: "tickets",
        }),
      () => setConfirmOpen(false),
    );
  const close = () => {
    markClosed(handover.id);
    setClosedId(handover.id);
    // 帯の出し分け（slot-dispatch）にも閉じたことを伝える：詳細を読み直して描き直させる
    void ticket.reload();
  };

  const acts =
    kind === "declined" ? (
      <>
        <Button size="sm" variant="outlined" onClick={close}>
          閉じる
        </Button>
        <Button size="sm" onClick={() => setPassOpen(true)}>
          別の人にする
        </Button>
      </>
    ) : (
      <SenderActions
        overdue={kind === "overdue"}
        busy={busy}
        onRemind={remind}
        onWithdraw={() => setConfirmOpen(true)}
        onReassign={() => setPassOpen(true)}
      />
    );

  return (
    <>
      <HandoverBand
        kind={kind}
        who={who}
        due={formatDue(handover.reply_due)}
        reason={kind === "declined" ? (handover.decline_reason ?? "") : handover.reason}
        at={formatAt(handover.decided_at)}
        acts={acts}
        {...(notice ? { notice } : {})}
      />
      <WithdrawConfirm
        open={confirmOpen}
        to={who}
        busy={busy === "withdraw"}
        onConfirm={withdraw}
        onOpenChange={setConfirmOpen}
      />
      <PassFlow
        ticket={ticket}
        open={passOpen}
        onClose={() => setPassOpen(false)}
        {...(kind !== "declined" ? { replaces: handover.id } : {})}
      />
    </>
  );
}
