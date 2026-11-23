"use client";
// 本文の区画の差し込み口の先（K-382 が置き、K-397 が中身）。区画の鍵が decisions の頁の形の詳細だけ決定ログの区画に描き替え、
//   ほかの区画・一覧の右に開く詳細（layout="side"・K-252）は今の区画（children）のまま。口を呼ぶのは区画の入れ物（section.tsx）の中だけ。
//   区画の行が無いチケット（詳細が版 0 の区画で呼ぶ・K-1119）は、決定が在るときだけ描く（D-150.41：出来たときだけ現れる）。
import type { ReactNode } from "react";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { useOpenMessage } from "../thread/from-message";
import { DecisionsSection } from "./section";

interface SlotSection {
  key: string;
  label: string;
  body: { text?: string } | null;
  version: number;
}

/** 区画の行が無い印（DB の区画の行の版は 1 から） */
const NO_ROW_VERSION = 0;

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
  const openMessage = useOpenMessage();
  if (section.key !== "decisions" || ticket.layout !== "page") return <>{children}</>;
  return (
    <DecisionsSection
      ticketId={ticket.id}
      myName={ticket.me}
      label={section.label}
      intro={section.body?.text?.trim() ? section.body.text : undefined}
      onlyWhenAny={section.version === NO_ROW_VERSION}
      onSource={openMessage}
    />
  );
}
