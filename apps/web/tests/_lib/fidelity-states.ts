// キャンバスとの見た目の突き合わせで、画面をその組の状態に整える道具（K-216）。
//   鍵は 04_design/fidelity.json の組の state。値は (page, path) => Promise<void>：path（組の app）を開き、組の状態（人・データ・開いた小窓）にする。
//   最初は空（入れた組が 0）。組を入れる（enrolled: true）画面のチケットが、ここに鍵を足す。
//   enrolled の組の鍵がここに無いと scripts/ci/fidelity_config.py が赤にする（"<鍵>": の字で探す）。
//   キャンバスの書体の差し替え（routeCanvasFonts・K-238）は比べ方の部品に 1 つだけ置き、ここは出し直す（道具 visual_fidelity.mjs と同じ物を使う）。
//   外枠の組（shell-nav・shell-tabs・K-138）：口は網の手前（page.route）で差し替え、本人の Bridge（127.0.0.1:38617）にも届かせない。
//     後から届く口の値（承認待ちの数の印・自分の札・グループ・PC）が描かれるまで待ってから返す（届く前の値で比べない）
import { expect, type Page, type Route } from "@playwright/test";
import { TICKET, executedBand, jst, mockApi, qrow, type Band } from "../features/F5/approve-complete.harness";
import { mockCreate } from "../k/create-mock";

export { routeCanvasFonts } from "../../../../scripts/ci/fidelity_compare.mjs";

const WS = "aaaaaaaa-0000-4000-8000-000000000001";
const ME = "11111111-0000-4000-8000-000000000001";

/** 外枠の口を差し替える：役 owner・名前 高本・会社 ENGINE BASE・承認待ち n・グループ 営業 EG・受託開発 JD・経理 KR・PC live（キャンバス Main と同じ人とデータ） */
interface ShellOpts {
  /** PC の一覧の答え（無ければ live の 1 台・K-230） */
  devices?: unknown[];
  /** この PC の中だけの口（127.0.0.1:38617）の差し替え（無ければ 404＝Bridge は居ない）。本人の Bridge には届かせない（K-230） */
  local?: (route: Route) => Promise<void>;
  /** 一覧の画面の組（K-251）が渡す、一覧の口の答えと、はじめにやることの口の答え。無ければ前のまま（一覧は 501・はじめにやることは 404） */
  tickets?: unknown[];
  setupTasks?: unknown[];
}
async function shellApi(page: Page, approvals: number, o: ShellOpts = {}): Promise<void> {
  await page.addInitScript((t) => window.localStorage.setItem("kaname.token", t), `tok-${WS}`);
  await page.route(/127\.0\.0\.1:38617/, (route) =>
    o.local ? o.local(route) : route.fulfill({ status: 404, body: "" }),
  );
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const ok = (data: unknown, meta: Record<string, unknown> = {}) => ({ status: 200, body: { data, meta } });
    let r: { status: number; body: unknown } = { status: 404, body: { code: "NOT_FOUND" } };
    if (p === "/api/auth/get-session")
      r = {
        status: 200,
        body: {
          session: { id: "s1", userId: ME, token: "t", expiresAt: "2099-01-01T00:00:00Z" },
          user: { id: ME, email: "me@example.com", name: "高本", emailVerified: true },
        },
      };
    else if (p === "/api/auth-ext/me")
      r = ok({
        member_id: ME,
        tenant_id: WS,
        display_name: "高本",
        role_id: "owner",
        scope_id: null,
        workspace_name: "ENGINE BASE",
      });
    else if (p === "/api/v1/scopes")
      r = ok(
        [
          { id: "22222222-0000-4000-8000-000000000001", name: "営業", ticket_prefix: "EG", tenant_id: WS },
          { id: "22222222-0000-4000-8000-000000000002", name: "受託開発", ticket_prefix: "JD", tenant_id: WS },
          { id: "22222222-0000-4000-8000-000000000003", name: "経理", ticket_prefix: "KR", tenant_id: WS },
        ],
        { limit: 200, writable: ["22222222-0000-4000-8000-000000000001"] },
      );
    else if (p === "/api/v1/approvals/queue") r = ok([], { limit: 20, counts: { total: approvals }, cursor: null });
    else if (p === "/api/v1/bridge/devices")
      r = ok(
        o.devices ?? [
          { id: "d0", device_label: "Mac", state: "live", last_seen_at: "2026-11-15T00:00:00Z", version: "1.0.0" },
        ],
      );
    else if (p === "/api/v1/bridge/pairing-codes" && req.method() === "POST")
      // 期限は近い未来（今から 10 分）。遠い未来は画面の待ち（setTimeout）の上限を越えてすぐ取り直しになる
      r = { status: 201, body: { data: { code: "KQ7M2X", expires_at: new Date(Date.now() + 600_000).toISOString() } } };
    else if (p === "/api/v1/ticket_kinds") r = ok([], { limit: 50 });
    else if (p === "/api/v1/members") r = ok([{ id: ME, display_name: "高本", kind_id: "human" }], { limit: 200 });
    else if (p === "/api/v1/tickets" && req.method() === "GET" && o.tickets) r = ok(o.tickets, { next_cursor: null });
    else if (p === "/api/v1/tickets" && req.method() === "GET")
      r = { status: 501, body: { error: "not_implemented", code: "NOT_IMPLEMENTED" } };
    else if (p === "/api/v1/me/setup-tasks" && o.setupTasks) r = ok(o.setupTasks, { dismissed: false });
    else if (p === "/api/v1/me/ticket-drafts") r = ok([]);
    await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
}

/** 一覧の画面の組（K-251）の行：キャンバス Main の自分に関わるものの 6 件（題名・番号・担当・期限は絵の値） */
const LIST_ROWS = [
  ["EG-128", "セイコー様へ 11月分の請求書を送る", "タスク", "awaiting_approval", "承認待ち", true, "2026-11-01", true],
  ["JD-198", "京蟻 管理画面の表示崩れ（Safari）", "課題", "doing", "作業中", false, "2026-10-31", true],
  ["EG-127", "発注ナビ 新着案件に応募文を出す", "タスク", "running", "実行中", true, "2026-11-02", false],
  ["EG-121", "京蟻 見積の金額と単価の根拠を確認する", "QA", "checking", "確認中", true, "2026-11-02", false],
  ["EG-119", "問い合わせ（山田様）に一次返信する", "タスク", "doing", "作業中", false, "2026-11-05", false],
  ["JD-200", "受託開発 定例（議題・議事・決定）", "会議", "todo", "未着手", false, "2026-11-06", false],
] as const;
const listRows = (): unknown[] =>
  LIST_ROWS.map(([number, title, kind, key, stage, ai, due, late], i) => ({
    id: `0193c5a0-0000-7000-8000-00000000f${String(100 + i)}`,
    number,
    title,
    kind: { id: `k-${kind}`, name: kind },
    stage: { id: `s-${key}`, name: stage, key },
    assignee: { id: ME, display_name: "高本" },
    delegated_to_clone: ai,
    due_on: due,
    overdue: late,
    updated_at: "2026-11-02T00:00:00Z",
    parent_ticket_id: null,
    depth: 1,
  }));
/** はじめにやることの口（K-250）の答え：パスキーは使えない・PC と ログイン情報はまだ */
const SETUP_TASKS = [
  {
    key: "passkey",
    label: "パスキーを付ける",
    desc: "まだ付けられません。数には入れていません",
    done: false,
    href: null,
    available: false,
    optional: false,
    skipped: false,
  },
  {
    key: "pc",
    label: "PC をつなぐ",
    desc: "分身はあなたの PC で動く。つなぐまで、分身は話すだけで実行はしない",
    done: false,
    href: "/setup/bridge",
    available: true,
    optional: false,
    skipped: false,
  },
  {
    key: "credentials",
    label: "ログイン情報を預ける",
    desc: "分身に使わせるメール・サービスのログイン。値は誰にも見せない",
    done: false,
    href: "/settings/credentials",
    available: true,
    optional: true,
    skipped: false,
  },
];

/** 入口（登録・待つ）の口を差し替える（K-255）。ログインしていない人・規約の今の版は空・申し込みは pending。
 *  hold の口は答えない（確かめ中・読み込み中の状態を作る） */
const SIGNUP_EMAIL = "takamoto@engine-base.example";
const SIGNUP_TOKEN = "st_fidelity_0123456789abcdefghijklmnopqrstuvwxyz";
async function authApi(page: Page, hold: { me?: boolean; status?: boolean } = {}): Promise<void> {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    let r: { status: number; body: unknown } = {
      status: 401,
      body: { error: "unauthenticated", code: "UNAUTHENTICATED" },
    };
    if (/\/me$/.test(p) && hold.me) return; // 答えない（確かめ中のまま）
    if (p === "/api/v1/auth/sign-up/status") {
      if (hold.status) return; // 答えない（読み込み中のまま）
      r = { status: 200, body: { data: { state: "pending", email: SIGNUP_EMAIL } } };
    } else if (p === "/api/v1/auth/terms/current") r = { status: 200, body: { data: [] } };
    await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
}
/** 待つ画面の申し込みの印をこのタブに置く（登録の答えと同じ形・features/F1/sign-up/store.ts） */
async function putTicket(page: Page): Promise<void> {
  await page.addInitScript(
    ([t, e]) =>
      window.sessionStorage.setItem(
        "kaname.signup",
        JSON.stringify({ token: t, email: e, sent: true, mailError: null }),
      ),
    [SIGNUP_TOKEN, SIGNUP_EMAIL] as const,
  );
}
/** 確認のリンクと同意し直しの口を差し替える（K-256）。verify：hold＝確定の口が答えない（確定中のまま）・expired＝410・used＝409。
 *  同意し直しは本人（/me）と今の版（利用規約・プライバシーポリシーの 2 つ）を返す */
const VERIFY_TOKEN = "vt_fidelity_0123456789abcdefghijklmnopqrstuvwxyz";
const TERMS_AT = "2026-11-01T00:00:00.000Z";
async function verifyApi(page: Page, verify: "hold" | "expired" | "used" | "none"): Promise<void> {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    let r: { status: number; body: unknown } = {
      status: 401,
      body: { error: "unauthenticated", code: "UNAUTHENTICATED" },
    };
    if (req.method() === "POST" && p === "/api/v1/auth/sign-up/verify") {
      if (verify === "hold") return; // 答えない（確定中のまま）
      if (verify === "expired")
        r = {
          status: 410,
          body: { code: "E-AUTH-003", message: "リンクの期限が切れました。もう一度登録してください" },
        };
      else if (verify === "used")
        r = {
          status: 409,
          body: {
            code: "E-CONF-011",
            message: "このメールアドレスの登録は確認まで終わっています。ログインしてください",
          },
        };
    } else if (p === "/api/v1/auth/terms/current")
      r = {
        status: 200,
        body: {
          data: [
            {
              id: "00000000-0000-4000-8000-000000000301",
              kind: "terms",
              version: "第2版",
              url: "/legal/terms?v=2",
              published_at: TERMS_AT,
            },
            {
              id: "00000000-0000-4000-8000-000000000302",
              kind: "privacy",
              version: "第2版",
              url: "/legal/privacy?v=2",
              published_at: TERMS_AT,
            },
          ],
        },
      };
    else if (/\/me$/.test(p) && verify === "none")
      r = { status: 200, body: { data: { id: ME, email: SIGNUP_EMAIL, name: "高本" } } };
    await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
}
const withToken = (path: string) => `${path}${path.includes("?") ? "&" : "?"}token=${VERIFY_TOKEN}`;

/** ログインの口を差し替える（K-221）。ログインしていない人・メールとパスワードの口は 2 段階の確かめを求める */
async function loginApi(page: Page): Promise<void> {
  await page.route(/127\.0\.0\.1:38617/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/(v1|auth-ext|auth)\//, async (route: Route) => {
    const p = new URL(route.request().url()).pathname;
    let r: { status: number; body: unknown } = {
      status: 401,
      body: { error: "unauthenticated", code: "UNAUTHENTICATED" },
    };
    if (p === "/api/v1/auth/sign-in")
      r = { status: 200, body: { data: { token: null, two_factor: true, pending: "tf-fidelity" } } };
    else if (p === "/api/auth/get-session") r = { status: 200, body: { session: null, user: null } };
    await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
}

/** チケットの詳細の小窓（K-229・キャンバス StApproveModal・StCompleteModal・StReturnModal）：口を差し替えてチケットを開き、
 *  帯（region「承認と実行」）のボタンで小窓を開き、題が出るまで待つ */
/** 完了の小窓の実施事項：キャンバス StCompleteModal と同じ 5 つ（済み 4・残り 1） */
const CANVAS_TODO = [
  "- [x] 新着から条件に合う案件を選ぶ（3 件 → 1 件）",
  "- [x] 案件の要件と予算を読む",
  "- [x] 応募文を作る（過去の採用文 3 件を参考）",
  "- [x] 確認を通す",
  "- 発注ナビの画面から応募する（承認のあと）",
].join("\n");
async function openBandModal(page: Page, path: string, button: string, title: string, done = false): Promise<void> {
  await (done ? mockApi(page, { ...executedBand, todo: CANVAS_TODO }) : mockApi(page));
  await page.goto(path.replace("{ticket}", TICKET));
  await page.getByRole("region", { name: "承認と実行" }).getByRole("button", { name: button, exact: true }).click();
  await expect(page.locator(".k-dialog .k-dialog-title")).toHaveText(title);
}

/** 詳細の帯（2）の組（K-228）：その状態の答えで開き、帯の箱（region の中の status か alert の .k-band）の題が描かれるまで待つ */
async function openStateBand(
  page: Page,
  path: string,
  band: Band,
  region: string,
  title: string,
  alert = false,
): Promise<void> {
  await mockApi(page, band);
  await page.goto(path.replace("{ticket}", TICKET));
  const box = page.getByRole("region", { name: region }).locator(`[role="${alert ? "alert" : "status"}"].k-band`);
  await expect(box.locator("h3")).toHaveText(title);
}
const makeRun = (status: string, o: Record<string, unknown> = {}) => ({
  phase: "make",
  status,
  pc: "live",
  stopped_reason: null,
  ...o,
});

/** 3 秒たっても終わらないときに出る文（D-144.8）が出るまで待つ（決めた秒数では待たない） */
async function untilStatusText(page: Page, text: string): Promise<void> {
  await expect(page.locator('[data-part="auth-box"]').getByRole("status")).toContainText(text, { timeout: 15_000 });
}

/** 承認待ち（K-231・キャンバス Approvals）：K-257 が描き直した絵と同じ 9 件（期限切れ 1・今日 2・7 日以内 4・それより後 1・期限なし 1） */
const CANVAS_QUEUE = () =>
  (
    [
      ["セイコー様へ 11月分の請求書を送る", -1, false, "承認するとメールを送る（取り消せない）"],
      [
        "京蟻 追加開発の見積を出す（1,826,000 円）",
        0,
        false,
        "見積が 100 万円を超えたため上位へ（ワークスペースの決まり）",
      ],
      ["入金の照合（10月分）を記録する", 0, true, "承認すると会計に記録する（戻せる）"],
      ["問い合わせ（山田様）に一次返信する", 1, false, "理由：先方と面識がある ・ 返事の期限 11/03"],
      ["発注ナビ 応募文を出す", 2, false, "承認すると 3 社に応募する（外に出る）"],
      ["ミナト様だけ月末締めにしたい", 3, false, "ワークスペースの決まり「請求は 25 日締め」と反対"],
      ["保守の範囲にログの保管は入るか", 4, false, null],
      ["【親】京蟻 v2.1 リリース", 12, false, null],
      ["やり方「問い合わせに返す」を営業の全員に", null, false, null],
    ] as const
  ).map(([title, due, inline, note], i) =>
    qrow(`0193c5a0-0000-7000-8000-0000000f00${String(i).padStart(2, "0")}`, {
      title,
      due_on: due === null ? null : jst(due),
      decide_inline: inline,
      irreversible: !inline,
      primary_action: inline ? "approve" : "open",
      note,
      ticket_number: `EG-${120 + i}`,
      from_name: "高本",
    }),
  );
async function openApprovals(page: Page, path: string, rows: ReturnType<typeof CANVAS_QUEUE>): Promise<void> {
  await shellApi(page, rows.length);
  await page.route(/\/api\/v1\/approvals\/queue/, (route) =>
    route.fulfill({
      status: 200,
      json: { data: rows, meta: { limit: 20, counts: { total: rows.length }, cursor: null } },
    }),
  );
  await page.goto(path);
  await expect(page.locator("header.k-page-head .k-page-sub")).toHaveText(`あなたが決めるもの ${rows.length} 件`);
}

/** キャンバス MePC の 2 台（最後に見えたは日本時間で 10/30 18:40） */
const BRIDGE_TWO = [
  {
    id: "d0",
    device_label: "高本の MacBook Pro",
    state: "live",
    last_seen_at: "2026-11-15T00:00:00Z",
    connected_at: "2026-09-12T00:00:00Z",
    version: "1.4",
  },
  { id: "d1", device_label: "事務所の Windows", state: "asleep", last_seen_at: "2026-10-30T09:40:00Z", version: "1.4" },
];
/** この PC の中だけの口：ping は版を返し、つなぐ（pair）は別のアカウントでつながっている（409） */
async function localBridgeOtherAccount(route: Route): Promise<void> {
  const req = route.request();
  const cors = {
    "access-control-allow-origin": req.headers()["origin"] ?? "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" });
  const path = new URL(req.url()).pathname;
  if (path === "/ping")
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ app: "kaname-bridge", version: "1.4", device_label: "この PC", connected: false }),
    });
  if (path === "/pair")
    return route.fulfill({
      status: 409,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({
        reason: "other_account",
        message: "この PC の Bridge は別のアカウントでつながっています",
      }),
    });
  return route.fulfill({ status: 404, headers: cors, body: "" });
}

/** チケットの詳細（K-226・キャンバス TicketDetail）：外枠の口に、承認待ちのチケット 1 件と実行 1 件・承認の中身を足す（キャンバスと同じ人とデータ） */
const DETAIL_ID = "0193c5a0-0000-7000-8000-00000000d226";
const DETAIL_APPROVAL = "0193c5a0-0000-7000-8000-0000000ad226";
async function detailApi(page: Page): Promise<string> {
  await shellApi(page, 2);
  const json = (route: Route, data: unknown, meta: Record<string, unknown> = {}) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data, meta }) });
  await page.route(`**/api/v1/tickets/${DETAIL_ID}`, (route) =>
    json(route, {
      ticket: {
        id: DETAIL_ID,
        number: "EG-128",
        title: "セイコー様へ 11月分の請求書を送る",
        scope_id: "22222222-0000-4000-8000-000000000001",
        created_at: "2026-10-30T08:44:00Z",
        start_on: "2026-10-30",
        due_on: "2026-11-01",
        priority: "mid",
      },
      sections: [
        {
          key: "purpose",
          label: "目的",
          body: { text: "セイコー様に 11 月分の保守費を請求し、11/30 までに入金してもらう。" },
          version: 3,
        },
        { key: "done", label: "完了の条件", body: { text: "金額が見積の月額と一致している" }, version: 3 },
        {
          key: "todo",
          label: "実施事項",
          body: { text: "見積 EG-097 の月額を確かめる\n請求書 PDF を作る" },
          version: 3,
        },
      ],
      kind: { id: "k1", name: "タスク", color: "#186F69" },
      stage: { id: "s1", key: "awaiting_approval", name: "承認待ち" },
      assignee: { id: ME, display_name: "高本" },
      approval: { id: DETAIL_APPROVAL, can_decide: true, irreversible: true, note: null, approver_name: "高本" },
      can: { complete: false, delegate: false },
      completed: null,
    }),
  );
  await page.route(`**/api/v1/tickets/${DETAIL_ID}/runs`, (route) =>
    json(
      route,
      [
        {
          id: "0193c5a0-0000-7000-8000-0000000ed226",
          ticket_id: DETAIL_ID,
          phase: "make",
          status: "done",
          by: { member_id: ME, display_name: "高本" },
          pc: "live",
          silent: false,
          progress: null,
          stopped_reason: null,
          started_at: "2026-11-01T00:00:00Z",
          finished_at: "2026-11-01T00:12:00Z",
          checks: { state: "none" },
        },
      ],
      { limit: 50 },
    ),
  );
  return DETAIL_ID;
}

export const FIDELITY_STATES: Record<string, (page: Page, path: string) => Promise<void>> = {
  // 鍵は "<鍵>": の字で探される（scripts/ci/fidelity_config.py）。整形が引用符を外さないようにする
  // prettier-ignore
  "signup": async (page, path) => {
    await authApi(page);
    await page.goto(path);
    await expect(page.getByLabel("名前", { exact: true })).toBeVisible();
  },
  "signup-waiting": async (page, path) => {
    await authApi(page);
    await putTicket(page);
    await page.goto(path);
    await expect(page.getByRole("button", { name: "送り直す" })).toBeVisible();
  },
  "signup-checking": async (page, path) => {
    await authApi(page, { me: true });
    await page.addInitScript(() => window.localStorage.setItem("kaname.token", "tok-fidelity"));
    await page.goto(path);
    await untilStatusText(page, "確かめています…");
  },
  "signup-waiting-loading": async (page, path) => {
    await authApi(page, { status: true });
    await putTicket(page);
    await page.goto(path);
    await untilStatusText(page, "読み込んでいます…");
  },
  // 確認のリンクを開いた後（K-256・キャンバス AuthVerifying・AuthVerifyExpired・AuthVerifyUsed）：手がかりつきで開き、状態の見出しか文が出るまで待つ
  "verify-confirming": async (page, path) => {
    await verifyApi(page, "hold");
    await page.goto(withToken(path));
    await untilStatusText(page, "登録を確定しています…");
  },
  "verify-expired": async (page, path) => {
    await verifyApi(page, "expired");
    await page.goto(withToken(path));
    await expect(page.locator('[data-part="auth-box"] h1')).toHaveText("リンクの期限が切れました");
  },
  "verify-used": async (page, path) => {
    await verifyApi(page, "used");
    await page.goto(withToken(path));
    await expect(page.locator('[data-part="auth-box"] h1')).toHaveText("登録は終わっています");
  },
  // 規約の同意し直し（K-256・キャンバス AuthConsent）：ログインの印を置き、本人と今の版を返して開き、チェックが出るまで待つ
  "consent-terms": async (page, path) => {
    await verifyApi(page, "none");
    await page.addInitScript(() => window.localStorage.setItem("kaname.token", "tok-fidelity"));
    await page.goto(path);
    await expect(page.getByRole("checkbox", { name: "利用規約とプライバシーポリシーに同意します" })).toBeVisible();
  },
  // ログイン（K-221・キャンバス AuthLogin）：ログインしていない人が開くだけ
  // prettier-ignore
  "login": async (page, path) => {
    await loginApi(page);
    await page.goto(path);
    await expect(page.locator('[data-part="auth-box"] [data-act="passkey"]')).toBeVisible();
  },
  // 確認のコード（K-221・キャンバス Auth2FA）：ログインの口を two_factor: true にし、メールとパスワードを入れて「次へ」まで進める
  "login-2fa": async (page, path) => {
    await loginApi(page);
    await page.goto(path);
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(SIGNUP_EMAIL);
    await page.getByLabel("パスワード", { exact: true }).fill("fidelity-password-000");
    await page.locator('[data-part="auth-box"]').getByRole("button", { name: "次へ", exact: true }).click();
    await expect(page.locator('[data-part="auth-box"] h1')).toHaveText("確認のコード");
  },
  // 再設定（K-638・キャンバス AuthReset）：メールを入れて「再設定メールを送る」を押し、送りました（作り直しのリンクを送った）まで進める
  // prettier-ignore
  "password-reset": async (page, path) => {
    await loginApi(page);
    await page.route(/\/api\/v1\/auth\/password\/forgot/, (route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { sent: true } }) }),
    );
    await page.goto(path);
    await page.getByRole("textbox", { name: "メールアドレス" }).fill(SIGNUP_EMAIL);
    await page.locator('[data-part="auth-box"]').getByRole("button", { name: "再設定メールを送る", exact: true }).click();
    await expect(page.locator('[data-auth="reset"]')).toContainText("作り直しのリンクを送りました");
  },
  // 規約の文面（K-232・キャンバス LegalPage）：口を読まない画面なので開くだけ。箱の題が出るまで待つ（鍵は "<鍵>": の字で探されるので引用符を残す）
  // prettier-ignore
  "legal": async (page, path) => {
    await page.goto(path);
    await expect(page.locator('[data-part="auth-box"] h1')).toBeVisible();
  },
  "shell-nav": async (page, path) => {
    await shellApi(page, 2);
    await page.goto(path);
    const nav = page.locator(".k-nav");
    await expect(nav.locator(".k-nav-badge")).toHaveText("2");
    await expect(nav.locator(".k-group-mark")).toHaveCount(3);
    await expect(nav.locator(".k-pc")).toHaveText("PC つながっている");
    await expect(page.locator(".k-bar .k-me .k-avatar")).toHaveText("高");
  },
  // 自分の設定の外枠（K-220・キャンバス MePC）：外枠の口と PC の一覧（つながっている 1 台）を返して /setup/bridge を開き、
  //   第 2 ナビと本文の見出し・左のメニューの PC の状態が描かれるまで待つ
  "bridge-shell": async (page, path) => {
    await shellApi(page, 2);
    await page.goto(path);
    await expect(page.locator('[aria-label="自分の設定の中"] .k-me-sub-t')).toHaveCount(5);
    await expect(page.locator(".k-nav .k-pc")).toHaveText("PC つながっている");
    await expect(page.locator("#connect-pc-title")).toHaveText("PC と使った量");
  },
  // PC をつなぐの中身（K-230・キャンバス EdPC・MePC・MePCInstalled）。口とこの PC の中だけの口は網の手前で差し替える（本人の Bridge に届かせない）
  //   bridge-code：PC 無し・Bridge 無し → つなぐ小窓が開き、コード（キャンバスと同じ KQ7M2X）が出るまで待つ
  "bridge-code": async (page, path) => {
    await shellApi(page, 2, { devices: [] });
    await page.goto(path);
    await expect(page.getByRole("dialog", { name: "PC をつなぐ" }).getByTestId("pairing-code")).toHaveText("KQ7M2X");
  },
  //   bridge-connected：キャンバス MePC の 2 行（つながっている 1 台と切れている 1 台）
  "bridge-connected": async (page, path) => {
    await shellApi(page, 2, { devices: BRIDGE_TWO });
    await page.goto(path);
    await expect(page.locator(".k-pc-card .k-pc-row")).toHaveCount(2);
    await expect(page.locator('[data-act="wake"]')).toBeVisible();
  },
  //   bridge-installed：この PC の口が答え（版 1.4）、つなぐと「別のアカウントでつながっている」（409）。押して「切り替える」が出るまで待つ
  "bridge-installed": async (page, path) => {
    await shellApi(page, 2, { devices: [], local: localBridgeOtherAccount });
    await page.goto(path);
    await page.getByRole("button", { name: "この PC の Bridge につなぐ" }).click();
    await expect(page.locator('button[data-act="switch-account"]')).toBeVisible();
  },
  // チケットの詳細（K-226・キャンバス TicketDetail）：承認待ちのチケットを開き、題名と右のパネルが描かれるまで待つ
  "ticket-detail": async (page, path) => {
    const id = await detailApi(page);
    await page.goto(path.replace("{ticket}", id));
    await expect(page.locator("header.k-page-head h1")).toHaveText("セイコー様へ 11月分の請求書を送る");
    await expect(page.locator('.k-detail-meta [data-part="stage"]')).toHaveText("承認待ち");
  },
  // 承認待ちの帯（K-227・キャンバス TicketDetail の main article [role="status"]）：承認待ち・決められる人・取り消せない承認を開き、
  //   帯の箱の題と要約（承認の 1 件の答えの後に出る）と成果物のカードが描かれるまで待つ
  "band-approval": async (page, path) => {
    await mockApi(page);
    await page.goto(path.replace("{ticket}", TICKET));
    const band = page.getByRole("region", { name: "承認と実行" });
    await expect(band.locator('[role="status"].k-band h3')).toHaveText("あなたの承認を待っています");
    await expect(band.locator('[role="status"].k-band .k-band-sub')).toBeVisible();
    await expect(band.getByRole("region", { name: "成果物" })).toBeVisible();
  },
  // 詳細の帯（2）（K-228・キャンバス StRunning・StFailed・StBefore・StConfirmDone・StDone・StDelegated の main article の帯）
  "band-running": async (page, path) => {
    await openStateBand(
      page,
      path,
      { stage: "running", run: makeRun("running") },
      "AI に任せる",
      "山田のAI が作っています",
    );
  },
  "band-failed": async (page, path) => {
    const band: Band = {
      stage: "doing",
      run: makeRun("stopped", { stopped_reason: "金額が見積の月額と合いませんでした" }),
      can_delegate: true,
    };
    await openStateBand(page, path, band, "AI に任せる", "山田のAI が止まりました", true);
    await expect(page.getByRole("table", { name: "確認の結果" })).toBeVisible();
  },
  "band-before": async (page, path) => {
    await openStateBand(page, path, { stage: "doing", can_delegate: true }, "AI に任せる", "AI に任せる");
    await expect(page.getByRole("region", { name: "AI に任せる" }).locator(".k-band-sub")).toBeVisible();
  },
  "band-confirm-done": async (page, path) => {
    const band: Band = { stage: "doing", can_complete: true, todo: "- [x] 請求書を作る\n- [x] 先方に送る" };
    await openStateBand(page, path, band, "承認と実行", "完了の条件を確かめて完了にしてください");
  },
  "band-done": async (page, path) => {
    const band: Band = { stage: "done", completed: { at: "2026-11-02T01:48:00Z", by: "高本" } };
    await openStateBand(page, path, band, "承認と実行", "完了しました（高本・11/02 10:48）");
  },
  "band-delegated": async (page, path) => {
    await openStateBand(
      page,
      path,
      { stage: "running", run: makeRun("queued") },
      "AI に任せる",
      "山田のAI に任せました。",
    );
  },
  // 承認と完了の小窓（K-229）：承認待ち・帯の「承認して送る」／実行が終わった作業中・「完了にする」／承認待ち・帯の「差し戻す」
  "approve-modal": async (page, path) => {
    await openBandModal(page, path, "承認して送る", "承認して送ります");
  },
  "complete-modal": async (page, path) => {
    await openBandModal(page, path, "完了にする", "完了にする", true);
  },
  "return-modal": async (page, path) => {
    await openBandModal(page, path, "差し戻す", "差し戻す");
  },
  "shell-tabs": async (page, path) => {
    await shellApi(page, 9);
    await page.goto(path);
    const tabs = page.locator(".k-tabs");
    await expect(tabs.locator(".k-nav-badge")).toHaveText("9");
    await expect(tabs.locator(".k-tab-create")).toBeVisible();
  },
  // prettier-ignore
  "approvals": async (page, path) => {
    await openApprovals(page, path, CANVAS_QUEUE());
    await expect(page.locator(".k-ap-card table")).toBeVisible();
  },
  "approvals-empty": async (page, path) => {
    await openApprovals(page, path, []);
    await expect(page.locator('.k-ap-body [data-state="empty"]')).toBeVisible();
  },
  // 一覧の画面のはじめて（K-251・キャンバス OnHome）：0 件・書ける人・はじめにやることが残っている。空の箱と はじめにやること が出るまで待つ
  "tickets-first": async (page, path) => {
    await shellApi(page, 3, { tickets: [], setupTasks: SETUP_TASKS });
    await page.goto(path);
    await expect(page.locator('[data-state="empty"]')).toBeVisible();
    await expect(page.getByRole("region", { name: "はじめにやること" })).toBeVisible();
  },
  // 一覧の画面の自分に関わるもの（K-251・キャンバス Main）：6 件。表の行が出るまで待つ
  "tickets-main": async (page, path) => {
    await shellApi(page, 3, { tickets: listRows() });
    await page.goto(path);
    await expect(page.locator("tbody tr[data-ticket]")).toHaveCount(6);
  },
  // グループの一覧（K-252・キャンバス List）：営業で絞った 6 件。表の行が出るまで待つ
  "tickets-list": async (page, path) => {
    await shellApi(page, 3, { tickets: listRows() });
    await page.goto(path);
    await expect(page.locator("tbody tr[data-ticket]")).toHaveCount(6);
  },
  // 作る面（K-224・キャンバス Create）：書けるグループのある人が開いた・下書きなし。続きの下書きを読み終えて題名の欄が出るまで待つ
  "tickets-new": async (page, path) => {
    await shellApi(page, 3);
    await page.goto(path);
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await expect(page.locator('.k-create-foot button[type="submit"]')).toBeEnabled();
  },
  // 作る面の本文の箱の区画（K-225・キャンバス Create の本文の箱）：種別はタスク（区画 4 つ）・下書きなし。区画の見出しが出るまで待つ。
  //   種別の区画は作る画面の試験の差し替え（tests/k/create-mock.ts）の口で出す（外枠の差し替えの種別は空）
  "tickets-new-sections": async (page, path) => {
    await mockCreate(page);
    await page.goto(path);
    await expect(page.locator('section[aria-label="本文"] .k-create-doc h2').first()).toBeVisible();
    await expect(page.locator('.k-create-foot button[type="submit"]')).toBeEnabled();
  },
};
