"use client";
// 段・保留・予定・実績の差し込み口の先（K-395）。値は詳細の答え（ticket.detail・progress-detail.ts）から作り、押したときの口は use-progress.ts に任せる
//   （この中に口も lib/api も書かない・K382-SL-001）。見た目は views.tsx の部品に値と押す関数を渡すだけ。
//   一覧の右に開く詳細（layout が "side"）は今のまま：段の札は children・帯と「理由を見る」は出さない・実績はパネルが無い。
//   知らせ（口の失敗）は notice.ts で分け合い、帯の入れ物の中（F5 の帯の後）に HoldBandSlot が描く（帯ではないので onWant は呼ばず yieldTo にも従わない）
import { useEffect, useState, type ReactNode } from "react";
import { NoticeBox } from "@/components/k";
import { bandYieldTo, type BandSlotProps, type SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { CompleteDialog } from "@/features/F5/approve-complete/complete-dialog";
import { catalogMessage, messageOf } from "@/features/F5/approve-complete/message";
import { clearProgressState, setNotice } from "./notice";
import { holdErrorsOf, type HoldErrors } from "./hold-fields";
import { holdByLine, LOCKED_STAGES, progressOf } from "./progress-detail";
import { TIME_ERROR_ID, toMinutes } from "./to-minutes";
import { useProgress } from "./use-progress";
import { ActualTime, ActualTimeEdit, HoldBand, HoldDialog, HoldReason, StageMenu, hm, type StagePick } from "./views";

interface Wrap {
  ticket: SlotTicket;
  children: ReactNode;
}

const CUSTOM_STAGE = "custom";
const targetOf = (number: string | null, title: string | null): string | undefined =>
  [number, title].filter(Boolean).join(" ") || undefined;

/** 頭の行の段の札（children＝今の段の札）。書ける人にはメニュー・仕組みの段は鍵の札・それ以外は字の札のまま */
export function StageSlot({ ticket, children }: Wrap): ReactNode {
  const v = progressOf(ticket.detail);
  const { busy, send } = useProgress(ticket);
  const [holding, setHolding] = useState(false);
  const [holdErrors, setHoldErrors] = useState<HoldErrors | undefined>(undefined);
  const [completing, setCompleting] = useState(false);
  if (ticket.layout !== "page" || !v.hasStage) return children;

  const stage = { key: v.stageKey ?? CUSTOM_STAGE, name: v.stageName };
  const locked = v.stageKey !== null && LOCKED_STAGES.has(v.stageKey);
  const target = targetOf(v.number, v.title);
  const pick = (to: StagePick) => {
    if (busy) return;
    if (to === "hold") {
      if (v.stageKey === "hold") return;
      setHoldErrors(undefined);
      setHolding(true);
      return;
    }
    if (to === "complete") {
      if (v.stageKey === "doing" && v.canComplete) setCompleting(true);
      return;
    }
    const next = to === "reopen" ? "doing" : to;
    if (next === v.stageKey) return;
    void send({ stage_key: next });
  };
  const submitHold = async (reason: string, resume: string) => {
    setHoldErrors(undefined);
    const sent = await send({ stage_key: "hold", hold_reason: reason, resume_condition: resume });
    if (sent.skipped) return;
    if (sent.ok || sent.close) setHolding(false);
    else setHoldErrors(holdErrorsOf(sent.details));
  };
  const showReason = v.stageKey === "hold" && v.hold !== null && bandYieldTo("hold", ticket.bands) !== null;
  return (
    <>
      {locked ? (
        <StageMenu stage={stage} canChange locked />
      ) : v.canProgress ? (
        <StageMenu stage={stage} canChange onPick={pick} busy={busy} canComplete={v.canComplete} />
      ) : (
        children
      )}
      {showReason && v.hold ? (
        <HoldReason reason={v.hold.reason} resume={v.hold.resume} by={holdByLine(v.hold)} />
      ) : null}
      {holding ? (
        <HoldDialog
          open
          errors={holdErrors}
          busy={busy}
          {...(target ? { target } : {})}
          onCancel={() => setHolding(false)}
          onSubmit={(reason, resume) => void submitHold(reason, resume)}
        />
      ) : null}
      {completing && v.canComplete ? (
        <CompleteDialog
          ticketId={ticket.id}
          {...(target ? { target } : {})}
          todo={v.todo}
          conditions={v.conditions}
          onClose={() => setCompleting(false)}
          onDone={async () => {
            setNotice(ticket.id, null);
            await ticket.reload();
          }}
          onFailed={async (r) => {
            if (r.status === 401) return; // 入り直しへ（共通の扱い）
            setNotice(ticket.id, messageOf(r));
            await ticket.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** 題名の下の帯の入れ物の中・渡しの帯の後。保留の帯（前の帯が出ている間は譲る）と、口の失敗の知らせ */
export function HoldBandSlot({ ticket, yieldTo, onWant }: BandSlotProps): ReactNode {
  const v = progressOf(ticket.detail);
  const { busy, notice, send } = useProgress(ticket);
  const page = ticket.layout === "page";
  const want = page && v.stageKey === "hold" && v.hold !== null;
  useEffect(() => {
    onWant(want);
  }, [want, onWant]);
  const { id } = ticket;
  useEffect(() => () => clearProgressState(id), [id]);
  return (
    <>
      {page && notice ? <NoticeBox>{notice}</NoticeBox> : null}
      {want && v.hold && yieldTo === null ? (
        <HoldBand
          reason={v.hold.reason}
          resume={v.hold.resume}
          by={holdByLine(v.hold)}
          canChange={v.canProgress}
          busy={busy}
          onResume={() => void send({ stage_key: "doing" })}
        />
      ) : null}
    </>
  );
}

/** 「日付と時間」の「実績」の値。人の分は「時間」と「分」で書き直せる（口が書ける人だけ） */
export function ActualTimeSlot({ ticket, children }: Wrap): ReactNode {
  const v = progressOf(ticket.detail);
  const { busy, send } = useProgress(ticket);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  if (ticket.layout !== "page" || !v.time) return children;
  const { human, ai } = v.time;
  const save = async (hours: string, minutes: string) => {
    setError(undefined);
    const m = toMinutes(hours, minutes);
    if (!m.ok) {
      setError(catalogMessage(TIME_ERROR_ID));
      return;
    }
    const sent = await send({ actual_minutes: m.minutes });
    if (sent.skipped) return;
    if (sent.ok || sent.close) setEditing(false);
    else setError(sent.details.find((d) => d.field === "actual_minutes")?.message);
  };
  if (editing && v.canActual)
    return (
      <ActualTimeEdit
        hours={Math.floor(human / 60)}
        minutes={human % 60}
        ai={ai}
        error={error}
        busy={busy}
        onCancel={() => setEditing(false)}
        onSave={(h, m) => void save(h, m)}
      />
    );
  return (
    <ActualTime
      human={human}
      ai={ai}
      canEdit={v.canActual}
      onEdit={() => {
        setError(undefined);
        setEditing(true);
      }}
    />
  );
}

/** 「日付と時間」の「予定」の値（出すだけ）。予定が無ければ children（空） */
export function EstimateSlot({ ticket, children }: Wrap): ReactNode {
  const v = progressOf(ticket.detail);
  if (ticket.layout !== "page" || v.time === null || v.time.estimate === null) return children;
  return <>{hm(v.time.estimate)}</>;
}
