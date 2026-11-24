# 見本の画面（/dev/k/showcase）の操作 テスト仕様（L1・K-36）

> 操作要素 1 つ＝1 行（D-128.113・G28）。ID を名前に持つ Playwright（apps/web/tests/k/showcase.spec.ts）が CI（G48）で通れば PASS。
> テスト項目の「（役割）「名前」」は、画面の操作要素と突き合わせる鍵（名前は読み上げの名前そのもの。数を持つリンクは数まで入る）（KSC-00-001 が、行の無い要素を赤にする）。新しい画面の仕様もこの形で書く。

| ID | 画面 | テスト観点 | テスト項目 | 前提条件 | 操作手順 | 期待結果 | 結果 | 備考 | タスク | 実行条件 |
|---|---|---|---|---|---|---|---|---|---|---|
| KSC-00-001 | k-showcase | 操作 | 操作要素の漏れ | 1440 で開く・2 つのタブ | 画面の操作要素を全部集める | どの操作要素も、この表に 1 行ある（行の無い要素は赤） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-001 | k-showcase | 操作 | （link）「本文へ」 | 1440 で開く | 最初に Tab を押し、Enter | 「本文へ」に動き、押すと本文に移る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-002 | k-showcase | 操作 | （button）「メニューを畳む」 | 1440 で開く | 押す | 左のバーが 56 のレールになり、開き直しても畳んだまま。もう一度押すと 216 に戻る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-003 | k-showcase | 操作 | （button）「チケットを作る」 | 1440 で開く | 左のバーの「チケットを作る」を押す | 知らせ「チケットを作る（見本）」が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-004 | k-showcase | 操作 | （link）「チケット」 | 1440 で開く | 左のバーを見る | いまの場所（aria-current）で、行き先は /tickets | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-005 | k-showcase | 操作 | （link）「承認待ち 2 件」 | 1440 で開く | 左のバーを見る | 数 2 が出て、行き先は /approvals | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-006 | k-showcase | 操作 | （link）「高本のAI」 | 1440 で開く | 左のバーを見る | 名前の入った AI のまとまりで、行き先は /ai/chat | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-007 | k-showcase | 操作 | （link）「ナレッジ」 | 1440 で開く | 左のバーを見る | 行き先は /knowledge | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-009 | k-showcase | 操作 | （link）「営業 18」 | 1440 で開く | 左のバーのグループを見る | グループの札と数 18 が出て、行き先がある | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-010 | k-showcase | 操作 | （link）「受託開発 42」 | 1440 で開く | 左のバーのグループを見る | グループの札と数 42 が出て、行き先がある | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-011 | k-showcase | 操作 | （link）「経理 9」 | 1440 で開く | 左のバーのグループを見る | グループの札と数 9 が出て、行き先がある | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-012 | k-showcase | 操作 | （link）「ワークスペースの管理」 | 1440 で開く | 左のバーの下を見る | 役割 R1 が入れる画面へ行く | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-01-013 | k-showcase | 操作 | （button）「会社を切り替える（準備中）」 | 1440 で開く | 左のバーの会社名の後ろの ▾ を押す・Enter を押す | 使えないボタン（aria-disabled）で薄さ 0.55。押しても何も開かず URL も変わらない（D-145.9・K-138） |  |  | K-138 | L1 |
| KSC-01-014 | k-showcase | 操作 | （button）「グループの★（準備中）」 | 1440 で開く | 「グループ」の見出しの ★ を押す・Enter を押す | 使えないボタン（aria-disabled）で薄さ 0.55。押しても何も開かず URL も変わらない（D-145.9・K-138） |  |  | K-138 | L1 |
| KSC-02-001 | k-showcase | 操作 | （link）「チケット」 | 1440 で開く | 上の帯のいまの場所を見る | いまの場所の 1 つ上（/tickets）へ行ける。最後の「見本」は aria-current | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-02-002 | k-showcase | 操作 | （searchbox）「探す」 | 1440 で開く | 「請求」と入れて Enter | 「「請求」を探す」が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-02-003 | k-showcase | 操作 | （button）「お知らせ（3 件）」 | 1440 で開く | 押す | 知らせ「知らせを開く（見本）」が出る |  | K-1113 で字を変えた（お知らせ） | K-36 | L1 |
| KSC-02-004 | k-showcase | 操作 | （button）「自分のメニュー」 | 1440 で開く | 押して、Esc | 自分の設定・見た目・ログアウトが出て、Esc で閉じる | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-02-005 | k-showcase | 操作 | （button）「自分の AI のパネルを閉じる」 | 1440 で開く | 押す | 右のパネルが閉じて本文が広がり、「自分の AI のパネルを開く」に替わる | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-02-006 | k-showcase | 操作 | （tab）「部品」 | 1440 で開く | 押す | 部品の見本が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-02-007 | k-showcase | 操作 | （tab）「4 つの状態とエラー」 | 1440 で開く | 押す | 4 つの状態の見本が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-001 | k-showcase | 操作 | （radio）「システム」 | 部品のタブ | 押す | data-theme が外れ、システムの見た目に合う | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-002 | k-showcase | 操作 | （radio）「明るい」 | 部品のタブ | 押す | data-theme=light になる | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-003 | k-showcase | 操作 | （radio）「暗い」 | 部品のタブ | 押す | data-theme=dark になり、地の色が替わる | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-004 | k-showcase | 操作 | （button）「保存する」 | 部品のタブ | 押す | 処理中（aria-busy）で押し直せず、終わると戻る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-005 | k-showcase | 操作 | （button）「下書き」 | 部品のタブ | 押す | 押せる（見本なので何も起きない） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-006 | k-showcase | 操作 | （button）「共有する」 | 部品のタブ | 押す | 押せる（見本なので何も起きない） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-007 | k-showcase | 操作 | （button）「あとで」 | 部品のタブ | 押す | 押せる（見本なので何も起きない） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-008 | k-showcase | 操作 | （button）「消す」 | 部品のタブ | 押して「やめる」、もう一度押して「消す」 | 確かめのダイアログが出て、やめると何もせず、消すと「消しました」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-009 | k-showcase | 操作 | （button）「小さい」 | 部品のタブ | 押す | 押せる（小さいボタン・28px 以上） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-010 | k-showcase | 操作 | （button）「押せない」 | 部品のタブ | 見る | disabled | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-011 | k-showcase | 操作 | （textbox）「件名」 | 部品のタブ | 空のまま「確かめる」 | 理由「件名を入れてください」が出て読み上げにつながる | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-012 | k-showcase | 操作 | （textbox）「中身」 | 部品のタブ | 文字を入れる | 入る（複数行） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-013 | k-showcase | 操作 | （combobox）「種類」 | 部品のタブ | キーボードで開いて「課題」を選ぶ | 選んだものが出る。使えない「会議」は選べない | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-014 | k-showcase | 操作 | （button）「確かめる」 | 部品のタブ | 件名を入れて押す | 理由が消える | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-015 | k-showcase | 操作 | （tab）「中身」 | 部品のタブ | 押す | 中身のタブ | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-016 | k-showcase | 操作 | （tab）「記録」 | 部品のタブ | 押す | 記録のタブ | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-017 | k-showcase | 操作 | （tab）「ファイル」 | 部品のタブ | 押す | ファイルのタブ | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-018 | k-showcase | 操作 | （tab）「まだ」 | 部品のタブ | 見る | 使えない（aria-disabled） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-019 | k-showcase | 操作 | （button）「知らせを出す」 | 部品のタブ | 押す | 知らせ「コピーしました」が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-020 | k-showcase | 操作 | （button）「失敗の知らせ」 | 部品のタブ | 押して、閉じる | 失敗の知らせが残り、「閉じる」で消える | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-03-021 | k-showcase | 操作 | （button）「ダイアログを開く」 | 部品のタブ | 押して Esc | ダイアログが開き、Esc で閉じて開いたボタンに戻る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-001 | k-showcase | 操作 | （button）「チケットを作る」 | 4 つの状態のタブ | 空の見本のボタンを押す | 「作る（見本 1）」が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-002 | k-showcase | 操作 | （button）「もう一度」 | 4 つの状態のタブ | 失敗の見本のボタンを押す | 押せる（数が増える） | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-003 | k-showcase | 操作 | （button）「マネージャーに頼む」 | 4 つの状態のタブ | 権限が無いの見本のボタンを押す | 「頼みました（見本）」が出る | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-004 | k-showcase | 操作 | （link）「戻る」 | 4 つの状態のタブ | 権限が無いの見本を見る | 行き先は /dev/k | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-005 | k-showcase | 操作 | （link）「notFound」 | 4 つの状態のタブ | 押す | 画面いっぱいの「見つかりませんでした。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-006 | k-showcase | 操作 | （link）「forbidden」 | 4 つの状態のタブ | 押す | 画面いっぱいの「この画面を見る権限がありません。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-007 | k-showcase | 操作 | （link）「down」 | 4 つの状態のタブ | 押す | 画面いっぱいの「Kaname の調子が悪くなっています。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-008 | k-showcase | 操作 | （link）「maintenance」 | 4 つの状態のタブ | 押す | 画面いっぱいの「いまメンテナンス中です。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-009 | k-showcase | 操作 | （link）「sessionExpired」 | 4 つの状態のタブ | 押す | 画面いっぱいの「ログインが切れました。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-010 | k-showcase | 操作 | （link）「linkExpired」 | 4 つの状態のタブ | 押す | 画面いっぱいの「このリンクは使えなくなりました。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-011 | k-showcase | 操作 | （link）「loadFailed」 | 4 つの状態のタブ | 押す | 画面いっぱいの「読み込めませんでした。」 | PASS（CI 305e80b） |  | K-36 | L1 |
| KSC-04-012 | k-showcase | 操作 | （link）「offline」 | 4 つの状態のタブ | 押す | 画面いっぱいの「オフラインです。」 | PASS（CI 305e80b） |  | K-36 | L1 |
