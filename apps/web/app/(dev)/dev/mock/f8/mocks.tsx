"use client";
// 段 9（F8 渡す・配る ＋ 前に出す招く葉）の下絵のモック（部品先行・枝 c/段9）。本番と同じ部品（features/F8/handover/views.tsx・
//   features/F10/invite/views.tsx・features/F4 の詳細の頭・components/k）を、決めた値で並べる。1 つの id ＝ 1 つの状態。
//   代表の答え（2026-11-20 朝・仮。代表が見直す）：0 横に渡す・配るだけ＋招く葉を前に／1 入口は詳細の右の「担当者 ▾」／2 本人は合意・マネージャーは配る・
//   直に書き換える道は作らない／4 渡し中も全部できる／5 AI が動いている・承認待ちは渡せない／残り 16 個は勧めのとおり（段9-代表に聞くこと.md）
//   詳細の右のパネルと承認待ちの表は、今の本線（detail-panel.tsx・queue-table.tsx）と同じクラスと並びをここで組む。本番では K-380 が置いた
//   差し込み口（パネルの担当者の値・題名の下の帯・表の行の種類）の先（features/F8/handover/detail-slots.tsx）に、画面の葉が features/F8 の部品を入れる
//   状態の持ち主（ticket）は画面の葉の番号（K-411〜K-415・招く葉 K-420）。本物にする葉はこのモックを正の絵にして本番をつなぐ
//   上へ上げる（A112）は今回切らない。キャンバスに在るのは承認待ちの絞り込みの札（上位の承認・判断を仰がれた）だけで、今の本線どおりグレー
import { Bot, PanelRight } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button, DocTools, Prose, Shell, Toaster, useNotify, type Crumb, type Group } from "@/components/k";
import { DetailMeta, DetailTitle, InertButton } from "@/features/F4/create-ticket/detail-head";
import "@/features/F4/create-ticket/ticket-detail.css";
import "@/features/F5/approve-complete/approve.css";
import {
  AssigneeValue,
  DeclineDialog,
  DistributeDialog,
  HandoverBand,
  HandoverDialog,
  HandoverRow,
  OfferDialog,
  OfferEntry,
  PickDialog,
  WithdrawConfirm,
  type CarryItem,
  type HandoverQueueRow,
  type PickMember,
  type QueueCardView,
  QueueCardMobile,
} from "@/features/F8/handover/views";
import {
  InviteDialog,
  MembersBody,
  WsHead,
  WsSub,
  type MemberGroup,
  type MemberRow,
} from "@/features/F10/invite/views";
import { StepUpDialog } from "@/features/F1/security/views";
import type { RoleId } from "@/lib/nav";
import type { Theme } from "@/lib/theme";

export interface MockEntry {
  id: string;
  screen: "tickets" | "approvals" | "members";
  label: string;
  /** この状態を本物にする画面の葉（11_tickets/K-411〜K-415・招く葉 K-420）。持ち主はこの番号だけ */
  ticket: string;
}

export const MOCKS: readonly MockEntry[] = [
  // 束 A：横に渡す
  {
    id: "f8-detail-owner",
    screen: "tickets",
    label: "詳細：担当者が見る（入口は右の「担当者 ▾」）",
    ticket: "K-411",
  },
  {
    id: "f8-pick",
    screen: "tickets",
    label: "相手を選ぶ小窓（探す欄・今週の件数・選べない人）",
    ticket: "K-411",
  },
  {
    id: "f8-pick-search",
    screen: "tickets",
    label: "相手を選ぶ小窓：名前・メールで絞った",
    ticket: "K-411",
  },
  { id: "f8-pick-none", screen: "tickets", label: "相手を選ぶ小窓：合う人がいない", ticket: "K-411" },
  { id: "f8-pass", screen: "tickets", label: "引き継いでもらうの小窓", ticket: "K-411" },
  {
    id: "f8-pass-error",
    screen: "tickets",
    label: "小窓：入力の誤り・相手が選べなくなった",
    ticket: "K-411",
  },
  {
    id: "f8-pass-refused",
    screen: "tickets",
    label: "小窓：口が断った（いま別の渡しの返事を待っている）",
    ticket: "K-411",
  },
  {
    id: "f8-blocked",
    screen: "tickets",
    label: "AI が動いている・承認待ちのチケットは渡せない",
    ticket: "K-411",
  },
  { id: "f8-waiting-sender", screen: "tickets", label: "渡した人：渡し中の帯", ticket: "K-413" },
  {
    id: "f8-reminded",
    screen: "tickets",
    label: "渡した人：催促した（1 日 1 回まで）",
    ticket: "K-413",
  },
  { id: "f8-withdraw", screen: "tickets", label: "渡した人：取り消す確かめ", ticket: "K-413" },
  { id: "f8-overdue", screen: "tickets", label: "渡した人：返事の期限が過ぎた", ticket: "K-413" },
  { id: "f8-declined-sender", screen: "tickets", label: "渡した人：断られた", ticket: "K-413" },
  { id: "f8-taken-sender", screen: "tickets", label: "渡した人：受けてもらえた", ticket: "K-412" },
  {
    id: "f8-queue",
    screen: "approvals",
    label: "渡された人：承認待ちに「渡された」の行",
    ticket: "K-412",
  },
  {
    id: "f8-waiting-recipient",
    screen: "tickets",
    label: "渡された人：詳細の帯（受ける／断る）",
    ticket: "K-412",
  },
  {
    id: "f8-decline",
    screen: "approvals",
    label: "渡された人：断る小窓（理由が必須）",
    ticket: "K-412",
  },
  {
    id: "f8-accepted",
    screen: "tickets",
    label: "渡された人：受けた後（担当者になった）",
    ticket: "K-412",
  },
  {
    id: "f8-gone",
    screen: "tickets",
    label: "渡された人：もう取り消された渡しを開いた",
    ticket: "K-412",
  },
  {
    id: "f8-offer-entry",
    screen: "tickets",
    label: "担当者でない人：題名の下の「引き継ぐ（申し出る）」",
    ticket: "K-414",
  },
  {
    id: "f8-offer",
    screen: "tickets",
    label: "担当者でない人：申し出る小窓（理由が必須）",
    ticket: "K-414",
  },
  {
    id: "f8-offer-answer",
    screen: "approvals",
    label: "担当者：申し出に答える（承認待ちの行）",
    ticket: "K-414",
  },
  { id: "f8-offer-band", screen: "tickets", label: "担当者：申し出の帯（詳細）", ticket: "K-414" },
  // 束 B：上から配る
  {
    id: "f8-pick-manager",
    screen: "tickets",
    label: "マネージャー：相手を選ぶ小窓（人かグループ）",
    ticket: "K-415",
  },
  { id: "f8-distribute", screen: "tickets", label: "マネージャー：配る小窓（人へ）", ticket: "K-415" },
  {
    id: "f8-distribute-group",
    screen: "tickets",
    label: "マネージャー：配る小窓（グループへ）",
    ticket: "K-415",
  },
  {
    id: "f8-distributed",
    screen: "tickets",
    label: "配られた人：すぐ担当者（合意なし）",
    ticket: "K-415",
  },
  {
    id: "f8-group-waiting",
    screen: "tickets",
    label: "配った人：グループに配り中の帯",
    ticket: "K-415",
  },
  {
    id: "f8-group",
    screen: "approvals",
    label: "グループの人：担当を決める・自分が持つ",
    ticket: "K-415",
  },
  // 共通
  { id: "f8-noperm", screen: "tickets", label: "閲覧のみの人：▾ も申し出も出ない", ticket: "K-411" },
  { id: "f8-failed", screen: "tickets", label: "渡しの様子を読めない", ticket: "K-411" },
  // 招く（F10 の葉を前に出す）
  { id: "inv-members", screen: "members", label: "メンバーの画面：「＋ 招く」", ticket: "K-420" },
  { id: "inv-dialog", screen: "members", label: "招くの小窓", ticket: "K-420" },
  {
    id: "inv-error",
    screen: "members",
    label: "招くの小窓：メールの形が違う・もう入っている",
    ticket: "K-420",
  },
  { id: "inv-link", screen: "members", label: "招くの小窓：招待のリンクを作った", ticket: "K-420" },
  {
    id: "inv-stepup",
    screen: "members",
    label: "管理者として招く前の本人確認の取り直し",
    ticket: "K-420",
  },
  { id: "inv-sent", screen: "members", label: "招いた：招待中の行", ticket: "K-420" },
];

// ---------------------------------------------------------------- 見本の値
const TICKET = {
  number: "EG-119",
  title: "問い合わせ（山田様）に一次返信する",
  created_at: "2026-11-20T00:40:00Z",
  start_on: "2026-11-20",
  due_on: "2026-11-27",
};
const KIND = { name: "タスク", color: "#22345C" };
const STAGE = { key: "doing", name: "作業中" };
const SECTIONS = [
  { key: "goal", label: "目的", text: "山田様の問い合わせ（保守の範囲）に、今日中に一次返信する" },
  { key: "done", label: "完了の条件", text: "山田様に一次返信のメールが届いている\n詳しい回答の期日を伝えている" },
];
const GROUPS: Group[] = [
  { code: "EG", name: "営業", href: "/tickets?scope=eg", pending: true, tone: "teal" },
  { code: "JD", name: "受託開発", href: "/tickets?scope=jd", pending: true, tone: "plum" },
];
const MEMBERS: PickMember[] = [
  {
    id: "m1",
    name: "高本 聖斗",
    sub: "営業",
    week: 7,
    email: "takamoto@engine-base.example",
    self: true,
    current: true,
  },
  { id: "m2", name: "鈴木 一郎", sub: "営業", week: 4, email: "suzuki@engine-base.example" },
  { id: "m3", name: "佐藤 花子", sub: "営業 マネージャー", week: 9, email: "sato@engine-base.example" },
  {
    id: "m4",
    name: "田中 美咲",
    sub: "営業",
    week: 0,
    email: "tanaka@engine-base.example",
    unavailable: "選べません（止まっています）",
  },
  {
    id: "m5",
    name: "木村 誠",
    sub: "営業",
    week: 0,
    email: "kimura@engine-base.example",
    unavailable: "選べません（招待中）",
  },
];
// 相手の佐藤 花子は営業（チケットのグループ）にいるので、グループを移す選び方は出さない（D-148.11・受けた帯の「グループは営業のまま」と合う）
const CARRY: CarryItem[] = [{ label: "子チケット 2 件も渡す（ほかの人の 1 件はそのまま）", checked: true }];
const VALUES = {
  reason: "先方と面識があるので、佐藤さんから返したほうが早い",
  ask: "今日中に一次返信だけお願いします",
  due: "11/23（月）18:00",
};
const WHY = "今週は月次の締めで手が空きません";

type Viewer = "takamoto" | "sato" | "suzuki" | "yamaguchi";
const VIEWER: Record<Viewer, { name: string; initial: string; role: RoleId }> = {
  takamoto: { name: "高本", initial: "高", role: "R1" },
  sato: { name: "佐藤", initial: "佐", role: "R2" },
  suzuki: { name: "鈴木", initial: "鈴", role: "R3" },
  yamaguchi: { name: "山口", initial: "山", role: "R4" },
};

// ---------------------------------------------------------------- 画面の組み立て
function Frame({
  theme,
  viewer,
  screen,
  crumbs,
  approvals,
  children,
  dialog,
}: {
  theme: Theme;
  viewer: Viewer;
  screen: "tickets" | "approvals" | "members";
  crumbs: Crumb[];
  approvals: number;
  children: ReactNode;
  dialog?: ReactNode;
}) {
  const v = VIEWER[viewer];
  return (
    <Toaster>
      <Shell
        role={v.role}
        screen={screen}
        crumbs={crumbs}
        workspace={{ name: "ENGINE BASE", initial: "E" }}
        member={{ name: v.name, initial: v.initial }}
        groups={GROUPS}
        badges={approvals ? { approvals } : {}}
        bridgeConnected
        theme={theme}
      >
        {children}
      </Shell>
      {dialog}
    </Toaster>
  );
}

/** 小さな知らせ（渡した直後・受けた直後など）。開いたときに 1 回出す */
function Toast({ title }: { title: string }) {
  const notify = useNotify();
  useEffect(() => {
    notify(title);
  }, [notify, title]);
  return null;
}

/** 詳細の右のパネル（今の detail-panel.tsx と同じクラスと並び。担当者の値だけ F8 の部品） */
function Panel({ assignee, viewer }: { assignee: ReactNode; viewer: Viewer }) {
  const rows: [string, ReactNode][] = [
    ["担当者", assignee],
    ["承認する人", ""],
  ];
  return (
    <aside aria-label="チケットのパネル" className="k-detail-panel">
      <button type="button" className="k-detail-panel-close" aria-label="パネルを閉じる" title="パネルを閉じる">
        <PanelRight size={16} aria-hidden="true" />
      </button>
      <nav aria-label="パネルのタブ" className="k-detail-tabs">
        <button type="button" aria-current="page">
          属性
        </button>
        <button type="button" aria-disabled="true" tabIndex={-1} title="まだ使えません">
          やり取り
        </button>
        <button type="button" aria-disabled="true" tabIndex={-1} title="まだ使えません">
          <Bot size={14} aria-hidden="true" />
          {`${VIEWER[viewer].name}のAI`}
        </button>
      </nav>
      <div className="k-detail-panel-body">
        <section aria-label="担当" className="k-detail-panel-sec">
          <h2>担当</h2>
          <dl className="k-detail-fields">
            {rows.map(([k, val]) => (
              <div key={k} className="k-detail-field">
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-label="日付と時間" className="k-detail-panel-sec">
          <h2>日付と時間</h2>
          <dl className="k-detail-fields">
            <div className="k-detail-field">
              <dt>開始日</dt>
              <dd>11/20（金）</dd>
            </div>
            <div className="k-detail-field">
              <dt>期限</dt>
              <dd>11/27（金）</dd>
            </div>
          </dl>
        </section>
        <section aria-label="分類" className="k-detail-panel-sec">
          <h2>分類</h2>
          <dl className="k-detail-fields">
            <div className="k-detail-field">
              <dt>グループ</dt>
              <dd>営業（EG）</dd>
            </div>
            <div className="k-detail-field">
              <dt>優先度</dt>
              <dd>中</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}

interface DetailProps {
  theme: Theme;
  viewer?: Viewer;
  band?: ReactNode;
  assignee?: ReactNode;
  approvals?: number;
  dialog?: ReactNode;
  toast?: string;
}

function Detail({ theme, viewer = "takamoto", band, assignee, approvals = 1, dialog, toast }: DetailProps) {
  return (
    <Frame
      theme={theme}
      viewer={viewer}
      screen="tickets"
      crumbs={[{ label: "チケット", href: "/tickets" }, { label: TICKET.number }]}
      approvals={approvals}
      dialog={
        <>
          {dialog}
          {toast ? <Toast title={toast} /> : null}
        </>
      }
    >
      <div className="k-detail">
        <section className="k-root k-page" aria-labelledby="ticket-title">
          <article className="k-detail-card">
            <DetailMeta ticket={TICKET} kind={KIND} stage={STAGE} />
            <DetailTitle title={TICKET.title} me={VIEWER[viewer].name} />
            {band ? <div className="k-detail-bands">{band}</div> : null}
            <DocTools label="本文の道具" note="「/」で部品を入れる ・ 本文の版 1">
              <InertButton size="sm" className="k-detail-versions">
                版と差分
              </InertButton>
            </DocTools>
            <div className="k-detail-doc">
              {SECTIONS.map((s) => (
                <section key={s.key} className="k-section" aria-label={s.label}>
                  <h2 id={`sec-${s.key}`}>{s.label}</h2>
                  <Prose>{s.text}</Prose>
                </section>
              ))}
            </div>
          </article>
          <section className="k-detail-links" aria-label="子チケット・つながり">
            <div className="k-detail-links-head">
              <h2>子チケット・つながり</h2>
              <InertButton size="sm">子を足す</InertButton>
              <InertButton size="sm">つながりを足す</InertButton>
            </div>
          </section>
        </section>
        <Panel viewer={viewer} assignee={assignee ?? <AssigneeValue name="高本 聖斗" mode="can" />} />
      </div>
    </Frame>
  );
}

// ---- 承認待ち（今の queue.tsx・queue-table.tsx と同じクラスと並び。「渡された」の行だけ F8 の部品）
const FILTERS = ["AI の成果物", "上位の承認", "渡された", "判断を仰がれた", "決まりの例外", "やり方を広げる"] as const;
const HEADERS = ["決めること", "種別", "番号", "題名", "誰から", "確認", "期限"] as const;
const inert = { "aria-disabled": true, tabIndex: -1 } as const;

function AiRow() {
  return (
    <tr>
      <td>
        <input type="checkbox" disabled aria-label="まとめて承認に入れる" />
      </td>
      <td>
        <span className="k-ap-kind">AI の成果物</span>
      </td>
      <td />
      <td>
        <a className="k-link k-ap-num" href="#ticket">
          EG-128
        </a>
      </td>
      <td className="k-ap-title">
        <a href="#ticket">セイコー様へ 11月分の請求書を送る</a>
      </td>
      <td>
        <span className="k-ap-from">
          <span className="k-ap-avatar" aria-hidden="true">
            AI
          </span>
          佐藤のAI
        </span>
      </td>
      <td className="k-ap-check">通過 3</td>
      <td>11/24</td>
      <td className="k-ap-end">
        <span className="k-ap-acts">
          <Button size="sm" variant="outlined">
            差し戻す
          </Button>
          <Button size="sm">承認する</Button>
        </span>
      </td>
    </tr>
  );
}

function Queue({
  theme,
  viewer = "sato",
  rows,
  dialog,
}: {
  theme: Theme;
  viewer?: Viewer;
  rows: readonly HandoverQueueRow[];
  dialog?: ReactNode;
}) {
  const total = rows.length + 1;
  return (
    <Frame
      theme={theme}
      viewer={viewer}
      screen="approvals"
      crumbs={[{ label: "承認待ち" }]}
      approvals={total}
      dialog={dialog}
    >
      <section className="k-root k-page" aria-labelledby="approvals-title">
        <header className="k-page-head k-ap-head">
          <h1 id="approvals-title">承認待ち</h1>
          <p className="k-page-sub">
            あなたが決めるもの <span className="k63-count">{total} 件</span>
          </p>
          <Button className="k-ap-next" {...inert}>{`続けて裁く（${total} 件）`}</Button>
        </header>
        <div className="k-ap-body">
          <section className="k-ap-card k-hnd-q-table" aria-label="承認待ちの一覧">
            <div className="k-ap-tools">
              <div className="k-ap-chips" role="group" aria-label="絞り込み">
                <button type="button" className="k-ap-chip" aria-pressed="true">
                  すべて {total}
                </button>
                {FILTERS.map((f) => (
                  <button key={f} type="button" className="k-ap-chip" aria-pressed="false" {...inert}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="k-ap-tools-end">
                <span className="k-ap-sort">期限の近い順 ▾</span>
                <Button variant="outlined" size="sm" {...inert}>
                  選んだものをまとめて承認
                </Button>
                <Button variant="outlined" size="sm" {...inert}>
                  決めた履歴
                </Button>
              </div>
            </div>
            <div className="k-ap-scroll">
              <table className="k-ap-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <input type="checkbox" disabled aria-label="まとめて選べるものをすべて選ぶ" />
                    </th>
                    {HEADERS.map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                    <th scope="col" className="k-ap-end">
                      その場で決める
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="k-ap-group">
                    <td colSpan={9}>
                      <span>今週</span>
                      {"　"}
                      <span>{total} 件</span>
                    </td>
                  </tr>
                  {rows.map((r) => (
                    <HandoverRow key={r.id} row={r} />
                  ))}
                  <AiRow />
                </tbody>
              </table>
            </div>
            <p className="k-ap-note">
              — は 1
              件ずつ中身を見て決めるもの（取り消せない操作・あなたが見る項目がある）。押すとチケットの詳細の承認の帯へ
            </p>
          </section>
          <section className="k-hnd-mq" aria-label="承認待ちの一覧（スマホ）">
            <div className="k-hnd-mchips" role="group" aria-label="絞り込み">
              <button type="button" className="k-ap-chip" aria-pressed="true">
                すべて {total}
              </button>
              {FILTERS.map((f) => (
                <button key={f} type="button" className="k-ap-chip" aria-pressed="false" {...inert}>
                  {f}
                </button>
              ))}
            </div>
            <ul className="k-hnd-mcards">
              {rows.map((r) => (
                <QueueCardMobile key={r.id} card={toCard(r)} />
              ))}
              <QueueCardMobile card={AI_CARD} />
            </ul>
          </section>
        </div>
      </section>
    </Frame>
  );
}

/** 表の 1 行と同じ中身をスマホのカードに（番号の札の右に誰から・種類、題名、中身の 1 行、期限、2 つのボタン） */
const toCard = (r: HandoverQueueRow): QueueCardView => ({
  id: r.id,
  number: r.number,
  meta: `渡された ・ ${r.from}さんから`,
  title: r.title,
  sub: r.sub.replace(`${r.from}さんから ・ `, ""),
  // グループに配られた行の期限はチケットの期限（返事の期限ではない）
  ...(r.due ? { note: `${r.acts[1] === "自分が持つ" ? "期限" : "返事の期限"} ${r.due}` } : {}),
  acts: r.acts,
});
const AI_CARD: QueueCardView = {
  id: "ai1",
  number: "EG-128",
  meta: "佐藤のAI が作成 ・ 確認 通過 3",
  title: "セイコー様へ 11月分の請求書を送る",
  sub: "1,716,000 円 ・ 送り先 山田様（CC 鈴木様）",
  acts: ["差し戻す", "承認する"],
};

const PASS_ROW: HandoverQueueRow = {
  id: "h1",
  number: "EG-119",
  title: "問い合わせ（山田様）に一次返信する",
  sub: "高本さんから ・ 子チケット 2 件も一緒に ・ 理由：先方と面識があるので…",
  from: "高本",
  due: "11/23 18:00",
  acts: ["断る", "受ける"],
  highlight: true,
};
const PASS_ROW2: HandoverQueueRow = {
  id: "h2",
  number: "JD-190",
  title: "【親】京蟻 v2.1 リリース",
  sub: "鈴木さんから ・ 子チケット 8 件も一緒に",
  from: "鈴木",
  due: "11/24 18:00",
  acts: ["断る", "受ける"],
};

// ---- メンバー（招く）。キャンバス WsPeople の並び
const SALES: MemberRow[] = [
  {
    id: "p2",
    name: "佐藤 花子",
    email: "sato@engine-base.example",
    role: "マネージャー",
    note: "受託開発も兼ねる",
    state: "分身 動いている",
    stateTone: "ok",
  },
  {
    id: "p1",
    name: "高本 聖斗",
    email: "takamoto@engine-base.example",
    role: "管理者",
    note: "自分",
    state: "分身 動いている",
    stateTone: "ok",
  },
  {
    id: "p3",
    name: "鈴木 一郎",
    email: "suzuki@engine-base.example",
    role: "メンバー",
    state: "分身 動いている",
    stateTone: "ok",
  },
  {
    id: "p4",
    name: "田中 美咲",
    email: "tanaka@engine-base.example",
    role: "メンバー",
    note: "受託開発も兼ねる",
    state: "PC 3 日つながっていない",
    stateTone: "warn",
  },
];
const DEV: MemberRow[] = [
  {
    id: "p5",
    name: "佐藤 花子",
    email: "sato@engine-base.example",
    role: "マネージャー",
    note: "兼ねている",
    state: "分身 動いている",
    stateTone: "ok",
  },
  {
    id: "p7",
    name: "田中 美咲",
    email: "tanaka@engine-base.example",
    role: "メンバー",
    note: "兼ねている",
    state: "PC 3 日つながっていない",
    stateTone: "warn",
  },
  {
    id: "p6",
    name: "山口 健",
    email: "yamaguchi@engine-base.example",
    role: "閲覧のみ",
    state: "分身なし（見るだけ）",
    stateTone: "none",
  },
];
const INVITED: MemberRow = {
  id: "p9",
  name: "",
  email: "kimura@engine-base.example",
  role: "メンバー",
  state: "",
  stateTone: "none",
  invitedLeft: "7 日",
};
const groupsOf = (invited: boolean): MemberGroup[] => [
  { code: "EG", name: "営業", tone: "teal", rows: invited ? [...SALES, INVITED] : SALES },
  { code: "JD", name: "受託開発", tone: "plum", rows: DEV },
];
const INVITE_VALUES = {
  typing: "",
  emails: ["kimura@engine-base.example"],
  group: "営業",
  role: "メンバー",
  message: "営業の問い合わせをいっしょに回してもらいます",
};

// 第 2 ナビの「メンバー N」の N は人の数（2 つのグループに入っている人は 1 人・パネルの行の総数ではない・PM の決め 2026-11-20）。
//   今のモックでは 5（招いた後の inv-sent は 6）
function Members({
  theme,
  invited = false,
  dialog,
  toast,
}: {
  theme: Theme;
  invited?: boolean;
  dialog?: ReactNode;
  toast?: string;
}) {
  const groups = groupsOf(invited);
  return (
    <Frame
      theme={theme}
      viewer="takamoto"
      screen="members"
      crumbs={[{ label: "ワークスペースの管理", disabled: true }, { label: "メンバー" }]}
      approvals={1}
      dialog={
        <>
          {dialog}
          {toast ? <Toast title={toast} /> : null}
        </>
      }
    >
      <WsHead name="株式会社ENGINE BASE" initial="E" />
      <div className="k-me-wrap">
        <WsSub members={new Set(groups.flatMap((g) => g.rows.map((r) => r.email))).size} />
        <MembersBody groups={groups} />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- 状態
const waiting = <AssigneeValue name="高本 聖斗" mode="can" waitingFor="佐藤 花子" />;

export function MockView({ id, theme }: { id: string; theme: Theme }) {
  switch (id) {
    case "f8-detail-owner":
      return <Detail theme={theme} />;
    case "f8-pick":
      return (
        <Detail
          theme={theme}
          dialog={
            <PickDialog
              open
              members={MEMBERS}
              intro="選んだ人に「引き継いでもらう」を頼みます。相手が受けるまで担当者はあなたのままです"
            />
          }
        />
      );
    case "f8-pick-search":
      return (
        <Detail
          theme={theme}
          dialog={
            <PickDialog
              open
              members={MEMBERS}
              query="suzuki"
              intro="選んだ人に「引き継いでもらう」を頼みます。相手が受けるまで担当者はあなたのままです"
            />
          }
        />
      );
    case "f8-pick-none":
      return (
        <Detail
          theme={theme}
          dialog={
            <PickDialog
              open
              members={MEMBERS}
              query="山田"
              intro="選んだ人に「引き継いでもらう」を頼みます。相手が受けるまで担当者はあなたのままです"
            />
          }
        />
      );
    case "f8-pass":
      return <Detail theme={theme} dialog={<HandoverDialog open to="佐藤 花子" values={VALUES} carry={CARRY} />} />;
    case "f8-pass-error":
      return (
        <Detail
          theme={theme}
          dialog={
            <HandoverDialog
              open
              to="田中 美咲"
              values={{ reason: "", ask: "", due: "11/19（木）09:00" }}
              errors={{
                to: "田中さんは今は選べません（止まっています）。別の人を選んでください",
                reason: "理由を書いてください",
                due: "返事の期限は今より後にしてください",
              }}
              carry={CARRY}
            />
          }
        />
      );
    case "f8-pass-refused":
      return (
        <Detail
          theme={theme}
          dialog={
            <HandoverDialog
              open
              to="佐藤 花子"
              values={VALUES}
              carry={CARRY}
              notice="いま鈴木さんの返事を待っています。先にその渡しを取り消してください"
            />
          }
        />
      );
    case "f8-blocked":
      return (
        <Detail
          theme={theme}
          assignee={
            <AssigneeValue name="高本 聖斗" mode="blocked" reason="AI の実行（承認）が終わってから渡してください" />
          }
          dialog={
            <PickDialog
              open
              members={MEMBERS}
              blocked="AI の実行（承認）が終わってから渡してください"
              intro="AI が動いている・承認を待っているあいだは、担当者を変えられません"
            />
          }
        />
      );
    case "f8-waiting-sender":
      return (
        <Detail
          theme={theme}
          assignee={waiting}
          band={<HandoverBand kind="sending" who="佐藤" due="11/23（月）18:00" reason={VALUES.reason} />}
          toast="佐藤さんに渡しました"
        />
      );
    case "f8-reminded":
      return (
        <Detail
          theme={theme}
          assignee={waiting}
          band={<HandoverBand kind="sending" who="佐藤" due="11/23（月）18:00" reason={VALUES.reason} />}
          toast="佐藤さんに催促しました（同じ渡しは 1 日 1 回まで）"
        />
      );
    case "f8-withdraw":
      return (
        <Detail
          theme={theme}
          assignee={waiting}
          band={<HandoverBand kind="sending" who="佐藤" due="11/23（月）18:00" reason={VALUES.reason} />}
          dialog={<WithdrawConfirm open to="佐藤" />}
        />
      );
    case "f8-overdue":
      return (
        <Detail
          theme={theme}
          assignee={waiting}
          band={<HandoverBand kind="overdue" who="佐藤" due="11/19（木）18:00" />}
        />
      );
    case "f8-declined-sender":
      return <Detail theme={theme} band={<HandoverBand kind="declined" who="佐藤" at="11/20 10:12" reason={WHY} />} />;
    case "f8-taken-sender":
      // 見ている人（高本）は配る権限の無い人（getTicket の handover_kinds が offer だけ・まとめの直し 2026-11-20）。
      //   配る権限のある人なら ▾ が出る（D-148.3・K-415）。担当者は佐藤に移ったので、高本の欄は字だけ
      return (
        <Detail
          theme={theme}
          assignee={<AssigneeValue name="佐藤 花子" mode="plain" />}
          band={<HandoverBand kind="taken" who="佐藤" at="11/20 10:12" />}
        />
      );
    case "f8-queue":
      return <Queue theme={theme} rows={[PASS_ROW, PASS_ROW2]} />;
    case "f8-waiting-recipient":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          approvals={3}
          assignee={<AssigneeValue name="高本 聖斗" mode="plain" waitingFor="あなた" />}
          band={
            <HandoverBand
              kind="receiving"
              who="高本"
              due="11/23（月）18:00"
              reason={VALUES.reason}
              ask={VALUES.ask}
              carry="子チケット 2 件も一緒に"
            />
          }
        />
      );
    case "f8-decline":
      return (
        <Queue theme={theme} rows={[PASS_ROW, PASS_ROW2]} dialog={<DeclineDialog open from="高本" value={WHY} />} />
      );
    case "f8-accepted":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          approvals={2}
          assignee={<AssigneeValue name="佐藤 花子" mode="can" />}
          band={
            <HandoverBand
              kind="accepted"
              who="高本"
              at="11/20 10:12"
              carry="子チケット 2 件も一緒に移りました ・ グループは営業のまま"
            />
          }
        />
      );
    case "f8-gone":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          approvals={2}
          assignee={<AssigneeValue name="高本 聖斗" mode="plain" />}
          band={<HandoverBand kind="gone" who="高本" at="11/20 11:40" />}
        />
      );
    case "f8-offer-entry":
      return (
        <Detail
          theme={theme}
          viewer="suzuki"
          assignee={<AssigneeValue name="高本 聖斗" mode="plain" />}
          band={<OfferEntry />}
        />
      );
    case "f8-offer":
      return (
        <Detail
          theme={theme}
          viewer="suzuki"
          assignee={<AssigneeValue name="高本 聖斗" mode="plain" />}
          band={<OfferEntry />}
          dialog={<OfferDialog open assignee="高本" value="手が空いたので、こちらで返します" />}
        />
      );
    case "f8-offer-answer":
      return (
        <Queue
          theme={theme}
          viewer="takamoto"
          rows={[
            {
              ...PASS_ROW,
              sub: "鈴木さんが引き継ぎを申し出ています ・ 理由：手が空いたので、こちらで返します",
              from: "鈴木",
              due: "",
              acts: ["断る", "渡す"],
            },
          ]}
        />
      );
    case "f8-offer-band":
      return (
        <Detail
          theme={theme}
          approvals={2}
          band={<HandoverBand kind="offered" who="鈴木" at="11/20 10:05" reason="手が空いたので、こちらで返します" />}
        />
      );
    case "f8-pick-manager":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          dialog={
            <PickDialog
              open
              members={MEMBERS.map((m) => ({ ...m, self: m.id === "m3" }))}
              groups={[{ id: "g2", code: "JD", name: "受託開発" }]}
              intro="あなたはこのグループのマネージャーなので、選ぶと「配る」になります（相手の合意なしで担当者が替わります）"
            />
          }
        />
      );
    case "f8-distribute":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          dialog={<DistributeDialog open to="鈴木 一郎" reason="来週の展示会の準備を優先してもらうため" />}
        />
      );
    case "f8-distribute-group":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          dialog={<DistributeDialog open toGroup to="受託開発" reason="技術の質問なので受託開発で見てほしい" />}
        />
      );
    case "f8-distributed":
      return (
        <Detail
          theme={theme}
          viewer="suzuki"
          assignee={<AssigneeValue name="鈴木 一郎" mode="can" />}
          band={
            <HandoverBand
              kind="distributed"
              who="佐藤"
              at="11/20 10:12"
              reason="来週の展示会の準備を優先してもらうため"
            />
          }
        />
      );
    case "f8-group-waiting":
      return (
        <Detail
          theme={theme}
          viewer="sato"
          assignee={<AssigneeValue name="佐藤 花子" mode="can" waitingFor="グループ「受託開発」" />}
          band={<HandoverBand kind="group" who="受託開発" at="11/20 10:12" />}
          toast="受託開発に配りました"
        />
      );
    case "f8-group":
      return (
        <Queue
          theme={theme}
          viewer="takamoto"
          rows={[
            {
              id: "g1",
              number: "EG-140",
              title: "展示会の来場者に礼状を送る",
              sub: "グループ「受託開発」に配られました ・ 担当者を決めてください",
              from: "佐藤",
              due: "11/30",
              acts: ["人を決める", "自分が持つ"],
              highlight: true,
            },
          ]}
        />
      );
    case "f8-noperm":
      return (
        <Detail
          theme={theme}
          viewer="yamaguchi"
          approvals={0}
          assignee={<AssigneeValue name="高本 聖斗" mode="plain" />}
        />
      );
    case "f8-failed":
      return <Detail theme={theme} band={<HandoverBand kind="read-failed" who="" />} />;
    case "inv-members":
      return <Members theme={theme} />;
    case "inv-dialog":
      return (
        <Members
          theme={theme}
          dialog={<InviteDialog open values={{ ...INVITE_VALUES, typing: "nakamura@engine-base.example" }} />}
        />
      );
    case "inv-error":
      return (
        <Members
          theme={theme}
          dialog={
            <InviteDialog
              open
              values={{ ...INVITE_VALUES, typing: "kimura@engine-base", emails: ["suzuki@engine-base.example"] }}
              errors={{
                emails:
                  "kimura@engine-base はメールの形ではありません。suzuki@engine-base.example はもうこのワークスペースに入っています",
              }}
            />
          }
        />
      );
    case "inv-link":
      return (
        <Members
          theme={theme}
          dialog={
            <InviteDialog
              open
              more
              values={{ ...INVITE_VALUES, emails: [] }}
              link="https://kaname.example/invite/xxxxxxxx"
            />
          }
        />
      );
    case "inv-stepup":
      return (
        <Members
          theme={theme}
          dialog={<StepUpDialog open reason="管理者として招く前に、本人か確かめます" withCode={false} />}
        />
      );
    case "inv-sent":
      return <Members theme={theme} invited toast="kimura@engine-base.example に招待を送りました" />;
    default:
      return <p>この状態はありません：{id}</p>;
  }
}
