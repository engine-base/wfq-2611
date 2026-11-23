"use client";
// 問い合わせの受信箱（段 13・領域 ops2・キャンバス OpInbox）。値を受け取って描くだけ（口は呼ばない・欄は読むだけ）
import { Button, Callout, Empty, PageBody, PageHeader, Select, TextArea } from "@/components/k";
import { Card, Chip, Facts, Note, StatusBadge } from "@/features/F12/ops/ops-parts";
import { INBOX_ROWS, type InboxRow } from "./ops2-sample";
import "@/features/F12/ops/ops.css";
import "./ops2.css";

const BOXES = [
  ["まだ誰も持っていない", 2],
  ["自分", 3],
  ["返事待ち", 4],
  ["後で", 1],
  ["済み", 0],
] as const;
const KINDS = ["すべて", "使い方", "うまく動かない", "お金・プラン", "ほか"] as const;
const STATE_TONE = { 進行中: "progress", 返事待ち: "warning", 後で: "neutral", 済み: "success" } as const;

function Boxes({ on }: { on: string }) {
  return (
    <div className="k-op-tools">
      <div className="k-op-chips" role="group" aria-label="箱">
        {BOXES.map(([b, n]) => (
          <Chip key={b} on={b === on} {...(n > 0 ? { count: n } : {})}>
            {b}
          </Chip>
        ))}
      </div>
      <div className="k-op-chips" role="group" aria-label="種類">
        <span className="k-op-chips-label">種類</span>
        {KINDS.map((k) => (
          <Chip key={k} on={k === "すべて"}>
            {k}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function InboxList({ rows, current }: { rows: readonly InboxRow[]; current?: string }) {
  return (
    <section aria-label="問い合わせの一覧">
      <div className="k-oq-sub">
        <b>自分 ・ {rows.length}</b>
        <span>新しい順</span>
      </div>
      <ul className="k-oq-list">
        {rows.map((r) => (
          <li key={r.id} {...(r.id === current ? { "aria-current": "true" as const } : {})}>
            <b>{r.title}</b>
            <span>
              {r.who} ・ {r.ws} ・ {r.at}
            </span>
            <span>
              <StatusBadge tone="neutral">{r.kind}</StatusBadge>
              <StatusBadge tone={STATE_TONE[r.state]}>{r.state}</StatusBadge>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 右：問い合わせてきたワークスペースの様子（数と種類だけ。プラン・PC・止まった実行・請求の 4 つ） */
function WsSide() {
  return (
    <Card title="合同会社ミナト企画" aside="チーム ・ 8 人">
      <Facts
        rows={[
          ["プラン", "チーム ・ 8 人"],
          [
            "この人の PC",
            <StatusBadge key="pc" tone="success">
              つながっている
            </StatusBadge>,
          ],
          ["止まった実行（7 日）", "3 件"],
          ["請求", "期限を過ぎた請求なし"],
        ]}
      />
      <div className="k-oq-acts">
        <a className="k-btn" data-variant="outlined" data-size="sm" href="/dev/mock/f12-ops/op-ws">
          1 社を開く
        </a>
        <Button size="sm" variant="outlined" aria-disabled="true" tabIndex={-1} title="まだ使えません">
          中を見る
        </Button>
      </div>
    </Card>
  );
}

function Msg({ head, children, memo }: { head: string; children: string; memo?: boolean }) {
  return (
    <article className="k-oq-msg" {...(memo ? { "data-kind": "memo" } : {})}>
      <div className="k-oq-msg-head">
        <b>{head}</b>
        {memo ? <StatusBadge tone="warning">社内メモ ・ 先方には見えない</StatusBadge> : null}
      </div>
      <p>{children}</p>
    </article>
  );
}

const REPLY =
  "湊さま　お問い合わせありがとうございます。実行の記録を確かめたところ、預けている Gmail のログイン情報（GMAIL_WORK）の期限が切れて止まっていました。右上の顔 › 自分の設定 › 預けたログイン情報 から「預け直す」をお願いします。預け直すと、実行待ちのものがすぐ動きます。";

/** 1 件を開いた：やり取り・返す・社内メモ・担当・後で・済みにする。taken は ほかの人が担当（見るだけ） */
function ThreadPane({ taken }: { taken?: boolean }) {
  return (
    <section className="k-oq-thread" aria-label="承認したのに動かない">
      <div className="k-oq-bar">
        <div>
          <b>承認したのに動かない</b>
          <div className="k-oq-sub">湊 さくら ・ 合同会社ミナト企画 ・ 11/02 09:40</div>
        </div>
        <div className="k-oq-acts">
          <span className="k-oq-sub">担当 {taken ? "佐野" : "高本（自分）"}</span>
          {taken ? (
            <Button variant="outlined" aria-disabled="true" tabIndex={-1} title="ほかの人が担当しています">
              自分が持つ
            </Button>
          ) : (
            <Button variant="outlined">外す</Button>
          )}
          <Select
            label="後で"
            name="later"
            defaultValue="none"
            disabled={taken ?? false}
            options={[
              { value: "none", label: "いつにするか選ぶ" },
              { value: "tomorrow", label: "明日の朝" },
              { value: "week", label: "来週" },
            ]}
          />
          <Button variant="outlined" {...(taken ? { "aria-disabled": true, tabIndex: -1 } : {})}>
            済みにする
          </Button>
        </div>
      </div>
      {taken ? (
        <Callout tone="info" title="佐野 さんが担当になりました">
          担当を取った人だけが返せます。あなたは見るだけです。担当を替えてもらうか、佐野 さんに声をかけてください
        </Callout>
      ) : null}
      <Msg head="湊 さくら ・ 09:40">
        請求書を送るチケット（KN-212）を承認したのですが、30 分たっても「実行待ち」のままです。PC はつけています。
      </Msg>
      <Note>付いてきた情報：画面 チケット KN-212 ・ Chrome 130 ・ PC つながっている</Note>
      <Msg memo head="高本（運営） ・ 09:58">
        中を見る（見るだけ）で実行の記録を確認。GMAIL_WORK の期限切れで止まっている。本人に預け直してもらえば動く
      </Msg>
      <div className="k-op-form">
        <TextArea
          label={taken ? "返事（返すのは担当の人だけ・社内メモは書けます）" : "返事"}
          name="reply"
          rows={5}
          readOnly
          defaultValue={taken ? "" : REPLY}
        />
        <div className="k-oq-end">
          <Button variant="outlined">社内メモにする</Button>
          <Button {...(taken ? { "aria-disabled": true, tabIndex: -1 } : {})}>返す</Button>
        </div>
        <Note>返すと「返事待ち」になります。返事は顧客の「困ったとき・お知らせ」と画面のお知らせに届く</Note>
      </div>
    </section>
  );
}

export interface InboxPageProps {
  /** 1 件を開いた形 */
  open?: boolean;
  /** 箱が空 */
  empty?: boolean;
  /** ほかの人が担当になった（見るだけ） */
  taken?: boolean;
}

/** 問い合わせ：5 つの箱・種類・新しい順・右にそのワークスペースの様子 */
export function InboxPage({ open = false, empty = false, taken = false }: InboxPageProps) {
  return (
    <PageBody labelledBy="oq-inbox-title">
      <PageHeader id="oq-inbox-title" title="問い合わせ" sub="顧客から届いた問い合わせ ・ 自分の担当 3 件" />
      <div className="k-op-body">
        <Boxes on={empty ? "後で" : "自分"} />
        {empty ? (
          <Empty title="この箱に問い合わせはありません">
            新しい問い合わせが届くと「まだ誰も持っていない」に入ります。担当を取ると「自分」に移ります
          </Empty>
        ) : (
          <div className="k-oq-inbox" {...(open ? { "data-open": "" } : {})}>
            <InboxList rows={INBOX_ROWS} {...(open ? { current: "i1" } : {})} />
            {open ? <ThreadPane {...(taken ? { taken } : {})} /> : null}
            <WsSide />
          </div>
        )}
      </div>
    </PageBody>
  );
}
