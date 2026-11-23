// 運営の 問い合わせ・お知らせ・請求・配るもの の見本の値（段 13・領域 ops2）。値段は仮（無料 ¥0・チーム ¥15,000・ビジネス ¥40,000）
export interface InboxRow {
  id: string;
  who: string;
  ws: string;
  at: string;
  title: string;
  kind: "使い方" | "うまく動かない" | "お金・プラン" | "ほか";
  state: "進行中" | "返事待ち" | "後で" | "済み";
  mine?: boolean;
}
export const INBOX_ROWS: readonly InboxRow[] = [
  {
    id: "i1",
    who: "湊 さくら",
    ws: "ミナト企画",
    at: "09:40",
    title: "承認したのに動かない",
    kind: "うまく動かない",
    state: "進行中",
    mine: true,
  },
  {
    id: "i2",
    who: "北村 透",
    ws: "北村デザイン",
    at: "昨日",
    title: "請求書の宛名を変えたい",
    kind: "お金・プラン",
    state: "返事待ち",
    mine: true,
  },
  {
    id: "i3",
    who: "太田 誠",
    ws: "オオタ物流",
    at: "10/30",
    title: "人数の上限を一時的に増やせるか",
    kind: "お金・プラン",
    state: "進行中",
    mine: true,
  },
];

export interface BillRow {
  id: string;
  ws: string;
  plan: string;
  amount: string;
  state: string;
  tone: "success" | "warning" | "danger" | "neutral";
  /** 入金の合計（差があれば差も） */
  paid: string;
  canPay: boolean;
  /** 期限から 7 日を過ぎた行に出す「止める案」（1 社の画面へ） */
  stopProposal?: boolean;
}
export const BILL_ROWS: readonly BillRow[] = [
  {
    id: "b1",
    ws: "北村デザイン事務所",
    plan: "チーム",
    amount: "¥16,500",
    state: "9 月分 期限を過ぎた 9 日",
    tone: "danger",
    paid: "—",
    canPay: true,
    stopProposal: true,
  },
  {
    id: "b2",
    ws: "株式会社ハル製作所",
    plan: "チーム",
    amount: "¥33,000",
    state: "8 月分 期限を過ぎた 40 日",
    tone: "danger",
    paid: "—",
    canPay: true,
  },
  {
    id: "b3",
    ws: "合同会社ミナト企画",
    plan: "チーム",
    amount: "¥16,500",
    state: "10 月分 お支払い待ち ・ 期限 11/30",
    tone: "warning",
    paid: "—",
    canPay: true,
  },
  {
    id: "b4",
    ws: "株式会社サクラ会計",
    plan: "ビジネス",
    amount: "¥44,000",
    state: "10 月分 払われた",
    tone: "success",
    paid: "¥44,000",
    canPay: false,
  },
  {
    id: "b5",
    ws: "株式会社オオタ物流",
    plan: "ビジネス",
    amount: "¥44,000",
    state: "10 月分 払われた",
    tone: "success",
    paid: "¥44,000",
    canPay: false,
  },
];

/** 1 枚の請求書の入金の並び（打ち消しの行は並べない・取り消した行は「取り消し済み」） */
export interface PaymentRow {
  id: string;
  paidOn: string;
  amount: string;
  payer: string;
  reversed: boolean;
}
export const PAYMENT_ROWS: readonly PaymentRow[] = [
  { id: "p1", paidOn: "11/01", amount: "¥16,500", payer: "キタムラデザイン", reversed: true },
];

export interface ImpactRow {
  ws: string;
  people: string;
  now: string;
  after: string;
}
export const IMPACT_ROWS: readonly ImpactRow[] = [
  { ws: "ミナト企画", people: "8 人", now: "¥15,000", after: "2027/2〜 ¥18,000" },
  { ws: "ENGINE BASE", people: "5 人", now: "¥15,000", after: "2027/2〜 ¥18,000" },
  { ws: "北村デザイン", people: "4 人", now: "¥15,000", after: "2027/2〜 ¥18,000" },
  { ws: "ハル製作所", people: "6 人", now: "止めている", after: "再開した月〜" },
];
