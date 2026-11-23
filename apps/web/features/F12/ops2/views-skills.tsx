"use client";
// 配るもの › ひな形・操作／会社の側のひな形の新しい版（段 13・領域 ops2・キャンバス OpTemplates・OpTypes）。値を受け取って描くだけ。
//   ひな形は新しく入る会社が最初に使う既定の形（種別（名前・色・本文のひな形）・状態・項目）。会社は後から自由に変えられ、新しい版は
//   会社が手を付けていない所だけ「こう変わります」と知らせる（代表の答え 2026-11-23・D-156.20）。業務の型は描かない（段 10 の決め）
import { Fingerprint, Plus } from "lucide-react";
import { Band, Button, Confirm, PageBody, PageHeader } from "@/components/k";
import { Bullets, Card, Note, StatusBadge } from "@/features/F12/ops/ops-parts";
import { SkillsNav } from "./views-plans";
import "@/features/F12/ops/ops.css";
import "./ops2.css";
import { RespTable, type RespColumn } from "@/features/F12/shared/resp-table";

interface TemplateRow {
  id: string;
  name: string;
  body: string;
  ver: string;
  using: string;
  took: string;
  last: string;
}
const TEMPLATES: readonly TemplateRow[] = [
  {
    id: "kind",
    name: "種別",
    body: "タスク・QA・課題・会議 の名前・色・本文のひな形",
    ver: "v3",
    using: "48",
    took: "31 ／ 46",
    last: "10/20",
  },
  {
    id: "state",
    name: "状態",
    body: "未着手・作業中・確認中・承認待ち・実行中・完了",
    ver: "v2",
    using: "48",
    took: "48 ／ 48",
    last: "09/15",
  },
  {
    id: "field",
    name: "項目",
    body: "チケットの欄の並び・必須。種別ごとに持つ",
    ver: "v1",
    using: "48",
    took: "—",
    last: "09/01",
  },
];
const COLS: RespColumn<TemplateRow>[] = [
  {
    key: "name",
    header: "ひな形",
    cell: (r) => (
      <span className="k-op-name">
        <b>{r.name}</b>
        <span>{r.body}</span>
      </span>
    ),
  },
  { key: "ver", header: "版", cell: (r) => r.ver },
  { key: "using", header: "使い始めたワークスペース", num: true, cell: (r) => r.using },
  { key: "took", header: "新しい版に変えた", num: true, cell: (r) => r.took },
  { key: "last", header: "最後に出した日", cell: (r) => r.last },
  {
    key: "act",
    header: <span className="sr-only">操作</span>,
    card: "action",
    cell: (r) => (
      <Button
        size="sm"
        variant="outlined"
        aria-label={`${r.name} の新しい版を作る`}
        aria-disabled="true"
        tabIndex={-1}
        title="まだ使えません"
      >
        新しい版
      </Button>
    ),
  },
];

/** ひな形：中身は 種別・状態・項目。版・使っている会社の数・新しい版に変えた数 */
export function TemplatesPage() {
  return (
    <PageBody labelledBy="oq-templates-title">
      <PageHeader
        id="oq-templates-title"
        title="ひな形"
        sub="新しく入るワークスペースが最初に使う既定の形。各ワークスペースは後から自由に変えられる"
        actions={
          <Button icon={<Plus size={14} />} aria-disabled="true" tabIndex={-1} title="まだ使えません">
            ひな形を足す
          </Button>
        }
      />
      <div className="k-op-body">
        <SkillsNav on="templates" />
        <RespTable caption="ひな形の一覧" columns={COLS} rows={[...TEMPLATES]} rowKey={(r) => r.id} />
        <Card title="新しい版を出すと">
          <ol className="k-oq-numbered">
            <li>新しく入るワークスペースは、最新の既定で始まる</li>
            <li>
              既定のまま使っているワークスペースの管理者には、鈴で「ひな形がこう変わります」と知らせる。管理者が「そのままにする」か「変える」を選ぶ
            </li>
            <li>既定から変えたワークスペース（直した・消した・自分で足した物がある）には知らせない（そのまま残る）</li>
          </ol>
          <Note>
            新しい版は、今の版の中身を写して直す（足す・直す・消す）。運営が業界ごとに作り込むことはしない。版を出す前に本人確認を取り直す
          </Note>
        </Card>
      </div>
    </PageBody>
  );
}

/** ひな形の新しい版を出す確かめ（会社に知らせる） */
export function TemplateReleaseConfirm({ onClose, onConfirm }: { onClose?: () => void; onConfirm?: () => void }) {
  return (
    <Confirm
      open
      onOpenChange={(o) => !o && onClose?.()}
      onConfirm={() => onConfirm?.()}
      tone="primary"
      confirmLabel="本人確認をして出す"
      title="ひな形「種別」の新しい版（v4）を出す"
      description="使っているワークスペース 48 か所のうち、既定のまま使っている 31 か所の管理者に鈴で知らせます"
    >
      <div className="k-op-form">
        <Bullets
          label="出すと起きること"
          items={[
            "新しく入るワークスペースは、すぐ v4 で始まる",
            "既定のまま使っているワークスペースの管理者に、鈴で「ひな形がこう変わります」と知らせる。「そのままにする」か「変える」を選ぶ",
            "既定から変えたワークスペース 17 か所には知らせない（そのまま残る）",
          ]}
        />
        <Note>
          <Fingerprint size={14} aria-hidden="true" />{" "}
          出す前に本人確認を取り直します（パスキー）。出した人・時刻・版は運営の記録に残ります
        </Note>
      </div>
    </Confirm>
  );
}

/** 操作：読むだけ（ブラウザで操作する v1.4）。上げる・直すは後のフェーズ（押せない形で出す） */
export function OperationsPage() {
  return (
    <PageBody labelledBy="oq-operations-title">
      <PageHeader
        id="oq-operations-title"
        title="操作"
        sub="全社向け。顧客には欄と説明だけが見え、中の作りは見えない"
        actions={
          <Button icon={<Plus size={14} />} aria-disabled="true" tabIndex={-1} title="まだ使えません">
            操作を上げる
          </Button>
        }
      />
      <div className="k-op-body">
        <SkillsNav on="ops" />
        <Card title="ブラウザで操作する" aside="v1.4 ・ 読むだけ">
          <p>汎用の操作 1 つ。初めてのサイトも動かし、うまくいったら動かし方を記録して次から使う</p>
          <div className="k-op-inline">
            <StatusBadge tone="success">検査 通った</StatusBadge>
            <Button size="sm" variant="outlined" aria-disabled="true" tabIndex={-1} title="まだ使えません">
              版を見る
            </Button>
          </div>
        </Card>
        <Note>いまは読むだけです。操作を上げる・版を出す・直すは、後のフェーズで使えるようになります</Note>
      </div>
    </PageBody>
  );
}

interface DiffRow {
  id: string;
  kind: "足す" | "変える";
  target: string;
  detail: string;
}
const DIFFS: readonly DiffRow[] = [
  { id: "d1", kind: "足す", target: "種別「会議」", detail: "欄「議事録のリンク」を足す（必須ではありません）" },
  { id: "d2", kind: "足す", target: "種別「課題」", detail: "色「橙」を足す" },
  { id: "d3", kind: "足す", target: "本文のひな形「QA」", detail: "「再現の手順」の見出しを足す" },
];
const DIFF_COLS: RespColumn<DiffRow>[] = [
  { key: "kind", header: "", cell: (r) => <StatusBadge tone="success">{r.kind}</StatusBadge> },
  { key: "target", header: "どこ", cell: (r) => r.target },
  { key: "detail", header: "中身", cell: (r) => r.detail },
];

/** 会社の側（ワークスペースの管理 › 設定）：ひな形がこう変わる。手を付けていない所だけを出し、「そのままにする」か「変える」を選ぶ（D-156.20） */
export function TemplateUpdatePage() {
  return (
    <PageBody labelledBy="oq-template-update-title">
      <PageHeader
        id="oq-template-update-title"
        title="ひな形がこう変わります"
        sub="種別 v3 → v4 ・ 手を付けていない所だけ ・ 出した日 10/20 ・ Kaname 運営より"
        actions={
          <>
            <Button variant="outlined">そのままにする</Button>
            <Button>変える</Button>
          </>
        }
      />
      <div className="k-op-body">
        <Band
          tone="info"
          title="自分で変えた所は、ここに出ません"
          sub="このワークスペースで手を付けていない所だけを出しています。変えても、自分で変えた所はそのまま残ります"
        />
        <RespTable caption="こう変わります" columns={DIFF_COLS} rows={[...DIFFS]} rowKey={(r) => r.id} />
        <Note>
          「変える」は上の 3
          つを新しい既定に変えます（自分で変えた種別・色・本文には触りません）。「そのままにする」は今のまま使います
        </Note>
        <Note>選べるのはワークスペースの管理者だけです。選んだ人と日時は記録に残ります</Note>
      </div>
    </PageBody>
  );
}

interface EditRow {
  id: string;
  name: string;
  color: string;
  body: string;
  /** 今の版から変えた所（無ければ今の版のまま） */
  change?: "足した" | "直した" | "消す";
}
const EDIT_ROWS: readonly EditRow[] = [
  { id: "task", name: "タスク", color: "青", body: "やること・期限・確かめること" },
  { id: "qa", name: "QA", color: "緑", body: "確かめる所・再現の手順・期待", change: "直した" },
  { id: "issue", name: "課題", color: "橙", body: "困っていること・影響・次の手", change: "直した" },
  { id: "meeting", name: "会議", color: "灰", body: "議題・決めたこと・議事録のリンク", change: "直した" },
  { id: "memo", name: "メモ", color: "灰", body: "書いておくこと", change: "消す" },
  { id: "estimate", name: "見積", color: "紫", body: "範囲・金額・期限", change: "足した" },
];
const CHANGE_TONE = { 足した: "success", 直した: "progress", 消す: "danger" } as const;

/** 直す頁の 1 行：名前・色・本文のひな形・変えた所・直す／消す（消す行は取り消す） */
const EDIT_COLS: RespColumn<EditRow>[] = [
  {
    key: "name",
    header: "種別",
    cell: (r) => (
      <span className="k-op-name">
        <b>{r.name}</b>
        <span>{r.body}</span>
      </span>
    ),
  },
  { key: "color", header: "色", nowrap: true, cell: (r) => r.color },
  {
    key: "change",
    header: "今の版から",
    nowrap: true,
    cell: (r) =>
      r.change ? (
        <StatusBadge tone={CHANGE_TONE[r.change]}>{r.change}</StatusBadge>
      ) : (
        <StatusBadge tone="neutral">そのまま</StatusBadge>
      ),
  },
  {
    key: "act",
    header: <span className="sr-only">操作</span>,
    card: "action",
    cell: (r) => (
      <span className="k-oq-acts">
        <Button size="sm" variant="outlined" aria-label={`${r.name} を直す`}>
          直す
        </Button>
        {r.change === "消す" ? (
          <Button size="sm" variant="ghost" aria-label={`${r.name} を消すのを取り消す`}>
            取り消す
          </Button>
        ) : (
          <Button size="sm" variant="ghost" aria-label={`${r.name} を消す`}>
            消す
          </Button>
        )}
      </span>
    ),
  },
];

/** ひな形の新しい版の中身を直す頁：今の版（v3）を写して直す（種別・状態・項目を足す・直す・消す）。出すときに出す確かめ（D-156.55） */
export function TemplateEditPage() {
  return (
    <PageBody labelledBy="oq-template-edit-title">
      <PageHeader
        id="oq-template-edit-title"
        title="ひな形「種別」の新しい版（v4）"
        sub="今の版 v3 を写して直しています ・ 下書き ・ 佐野 ・ 11/05 14:20 に保存"
        actions={
          <>
            <Button variant="outlined">下書きにする</Button>
            <Button icon={<Fingerprint size={14} />}>v4 を出す</Button>
          </>
        }
      />
      <div className="k-op-body">
        <SkillsNav on="templates" />
        <Card title="種別" aside="名前・色・本文のひな形">
          <RespTable caption="新しい版の種別" columns={EDIT_COLS} rows={[...EDIT_ROWS]} rowKey={(r) => r.id} />
          <div className="k-oq-acts">
            <Button size="sm" variant="outlined" icon={<Plus size={14} />}>
              種別を足す
            </Button>
          </div>
        </Card>
        <Card title="今の版 v3 との差">
          <Bullets
            label="今の版 v3 との差"
            items={[
              "足す：種別「見積」",
              "直す：種別「QA」「課題」「会議」の本文のひな形",
              "消す：種別「メモ」（使っているワークスペースの「メモ」はそのまま残る）",
            ]}
          />
          <Note>出すまでは顧客に何も届きません。今の版 v3 はそのまま残り、前の版に戻せます</Note>
        </Card>
      </div>
    </PageBody>
  );
}
