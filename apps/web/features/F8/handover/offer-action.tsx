"use client";
// 担当者でない人の、題名の下の申し出のボタン（引き継ぐ（申し出る））と小窓（K-414）。帯の場所に出す入口。
//   K-400 の slot-dispatch.tsx が、入口が offer（担当者でなく、できる種類が offer だけ）で帯の種類が無いときにだけ呼ぶ。
//   部品は views.tsx の OfferEntry。押すと offer-dialog.tsx の小窓を開く（開いている間だけ置く）。下見は読まない。
//   担当者がいなければ申し出る相手がいないので何も出さない（入口の判定は K-400・最後の判定は口 K-408 の 403）
import { useState, type ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { OfferFlow } from "./offer-dialog";
import { surnameOf } from "./pass-dialog";
import type { HandoverBandKey } from "./use-handovers";
import { OfferEntry } from "./views";

/** このファイルが本物にした入口（"offer-entry"・空の区画が保留の帯を譲らせない） */
export const READY: readonly HandoverBandKey[] = ["offer-entry"];

/** getTicket の担当者の名前（無い・読めなければ null） */
function assigneeNameOf(detail: SlotTicket["detail"]): string | null {
  const a = detail["assignee"];
  if (typeof a !== "object" || a === null) return null;
  const name = (a as Record<string, unknown>)["display_name"];
  return typeof name === "string" && name !== "" ? name : null;
}

export function OfferAction({ ticket }: { ticket: SlotTicket }): ReactNode {
  const [open, setOpen] = useState(false);
  const name = assigneeNameOf(ticket.detail);
  if (name === null) return null;
  return (
    <>
      <OfferEntry onClick={() => setOpen(true)} />
      {open ? <OfferFlow ticket={ticket} assignee={surnameOf(name)} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
