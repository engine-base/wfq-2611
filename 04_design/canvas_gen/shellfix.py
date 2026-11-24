import re, glob, os
P = os.environ.get("KANAME_CANVAS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "canvas") + "/"
SV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">%s</svg>'
IC = {
 "tickets": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>',
 "approvals": '<path d="M20 6 9 17l-5-5"></path>',
 "ai": '<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2M20 14h2M15 13v2M9 13v2"></path>',
 "knowledge": '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5a2.5 2.5 0 0 0 0 5H20"></path>',
 "clients": '<rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>',
 "company": '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"></path>',
 "panelL": '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M9 3v18"></path>',
 "panelR": '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M15 3v18"></path>',
}
ITEM = 'display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: 6px; text-decoration: none; '
def item(href, key, label, cur, extra=""):
    st = ITEM + ("background: #22345C; color: #FFFFFF; font-weight: 500" if cur else "color: #131B27")
    return '  <a href="%s" title="%s"%s class="kn-item" style="%s">%s<span class="kn-lbl">%s</span>%s</a>\n' % (href, label, ' aria-current="page"' if cur else "", st, SV % IC[key], label, extra)
def grp(code, bg, name, n, href="#"):
    return '  <a href="%s" title="%s" class="kn-item" style="display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border-radius: 6px; color: #131B27; text-decoration: none"><span style="width: 18px; height: 18px; flex: none; border-radius: 4px; background: %s; color: #FFFFFF; font-size: 10px; display: grid; place-items: center">%s</span><span class="kn-lbl">%s</span><span class="kn-lbl" style="margin-left: auto; font-size: 12px; color: #4A5563">%s</span></a>\n' % (href, name, bg, code, name, n)
def nav(sec):
    badge = '<b class="kn-lbl" style="margin-left: auto; font-size: 11px; background: #B45309; color: #FFFFFF; border-radius: 99px; padding: 0 7px">2</b>'
    return (' <nav aria-label="メニュー" class="kn-nav" style="flex: 0 0 216px; background: #EEF0F4; border-right: 1px solid #DDE2E9; display: flex; flex-direction: column; gap: 1px; padding: 10px 8px; box-sizing: border-box">\n'
      '  <div class="kn-top" style="display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 8px"><span style="width: 24px; height: 24px; flex: none; border-radius: 6px; background: #22345C; color: #FFFFFF; display: grid; place-items: center; font-size: 12px; font-weight: 700">E</span><b class="kn-lbl" style="font-weight: 700">ENGINE BASE ▾</b>'
      '<label for="kn-tg-nav" class="kn-tg" title="メニューを閉じる・開く" style="margin-left: auto; width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center; color: #4A5563; cursor: pointer">' + SV % IC["panelL"] + '</label></div>\n'
      '  <a href="Create.dc.html" title="チケットを作る" class="kn-create" style="margin: 6px 0; background: #22345C; color: #FFFFFF; border-radius: 6px; height: 34px; display: flex; align-items: center; justify-content: center; gap: 4px; text-decoration: none; font-weight: 500">＋<span class="kn-lbl">チケットを作る</span></a>\n'
      + item("Main.dc.html", "tickets", "チケット", sec == "tickets")
      + item("Approvals.dc.html", "approvals", "承認待ち", sec == "approvals", badge)
      + item("Room.dc.html", "ai", "高本のAI", sec == "ai")
      + item("KnHome.dc.html", "knowledge", "ナレッジ", sec == "knowledge")
      + '  <div class="kn-lbl" style="font-size: 12px; color: #4A5563; padding: 12px 10px 4px; display: flex">グループ<span style="margin-left: auto">★</span></div>\n'
      + grp("EG", "#186F69", "営業", 18, "Overview.dc.html") + grp("JD", "#6D4AA6", "受託開発", 42) + grp("KR", "#B45309", "経理", 9)
      + '  <div style="flex: 1"></div>\n'
      + item("WsPeople.dc.html", "company", "ワークスペースの管理", sec == "company")
      + '  <div title="PC つながっている" style="font-size: 12px; color: #166534; display: flex; align-items: center; gap: 6px; padding: 6px 10px"><span style="width: 8px; height: 8px; flex: none; border-radius: 99px; background: #166534"></span><span class="kn-lbl">PC つながっている</span></div>\n'
      ' </nav>\n')
IC.update({
 "inbox": '<path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"></path>',
 "notice": '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"></path><path d="M16 9a3 3 0 0 1 0 6M19 6a7 7 0 0 1 0 12"></path>',
 "yen": '<path d="M6 3l6 8 6-8M12 11v10M7 13h10M7 17h10"></path>',
 "box": '<path d="M21 8 12 3 3 8v8l9 5 9-5z"></path><path d="M3 8l9 5 9-5M12 13v8"></path>',
 "team": '<circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20a6.5 6.5 0 0 1 13 0"></path><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"></path>',
})
def nav_ops(sec):
    b3 = '<b class="kn-lbl" style="margin-left: auto; font-size: 11px; background: #B45309; color: #FFFFFF; border-radius: 99px; padding: 0 7px">3</b>'
    b2 = '<b class="kn-lbl" style="margin-left: auto; font-size: 11px; background: #B45309; color: #FFFFFF; border-radius: 99px; padding: 0 7px">2</b>'
    return (' <nav aria-label="メニュー" class="kn-nav" style="flex: 0 0 216px; background: #EEF0F4; border-right: 1px solid #DDE2E9; display: flex; flex-direction: column; gap: 1px; padding: 10px 8px; box-sizing: border-box">\n'
      '  <div class="kn-top" style="display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 8px"><span style="width: 24px; height: 24px; flex: none; border-radius: 6px; background: #131B27; color: #FFFFFF; display: grid; place-items: center; font-size: 12px; font-weight: 700">K</span><b class="kn-lbl" style="font-weight: 700">Kaname</b><span class="kn-lbl" style="font-size: 11px; background: #131B27; color: #FFFFFF; border-radius: 4px; padding: 0 6px">運営</span>'
      '<label for="kn-tg-nav" class="kn-tg" title="メニューを閉じる・開く" style="margin-left: auto; width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center; color: #4A5563; cursor: pointer">' + SV % IC["panelL"] + '</label></div>\n'
      '  <div style="height: 8px"></div>\n'
      + item("OpList.dc.html", "company", "ワークスペース", sec == "ws")
      + item("OpInbox.dc.html", "inbox", "問い合わせ", sec == "inbox", b3)
      + item("OpNotices.dc.html", "notice", "お知らせ", sec == "notice")
      + item("OpBills.dc.html", "yen", "請求", sec == "bill", b2)
      + item("OpTypes.dc.html", "box", "配るもの", sec == "master")
      + '  <div style="flex: 1"></div>\n'
      + item("OpTeam.dc.html", "team", "運営の人", sec == "team")
      + '  <div class="kn-lbl" style="font-size: 11px; color: #4A5563; padding: 6px 10px">顧客の画面とは別の場所。操作はすべて運営の記録に残る</div>\n'
      ' </nav>\n')
def opsec(f):
    n = f.replace(".dc.html", "")
    for k, v in [("OpInbox", "inbox"), ("OpNotice", "notice"), ("OpBill", "bill"), ("OpPay", "bill"), ("OpType", "master"), ("OpPlan", "master"), ("OpTeam", "team")]:
        if n.startswith(k): return v
    return "ws"
# 幅 767 以下の入力欄は 16px（D-144.7。スマホで入力欄に触れたとき画面が勝手に拡大しない）。広い幅は絵の大きさのまま。
# 全部の絵（スマホの絵 Mobile* も）の頭の style に 1 回だけ足す。16px にした選ぶ欄が、選んだ字の幅で並びからはみ出さないよう、縮めてよいことにする
NARROW = ("/* kn-narrow */\n@media (max-width: 767px) { input, textarea, select { font-size: 16px !important } }\n"
          "@media (max-width: 767px) { select { min-width: 0; max-width: 100% } label:has(> select) { min-width: 0 } }\n")
# スマホの絵の外枠（幅 390px の固定）は、狭い画面では画面の幅に縮む（広い画面では 390px のまま）
PHONE = (re.compile(r"(?<![-\w])width: 390px; height: 844px;"), "width: 100%; max-width: 390px; height: 844px;")   # max-width の中には当てない（何度流しても 1 回だけ）
def narrow(s):
    s = PHONE[0].sub(PHONE[1], s)
    s = re.sub(r"/\* kn-narrow \*/\n(?:@media[^\n]*\n)*", "", s)   # 前に足した分は消してから足す（決まりを替えても 1 回だけ）
    return s.replace("</style>", NARROW + "</style>", 1)
SIDE = ("選んだもの", "自分の AI", "自分の AI との会話", "チケットのパネル", "ワークスペースの情報", "問い合わせのワークスペース")
CSS = """
/* kn-shell: bars and panels run edge to edge; menu and side panel open/close */
[data-shell]{min-height:100vh !important;align-items:stretch}
[data-shell]>main{display:flex !important;flex-direction:column}
[data-shell]>main>.kn-bar~*:last-child{flex:1 0 auto}
.kn-bar~header{flex:none}
.kn-tgc{position:absolute;opacity:0;pointer-events:none}
.kn-tg:hover{background:#DDE2E9}
.kn-nav{transition:flex-basis .15s}
body:has(#kn-tg-nav:checked) .kn-nav{flex-basis:56px !important;padding:10px 6px !important}
body:has(#kn-tg-nav:checked) .kn-lbl{display:none !important}
body:has(#kn-tg-nav:checked) .kn-top{flex-direction:column;padding:4px 0 !important}
body:has(#kn-tg-nav:checked) .kn-tg{margin-left:0 !important}
body:has(#kn-tg-nav:checked) .kn-item{justify-content:center;padding:0 !important}
aside[aria-label="チケットのパネル"]{position:sticky;top:0;height:calc(100vh - 48px);align-self:flex-start}
.kn-pbody{flex:1 1 auto !important;min-height:0;overflow:auto}
.kn-thread{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column-reverse}
@media (max-width:1023px){aside[aria-label="チケットのパネル"]{position:static;height:auto}}
.kn-side{position:relative}
.kn-side>.kn-tg+*{padding-right:44px !important}
.kn-side>.kn-tg{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:6px;display:grid;place-items:center;color:#4A5563;cursor:pointer;background:#FFFFFF}
.kn-reopen{display:none;flex:0 0 36px;background:#FFFFFF;border-left:1px solid #DDE2E9;justify-content:center;padding-top:10px;color:#4A5563;cursor:pointer}
.kn-reopen:hover{color:#22345C;background:#F7F8FA}
body:has(#kn-tg-side:checked) .kn-side{display:none !important}
body:has(#kn-tg-side:checked) .kn-reopen{display:flex}
/* kn-sub: secondary left panel, white floating card for the current item */
.kn-sub{width:232px;flex:none;background:#EDF0F4;border-right:1px solid #DDE2E9;padding:10px 10px 14px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.kn-sub-h{font-size:11px;color:#6B7585;padding:12px 10px 4px;letter-spacing:.02em}
.kn-sub-h:first-child{padding-top:4px}
.kn-sub-i{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border-radius:8px;color:#3A4453;text-decoration:none;transition:background .12s}
.kn-sub-i:hover{background:rgba(255,255,255,.55);color:#131B27}
.kn-sub-i[aria-current="page"]{background:#FFFFFF;color:#131B27;font-weight:600;box-shadow:0 1px 2px rgba(19,27,39,.08),0 0 0 1px rgba(19,27,39,.06)}
.kn-sub-ic{display:grid;place-items:center;width:20px;color:#6B7585}
.kn-sub-i[aria-current="page"] .kn-sub-ic{color:#22345C}
.kn-sub-t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kn-sub-n{font-size:12px;color:#6B7585;font-weight:400}
.kn-sub-badge{font-size:11px;background:#B45309;color:#FFFFFF;border-radius:99px;padding:0 7px;font-weight:500}
.kn-sub-note{margin-top:auto;font-size:11px;color:#6B7585;padding:10px}
@media (max-width:1023px){.kn-sub{width:64px;padding:10px 8px}.kn-sub-h,.kn-sub-t,.kn-sub-n,.kn-sub-note{display:none}.kn-sub-i{justify-content:center;padding:0}.kn-sub-badge{position:absolute;margin:-18px 0 0 18px;font-size:9px;padding:0 4px}}
@media (max-width:767px){.kn-sub{width:auto;flex:none;flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid #DDE2E9;padding:6px 8px}.kn-sub-t{display:inline}.kn-sub-i{padding:0 10px;flex:none}}
@media (max-width:1023px){.kn-nav{flex-basis:56px !important;padding:10px 6px !important}.kn-lbl{display:none !important}.kn-top{flex-direction:column;padding:4px 0 !important}.kn-tg{margin-left:0 !important}.kn-item{justify-content:center;padding:0 !important}}
@media (max-width:767px){div:has(>.kn-sub){flex-direction:column}}
""" + NARROW
# 幅 767 以下の上の帯（D-147・2026-11-18 代表の直し・answer=0a262be577b2）：画面の外枠（components/k/shell.tsx・shell.css）と同じく、
#   スマホにも高さ 48px の上の帯を出す。左に会社の印と名前、右に 探す（虫眼鏡。押すと探す欄が帯の幅いっぱいに開き × で戻る）・お知らせ・自分のアイコン。
#   いまの場所は出さない（題は本文の h1）。前の決め（MobileList どおり上の帯を出さない・承認待ちは見出しの右に鈴の場所）は D-147 で置き換えた
WS_MARK = 'width: 24px; height: 24px; flex: none; border-radius: 6px; background: %s; color: #FFFFFF; place-items: center; font-size: 12px; font-weight: 700'
WS_NAME = 'flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; font-weight: 600; color: #131B27'
ICON_BTN = 'width: 44px; height: 44px; flex: none; border-radius: 6px; place-items: center; color: #4A5563; cursor: pointer'
SV18 = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">%s</svg>'
MAG = '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>'
XX = '<path d="M18 6 6 18M6 6l12 12"></path>'
BAR_OPEN = re.compile(r'<div class="kn-bar" style="[^"]*">')
SEARCH_LABEL = re.compile(r'<label style="[^"]*">(?:(?!</label>).)*?<input type="search".*?</label>', re.S)
def mobile_bar(s, ops):
    """上の帯に、スマホの帯の物（会社の印と名前・虫眼鏡・探すを閉じる）を足す。帯ごとに 1 回だけ（何度流しても同じ）"""
    m = BAR_OPEN.search(s)
    if not m: return s
    end = s.index("</span></div>", m.end())
    bar = s[m.end():end]
    if 'class="kn-bar-ws"' in bar: return s
    mark, name, bg = ("K", "Kaname", "#131B27") if ops else ("E", "ENGINE BASE", "#22345C")
    head = ('<span class="kn-bar-ws" aria-hidden="true" style="%s">%s</span><span class="kn-bar-ws-name" style="%s">%s</span>'
            % (WS_MARK % bg, mark, WS_NAME, name))
    sm = SEARCH_LABEL.search(bar)
    if sm:
        opener = '<label for="kn-tg-search" class="kn-bar-search-open" aria-label="探す" title="探す" style="%s">%s</label>' % (ICON_BTN, SV18 % MAG)
        closer = '<label for="kn-tg-search" class="kn-bar-search-close" aria-label="探すを閉じる" title="探すを閉じる" style="%s">%s</label>' % (ICON_BTN, SV18 % XX)
        bar = bar[:sm.start()] + opener + sm.group(0) + closer + bar[sm.end():]
    return s[:m.end()] + head + bar + s[end:]
MOBILE_BAR_CSS = """/* kn-mobile-bar（D-147）：幅 767 以下の上の帯は画面の外枠と同じ（会社の印と名前・探す・お知らせ・自分のアイコン。いまの場所は出さない） */
.kn-bar-ws,.kn-bar-ws-name,.kn-bar-search-open,.kn-bar-search-close{display:none}
@media (max-width:767px){.kn-bar{gap:8px !important;padding:0 8px 0 16px !important}.kn-bar>nav[aria-label="いまの場所"]{display:none !important}.kn-bar-ws{display:grid}.kn-bar-ws-name{display:block}.kn-bar>span[style*="margin-left: auto"]{gap:0 !important}.kn-bar>span>label:has(input[type="search"]){display:none !important}.kn-bar-search-open{display:grid}.kn-bar>span>[aria-label^="お知らせ"]{width:44px !important;height:44px !important}.kn-bar-search-open:hover,.kn-bar-search-close:hover{background:#DDE2E9}
body:has(#kn-tg-search:checked) .kn-bar>:not(span[style*="margin-left: auto"]),body:has(#kn-tg-search:checked) .kn-bar>span>:not(label){display:none !important}body:has(#kn-tg-search:checked) .kn-bar-search-open{display:none !important}body:has(#kn-tg-search:checked) .kn-bar>span[style*="margin-left: auto"]{flex:1;margin-left:0 !important;gap:4px !important}body:has(#kn-tg-search:checked) .kn-bar>span>label:has(input[type="search"]){display:flex !important;flex:1;width:auto !important;max-width:none !important;height:36px !important}body:has(#kn-tg-search:checked) .kn-bar>span>label:has(input[type="search"])>span:last-child{display:none}body:has(#kn-tg-search:checked) .kn-bar-search-close{display:grid}}
"""
CSS = CSS + MOBILE_BAR_CSS
# 絵ごとの幅 767 以下の決まり（足元の帯を下のタブ 60px の上に置く など）。kn-shell の塊の中に足すので、shellfix.py を何度流しても 1 回だけ（K-224：Create・K-226：TicketDetail）
NARROW_BY_BOARD = {
    "Create.dc.html": "/* kn-board-narrow（K-224）：足元の帯を下のタブ（60px）の上に置く */\n"
                      "@media (max-width:767px){main>div[style*=\"position: sticky; bottom: 0\"]{bottom:60px !important}}\n",
}
# 一覧の絵（K-251：OnHome・Main・List）：見え方のタブは字を折り返さず 1 行のまま横に送る
_LIST_NARROW = ("/* kn-board-narrow（K-251）：見え方のタブは字を折り返さず横に送る */\n"
                "@media (max-width:767px){nav[aria-label=\"チケットの見え方\"]>a{white-space:nowrap;flex:none}}\n")
NARROW_BY_BOARD.update({"OnHome.dc.html": _LIST_NARROW, "Main.dc.html": _LIST_NARROW, "List.dc.html": _LIST_NARROW})
# 詳細の形の絵（K-226：詳細と帯の 7 枚・K-257 が同じ形にそろえた）。7 枚とも同じにする：帯の位置を TicketDetail とそろえる約束（K257-UI-013）を保つ
DETAIL_BOARDS = ("TicketDetail", "StRunning", "StFailed", "StBefore", "StConfirmDone", "StDone", "StDelegated")
# K-227：767 以下は帯の箱の左右も、カードの中のほかの行（article>div の左右 16px）と同じ 16px にそろえる（画面の外枠の
#   .k-detail-bands と同じ）。箱の中の余白は、ほかの行の 16px に上書きされないよう箱の余白（10px 12px・12px 14px）のまま保つ
BAND_NARROW = ('article>div:is([role="status"],[role="alert"])[style*="margin: 0 20px"]{margin-left:16px !important;margin-right:16px !important}'
               'article>div:is([role="status"],[role="alert"])[style*="padding: 10px 12px"]{padding-left:12px !important;padding-right:12px !important}'
               'article>div:is([role="status"],[role="alert"])[style*="padding: 12px 14px"]{padding-left:14px !important;padding-right:14px !important}')
NARROW_BY_BOARD.update({
    f"{b}.dc.html": "/* kn-board-narrow（K-226・K-227）：帯の箱の左右はカードの行と同じ 16px */\n"
                    "@media (max-width:767px){" + BAND_NARROW + "}\n"
    for b in DETAIL_BOARDS
})
# 必須の印「*」を項目名と同じ行に置く（K-225）。縦並び（flex の column）の label の中で、項目名の字と <b>*</b> が別々の段に割れて
#   「種別」「*」「欄」の 3 段になっていた（絵の描き方の事故）。項目名と印を 1 つの span に包む。包んだ後は合わないので、何度流しても 1 回だけ
REQ_INLINE_BOARDS = ("Create.dc.html",)
REQ_INLINE = re.compile(r'(<label style="display: flex; flex-direction: column;[^"]*">)([^<]+?) (<b style="color: #B91C1C">\*</b>)')
def req_inline(s):
    return REQ_INLINE.sub(r"\1<span>\2 \3</span>", s)
def section(f):
    ED = {"EdRule": "ai", "EdMemory": "ai", "EdClient": "clients", "EdContact": "clients", "EdMemberMenu": "company", "EdMemberRemove": "company", "EdGroup": "company", "EdApproval": "company", "EdSection": "company", "EdPC": "none", "EdMove": "tickets", "OnHome": "tickets", "EdKind": "company", "EdParent": "tickets", "EdTeach": "ai", "EdTypeChange": "tickets", "EdPlan": "company", "EdDeleteWs": "company", "EdLeaveWs": "none", "EdPasskey": "none", "EdInquiry": "none", "MbHelp": "none", "OnRoom": "ai", "OnKnowledge": "knowledge", "OnClients": "clients", "OnLoading": "tickets", "OnError": "tickets"}
    if f.replace(".dc.html", "") in ED: return ED[f.replace(".dc.html", "")]
    if f.startswith("Approvals"): return "approvals"
    if f.startswith("Room") or f.startswith("AiChat"): return "ai"
    if f.startswith("Ws"): return "company"
    if f.startswith("Me"): return "none"
    if f.startswith("Kn"): return "knowledge"
    if f.startswith("Cu") and f != "CuReview.dc.html": return "clients"
    return "tickets"
for path in sorted(glob.glob(P + "*.dc.html")):
    f = os.path.basename(path)
    s = open(path, encoding="utf-8").read()
    if f.startswith("Mobile"):
        s2 = narrow(s)
        if s2 != s: open(path, "w", encoding="utf-8").write(s2)
        continue
    s = PHONE[0].sub(PHONE[1], s)
    if "kn-shell" in s: s = re.sub(r"\n/\* kn-shell.*?(?=</style>)", "\n", s, flags=re.S)
    s = re.sub(r"\n{2,}(?=</style>)", "\n", s, count=1)
    s = s.replace("</style>", CSS + NARROW_BY_BOARD.get(f, "") + "</style>", 1)
    if f in REQ_INLINE_BOARDS: s = req_inline(s)
    # root
    i = s.index("</helmet>"); j = s.index(">", s.index("<div", i))
    root = s[s.index("<div", i):j+1]
    nr = re.sub(r"width: 1440px; height: 1000px;", "min-height: 100vh;", root)
    nr = re.sub(r"min-height: \d+px", "min-height: 100vh", nr)
    if "data-shell" not in nr: nr = nr.replace("<div ", "<div data-shell ", 1)
    inputs = '\n <input type="checkbox" id="kn-tg-nav" class="kn-tgc" aria-label="メニューを閉じる"><input type="checkbox" id="kn-tg-side" class="kn-tgc" aria-label="パネルを閉じる">'
    if 'id="kn-tg-nav"' in s: inputs = ""
    if 'id="kn-tg-search"' not in s and 'class="kn-bar"' in s:   # スマホの帯の虫眼鏡で開く探す欄（D-147）
        inputs += '<input type="checkbox" id="kn-tg-search" class="kn-tgc" aria-label="探す欄を開く">'
    s = s[:s.index("<div", i)] + nr + inputs + s[j+1:]
    s = mobile_bar(s, f.startswith("Op"))
    # nav
    m = re.search(r' <nav aria-label="メニュー".*?</nav>\n', s, flags=re.S)
    if m: s = s[:m.start()] + (nav_ops(opsec(f)) if f.startswith("Op") else nav(section(f))) + s[m.end():]
    # subnav fixed height
    s = s.replace("min-height: 860px; ", "")
    # side panels
    for lab in SIDE:
        tag = '<aside aria-label="%s"' % lab
        if tag in s and 'class="kn-side"' not in s:
            k = s.index(tag)
            reopen = '<label for="kn-tg-side" class="kn-reopen" title="パネルを開く">' + SV % IC["panelR"] + '</label>\n   '
            close = '\n    <label for="kn-tg-side" class="kn-tg" title="パネルを閉じる">' + SV % IC["panelR"] + '</label>'
            e = s.index(">", k)
            s = s[:k] + reopen + s[k:e].replace("<aside ", '<aside class="kn-side" ', 1) + ">" + close + s[e+1:]
    open(path, "w", encoding="utf-8").write(s)
    print(f, "nav" if m else "-", "side" if 'class="kn-side"' in s else "")

try:
    import edwire; edwire.run()
    import linkfix; linkfix.run()
    import tokensnap; tokensnap.run()
except Exception as e:
    print('edwire', e)

# 最後に、shellfix が全部の画面に同じに掛けた所のうち、絵ごとに違うもの（承認待ちが空の絵のバー・「あとで」の絵のバー）を直す（K-219）。
# ここで呼ぶので、shellfix.py だけを回し直しても戻らない
import k219; k219.after_shellfix()
