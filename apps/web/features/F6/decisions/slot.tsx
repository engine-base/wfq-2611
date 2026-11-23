"use client";
// 本文の区画の差し込み口の先（K-382 が置き、K-397 が中身）。区画の鍵が decisions の頁の形の詳細だけ決定ログの区画に描き替え、
//   ほかの区画・一覧の右に開く詳細（layout="side"・K-252）は今の区画（children）のまま。口を呼ぶのは区画の入れ物（section.tsx）の中だけ。
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { DecisionsSection } from "./section";

interface SlotSection {
  key: string;
  label: string;
  body: { text?: string } | null;
  version: number;
}

/** 本文の区画の 1 つずつ（children＝今の section.k-section） */
export function SectionSlot({
  ticket,
  children,
  section,
}: {
  ticket: SlotTicket;
  children: ReactNode;
  section: SlotSection;
}): ReactNode {
  if (section.key !== "decisions" || ticket.layout !== "page") return <>{children}</>;
  return (
    <DecisionsSection
      ticketId={ticket.id}
      myName={ticket.me}
      label={section.label}
      intro={section.body?.text?.trim() ? section.body.text : undefined}
    />
  );
}
