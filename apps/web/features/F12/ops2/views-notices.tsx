"use client";
// 運営のお知らせ：一覧・作る・1 件（障害の続報）・出す確かめ（段 13・領域 ops2・キャンバス OpNotices・OpNoticeNew・OpNotice）。値を受け取って描くだけ
import { Plus } from "lucide-react";
import {
  Band,
  Button,
  Confirm,
  PageBody,
  PageHeader,
  Select,
  TextArea,
  TextField,
  type BadgeTone,
} from "@/components/k";
import { Bullets, Card, Chip, Facts, Feed, Note, RadioChoice, StatusBadge } from "@/features/F12/ops/ops-parts";
import "@/features/F12/ops/ops.css";
import "./ops2.css";
import { RespTable, type RespColumn } from "@/features/F12/shared/resp-table";
import "../shared/choice.css";

interface NoticeRow {
  kind: string;
  title: string;
  to: string;
  state: string;
  tone: BadgeTone;
  by: string;
}
const ROWS: readonly NoticeRow[] = [
  {
    kind: "障害",
    title: "分身の実行が遅れています",
    to: "全部",
    state: "原因が分かった ・ 11/02 09:40〜",
    tone: "warning",
    by: "高本",
  },
  {
    kind: "メンテ",
    title: "11/10（月）2:00〜3:00 メンテナンス",
    to: "全部",
    state: "予定 ・ 11/03 10:00 に出す",
    tone: "progress",
    by: "高本",
  },
  {
    kind: "リリース",
    title: "チケットにスレッドができました",
    to: "全部",
    state: "出した 10/28",
    tone: "success",
    by: "高本",
  },
  {
    kind: "リリース",
    title: "先方の人を招けるようにしました",
    to: "チーム・ビジネス",
    state: "出した 10/14",
    tone: "success",
    by: "佐野",
  },
  {
    kind: "リリース",
    title: "ナレッジの取り込み（Obsidian・Notion）",
    to: "全部",
    state: "下書き",
    tone: "neutral",
    by: "佐野",
  },
];
const COLS: RespColumn<NoticeRow>[] = [
  { key: "kind", header: "種類", cell: (r) => <StatusBadge tone="neutral">{r.kind}</StatusBadge> },
  {
    key: "title",
    header: "題",
    cell: (r) => (
      <a className="k-link" href="/dev/mock/f12-ops2/oq-notice">
        {r.title}
      </a>
    ),
  },
  { key: "to", header: "誰に", cell: (r) => r.to },
  { key: "state", header: "状態", cell: (r) => <StatusBadge tone={r.tone}>{r.state}</StatusBadge> },
  { key: "by", header: "出した人", cell: (r) => r.by },
];

/** お知らせの一覧：出した・予定・障害の状態・下書き */
export function NoticesPage() {
  return (
    <PageBody labelledBy="oq-notices-title">
      <PageHeader
        id="oq-notices-title"
        title="お知らせ"
        sub="全部のワークスペースか、選んだワークスペースに出す"
        actions={
          <a className="k-btn" data-variant="primary" data-size="md" href="/dev/mock/f12-ops2/oq-notice-new">
            <Plus size={14} aria-hidden="true" />
            お知らせを書く
          </a>
        }
      />
      <div className="k-op-body">
        <div className="k-op-chips" role="group" aria-label="種類">
          {["すべて", "障害", "メンテ", "リリース", "下書き"].map((k, i) => (
            <Chip key={k} on={i === 0}>
              {k}
            </Chip>
          ))}
        </div>
        <RespTable caption="お知らせの一覧" columns={COLS} rows={[...ROWS]} rowKey={(r) => r.title} />
        <Note>
          顧客には「困ったとき・お知らせ」の一覧に出る。障害とメンテは上の帯にも出て、メンテ中はメンテナンス中の画面になる。メールは、使えなくなるメンテのときだけ各ワークスペースの管理者に届く
        </Note>
      </div>
    </PageBody>
  );
}

const PLAN_PICKS = ["無料", "チーム", "ビジネス"] as const;
const WS_PICKS = ["合同会社ミナト企画", "北村デザイン事務所", "株式会社オオタ物流"] as const;

/** 誰に を選んだときの中の選び肢（プラン 3 つ・ワークスペースの候補）。選んでいない方は押せない */
function PickChecks({ label, items, on }: { label: string; items: readonly string[]; on: boolean }) {
  // ワークスペースの名前は長いので 1 列（細い列で名前が折れないように）
  const wide = items.some((t) => t.length > 6);
  return (
    <div className="k-op-checks" role="group" aria-label={label} {...(wide ? { "data-wide": true } : {})}>
      {items.map((t) => (
        <label key={t} className="k-op-choice">
          <input type="checkbox" defaultChecked={on && t !== "無料"} disabled={!on} />
          <span className="k-op-choice-text">
            <b>{t}</b>
          </span>
        </label>
      ))}
    </div>
  );
}

export interface NoticeNewPageProps {
  /** 出したお知らせを書き直す（題・本文・影響・メンテの時間だけ直せる。種類・誰に・出す場所・いつ出すかは押せない形で出す＝隠さない） */
  edit?: boolean;
}

/** お知らせを書く・書き直す：種類・題・本文・メンテの始まりと終わり・影響・誰に・出す場所・いつ出すか・顧客にはこう見える */
export function NoticeNewPage({ edit = false }: NoticeNewPageProps) {
  const fixed = edit ? { disabled: true } : {};
  return (
    <PageBody labelledBy="oq-notice-new-title">
      <PageHeader
        id="oq-notice-new-title"
        title={edit ? "お知らせを書き直す" : "お知らせを書く"}
        {...(edit ? { sub: "出したお知らせ ・ 題・本文・影響・メンテの時間だけ直せます" } : {})}
        actions={
          edit ? (
            <>
              <Button variant="outlined">やめる</Button>
              <Button>書き直す</Button>
            </>
          ) : (
            <>
              <Button variant="outlined">下書きにする</Button>
              <Button>11/03 10:00 に出す</Button>
            </>
          )
        }
      />
      <div className="k-op-body">
        <div className="k-oq-grid2">
          <div className="k-op-form">
            <Select
              label="種類"
              name="kind"
              defaultValue="maint"
              {...fixed}
              options={[
                { value: "release", label: "リリース" },
                { value: "incident", label: "障害" },
                { value: "maint", label: "メンテ" },
              ]}
            />
            <TextField label="題" name="title" readOnly defaultValue="11/10（月）2:00〜3:00 メンテナンス" />
            <TextArea
              label="本文"
              name="body"
              rows={6}
              readOnly
              defaultValue={
                "データベースの入れ替えのため、11/10（月）2:00〜3:00 の間 Kaname を使えません。\n・実行中の分身の仕事は、始まる前に区切りまで進めて止めます\n・この間に承認したものは「実行待ち」になり、終わってから動きます"
              }
            />
            <div className="k-oq-grid2">
              <TextField
                label="メンテの始まり"
                name="starts_at"
                type="datetime-local"
                readOnly
                defaultValue="2026-11-10T02:00"
                description="日本時間 ・ 種類がメンテのときだけ"
              />
              <TextField
                label="メンテの終わり"
                name="ends_at"
                type="datetime-local"
                readOnly
                defaultValue="2026-11-10T03:00"
              />
            </div>
            <TextField
              label="影響する部分"
              name="impact"
              readOnly
              defaultValue="画面・分身の実行・PC とのつながり（すべて使えません）"
              description="200 字まで"
            />
            <fieldset className="k-op-fieldset" {...fixed}>
              <legend>誰に</legend>
              <RadioChoice name="to" value="all" checked title="全部のワークスペース" />
              <RadioChoice name="to" value="plan" title="プランで選ぶ" />
              <PickChecks label="プラン" items={PLAN_PICKS} on={false} />
              <RadioChoice name="to" value="pick" title="ワークスペースを選ぶ" />
              <PickChecks label="ワークスペース" items={WS_PICKS} on={false} />
            </fieldset>
            <fieldset className="k-op-fieldset" {...fixed}>
              <legend>出す場所</legend>
              <div className="k-op-checks" data-wide>
                {["お知らせの一覧", "上の帯（閉じられる）"].map((t) => (
                  <label key={t} className="k-op-choice">
                    <input type="checkbox" defaultChecked />
                    <span className="k-op-choice-text">
                      <b>{t}</b>
                    </span>
                  </label>
                ))}
              </div>
              <Note>
                メンテのときは、メンテの間はメンテナンス中の画面・ログインの画面にも出ます。使えなくなるメンテなので、各ワークスペースの管理者にメールでも届きます
              </Note>
            </fieldset>
            <fieldset className="k-op-fieldset" {...fixed}>
              <legend>いつ出すか</legend>
              <RadioChoice name="at" value="now" title="すぐ" />
              <RadioChoice name="at" value="date" checked title="日を決める" desc="11/03 10:00" />
            </fieldset>
          </div>
          <div className="k-op-form">
            <b>顧客にはこう見える</b>
            <div className="k-oq-preview">
              <span>上の帯</span>
              <Band
                tone="wait"
                title="11/10（月）2:00〜3:00 メンテナンス"
                sub="データベースの入れ替えのため、11/10（月）2:00〜3:00 の間 Kaname を使えません。…"
                acts={
                  <Button size="sm" variant="outlined">
                    詳しく
                  </Button>
                }
              />
            </div>
            <div className="k-oq-preview">
              <span>困ったとき・お知らせ の一覧</span>
              <b>メンテ ・ 11/10（月）2:00〜3:00 メンテナンス</b>
            </div>
          </div>
        </div>
      </div>
    </PageBody>
  );
}

const STEPS = ["調べている", "原因が分かった", "様子を見ている", "直った"] as const;

/** 1 件（障害）：状態 4 つ・続報を足す・影響する部分・出している場所 */
export function NoticePage() {
  return (
    <PageBody labelledBy="oq-notice-title">
      <PageHeader
        id="oq-notice-title"
        title="分身の実行が遅れています"
        sub="障害 ・ 全部のワークスペース ・ 11/02 09:40〜"
        actions={
          <>
            <Button variant="outlined">書き直す</Button>
            <Button>直ったにする</Button>
          </>
        }
      />
      <div className="k-op-body">
        <ol className="k-oq-steps" aria-label="状態">
          {STEPS.map((s, i) => (
            <li key={s} {...(i === 1 ? { "aria-current": "step" as const } : {})}>
              {i + 1} {s}
            </li>
          ))}
        </ol>
        <Card title="状態を足す">
          <div className="k-op-form">
            <Select
              label="状態"
              name="step"
              defaultValue="watch"
              options={[
                { value: "cause", label: "原因が分かった" },
                { value: "watch", label: "様子を見ている" },
                { value: "fixed", label: "直った" },
              ]}
            />
            <TextArea
              label="続報"
              name="body"
              rows={3}
              readOnly
              defaultValue="送る順番の仕組みを入れ替えました。遅れていた実行は順に動いています。様子を見ています。"
            />
            <div className="k-oq-end">
              <Button>足して出す</Button>
            </div>
          </div>
        </Card>
        <Card title="これまで">
          <Feed
            label="続報の記録"
            items={[
              {
                at: "11/02 10:20",
                text: "原因が分かった",
                detail: "送る順番の仕組みが詰まっていました。入れ替えています。データは消えていません。",
              },
              {
                at: "11/02 09:40",
                text: "調べている",
                detail: "分身の実行が始まるまでに時間がかかっています。調べています。",
              },
            ]}
          />
        </Card>
        <Card title="影響する部分">
          <Facts
            rows={[
              ["影響", "分身の実行が始まるまでに時間がかかっています。画面と PC とのつながりはふつうに使えます"],
              ["出している場所", "お知らせの一覧 ・ 上の帯"],
            ]}
          />
        </Card>
      </div>
    </PageBody>
  );
}

/** お知らせを出す確かめ：届く数・メンテはメールも */
export function NoticePublishConfirm({ onClose, onConfirm }: { onClose?: () => void; onConfirm?: () => void }) {
  return (
    <Confirm
      open
      onOpenChange={(o) => !o && onClose?.()}
      onConfirm={() => onConfirm?.()}
      tone="primary"
      confirmLabel="出す"
      title="このお知らせを出す"
      description="11/10（月）2:00〜3:00 メンテナンス。出すと、全部のワークスペースの人に届きます"
    >
      <Bullets
        label="出すと起きること"
        items={[
          "48 か所・延べ 312 人の「困ったとき・お知らせ」に出る",
          "画面の上の帯にも出る（閉じられる）",
          "メンテの間は、メンテナンス中の画面になる",
          "メンテなので、48 か所の管理者にメールも届く（使えなくなるため）",
        ]}
      />
      <Note>
        出したあとも、続報と 題・本文・影響・メンテの時間 の書き直しはできます。出したことは運営の記録に残ります
      </Note>
    </Confirm>
  );
}
