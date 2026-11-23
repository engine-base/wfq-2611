"use client";
// 運営の請求：月ごと・入金を記録（段 13・領域 ops2・キャンバス OpBills・OpPay）。値を受け取って描くだけ
import { Fingerprint } from "lucide-react";
import { Button, Confirm, Dialog, PageBody, PageHeader, Select, TextField } from "@/components/k";
import { Chip, Note, Stat, StatGrid, StatusBadge } from "@/features/F12/ops/ops-parts";
import { BILL_ROWS, PAYMENT_ROWS, type BillRow, type PaymentRow } from "./ops2-sample";
import "@/features/F12/ops/ops.css";
import "./ops2.css";
import { RespTable, type RespColumn } from "@/features/F12/shared/resp-table";

/** 月の選び肢（12 か月） */
const MONTHS = [
  "10 月分",
  "9 月分",
  "8 月分",
  "7 月分",
  "6 月分",
  "5 月分",
  "4 月分",
  "3 月分",
  "2 月分",
  "1 月分",
  "12 月分",
  "11 月分（2025 年）",
] as const;

const COLS: RespColumn<BillRow>[] = [
  { key: "ws", header: "ワークスペース", cell: (r) => r.ws },
  { key: "plan", header: "プラン", cell: (r) => r.plan },
  { key: "amount", header: "金額（税込）", num: true, cell: (r) => r.amount },
  {
    key: "state",
    header: "状態",
    cell: (r) => (
      <span className="k-op-inline">
        <StatusBadge tone={r.tone}>{r.state}</StatusBadge>
        {r.stopProposal ? (
          <a className="k-link" href="/dev/mock/f12-ops/op-ws">
            止める案
          </a>
        ) : null}
      </span>
    ),
  },
  { key: "paid", header: "入金", cell: (r) => r.paid },
  {
    key: "act",
    header: <span className="sr-only">操作</span>,
    card: "action",
    cell: (r) =>
      r.canPay ? (
        <Button size="sm" variant="outlined" aria-label={`${r.ws} の入金を記録`}>
          入金を記録
        </Button>
      ) : null,
  },
];

/** 請求：月ごと・お支払い待ち・払われた・期限を過ぎた（前の月の分も上） */
export function BillsPage() {
  return (
    <PageBody labelledBy="oq-bills-title">
      <PageHeader
        id="oq-bills-title"
        title="請求"
        sub="10 月分 ・ 5 件"
        actions={
          <a
            className="k-btn"
            data-variant="outlined"
            data-size="md"
            href="/dev/mock/f12-ops-invoice/op-invoice-template"
          >
            請求書の型
          </a>
        }
      />
      <div className="k-op-body">
        <Select label="月" name="month" defaultValue="10 月分" options={MONTHS.map((m) => ({ value: m, label: m }))} />
        <div className="k-op-chips" role="group" aria-label="絞り込み">
          <Chip on count={5}>
            すべて
          </Chip>
          <Chip count={1}>お支払い待ち</Chip>
          <Chip count={2}>払われた</Chip>
          <Chip count={2}>期限を過ぎた（前の月の分）</Chip>
        </div>
        <StatGrid>
          <Stat label="10 月分" value="¥ 104,500" sub="税込 ・ 3 件 ・ 無料は請求なし" />
          <Stat label="お支払い待ち" value="1 件" sub="期限 11/30 ・ 払われた 2 件" />
          <Stat label="期限を過ぎた" value="¥ 49,500" sub="2 件 ・ 前の月の分" tone="danger" />
        </StatGrid>
        <RespTable
          caption="請求の一覧（期限を過ぎたものが上）"
          columns={COLS}
          rows={[...BILL_ROWS]}
          rowKey={(r) => r.id}
        />
        <Note>
          ［まとめて出す］を押すと、締めた月の請求書を確かめてからまとめて出す。出すと各ワークスペースの請求書の画面に出る。期限を過ぎたものは前の月の分も上に出し、期限から
          7 日を過ぎたら「止める案」が出る（止めるかは人が決める）。入金は 1
          件ずつ記録する（銀行とつないだ自動の消し込み・カード払いは後のフェーズ）。値段は仮
        </Note>
        <div className="k-oq-end">
          <Button variant="secondary">10 月分をまとめて出す</Button>
        </div>
      </div>
    </PageBody>
  );
}

/** 今月の請求書をまとめて出す確かめ：件数・合計・本人確認 */
export function BillsIssueConfirm({ onClose, onConfirm }: { onClose?: () => void; onConfirm?: () => void }) {
  return (
    <Confirm
      open
      onOpenChange={(o) => !o && onClose?.()}
      onConfirm={() => onConfirm?.()}
      tone="primary"
      confirmLabel="本人確認をして出す"
      title="10 月分の請求書をまとめて出す"
      description="下書きの請求書を、各ワークスペースの請求書の画面に出します。出したあとは取り消せません"
    >
      <div className="k-op-form">
        <StatGrid>
          <Stat label="件数" value="46 件" sub="無料の 2 か所は請求なし" />
          <Stat label="合計（税込）" value="¥ 1,207,800" sub="期限 12/31" />
        </StatGrid>
        <Note>
          <Fingerprint size={14} aria-hidden="true" />{" "}
          出す前に本人確認を取り直します（パスキー）。出した人・時刻・件数は運営の記録に残ります。値段は仮
        </Note>
      </div>
    </Confirm>
  );
}

/** その請求書の入金の並び（入金日・額・振込名義・取り消す）。取り消した行は押せない */
function Payments({ rows }: { rows: readonly PaymentRow[] }) {
  const cols: RespColumn<PaymentRow>[] = [
    { key: "on", header: "入金日", cell: (r) => r.paidOn },
    { key: "amount", header: "額", num: true, cell: (r) => r.amount },
    { key: "payer", header: "振込名義", cell: (r) => r.payer },
    {
      key: "act",
      header: <span className="sr-only">操作</span>,
      card: "action",
      cell: (r) =>
        r.reversed ? (
          <Button size="sm" variant="ghost" aria-disabled="true" tabIndex={-1} title="取り消し済み">
            取り消し済み
          </Button>
        ) : (
          <Button size="sm" variant="outlined" aria-label={`${r.paidOn} の ${r.amount} の入金を取り消す`}>
            取り消す
          </Button>
        ),
    },
  ];
  return <RespTable caption="この請求書の入金" columns={cols} rows={[...rows]} rowKey={(r) => r.id} />;
}

/** 入金を記録する小窓：入金の並び・入金日・金額・振込名義・差。diff を渡すと差がある形（足りないのでお支払い待ちのまま） */
export function PayDialog({ diff = false, onClose }: { diff?: boolean; onClose?: () => void }) {
  const amount = diff ? "¥10,000" : "¥16,500";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose?.()}
      title="入金を記録"
      target="北村デザイン事務所 ・ 9 月分 ¥16,500（期限 10/31）"
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            やめる
          </Button>
          <Button>記録する</Button>
        </>
      }
    >
      <div className="k-op-form">
        <div className="k-op-form-group">
          <b>これまでの入金</b>
          <Payments rows={PAYMENT_ROWS} />
        </div>
        <TextField label="入金日" name="date" type="date" readOnly defaultValue="2026-11-02" />
        <TextField label="金額" name="amount" readOnly defaultValue={amount} />
        <TextField label="振込名義" hint="任意" name="payer" readOnly defaultValue="キタムラデザイン" />
        {diff ? (
          <p className="k-op-alert" role="status">
            差 ¥6,500 ・ 請求額より足りません。差を残して「お支払い待ち」のままにします
          </p>
        ) : (
          <Note>差 ¥0 ・ 請求額と同じ → 払われた にする</Note>
        )}
        <Note>
          足りない・多いときは差を残して「お支払い待ち」のまま（次の入金で足せる）。打ち間違いは「取り消す」で打ち消しの行を足す（消さない）。記録すると、顧客の請求書の画面にも出て、運営の記録に残る
        </Note>
      </div>
    </Dialog>
  );
}
