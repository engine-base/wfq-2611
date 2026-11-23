"use client";
// 知らせる人を選ぶ小窓（K-393）。中身は作る画面と同じ部品 NotifyPicker（同じ物を 2 つ作らない）。
//   候補はそのチケットを見られる人から自分を除いた人。選んだ時点で書く欄の知らせる人の並びに入り、× で閉じる
import type { ReactNode } from "react";
import { Dialog } from "@/components/k";
import { NotifyPicker, type Person } from "@/features/F4/create-ticket/notify-picker";

export interface NotifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: Person[];
  chosen: string[];
  onChange: (ids: string[]) => void;
}

export function NotifyDialog({ open, onOpenChange, people, chosen, onChange }: NotifyDialogProps): ReactNode {
  return (
    <Dialog title="知らせる人を選ぶ" open={open} onOpenChange={onOpenChange}>
      <NotifyPicker
        people={people}
        chosen={chosen}
        onChange={onChange}
        label="知らせる人"
        placeholder="名前で絞り込む"
      />
    </Dialog>
  );
}
