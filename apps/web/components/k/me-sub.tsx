// 自分の設定の第 2 ナビ（K-220・キャンバス MePC の aside.kn-sub）。自分の設定の画面の本文の中に、本文の箱の左に置く。
//   並べ方はキャンバスどおり：アカウント（プロフィール・ログインと安全）／分身（PC と使った量・預けたログイン情報）／ワークスペースごと（知らせ）と、一番下に注
//   作った画面（BUILT_ROUTES に在る道）だけ押せる。ほかは出すが押せない（href なし・aria-disabled・Tab で止まらない・正本の使えない状態の薄さ・D-145.9）。
//   目に見える「準備中」の字は出さない（指を置くと title で読める・D-144.1）。件数は本当の数を返す口が無いので出さない（D-144.3）
//   幅：1024 以上は 232px・768〜1023 は 64px（絵だけ）・767 以下は本文の上の横 1 列（横に送れる）。見た目は me-sub.css
import { Menu as M } from "@base-ui/react/menu";
import { Fragment, type ReactNode } from "react";
import { isBuilt } from "@/lib/built-routes";
import "./me-sub.css";

/** キャンバス MePC の絵の線をそのまま描く */
const ICON: Record<string, ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  pc: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2 20 3M16 7l3 3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
};

export type MeSubKey = "profile" | "login" | "bridge" | "credentials" | "notices";
interface Item {
  key: MeSubKey;
  label: string;
  icon: string;
  /** 行き先（画面がまだ無ければ isBuilt が偽になり、押せない形で出す） */
  href: string;
}
const SECTIONS: { head: string; items: Item[] }[] = [
  {
    head: "アカウント",
    items: [
      { key: "profile", label: "プロフィール", icon: "user", href: "/account" },
      { key: "login", label: "ログインと安全", icon: "lock", href: "/mfa-setup" },
    ],
  },
  {
    head: "分身",
    items: [
      { key: "bridge", label: "PC と使った量", icon: "pc", href: "/setup/bridge" },
      { key: "credentials", label: "預けたログイン情報", icon: "key", href: "/settings/credentials" },
    ],
  },
  {
    head: "ワークスペースごと",
    items: [{ key: "notices", label: "お知らせ", icon: "bell", href: "/notifications" }],
  },
];

function SubItem({ it, current }: { it: Item; current: boolean }) {
  const body = (
    <>
      <span className="k-me-sub-ic">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          {ICON[it.icon]}
        </svg>
      </span>
      <span className="k-me-sub-t">{it.label}</span>
    </>
  );
  if (!current && !isBuilt(it.href))
    return (
      <a className="k-me-sub-i" role="link" aria-disabled="true" tabIndex={-1} title={`${it.label}（準備中）`}>
        {body}
      </a>
    );
  return (
    <a className="k-me-sub-i" href={it.href} title={it.label} aria-current={current ? "page" : undefined}>
      {body}
    </a>
  );
}

/** 767 以下：横に流れる帯の代わりに「自分の設定 › いまの項目 ▾」のボタン 1 つ。押すと項目を全部、縦の一覧で開く（段 4 の下絵・代表の直し 2026-11-18） */
function MobileSub({ current }: { current: MeSubKey }) {
  const now = SECTIONS.flatMap((s) => s.items).find((it) => it.key === current);
  return (
    <div className="k-me-sub-m">
      <M.Root>
        {/* 読み上げと声の操作の名前は、見えている字（自分の設定 › いまの項目）で始める。▾ は飾りなので名前に入れない */}
        <M.Trigger
          className="k-btn"
          data-variant="outlined"
          data-size="md"
          aria-label={`自分の設定 › ${now?.label ?? ""}（自分の設定の中を選ぶ）`}
        >
          自分の設定 › {now?.label ?? ""} ▾
        </M.Trigger>
        <M.Portal>
          <M.Positioner className="k-popup-layer" sideOffset={6} align="start">
            <M.Popup className="k-select-popup k-menu">
              {SECTIONS.map((s) => (
                <Fragment key={s.head}>
                  <div className="k-menu-head">{s.head}</div>
                  {s.items.map((it) =>
                    it.key !== current && !isBuilt(it.href) ? (
                      <M.Item key={it.key} className="k-select-item" disabled title={`${it.label}（準備中）`}>
                        {it.label}
                      </M.Item>
                    ) : (
                      <M.Item
                        key={it.key}
                        className="k-select-item"
                        render={<a href={it.href} aria-current={it.key === current ? "page" : undefined} />}
                      >
                        {it.label}
                      </M.Item>
                    ),
                  )}
                </Fragment>
              ))}
            </M.Popup>
          </M.Positioner>
        </M.Portal>
      </M.Root>
    </div>
  );
}

/** 自分の設定の第 2 ナビ。current は今いる項目 */
export function MeSub({ current }: { current: MeSubKey }) {
  return (
    <aside aria-label="自分の設定の中" className="k-me-sub">
      <MobileSub current={current} />
      {SECTIONS.map((s) => (
        <Fragment key={s.head}>
          <div className="k-me-sub-h">{s.head}</div>
          {s.items.map((it) => (
            <SubItem key={it.key} it={it} current={it.key === current} />
          ))}
        </Fragment>
      ))}
      <div className="k-me-sub-note">アカウントは 1 人 1 つ。預けたログイン情報とお知らせはワークスペースごと</div>
    </aside>
  );
}
