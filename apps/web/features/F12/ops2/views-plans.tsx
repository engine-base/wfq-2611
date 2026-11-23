"use client";
// 配るもの › プラン：いまのプラン・値段を変える案・決める人の画面・値段の記録（段 13・領域 ops2・キャンバス OpPlans・OpPlanEdit・OpPlanReview・OpPlanLog）。
//   値を受け取って描くだけ。値段は仮。業務の型は描かない（段 10 の決め）
import { Plus } from "lucide-react";
import { Band, Button, Callout, PageBody, PageHeader, TextArea, TextField } from "@/components/k";
import { Card, Chip, Facts, Feed, Note, RadioChoice, Stat, StatGrid, StatusBadge } from "@/features/F12/ops/ops-parts";
import { IMPACT_ROWS, type ImpactRow } from "./ops2-sample";
import "@/features/F12/ops/ops.css";
import "./ops2.css";
import { RespTable, type RespColumn } from "@/features/F12/shared/resp-table";

export type SkillsTab = "ops" | "templates" | "plans";
const TABS: readonly (readonly [SkillsTab, string, number, string])[] = [
  ["ops", "操作", 1, "/dev/mock/f12-ops2/oq-operations"],
  ["templates", "ひな形", 3, "/dev/mock/f12-ops2/oq-templates"],
  ["plans", "プラン", 3, "/dev/mock/f12-ops2/oq-plans"],
];

/** 配るものの中の行き先（操作・ひな形・プラン）。配るものは全部のワークスペースに効く */
export function SkillsNav({ on }: { on: SkillsTab }) {
  return (
    <nav aria-label="配るものの中">
      <ul className="k-oq-subnav">
        {TABS.map(([k, label, n, href]) => (
          <li key={k}>
            <a href={href} {...(k === on ? { "aria-current": "page" as const } : {})}>
              {label}
              <StatusBadge tone="neutral">{n}</StatusBadge>
            </a>
          </li>
        ))}
        <li>
          <Note>配るものは全部のワークスペースに効く。版で持ち、前の版に戻せる</Note>
        </li>
      </ul>
    </nav>
  );
}

type PlansView = "now" | "proposal" | "log";
function PlansChips({ on }: { on: PlansView }) {
  return (
    <div className="k-op-chips" role="group" aria-label="プランの見方">
      <Chip on={on === "now"}>いまのプラン</Chip>
      <Chip on={on === "proposal"} count={1}>
        変える案
      </Chip>
      <Chip on={on === "log"}>記録</Chip>
    </div>
  );
}

interface PlanBox {
  name: string;
  ver: string;
  places: number;
  price: string;
  rows: readonly (readonly [string, string])[];
  proposal?: string;
}
const PLAN_BOXES: readonly PlanBox[] = [
  {
    name: "無料",
    ver: "v1",
    places: 21,
    price: "¥0",
    rows: [
      ["人数", "3 人まで"],
      ["使えるもの", "チケット・承認・ナレッジ"],
    ],
  },
  {
    name: "チーム",
    ver: "v1",
    places: 19,
    price: "¥15,000",
    rows: [
      ["人数", "10 人まで"],
      ["使えるもの", "＋ ゲストを招く"],
      ["無料期間", "なし"],
    ],
    proposal: "v2 ¥18,000 ・ 決める人を待っている",
  },
  {
    name: "ビジネス",
    ver: "v1",
    places: 8,
    price: "¥40,000",
    rows: [
      ["人数", "30 人まで"],
      ["使えるもの", "＋ ゲストのグループ"],
      ["無料期間", "なし"],
    ],
  },
];

/** プラン：版・使っている会社の数・変える案 */
export function PlansPage() {
  return (
    <PageBody labelledBy="oq-plans-title">
      <PageHeader
        id="oq-plans-title"
        title="プラン"
        sub="値段と中身。変えるときは新しい版の案を作り、別の人が決める"
        actions={
          <Button icon={<Plus size={14} />} aria-disabled="true" tabIndex={-1} title="まだ使えません">
            プランを足す
          </Button>
        }
      />
      <div className="k-op-body">
        <SkillsNav on="plans" />
        <PlansChips on="now" />
        <Callout tone="info" title="仮">
          値段はまだ仮です。決めたら新しい版として出します（顧客の「プランを変える」と請求書に出る値段もここから）
        </Callout>
        <div className="k-oq-plans">
          {PLAN_BOXES.map((p) => (
            <Card key={p.name} title={p.name} aside={`${p.ver} ・ ${p.places} か所`}>
              <p className="k-op-price">
                <b>{p.price}</b>
                {p.price === "¥0" ? "" : " ／月・税別"}
              </p>
              <Facts rows={p.rows} />
              {p.proposal ? <Note>案 ・ {p.proposal}</Note> : null}
              <div className="k-oq-acts">
                <Button size="sm" variant="outlined">
                  変える案を作る
                </Button>
              </div>
            </Card>
          ))}
        </div>
        <Note>
          変える流れ：「値段の案」ができる人が案を作る → 「値段を決める」ができる別の人が影響を見て決める →
          いまの顧客へのお知らせが自動で出る → 決めた日に効く。すべて「記録」に残る
        </Note>
      </div>
    </PageBody>
  );
}

const IMPACT_COLS: RespColumn<ImpactRow>[] = [
  { key: "ws", header: "ワークスペース", cell: (r) => r.ws },
  { key: "people", header: "人数", num: true, cell: (r) => r.people },
  { key: "now", header: "いま", cell: (r) => <span className="k-oq-from">{r.now}</span> },
  { key: "after", header: "変わったあと", cell: (r) => <span className="k-oq-to">{r.after}</span> },
];

/** 影響（案を作る画面と決める画面で同じ） */
function Impact() {
  return (
    <Card title="影響" aside="いまのチームの顧客">
      <StatGrid>
        <Stat label="いまのチームの顧客" value="19 か所" sub="止めている 1 を含む" />
        <Stat label="月の売上（税別）" value="+ ¥57,000" sub="2027 年 2 月分から" />
        <Stat label="新しく入る人" value="12/01 から" sub="¥18,000 で始まる" />
      </StatGrid>
      <RespTable
        caption="影響を受けるワークスペース"
        columns={IMPACT_COLS}
        rows={[...IMPACT_ROWS]}
        rowKey={(r) => r.ws}
      />
      <Note>ほか 15 か所も同じ（すべて見る）</Note>
    </Card>
  );
}

/** 値段を変える案を作る：前後の差・いまの顧客の扱い・新しく入る人・理由・影響・決める人 */
export function PlanEditPage() {
  return (
    <PageBody labelledBy="oq-plan-edit-title">
      <PageHeader
        id="oq-plan-edit-title"
        title="チームの値段を変える案"
        sub="v1 → v2 ・ 作る人 佐野"
        actions={
          <>
            <Button variant="outlined">下書きにする</Button>
            <Button>決める人に回す</Button>
          </>
        }
      />
      <div className="k-op-body">
        <SkillsNav on="plans" />
        <Card title="変えるところ">
          <div className="k-oq-grid2">
            <TextField
              label="値段（月・税別）"
              name="price"
              readOnly
              defaultValue="¥18,000"
              description="いま ¥15,000"
            />
            <TextField label="人数" name="people" readOnly defaultValue="12 人まで" description="いま 10 人まで" />
            <TextField
              label="無料期間（日）"
              name="trial_days"
              type="number"
              readOnly
              defaultValue="0"
              description="0〜365 ・ 0 なら無し ・ いま 0 日（なし）"
            />
          </div>
        </Card>
        <Card title="いまの顧客（19 か所）は">
          <fieldset className="k-op-fieldset">
            <RadioChoice
              name="existing"
              value="after"
              checked
              title="お知らせから 90 日たってから新しい値段"
              desc="決めた日にお知らせを出し、90 日たった最初の月の分から ¥18,000。日数は変えられる（30 日より短くはできない）"
            />
            <RadioChoice
              name="existing"
              value="keep"
              title="ずっと今の値段のまま"
              desc="いまの顧客は v1（¥15,000）のまま。新しく入る人だけ ¥18,000。中身の変化（12 人まで）も v1 の顧客には効かない"
            />
          </fieldset>
          <TextField label="日数" name="days" readOnly defaultValue="90 日" />
          <Note>値下げ・中身を増やすだけの版は、いまの顧客にも次の請求からすぐ効く（この欄は出ない）</Note>
        </Card>
        <Card title="新しく入る人">
          <fieldset className="k-op-fieldset">
            <RadioChoice name="newcomer" value="now" title="決めたらすぐ" />
            <RadioChoice name="newcomer" value="date" checked title="日を決める" desc="12/01" />
          </fieldset>
        </Card>
        <TextArea
          label="理由"
          name="reason"
          rows={3}
          required
          readOnly
          description="必須 ・ お知らせの文のもとにもなる"
          defaultValue="チームの使われ方が増え、人数の上限に当たる会社が多いため。人数を 12 人まで広げ、値段を見直す"
        />
        <Impact />
        <Card title="決める人">
          <Facts rows={[["決める人", "高本 聖斗（「値段を決める」ができる人）"]]} />
          <Note>自分の案は自分で決められない</Note>
        </Card>
      </div>
    </PageBody>
  );
}

/** 決める人の画面：影響を見て決める／差し戻す。self を渡すと自分の案（決められない・押せない形） */
export function PlanReviewPage({ self = false }: { self?: boolean }) {
  const blocked = self ? { "aria-disabled": true, tabIndex: -1, title: "自分の案は自分で決められません" } : {};
  return (
    <PageBody labelledBy="oq-plan-review-title">
      <PageHeader
        id="oq-plan-review-title"
        title="チーム v1 → v2 の案"
        sub={
          self
            ? "自分が作った案 ・ 佐野 ・ 11/04 16:40 に回した"
            : "決める人を待っている ・ 佐野 ・ 11/04 16:40 に回した"
        }
      />
      <div className="k-op-body">
        <SkillsNav on="plans" />
        <PlansChips on="proposal" />
        {self ? (
          <Band
            tone="info"
            title="自分の案は自分で決められません"
            sub="「値段を決める」ができる別の運営の人（高本）が決めます。決めてもらうまで、この案は見るだけです"
          />
        ) : null}
        <Card title="変わること">
          <Facts
            rows={[
              [
                "値段（月・税別）",
                <span key="p">
                  <span className="k-oq-from">¥15,000</span> → <span className="k-oq-to">¥18,000</span>
                </span>,
              ],
              [
                "人数",
                <span key="n">
                  <span className="k-oq-from">10 人まで</span> → <span className="k-oq-to">12 人まで</span>
                </span>,
              ],
              ["無料期間", "なし（変えない）"],
              ["いまの顧客", "お知らせから 90 日たった最初の月（2027 年 2 月分）から"],
              ["新しく入る人", "12/01 から"],
            ]}
          />
          <Note>
            理由：チームの使われ方が増え、人数の上限に当たる会社が多いため。人数を 12 人まで広げ、値段を見直す
          </Note>
        </Card>
        <Card title="決めると起きること">
          <ol className="k-oq-numbered">
            <li>チーム v2 ができる（v1 は残り、いまの顧客は 2027 年 1 月分まで v1）</li>
            <li>
              いまの顧客 19
              か所の管理者にお知らせが出る（文は下で直せる）。設定の「プランと支払い」にも変わる日と値段が出る
            </li>
            <li>12/01 から、新しく入る人と「プランを変える」でチームを選ぶ人は ¥18,000</li>
            <li>2027 年 2 月分の請求書から ¥18,000（下書きの段で運営が確かめる）</li>
          </ol>
        </Card>
        <TextArea
          label="お知らせの文（決めたら出る）"
          name="notice"
          rows={4}
          readOnly
          defaultValue="チームプランの料金を 2027 年 2 月分から月 ¥18,000（税別）に改めます。あわせて人数の上限を 10 人から 12 人に広げます。それまでは今の料金のままです。ご不明な点は「困ったとき・お知らせ」からお問い合わせください。"
        />
        <Impact />
        <div className="k-oq-bar">
          <Note>
            決める前に本人確認を取り直す（パスキー）。決めた人・時刻・理由・前後の値段は「記録」に残り、消せない
          </Note>
          <div className="k-oq-acts">
            <Button variant="outlined" {...blocked}>
              差し戻す（理由を書く）
            </Button>
            <Button {...blocked}>決める</Button>
          </div>
        </div>
      </div>
    </PageBody>
  );
}

/** 値段の記録：消せない・直せない */
export function PlanLogPage() {
  return (
    <PageBody labelledBy="oq-plan-log-title">
      <PageHeader id="oq-plan-log-title" title="プランの記録" sub="値段と中身を変えた記録。消せない・直せない" />
      <div className="k-op-body">
        <SkillsNav on="plans" />
        <PlansChips on="log" />
        <div className="k-op-chips" role="group" aria-label="プラン">
          {["すべて", "無料", "チーム", "ビジネス"].map((p, i) => (
            <Chip key={p} on={i === 0}>
              {p}
            </Chip>
          ))}
        </div>
        <Card>
          <Feed
            label="値段の記録"
            items={[
              {
                at: "11/04 16:40",
                who: "佐野",
                text: "が チーム v2 の案を直して、決める人に回した",
                detail: "¥20,000 → ¥18,000 ・ 10 → 12 人",
              },
              {
                at: "11/04 15:10",
                who: "高本",
                text: "が チーム v2 の案を差し戻した",
                detail: "理由：上げ幅が大きい。人数の上限を広げるなら考える",
              },
              {
                at: "11/04 11:20",
                who: "佐野",
                text: "が チーム v2 の案を作った",
                detail: "¥15,000 → ¥20,000",
              },
              {
                at: "04/01 10:00",
                who: "高本",
                text: "が チーム v1 の案を決めた",
                detail: "¥0 → ¥15,000 ・ 理由：はじめの値段",
              },
            ]}
          />
        </Card>
        <Note>消せない・直せない。決めた版は、どのワークスペースがどの版にいるかと一緒に残る</Note>
      </div>
    </PageBody>
  );
}
