"use client";
// 段 13・領域 ops2 の下絵の 1 つの状態を描く（id → 部品の組み合わせ）。誰も持っていない id は「まだありません」
//   運営の画面は運営の外枠 OpsShell（領域 ops）。13-9 だけは会社の側なので利用者の Shell（ワークスペースの管理 › 設定）
import type { ReactNode } from "react";
import { Shell, Toaster, type Crumb } from "@/components/k";
import { OpsShell, type OpsScreen } from "@/features/F12/ops/ops-shell";
import { InboxPage } from "@/features/F12/ops2/views-inbox";
import { NoticeNewPage, NoticePage, NoticePublishConfirm, NoticesPage } from "@/features/F12/ops2/views-notices";
import { BillsIssueConfirm, BillsPage, PayDialog } from "@/features/F12/ops2/views-bills";
import { PlanEditPage, PlanLogPage, PlanReviewPage, PlansPage } from "@/features/F12/ops2/views-plans";
import {
  OperationsPage,
  TemplateEditPage,
  TemplateReleaseConfirm,
  TemplatesPage,
  TemplateUpdatePage,
} from "@/features/F12/ops2/views-skills";
import type { Theme } from "@/lib/theme";

function Ops({ screen, crumbs, children }: { screen: OpsScreen; crumbs: Crumb[]; children: ReactNode }) {
  return (
    <OpsShell
      screen={screen}
      crumbs={crumbs}
      badges={{ support: 3, billing: 2 }}
      operator={{ name: "高本 聖斗", initial: "高" }}
      notices={3}
    >
      {children}
    </OpsShell>
  );
}

const SUPPORT: Crumb[] = [{ label: "問い合わせ" }];
const NOTICES: Crumb[] = [{ label: "お知らせ", href: "/dev/mock/f12-ops2/oq-notices" }];
const BILLS: Crumb[] = [{ label: "請求" }];
const PLANS: Crumb[] = [
  { label: "配るもの", href: "/dev/mock/f12-ops2/oq-plans" },
  { label: "プラン", href: "/dev/mock/f12-ops2/oq-plans" },
];

export function MockView({ id, theme }: { id: string; theme: Theme }): ReactNode {
  switch (id) {
    case "oq-inbox":
      return (
        <Ops screen="ops-support" crumbs={[{ label: "問い合わせ" }, { label: "自分" }]}>
          <InboxPage />
        </Ops>
      );
    case "oq-inbox-thread":
      return (
        <Ops
          screen="ops-support"
          crumbs={[{ label: "問い合わせ", href: "/dev/mock/f12-ops2/oq-inbox" }, { label: "承認したのに動かない" }]}
        >
          <InboxPage open />
        </Ops>
      );
    case "oq-inbox-empty":
      return (
        <Ops screen="ops-support" crumbs={[{ label: "問い合わせ" }, { label: "後で" }]}>
          <InboxPage empty />
        </Ops>
      );
    case "oq-inbox-taken":
      return (
        <Ops
          screen="ops-support"
          crumbs={[{ label: "問い合わせ", href: "/dev/mock/f12-ops2/oq-inbox" }, { label: "承認したのに動かない" }]}
        >
          <InboxPage open taken />
        </Ops>
      );
    case "oq-notices":
      return (
        <Ops screen="ops-notices" crumbs={[{ label: "お知らせ" }]}>
          <NoticesPage />
        </Ops>
      );
    case "oq-notice-new":
      return (
        <Ops screen="ops-notices" crumbs={[...NOTICES, { label: "お知らせを書く" }]}>
          <NoticeNewPage />
        </Ops>
      );
    case "oq-notice":
      return (
        <Ops screen="ops-notices" crumbs={[...NOTICES, { label: "分身の実行が遅れています" }]}>
          <NoticePage />
        </Ops>
      );
    case "oq-notice-edit":
      return (
        <Ops
          screen="ops-notices"
          crumbs={[
            ...NOTICES,
            { label: "11/10（月）2:00〜3:00 メンテナンス", href: "/dev/mock/f12-ops2/oq-notice" },
            { label: "書き直す" },
          ]}
        >
          <NoticeNewPage edit />
        </Ops>
      );
    case "oq-notice-publish":
      return (
        <Ops screen="ops-notices" crumbs={[...NOTICES, { label: "お知らせを書く" }]}>
          <NoticeNewPage />
          <NoticePublishConfirm />
        </Ops>
      );
    case "oq-bills":
      return (
        <Ops screen="ops-billing" crumbs={BILLS}>
          <BillsPage />
        </Ops>
      );
    case "oq-bills-issue":
      return (
        <Ops screen="ops-billing" crumbs={BILLS}>
          <BillsPage />
          <BillsIssueConfirm />
        </Ops>
      );
    case "oq-pay":
      return (
        <Ops screen="ops-billing" crumbs={BILLS}>
          <BillsPage />
          <PayDialog />
        </Ops>
      );
    case "oq-pay-diff":
      return (
        <Ops screen="ops-billing" crumbs={BILLS}>
          <BillsPage />
          <PayDialog diff />
        </Ops>
      );
    case "oq-plans":
      return (
        <Ops screen="ops-skills" crumbs={PLANS.slice(0, 1).concat({ label: "プラン" })}>
          <PlansPage />
        </Ops>
      );
    case "oq-plan-edit":
      return (
        <Ops screen="ops-skills" crumbs={[...PLANS, { label: "チームの値段を変える案" }]}>
          <PlanEditPage />
        </Ops>
      );
    case "oq-plan-review":
      return (
        <Ops screen="ops-skills" crumbs={[...PLANS, { label: "変える案" }]}>
          <PlanReviewPage />
        </Ops>
      );
    case "oq-plan-self":
      return (
        <Ops screen="ops-skills" crumbs={[...PLANS, { label: "変える案" }]}>
          <PlanReviewPage self />
        </Ops>
      );
    case "oq-plan-log":
      return (
        <Ops screen="ops-skills" crumbs={[...PLANS, { label: "記録" }]}>
          <PlanLogPage />
        </Ops>
      );
    case "oq-templates":
      return (
        <Ops
          screen="ops-skills"
          crumbs={[{ label: "配るもの", href: "/dev/mock/f12-ops2/oq-plans" }, { label: "ひな形" }]}
        >
          <TemplatesPage />
        </Ops>
      );
    case "oq-template-release":
      return (
        <Ops
          screen="ops-skills"
          crumbs={[
            { label: "配るもの", href: "/dev/mock/f12-ops2/oq-plans" },
            { label: "ひな形", href: "/dev/mock/f12-ops2/oq-templates" },
            { label: "種別の新しい版" },
          ]}
        >
          <TemplateEditPage />
          <TemplateReleaseConfirm />
        </Ops>
      );
    case "op-template-edit":
      return (
        <Ops
          screen="ops-skills"
          crumbs={[
            { label: "配るもの", href: "/dev/mock/f12-ops2/oq-plans" },
            { label: "ひな形", href: "/dev/mock/f12-ops2/oq-templates" },
            { label: "種別の新しい版" },
          ]}
        >
          <TemplateEditPage />
        </Ops>
      );
    case "oq-operations":
      return (
        <Ops
          screen="ops-skills"
          crumbs={[{ label: "配るもの", href: "/dev/mock/f12-ops2/oq-plans" }, { label: "操作" }]}
        >
          <OperationsPage />
        </Ops>
      );
    case "oq-template-update":
      return (
        <Toaster>
          <Shell
            role="R1"
            screen="settings"
            crumbs={[
              { label: "ワークスペースの管理", href: "/company" },
              { label: "設定", href: "/settings" },
              { label: "ひな形" },
            ]}
            workspace={{ name: "ENGINE BASE", initial: "E" }}
            member={{ name: "高本 聖斗", initial: "高" }}
            bridgeConnected
            theme={theme}
          >
            <TemplateUpdatePage />
          </Shell>
        </Toaster>
      );
    default:
      return <p>この状態はまだありません：{id}</p>;
  }
}
