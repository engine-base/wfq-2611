"use client";
// 担当者でない人の、題名の下の申し出のボタン（引き継ぐ（申し出る））と小窓（K-414）。帯の場所に出す入口。
//   この葉（K-400）では何も出さない：空の形。本物にする葉は、ここを書き、出せるようになったら READY に "offer-entry" を足す
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import type { HandoverBandKey } from "./use-handovers";

/** このファイルが本物にした入口（"offer-entry"・空の区画が保留の帯を譲らせない） */
export const READY: readonly HandoverBandKey[] = [];

export function OfferAction(props: { ticket: SlotTicket }): ReactNode {
  void props;
  return null;
}
