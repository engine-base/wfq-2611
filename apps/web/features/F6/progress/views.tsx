"use client";
// 段 7 の「自分で進める」の見た目の部品：頭の行の段の札のメニュー・保留にする小窓・保留中の帯・実績（人が使った時間）。下絵（K-66 の切る段・/dev/mock/f6）で並べる。
//   口はまだつながない（段と実績を変える口は K-387・K-388、画面の結線は K-395）。ここは値を受け取って描くだけ。
//   代表の答え（2026-11-20）：① 札を押すと選べる（書く欄の「状態 ▾」もある）／② 書ける人が変えられる（閲覧のみは字の札のまま）／
//   ③ メニューに「完了にする…」（作業中のときだけ押せ、今の完了の小窓を開く）／④ 保留は題名の下の帯／⑤ 完了を「開き直す」を入れる／
//   ⑥ 実績は人の分を「時間」と「分」で入れ、AI の分は自動で足す／㉒ 文は勧めのとおり
import { Lock } from "lucide-react";
import { useState } from "react";
import {
  Band,
  BandLine,
  Button,
  Dialog,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  TextArea,
  TextField,
} from "@/components/k";
import { checkHold, type HoldErrors } from "./hold-fields";
import "./progress.css";

export interface StageView {
  key: string;
  name: string;
}

/** 人が動かせる作業の段（札の色は詳細の .k-detail-stage[data-stage]） */
export const STAGES = {
  todo: { key: "todo", name: "未着手" },
  doing: { key: "doing", name: "作業中" },
  hold: { key: "hold", name: "保留" },
  done: { key: "done", name: "完了" },
} as const satisfies Record<string, StageView>;

/** 段の札（頭の行の札と同じ形と色・押せない字の札） */
export function StageTag({ stage }: { stage: StageView }) {
  return (
    <span className="k-detail-stage" data-stage={stage.key}>
      {stage.name}
    </span>
  );
}

/** 仕組みの段（AI が動いている間と承認待ちの間）は人が変えられない（D-125.38） */
export const LOCKED_TEXT = "AI が動いている間と承認待ちの間は、状態を変えられません";

export interface StageMenuProps {
  stage: StageView;
  /** そのチケットを書ける人か（閲覧のみは false：字の札のまま） */
  canChange: boolean;
  /** 仕組みの段の間（確認中・承認待ち・実行中） */
  locked?: boolean;
  /** メニューを開いておく（モック） */
  open?: boolean;
  /** 項目を選んだとき（無ければ押しても何も起きない・モック） */
  onPick?: (pick: StagePick) => void;
  /** 送っている間：札を押せない（MenuTrigger の disabled・焦点は札に残る） */
  busy?: boolean;
  /** 完了にできるか（口の can.complete）。false なら作業中でも「完了」は押せない（既定は true） */
  canComplete?: boolean;
}

/** メニューの項目：未着手・作業中・保留・完了にする…・開き直す */
export type StagePick = "todo" | "doing" | "hold" | "complete" | "reopen";

/** 頭の行の段の札。押すとメニュー（未着手・作業中・保留…・完了にする…／完了なら 開き直す） */
export function StageMenu({ stage, canChange, locked, open, onPick, busy, canComplete = true }: StageMenuProps) {
  if (locked)
    return (
      <span
        className="k-detail-stage k-prog-stage-locked"
        data-stage={stage.key}
        data-part="stage"
        title={LOCKED_TEXT}
        aria-label={`${stage.name}（${LOCKED_TEXT}）`}
      >
        {stage.name}
        <Lock size={11} aria-hidden="true" />
      </span>
    );
  if (!canChange)
    return (
      <span className="k-detail-stage" data-stage={stage.key} data-part="stage">
        {stage.name}
      </span>
    );
  const done = stage.key === "done";
  // 選ぶ物は頭の段の札と同じ色つきの札で並べる（代表の直し 2026-11-20・answer=fabd031f9b37）
  const item = (to: StageView, pick: StagePick, note?: string, disabled?: boolean) => (
    <MenuItem
      key={`${to.key}-${note ?? ""}`}
      disabled={disabled ?? false}
      className="k-prog-item"
      onSelect={() => onPick?.(pick)}
    >
      <StageTag stage={to} />
      {to.key === stage.key && !note ? <span aria-label="いまの段">✓</span> : null}
      {note ? <span className="k-prog-item-note">{note}</span> : null}
    </MenuItem>
  );
  return (
    <Menu defaultOpen={open ?? false}>
      <MenuTrigger
        className="k-detail-stage k-prog-stage-btn"
        label={`状態：${stage.name}（変える）`}
        disabled={busy ?? false}
      >
        <span data-part="stage">{stage.name}</span>
        <span aria-hidden="true">▾</span>
      </MenuTrigger>
      <MenuPopup className="k-prog-menu">
        {done ? (
          <>
            {item(STAGES.done, "complete")}
            <hr className="k-prog-sep" />
            {item(STAGES.doing, "reopen", "開き直す")}
          </>
        ) : (
          <>
            {item(STAGES.todo, "todo")}
            {item(STAGES.doing, "doing")}
            {item(STAGES.hold, "hold", stage.key === "hold" ? undefined : "理由を書く")}
            <hr className="k-prog-sep" />
            {item(
              STAGES.done,
              "complete",
              stage.key === "doing" ? "確かめて完了にする…" : "作業中にしてから",
              stage.key !== "doing" || !canComplete,
            )}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

export interface HoldDialogProps {
  open: boolean;
  reason?: string;
  resume?: string;
  /** 口の 422 の欄の断り（口を呼ぶ前の確かめの文は小窓の中で出す） */
  errors?: HoldErrors | undefined;
  target?: string;
  /** 送っている間：ボタンを押せない・Esc でも閉じない */
  busy?: boolean;
  /** やめる・Esc・×（無ければ閉じない・モック） */
  onCancel?: () => void;
  /** 確かめが通ったとき。前後の空白を除いた理由と再開の条件（口を呼ぶのは呼んだ側） */
  onSubmit?: (reason: string, resume: string) => void;
}

/** 保留にする小窓（理由と再開の条件は必須・D-125.33） */
export function HoldDialog({
  open,
  reason = "",
  resume = "",
  errors,
  target,
  busy = false,
  onCancel,
  onSubmit,
}: HoldDialogProps) {
  const [r, setR] = useState(reason);
  const [c, setC] = useState(resume);
  const [local, setLocal] = useState<HoldErrors>({});
  const submit = () => {
    if (busy) return;
    const checked = checkHold(r, c);
    if (!checked.ok) {
      setLocal(checked.errors);
      return;
    }
    setLocal({});
    onSubmit?.(checked.body.hold_reason, checked.body.resume_condition);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel?.();
      }}
      title="保留にします"
      {...(target ? { target } : {})}
      actions={
        <>
          <Button variant="outlined" disabled={busy} onClick={() => onCancel?.()}>
            やめる
          </Button>
          <Button loading={busy} onClick={submit}>
            保留にする
          </Button>
        </>
      }
    >
      <TextArea
        label="保留の理由"
        name="hold_reason"
        required
        value={r}
        onChange={(e) => setR(e.target.value)}
        rows={2}
        error={local.reason ?? errors?.reason}
      />
      <TextField
        label="再開の条件"
        name="hold_resume"
        required
        value={c}
        onChange={(e) => setC(e.target.value)}
        placeholder="例：先方の返事が来たら"
        error={local.resume ?? errors?.resume}
      />
      <p className="k-desc">保留の間も、やり取りと決定は書けます</p>
    </Dialog>
  );
}

export interface HoldBandProps {
  reason: string;
  resume: string;
  /** 「11/01 10:41 佐藤 が保留にした」 */
  by: string;
  canChange: boolean;
  /** 「作業中に戻す」を押したとき */
  onResume?: () => void;
  /** 送っている間 */
  busy?: boolean;
}

/** 保留中の帯（題名の下・帯は 1 つだけ）。変えられない人にはボタンを出さない */
export function HoldBand({ reason, resume, by, canChange, onResume, busy }: HoldBandProps) {
  return (
    <Band
      tone="plain"
      title="保留中です"
      sub={by}
      {...(canChange
        ? {
            acts: (
              <Button size="sm" loading={busy ?? false} onClick={() => onResume?.()}>
                作業中に戻す
              </Button>
            ),
          }
        : {})}
    >
      <BandLine>理由：{reason}</BandLine>
      <BandLine>再開の条件：{resume}</BandLine>
    </Band>
  );
}

export interface HoldReasonProps {
  reason: string;
  resume: string;
  /** 「11/01 10:41 佐藤 が保留にした」 */
  by: string;
  /** 箱を開いておく（モック） */
  open?: boolean;
}

/** 保留の帯が前の帯（承認と実行）に譲っている間、段の札の横に出す「理由を見る」（代表の答え ㉓）。押すと理由・再開の条件・保留にした人と時刻の箱 */
export function HoldReason({ reason, resume, by, open }: HoldReasonProps) {
  return (
    <Menu defaultOpen={open ?? false}>
      <MenuTrigger className="k-prog-reason-btn">理由を見る</MenuTrigger>
      <MenuPopup align="start" className="k-prog-reason">
        <p>理由：{reason}</p>
        <p>再開の条件：{resume}</p>
        <p className="k-prog-reason-by">{by}</p>
      </MenuPopup>
    </Menu>
  );
}

/** 分 → 「1 時間 12 分」 */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} 時間 ${m} 分`;
  return h ? `${h} 時間` : `${m} 分`;
}

export interface ActualTimeProps {
  /** 人が使った時間（分） */
  human: number;
  /** AI が動いた時間（分・実行の記録から自動）。PC が無い時点は 0 */
  ai: number;
  canEdit: boolean;
  /** 「直す」を押したとき */
  onEdit?: () => void;
}

/** 実績の読む形：合計と内訳（AI の分が 0 なら内訳を出さない）・「直す」 */
export function ActualTime({ human, ai, canEdit, onEdit }: ActualTimeProps) {
  return (
    <span className="k-prog-time">
      {hm(human + ai)}
      {ai > 0 ? (
        <span className="k-prog-time-sub">
          （AI {hm(ai)}・人 {hm(human)}）
        </span>
      ) : null}
      {canEdit ? (
        <Button variant="ghost" size="sm" onClick={() => onEdit?.()}>
          直す
        </Button>
      ) : null}
    </span>
  );
}

export interface ActualTimeEditProps {
  hours: number;
  minutes: number;
  ai: number;
  error?: string | undefined;
  /** 送っている間 */
  busy?: boolean;
  onCancel?: () => void;
  /** 「保存」。入れた字のまま（確かめて分に直すのは呼んだ側・to-minutes.ts） */
  onSave?: (hours: string, minutes: string) => void;
}

/** 実績の直す形：人が使った時間を「時間」と「分」で入れる */
export function ActualTimeEdit({ hours, minutes, ai, error, busy = false, onCancel, onSave }: ActualTimeEditProps) {
  const [h, setH] = useState(String(hours));
  const [m, setM] = useState(String(minutes));
  return (
    <div className="k-prog-time-edit">
      <span className="k-prog-time-sub">人が使った時間</span>
      <div className="k-prog-time-row">
        <TextField
          label="時間"
          name="actual_hours"
          inputMode="numeric"
          value={h}
          onChange={(e) => setH(e.target.value)}
          error={error}
        />
        <TextField
          label="分"
          name="actual_minutes"
          inputMode="numeric"
          value={m}
          onChange={(e) => setM(e.target.value)}
        />
      </div>
      <span className="k-prog-time-sub">AI が動いた時間{ai > 0 ? `（${hm(ai)}）` : ""}は自動で足されます</span>
      <div className="k-prog-time-acts">
        <Button variant="outlined" size="sm" disabled={busy} onClick={() => onCancel?.()}>
          やめる
        </Button>
        <Button size="sm" loading={busy} onClick={() => onSave?.(h, m)}>
          保存
        </Button>
      </div>
    </div>
  );
}
