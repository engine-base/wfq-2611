"""押しても何も起きないところ（href="#"）と、行き先のあるボタンを直す。
- 行き先がある → その画面へつなぐ
- その場で効く操作 → role="button" と data-act を付ける（行き先は持たない）
- 行き先が画面の外（利用規約など） → 外のページ
shellfix → edwire のあとに走る。"""
import re, glob, os
P = os.environ.get("KANAME_CANVAS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "canvas") + "/"
EXT = {"利用規約": "https://kaname.example/terms", "プライバシー": "https://kaname.example/privacy", "困ったとき": "https://kaname.example/help", "いまの様子": "https://status.kaname.example"}
G = [  # 文字の頭 → 行き先（どの画面でも）
 ("JD 受託開発", "Overview.dc.html"), ("KR 経理", "Overview.dc.html"), ("EG 営業", "Overview.dc.html"),
 ("KR-031", "TicketDetail.dc.html"), ("取引先のルール：セイコー様", "KnPage.dc.html"), ("添付：", "TdPreview.dc.html"),
 ("京蟻 追加開発の見積", "TicketDetail.dc.html"), ("やったこと", "RoomDone.dc.html"),
 ("タスク 区画", "WsShape.dc.html"), ("課題 区画", "WsShape.dc.html"), ("QA 区画", "WsShape.dc.html"), ("会議 区画", "WsShape.dc.html"),
 ("好み", "RoomMemory.dc.html"), ("事実", "RoomMemory.dc.html"), ("実例", "RoomMemory.dc.html"), ("{{t.mark}}", "EdRule.dc.html"),
 ("▾ E ワークスペース全体", "KnHome.dc.html"), ("▾ 請求", "KnHome.dc.html"), ("▸ 見積", "KnHome.dc.html"), ("▾ EG 営業", "KnHome.dc.html"), ("▸ JD 受託開発", "KnHome.dc.html"), ("▸ 高 自分のページ", "KnHome.dc.html"), ("しまったページ", "KnHome.dc.html"),
 ("インボイスの書き方", "KnPage.dc.html"), ("請求書のひな形", "KnPage.dc.html"), ("経理の月次の流れ", "KnPage.dc.html"), ("営業の進め方", "KnPage.dc.html"), ("提案書の組み立て", "KnPage.dc.html"), ("問い合わせの返し方", "KnPage.dc.html"),
 ("ワークスペース全体", "KnHome.dc.html"), ("請求", "KnHome.dc.html"), ("取引先ごとの宛名の決め方", "KnPage.dc.html"), ("請求の取り消しと出し直し", "KnPage.dc.html"), ("チケット 17 件をすべて見る", "List.dc.html"),
 ("使われ方", "KnPage.dc.html"), ("つながり", "KnLinks.dc.html"), ("版 4", "KnPage.dc.html"), ("やり取り 2", "KnPage.dc.html"),
 ("1 取引先のルール：セイコー様", "KnPage.dc.html"), ("いいえ（直す案にする）", "KnProposal.dc.html"),
 ("京 京蟻システム", "CuPage.dc.html"), ("ミ 合同会社ミナト", "CuPage.dc.html"), ("セイコー様 保守契約の範囲", "KnPage.dc.html"),
 ("署 ", "EdRule.dc.html"), ("締 ", "EdRule.dc.html"), ("禁 ", "EdRule.dc.html"), ("秘 ", "EdRule.dc.html"), ("字 ", "EdRule.dc.html"), ("経 経費の申請", "RoomType.dc.html"), ("応 求人の応募文", "RoomType.dc.html"),
 ("PC をつけているのに実行待ち", "MeInquiry.dc.html"), ("ナレッジの取り込みの形式", "MeInquiry.dc.html"), ("＋ 種別を足す", "EdKind.dc.html"), ("＋ 区画を足す", "EdSection.dc.html"),
 ("{{t.title}}", "TicketDetail.dc.html"), ("鍵 バックアップコードで入る", "Auth2FA.dc.html"),
 ("セ 12 月分", "CuRequests.dc.html"), ("京 管理画面に CSV", "CuRequests.dc.html"), ("京 ログイン画面の文言", "CuRequests.dc.html"), ("ミ 10 月分の請求書", "CuRequests.dc.html"),
 ("選ぶのをやめる", "List.dc.html"), ("開く", "MobileDetail.dc.html"), ("見てから承認して送る", "MbApprovals.dc.html"), ("中身を見る", "MbApproveOne.dc.html"),
 ("やり取り 1", "MbTalk.dc.html"), ("高本のAI", "MbAI.dc.html"),
 ("湊 さくら ・ ミナト企画", "OpInbox.dc.html"), ("北村 透 ・ 北村デザイン", "OpInbox.dc.html"), ("太田 誠 ・ オオタ物流", "OpInbox.dc.html"),
 ("株式会社オオタ物流 管理者", "OpWs.dc.html"), ("山田工務店 管理者", "OpWs.dc.html"), ("株式会社サクラ会計 管理者", "OpWs.dc.html"), ("株式会社ENGINE BASE 管理者", "OpWs.dc.html"), ("株式会社ハル製作所 管理者", "OpWs.dc.html"), ("佐々木 恵 個人", "OpWs.dc.html"),
 ("詳しく", "MeHelp.dc.html"), ("メンバー 4", "WsPeople.dc.html"), ("このグループの決まり", "WsRules.dc.html"), ("通知", "MeNotify.dc.html"), ("決まりを開く", "WsRules.dc.html"),
 ("EG-112", "TicketDetail.dc.html"), ("支払期日は月末締め", "TicketDetail.dc.html"), ("請求のルール", "KnPage.dc.html"), ("PC をつなぐ", "EdPC.dc.html"),
 ("子チケットを作る", "Create.dc.html"), ("困ったとき・お知らせ", "MeHelp.dc.html"), ("ログアウト", "AuthLogin.dc.html"),
 ("高 高本 聖斗 自分だけ", "Main.dc.html"), ("京 京蟻システム株式会社 メンバー", "Main.dc.html"), ("ミ 合同会社ミナト クライアントの場所", "CpHome.dc.html"), ("届いた招待", "AuthInvite.dc.html"),
 ("チケット 4", "List.dc.html"), ("決まり 3", "EdClient.dc.html"), ("親チケットを決める", "EdParent.dc.html"),
]
F = {("MbTalk", "高本のAI"): "MbAI.dc.html"}
B = [  # ボタン → 行き先（文字が同じとき）
 ("高 ▾", "TopMe.dc.html", None), ("3", "StOverlay.dc.html", "知らせ（"), ("1", "StOverlay.dc.html", "知らせ（"),
 ("＋ グループ", "EdGroup.dc.html", None), ("表示設定", "LsView.dc.html", None), ("表示設定（列）", "LsView.dc.html", None), ("検索条件を保存", "LsSave.dc.html", None), ("まとめて操作", "LsBulk.dc.html", None),
 ("開始・期限が無い 4 件", "GtNoDate.dc.html", None), ("決めた履歴", "ApHistory.dc.html", None), ("AI と話して作る", "StCreateAi.dc.html", None), ("自分で書く", "Create.dc.html", None), ("過去のチケットから複製", "TdDuplicate.dc.html", None),
 ("＋ プランを足す", "OpPlanEdit.dc.html", None), ("書き直す", "OpNoticeNew.dc.html", None), ("PDF を大きく見る", "TdPreview.dc.html", None), ("＋ 覚えさせる", "EdTeach.dc.html", None), ("覚えさせる", "EdTeach.dc.html", None),
 ("いまの様子を見る", "https://status.kaname.example", None), ("いまの様子（運営の知らせ）", "https://status.kaname.example", None), ("ほかの項目（7）を開く", "TicketDetail.dc.html", None),
]
BF = {("MobileList", "カレンダー"): "Calendar.dc.html", ("MobileList", "概要"): "Overview.dc.html", ("MobileList", "一覧"): "List.dc.html", ("MeProfile", "変える"): "MeProfileEdit.dc.html", ("TicketDetail", "期限"): "TdDue.dc.html"}

PATCH = [  # 入口を付ける・古い言い方を直す（何度流しても同じになる）
 ("AuthVerify", '<a href="OnHome.dc.html" style="height: 44px', '<a href="AuthAddPasskey.dc.html" style="height: 44px'),
 ("Calendar", '<div style="{{c.numStyle}}">{{c.d}}</div>', '<a href="CalDay.dc.html" style="{{c.numStyle}}; display: block; color: inherit; text-decoration: none">{{c.d}}</a>'),
 ("Gantt", '<span style="{{r.bar}}">{{r.barText}}</span>', '<a href="GtMove.dc.html" style="{{r.bar}}; text-decoration: none">{{r.barText}}</a>'),
 ("TicketDetail", '<span style="color: #4A5563">期限</span><span style="color: #B91C1C; font-weight: 500">11/01（日）1 日過ぎ</span>', '<span style="color: #4A5563">期限</span><a href="TdDue.dc.html" style="color: #B91C1C; font-weight: 500; text-decoration: none">11/01（日）1 日過ぎ ▾</a>'),
 ("MobileDetail", '<span style="color: #4A5563">担当者</span><span>高本</span>\n   <span style="color: #4A5563">実行者</span><span>高本のAI</span>', '<span style="color: #4A5563">担当者</span><span>高本 <span style="font-size: 11px; border: 1px solid #DDE2E9; border-radius: 99px; padding: 0 6px; color: #4A5563">高本のAI に任せている</span></span>'),
 ("MobileDetail", '<h3 style="font-size: 13px; margin: 0 0 6px">やり取りと記録</h3>', '<h3 style="font-size: 13px; margin: 0 0 6px; display: flex">やり取りと記録<a href="MbTalk.dc.html" style="margin-left: auto; font-weight: 400; font-size: 12px">やり取りを開く ›</a></h3>'),
 ("MeLogin", '<b style="font-weight: 600; flex: 1">2 段階認証</b>', '<b style="font-weight: 600; flex: 1">2 段階認証 <a href="MeLogin2FA.dc.html" style="font-weight: 400; font-size: 12px">付けている人の見え方</a></b>'),
]
TEXT = [  # 古い呼び方をそろえる（全部の画面）
 ("自分の AI", "高本のAI"), ("証跡（いつ誰が消したか）", "記録（いつ誰が消したか）"), ("証跡に残る", "記録に残る"),
 ("ワークスペース › ワークスペースの設定", "ワークスペースの管理 › 設定"),
 ("期限を延ばすと、承認する人（高本）とウォッチしている 2 人に知らせが出る", "期限を延ばすと、承認する人（高本）に知らせが出る"),
 ("ウォッチしている 3 人に知らせる", "持ち主と、直す案を出した人に知らせる"),
 ("ウォッチしているチケットが動いた", "自分が担当・承認するチケットが動いた"),
 ("（担当者とウォッチする人には自動で届く）", "（担当者と承認する人には自動で届く）"),
 # 名詞の「知らせ」は「お知らせ」（段 5 のすり合わせ・K-400・K-1113）。上の帯の鈴・自分の設定の第 2 ナビとその注
 ("aria-label=\"知らせ（", "aria-label=\"お知らせ（"), ("aria-label=\"知らせ\"", "aria-label=\"お知らせ\""),
 ("<span class=\"kn-sub-t\">知らせ</span>", "<span class=\"kn-sub-t\">お知らせ</span>"), ("預けたログイン情報と知らせはワークスペースごと", "預けたログイン情報とお知らせはワークスペースごと"),
 ("ウォッチしているものの動き", "自分が担当・承認するものの動き"), ("ウォッチしているもの", "自分が担当・承認するもの"), ("「ワークスペース › 消したもの」から戻せる", "ワークスペースの管理 › 記録 の「消した」から戻せる"),
]
RX = [  # 決まりに合わせて外すもの（D-128.80〜.82）
 (r'<(a|button)\b[^>]*>ウォッチ(?: \d+)?</\1>', ''),   # ウォッチは持たない
 (r'<div style="display: flex; gap: 8px; align-items: center; background: #F7F8FA; border-radius: 8px; padding: 8px 10px; font-size: 12px"><span[^>]*>型</span><span>毎月くり返すなら .*?</span></div>', ''),   # くり返しは後のフェーズ
 (r'<button type="button"[^>]*>(?:これを先に終える（前提）|これが終わったら始める|重複)</button>', ''),   # つながりは関連・派生元だけ（D-125.50）
]
def hit(t, k):
    if not t.startswith(k) or t == k: return False
    return k[-1] in " ：" or t[len(k)] == " " or len(k) >= 8
def norm(h): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)).strip()
def act(m):
    tag = m.group(0)
    st = re.search(r'style="([^"]*)"', tag)
    add = "cursor: pointer; "
    tag = tag.replace('<a href="#"', '<a role="button" tabindex="0" data-act', 1)
    return tag.replace('style="', 'style="' + add, 1) if st else tag.replace("data-act", 'data-act style="%s"' % add, 1)
def run():
    left = {}
    for path in sorted(glob.glob(P + "*.dc.html")):
        f = os.path.basename(path).replace(".dc.html", ""); s = open(path, encoding="utf-8").read(); o = s
        s = re.sub(r'<a role="button" tabindex="0" data-act([^>]*?)style="cursor: pointer; (?:text-decoration: underline; )?', r'<a href="#"\1style="', s)
        def rep(m):
            t = norm(m.group(2))
            href = F.get((f, t)) or next((h for k, h in G if t == k), None) or next((h for k, h in G if hit(t, k)), None) or EXT.get(t)
            if href:
                ext = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
                out = m.group(0).replace('<a href="#"', '<a href="%s"%s' % (href, ext), 1)
                if "<" in m.group(2) and "text-decoration" not in m.group(1):
                    out = out.replace('style="', 'style="text-decoration: none; color: inherit; ', 1) if 'style="' in m.group(1) else out.replace('<a href="%s"' % href, '<a href="%s" style="text-decoration: none; color: inherit"' % href, 1)
                return out
            left[t] = left.get(t, 0) + 1
            return re.sub(r'^<a href="#"[^>]*>', act, m.group(0))
        s = re.sub(r'(<a href="#"[^>]*>)(.*?)</a>', rep, s, flags=re.S)
        def brep(m):
            attrs, inner = m.group(1), m.group(2); t = norm(inner)
            href = BF.get((f, t))
            if not href:
                for k, h, need in B:
                    if t == k and (need is None or need in attrs): href = h; break
            if not href or href == f + ".dc.html": return m.group(0)
            st = re.search(r'style="([^"]*)"', attrs); aria = re.search(r'aria-label="[^"]*"', attrs)
            ext = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
            return '<a href="%s"%s%s style="%s; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; box-sizing: border-box; cursor: pointer">%s</a>' % (href, ext, " " + aria.group(0) if aria else "", st.group(1) if st else "", inner)
        s = re.sub(r'<button type="button"([^>]*)>(.*?)</button>', brep, s, flags=re.S)
        def nodeco(m):
            if "text-decoration" in m.group(1) or not re.search(r"<(span|svg|b|div)", m.group(2)): return m.group(0)
            return m.group(0).replace('style="', 'style="text-decoration: none; ', 1) if 'style="' in m.group(1) else m.group(0).replace("<a ", '<a style="text-decoration: none" ', 1)
        s = re.sub(r'(<a href="[^"#][^"]*\.dc\.html"[^>]*>)(.*?)</a>', nodeco, s, flags=re.S)
        for a, b in TEXT: s = s.replace(a, b)
        for a, b in RX: s = re.sub(a, b, s, flags=re.S)
        for pf, a, b in PATCH:
            if pf == f: s = s.replace(a, b)
        if s != o: open(path, "w", encoding="utf-8").write(s)
    return left
if __name__ == "__main__":
    l = run(); print("その場の操作にした:", sum(l.values())); [print(" ", n, t) for t, n in sorted(l.items(), key=lambda x: -x[1])]
