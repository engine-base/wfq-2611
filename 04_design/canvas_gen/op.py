import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ov import *
from subnav import build, SV, IC
MAIN = load("Main.dc.html")
WHITE = "background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px"
AMBER = "#B45309"; GREEN = "#166534"; RED = "#B91C1C"
def av(c, bg, n=28): return '<span style="width: %dpx; height: %dpx; flex: none; border-radius: 99px; background: %s; color: #FFFFFF; font-size: 11px; display: grid; place-items: center">%s</span>' % (n, n, bg, c)
def dot(t, c=GREEN): return '<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; color: %s"><span style="width: 7px; height: 7px; flex: none; border-radius: 99px; background: %s"></span>%s</span>' % ("#4A5563" if c == GREEN else c, c, t)
def warn(t): return pill(t, "#FCEBD5", "#7A4A05")
def bad(t): return pill(t, "#FBE4E4", "#8F1D1D")
def ok(t): return pill(t, "#E3F1E7", "#1E5A33")
def ttl(h, note="", act=""): return '<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap"><h1 style="font-size: 18px; margin: 0">%s</h1><span style="font-size: 12px; color: %s">%s</span>%s</div>' % (h, MUTED, note, '<span style="margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; align-items: center">%s</span>' % act if act else "")
def card(h, pad="14px 16px"): return '<div style="%s; padding: %s">%s</div>' % (WHITE, pad, h)
def table(cols, rows, widths=None):
    th = "".join('<th style="%s">%s</th>' % ("width: %s" % widths[i] if widths and widths[i] else "", c) for i, c in enumerate(cols))
    tr = "".join('<tr style="border-top: 1px solid #EDF0F4%s">%s</tr>' % (r[1] if isinstance(r, tuple) else "", "".join('<td style="padding: 6px 12px; height: 48px; vertical-align: middle; white-space: nowrap">%s</td>' % c for c in (r[0] if isinstance(r, tuple) else r))) for r in rows)
    return '<div style="%s; overflow: auto"><table style="width: 100%%; border-collapse: collapse; font-size: 13px"><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (WHITE, th, tr)
def two(a, b): return '<span style="display: block; min-width: 0">%s<span style="display: block; font-size: 11px; color: %s">%s</span></span>' % (a, MUTED, b)
def stat(label, val, sub_="", c="#131B27"): return '<div style="flex: 1 1 160px; %s; padding: 8px 14px; line-height: 1.5"><div style="font-size: 12px; color: %s">%s</div><div style="font-size: 17px; font-weight: 700; color: %s">%s</div><div style="font-size: 11px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">%s</div></div>' % (WHITE, MUTED, label, c, val, MUTED, sub_)
def bar(p, c=NAVY): return '<span style="display: block; height: 6px; border-radius: 99px; background: #EDF0F4; overflow: hidden"><span style="display: block; width: %d%%; height: 100%%; background: %s"></span></span>' % (p, c)
def search(ph, w="320px"): return '<div style="display: flex; gap: 8px; align-items: center; %s; padding: 0 12px; height: 36px; width: %s; max-width: 100%%"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4A5563" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><span style="color: %s; font-size: 12px">%s</span></div>' % (WHITE, w, MUTED, ph)
def tabs(items, cur):
    return '<div style="display: flex; border-bottom: 1px solid #DDE2E9; overflow-x: auto">' + "".join('<a href="%s" style="padding: 8px 14px; white-space: nowrap; border-bottom: 2px solid %s; color: %s; text-decoration: none; %s">%s</a>' % (h, NAVY if k == cur else "transparent", NAVY if k == cur else MUTED, "font-weight: 600" if k == cur else "", t) for k, t, h in items) + '</div>'

def shell(base, crumbs, search_ph):
    s = base
    a = s.index('<nav aria-label="いまの場所"'); b = s.index("</nav>", a) + 6
    cr = ""
    for i, (t, h) in enumerate(crumbs):
        if i: cr += '<span style="color: #B8C0CC">›</span>'
        cr += ('<a href="%s" style="color: #4A5563; text-decoration: none">%s</a>' % (h, t)) if h else '<b style="font-weight: 500; color: #131B27">%s</b>' % t
    s = s[:a] + '<nav aria-label="いまの場所" style="display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; white-space: nowrap; overflow: hidden">%s</nav>' % cr + s[b:]
    s = s.replace('placeholder="チケット・ナレッジ・決定を探す"', 'placeholder="%s"' % search_ph, 1)
    return s
def page(name, title, crumbs, body, sub="", side="", hdr="", base=None, ph="ワークスペース・問い合わせを探す", pad="20px 28px"):
    s = shell(base or MAIN, crumbs, ph)
    if name.startswith("Op"):
        s = re.sub(r'aria-label="(お?)知らせ（3 件）"', r'aria-label="\1知らせ（1 件）"', s, count=1).replace('>3</b></button>', '>1</b></button>', 1)
    bar_end = s.index("</span></div>", s.index('class="kn-bar"')) + len("</span></div>")
    mend = s.rindex("</main>")
    s = s[:bar_end] + hdr + '\n  <div style="display: flex; min-height: 0">' + sub + '<section style="flex: 1; min-width: 0; padding: %s; display: flex; flex-direction: column; gap: 14px">' % pad + body + '</section>' + side + '</div>\n ' + s[mend:]
    save(name, title, s); return s

# ============ ワークスペースの一覧 ============
def lsub(cur):
    return build("ワークスペースの絞り込み", [("", [("OpList.dc.html", SV % IC["list"], "すべて", "48", False), ("OpList.dc.html#watch", "!", "気にかける", "4", True), ("OpList.dc.html#stopped", "■", "止めている", "1", False), ("OpList.dc.html#leaving", "→", "やめる手続き中", "1", False)]),
        ("プラン（仮）", [("OpList.dc.html#free", "", "無料", "21", False), ("OpList.dc.html#team", "", "チーム", "19", False), ("OpList.dc.html#biz", "", "ビジネス", "8", False)])], cur, "中身（チケット・会話）はここには出ない。見るときは 1 社から「中を見る」")
WS = [("合同会社ミナト企画", "管理者 湊 さくら", "チーム", "8 / 10", "6 / 8", "1,284", warn("止まった実行 3"), ok("払われた"), dot("使っている"), "OpWs.dc.html", True),
      ("北村デザイン事務所", "管理者 北村 透", "チーム", "4 / 10", "4 / 4", "512", "", bad("期限を過ぎた 9 日"), dot("使っている"), "OpWsBilling.dc.html", True),
      ("株式会社オオタ物流", "管理者 太田 誠", "ビジネス", "27 / 30", "19 / 27", "6,930", warn("上限の 92%"), ok("払われた"), dot("使っている"), "#", True),
      ("山田工務店", "管理者 山田 健二", "無料", "2 / 3", "0 / 2", "0", warn("PC がまだ 14 日"), "—", dot("使っている"), "#", True),
      ("株式会社サクラ会計", "管理者 桜井 恵子", "ビジネス", "22 / 30", "20 / 22", "8,115", "", ok("払われた"), dot("使っている"), "#", False),
      ("株式会社ENGINE BASE", "管理者 高本 聖斗", "チーム", "5 / 10", "5 / 5", "2,040", "", ok("払われた"), dot("使っている"), "#", False),
      ("株式会社ハル製作所", "管理者 春日 亮", "チーム", "6 / 10", "—", "—", "", bad("未入金 2 か月"), dot("止めている（10/20〜）", AMBER), "#", False),
      ("佐々木 恵", "個人", "無料", "1 / 3", "1 / 1", "86", "", "—", dot("やめる手続き中（あと 12 日）", AMBER), "#", False)]
rows = [['<a href="%s" style="text-decoration: none; color: #131B27">%s</a>' % (w[9], two('<b style="font-weight: 500">%s</b>' % w[0], w[1])), w[2], w[3], w[4], w[5], w[6] or '<span style="color: #8A94A3">—</span>', w[7], w[8]] for w in WS]
body = (ttl("ワークスペース", "Kaname を使っているワークスペース ・ 48", btn("書き出す（CSV）"))
  + '<div style="display: flex; gap: 10px; flex-wrap: wrap">' + stat("使っている", "46", "止めている 1 ・ やめる手続き中 1") + stat("気にかける", "4", "詰まり・未入金・PC がまだ・上限が近い", AMBER) + stat("今月の実行", "48,210", "先月より 12% 多い") + stat("期限を過ぎた請求", "2 件", "¥ 49,500（税込）", RED) + '</div>'
  + '<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">' + search("名前・管理者のメールで探す") + chip("気にかけるを上に", True) + chip("人数") + chip("今月の実行") + '</div>'
  + table(["ワークスペース", "プラン", "人数", "PC がつながる人", "今月の実行", "気にかけること", "請求", "状態"], rows, ["26%", "", "", "", "", "", "", ""])
  + '<div style="font-size: 12px; color: %s">気にかけること：止まった実行が続く・請求の期限を過ぎた・登録から 7 日たっても PC がつながらない・上限の 90%% を超えた。数と種類だけで、中身は出さない</div>' % MUTED)
page("OpList.dc.html", "運営 ワークスペース", [("ワークスペース", "")], body, sub=lsub("OpList.dc.html"))

# ============ 1 社 ============
def whdr(cur):
    t = tabs([("now", "いまの状態", "OpWs.dc.html"), ("mem", "メンバー 8", "OpWsMembers.dc.html"), ("bill", "プランと請求", "OpWsBilling.dc.html"), ("inq", "問い合わせ 1", "OpInbox.dc.html"), ("log", "記録", "OpWsLog.dc.html")], cur)
    return ('\n  <header style="background: #FFFFFF; border-bottom: 1px solid #DDE2E9; padding: 14px 24px 0; display: flex; flex-direction: column; gap: 10px"><div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">' + icon("ミ", "#186F69", 36)
      + '<div style="min-width: 0"><h1 style="font-size: 18px; margin: 0">合同会社ミナト企画</h1><div style="font-size: 12px; color: %s; display: flex; gap: 10px; flex-wrap: wrap; align-items: center">%s<span>チーム（仮）・ 8 人</span><span>2026-04-01 から</span></div></div>' % (MUTED, dot("使っている"))
      + '<span style="margin-left: auto; display: flex; gap: 6px">' + btn("お知らせを送る", "", "OpNoticeNew.dc.html") + btn("中を見る", "p", "OpPeek.dc.html") + btn("⋯", "", "OpStop.dc.html") + '</span></div>' + t + '</header>')
INFO = ('<aside aria-label="ワークスペースの情報" style="width: 300px; flex: none; background: #FFFFFF; border-left: 1px solid #DDE2E9; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box">'
  + '<b style="font-size: 13px">ワークスペースの情報</b>'
  + "".join('<div><div style="font-size: 11px; color: %s">%s</div><div>%s</div></div>' % (MUTED, a, b) for a, b in [("名前", "合同会社ミナト企画"), ("管理者", "湊 さくら<br><span style=\"font-size: 12px; color: #4A5563\">minato@minato-kikaku.example</span>"), ("始めた日", "2026-04-01（登録）・ 04-03 から チーム"), ("払い方", "請求書払い ・ 月末締め 翌月末払い"), ("請求先", "合同会社ミナト企画 経理 ご担当<br><span style=\"font-size: 12px; color: #4A5563\">keiri@minato-kikaku.example</span>"), ("次の請求", "12/01 ・ ¥16,500（税込・仮）"), ("運営の担当", "佐野（サポート）")])
  + '<div style="font-size: 11px; color: %s; border-top: 1px solid #EDF0F4; padding-top: 10px">このワークスペースへの運営の操作はすべて「記録」に残り、顧客の「ワークスペースの管理 › 記録」にも出る（許可は規約で先にもらっている）</div></aside>' % MUTED)
def ws_page(name, title, cur, body, crumb):
    return page(name, title, [("ワークスペース", "OpList.dc.html"), ("合同会社ミナト企画", "OpWs.dc.html" if crumb else ""), ] + ([(crumb, "")] if crumb else []), body, hdr=whdr(cur), side=INFO)
evt = lambda w, t, s_="": '<div style="display: flex; gap: 12px; padding: 9px 0; border-top: 1px solid #EDF0F4"><span style="width: 86px; flex: none; font-size: 12px; color: %s">%s</span><span style="flex: 1">%s%s</span></div>' % (MUTED, w, t, '<span style="display: block; font-size: 11px; color: %s">%s</span>' % (MUTED, s_) if s_ else "")
body = ('<div style="display: flex; gap: 10px; flex-wrap: wrap">' + stat("PC がつながる人", "6 / 8", "山本さん・木下さん はまだ") + stat("今月の実行", "1,284", "人ごとの枠の 64%（いちばん多い人 88%）") + stat("止まった実行", "3", "この 7 日 ・ 先週は 0", AMBER) + stat("ファイル", "2.1 GB", "10 GB まで（仮）") + '</div>'
  + card('<div style="display: flex; align-items: center; gap: 8px"><b>止まった理由</b><span style="font-size: 12px; color: %s">種類と数だけ。中身を見るときは「中を見る」</span></div>' % MUTED
    + evt("2 件", "預けたログイン情報の期限が切れた", "湊さんの GMAIL_WORK ・ 本人に「預け直す」の知らせが出ている（10/31〜）")
    + evt("1 件", "相手のサイトの画面が変わった", "記録した動かし方が合わず、汎用のブラウザ操作に戻して記録し直した ・ 自動で直った"))
  + card('<b>最近のこと</b>'
    + evt("11/02 09:40", "問い合わせ「承認したのに動かない」が届いた", "湊 さくら ・ 担当 高本 ・ 進行中")
    + evt("11/01 09:00", "10 月分の請求書を出した ¥16,500", "期限 11/30")
    + evt("10/28", "9 月分の入金を記録した", "佐野")
    + evt("10/15", "メンバーが 1 人増えた（8 人）")
    + evt("10/03", "預けたログイン情報 GMAIL_WORK の期限が近い、の知らせを本人に出した", "自動")))
WP = ws_page("OpWs.dc.html", "運営 1 社 いまの状態", "now", body, "")

mrow = lambda c, bg, n, mail, role, last, pc, mfa: [two('<span style="display: inline-flex; gap: 8px; align-items: center">%s%s</span>' % (av(c, bg, 24), n), mail), role, last, pc, mfa]
body = (ttl("メンバー", "8 人 ・ 運営は役割も中身も変えない（変えるのはワークスペースの管理者）")
  + table(["人", "役割", "最後に入った", "PC", "ログイン"], [mrow("湊", "#186F69", "湊 さくら", "minato@minato-kikaku.example", "管理者", "11/02 09:31", dot("つながっている"), "パスキー"),
      mrow("吉", "#2F4B7C", "吉田 健", "yoshida@…", "マネージャー", "11/02 08:50", dot("つながっている"), "パスキー"),
      mrow("山", "#7E570D", "山本 由美", "yamamoto@…", "メンバー", "10/30 18:02", dot("まだつないでいない", AMBER), "パスワード＋2 段階"),
      mrow("木", "#6D4AA6", "木下 翔", "kinoshita@…", "メンバー", "10/12 10:15", dot("まだつないでいない", AMBER), "パスワード＋2 段階"),
      mrow("小", "#4A5563", "小池 真理", "koike@…", "閲覧のみ", "11/01 13:40", '<span style="color: #8A94A3">—（分身なし）</span>', "パスキー")])
  + '<div style="font-size: 12px; color: %s">ほか 3 人は「すべて見る」。ログインに困っている人は、ワークスペースの管理者が 2 段階認証を戻せる（運営からは本人確認のメールを送り直すだけ）</div>' % MUTED)
ws_page("OpWsMembers.dc.html", "運営 1 社 メンバー", "mem", body, "メンバー")

inv = lambda m, amt, iss, due, st, paid, act="": [m, amt, iss, due, st, paid, act]
body = ('<div style="display: flex; gap: 12px; flex-wrap: wrap">'
  + '<div style="flex: 1 1 320px; %s; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px"><div style="display: flex; align-items: center; gap: 8px"><b>チーム</b>%s<span style="margin-left: auto; font-size: 12px; color: %s">プランの版 v1 ・ 04-03 から</span></div>' % (WHITE, pill("値段は仮", "#FCEBD5", "#7A4A05"), MUTED)
  + '<div style="font-size: 22px; font-weight: 700">¥15,000 <span style="font-size: 12px; font-weight: 400; color: %s">／月（税別）</span></div>' % MUTED
  + "".join('<div><div style="display: flex; font-size: 12px"><span>%s</span><span style="margin-left: auto; color: %s">%s</span></div>%s</div>' % (a, MUTED, b, bar(p, c)) for a, b, p, c in [("人数", "8 / 10", 80, NAVY), ("分身の実行（人ごとの枠・いちばん多い人）", "88%", 88, AMBER), ("ファイル", "2.1 / 10 GB", 21, NAVY)])
  + '<div style="font-size: 12px; color: %s">プランを変えるのはワークスペースの管理者（上げるとすぐ・下げると次の請求日から）。運営は頼まれたときだけ代わりに変え、記録に残す</div></div>' % MUTED
  + '<div style="flex: 1 1 260px; %s; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px"><b>払い方</b><div>請求書払い</div><div style="font-size: 12px; color: %s">月末締め・翌月 1 日に請求書を出す・月末払い。請求書はワークスペースの管理 › 設定 › 請求書 に出て、請求先のメールにも届く</div><div style="font-size: 12px; color: %s">カード払いは後のフェーズ</div></div></div>' % (WHITE, MUTED, MUTED)
  + ttl("請求書", "", btn("書き出す（CSV）"))
  + table(["月", "金額（税込）", "出した日", "期限", "状態", "入金", ""], [inv("10 月分", "¥16,500", "11/01", "11/30", pill("出した"), "—", btn("入金を記録", "", "OpPay.dc.html")),
      inv("9 月分", "¥16,500", "10/01", "10/31", ok("払われた"), "10/28 ・ 佐野"), inv("8 月分", "¥16,500", "09/01", "09/30", ok("払われた"), "09/29 ・ 佐野"), inv("7 月分", "¥16,500", "08/01", "08/31", ok("払われた"), "08/27 ・ 佐野")])
  + '<div style="font-size: 12px; color: %s">期限を過ぎると、管理者に知らせが出る（過ぎた日・7 日後）。7 日たっても払われないとき、運営に「止める」の案が出る。止めるかは人が決める</div>' % MUTED)
ws_page("OpWsBilling.dc.html", "運営 1 社 プランと請求", "bill", body, "プランと請求")

lg = lambda w, who, what, why="": '<div style="display: flex; gap: 12px; align-items: flex-start; padding: 10px 16px; border-top: 1px solid #EDF0F4"><span style="width: 100px; flex: none; font-size: 12px; color: %s">%s</span><span style="flex: 1; min-width: 0"><b style="font-weight: 500">%s</b> %s%s</span></div>' % (MUTED, w, who, what, '<span style="display: block; font-size: 11px; color: %s">%s</span>' % (MUTED, why) if why else "")
body = (ttl("記録", "このワークスペースに運営の誰が何をしたか。消せない・直せない", btn("書き出す"))
  + '<div style="%s; overflow: hidden">' % WHITE
  + lg("11/02 10:12", "高本", "が 中を見た（見るだけ・38 分）", "理由：問い合わせ「承認したのに動かない」・見た画面：チケット 4 件・承認待ち・湊さんの分身の実行の記録")
  + lg("11/02 09:58", "高本", "が 問い合わせを持った")
  + lg("11/01 09:00", "請求", "が 10 月分の請求書を出した ¥16,500", "まとめて出した 46 件のうちの 1 件")
  + lg("10/28 15:20", "佐野", "が 9 月分の入金を記録した ¥16,500", "振込名義 ミナトキカク")
  + lg("04/03 11:05", "高本", "が プランを 無料 → チーム にした", "管理者 湊 さくら さんの頼み（問い合わせから）")
  + '</div><div style="font-size: 12px; color: %s">全社をまたぐ運営の記録の画面は後のフェーズ。いまは 1 社ずつここで見る</div>' % MUTED)
ws_page("OpWsLog.dc.html", "運営 1 社 記録", "log", body, "記録")

# 中を見る（小窓）
s = modal(WP, mhead("中を見る", "OpWs.dc.html", icon("目", NAVY, 28), "合同会社ミナト企画")
  + mbody('<div>' + lab("理由") + field("問い合わせ「承認したのに動かない」（湊 さくら・11/02） ▾") + '<div style="font-size: 11px; color: %s; margin-top: 4px">問い合わせを選ぶか、書く（障害の調べ・請求の確認 など）</div></div>' % MUTED
    + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"><div>' + lab("見る時間") + field("1 時間 ▾") + '</div><div>' + lab("できること") + field("見るだけ（何も変えられない）") + '</div></div>'
    + '<div style="background: #F7F8FA; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: %s">・ 規約で先に許可をもらっているので、顧客に聞かずに開ける<br>・ 誰が・いつ・何を見たか・理由は、運営の記録と顧客のワークスペースの記録の両方に残る<br>・ 預けたログイン情報の値は運営にも見えない<br>・ 見ている間は画面のいちばん上に帯が出る</div>' % MUTED)
  + mfoot(btn("やめる", "", "OpWs.dc.html"), btn("見るだけで開く", "p", "PeekMain.dc.html"), left='<span style="font-size: 12px; color: %s">開く前に本人確認を取り直す（パスキー）</span>' % MUTED), 560, "中を見る")
save("OpPeek.dc.html", "運営 中を見る", s)

# 止める（小窓）
s = modal(WP, mhead("止める", "OpWs.dc.html", icon("■", AMBER, 28), "合同会社ミナト企画 ・ 8 人")
  + mbody('<div>' + lab("理由") + '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + chip("請求が払われない", True) + chip("規約に反する") + chip("先方から頼まれた") + chip("ほか") + '</div></div>'
    + '<div>' + lab("いつ止めるか") + '<div style="display: flex; flex-direction: column; gap: 2px">' + check("先に知らせて、日を決めて止める", True, "管理者に知らせが出る ・ 止める日 11/09（7 日後）") + check("すぐ止める", False, "規約に反する・危ないときだけ") + '</div></div>'
    + '<div>' + lab("管理者への知らせ") + '<div style="border: 1px solid #DDE2E9; border-radius: 6px; padding: 8px 10px; min-height: 64px; font-size: 13px">10 月分の請求書（¥16,500・期限 11/30）のお支払いが確かめられていません。11/09 までに確かめられない場合、ワークスペースを止めます。</div></div>'
    + '<div style="background: #FFF8EE; border: 1px solid #F1D9A8; border-radius: 8px; padding: 10px 12px; font-size: 12px">止めると<br>・ メンバー全員がログインできなくなる（ログインの画面で理由と問い合わせ先が出る）<br>・ 分身の実行も止まる。実行待ちのものは消さずに残す<br>・ チケット・記録・分身の記憶はそのまま残る。再開すれば元に戻る</div>')
  + mfoot(btn("やめる", "", "OpWs.dc.html"), btn("11/09 に止める", "d", "OpWs.dc.html"), left='<span style="font-size: 12px; color: %s">止めるのは「止める」ができる運営の人だけ・記録に残る</span>' % MUTED), 560, "止める")
save("OpStop.dc.html", "運営 止める", s)

# 中を見ている（顧客の画面の上に帯）
s = shell(MAIN, [("チケット", "Main.dc.html"), ("自分に関わるもの", "")], "チケット・ナレッジ・決定を探す")
banner = ('<div role="status" style="position: fixed; top: 0; left: 0; right: 0; height: 36px; z-index: 40; background: #131B27; color: #FFFFFF; display: flex; align-items: center; gap: 12px; padding: 0 16px; font-size: 12px">'
  + '<span style="background: %s; border-radius: 4px; padding: 1px 8px; font-weight: 600">運営として見ています</span><span>合同会社ミナト企画 ・ 湊 さくら さんの画面 ・ 見るだけ（押しても何も変わらない）</span><span style="color: #B8C0CC">理由：問い合わせ「承認したのに動かない」</span>' % AMBER
  + '<span style="margin-left: auto">残り 52 分</span><a href="OpWs.dc.html" style="color: #FFFFFF; border: 1px solid #4A5563; border-radius: 6px; padding: 2px 10px; text-decoration: none">見るのをやめる</a></div>'
  + '<div aria-hidden="true" style="position: fixed; inset: 36px 0 0 0; z-index: 39; pointer-events: none; box-shadow: inset 0 0 0 3px %s"></div>' % AMBER)
s = s.replace('<div data-shell style="', '<div data-shell style="margin-top: 36px; ', 1).replace("</x-dc>", banner + "\n</x-dc>", 1)
save("PeekMain.dc.html", "運営として見ている", s)

# ============ 問い合わせ ============
isub = build("問い合わせの絞り込み", [("", [("OpInbox.dc.html#none", "○", "まだ誰も持っていない", "2", True), ("OpInbox.dc.html", "●", "自分", "3", False), ("OpInbox.dc.html#wait", "…", "返事待ち", "4", False), ("OpInbox.dc.html#later", "◷", "後で", "1", False), ("OpInbox.dc.html#done", "✓", "済み", "", False)]),
    ("種類", [("#", "", "使い方", "", False), ("#", "", "うまく動かない", "", False), ("#", "", "お金・プラン", "", False)])], "OpInbox.dc.html", "返事は顧客の「困ったとき・お知らせ」と画面の知らせに届く")
li = lambda on, who, ws, t, w, st: '<a href="#" style="display: block; padding: 10px 12px; border-bottom: 1px solid #EDF0F4; text-decoration: none; color: #131B27; %s"><span style="display: flex; gap: 6px; font-size: 11px; color: %s"><span>%s ・ %s</span><span style="margin-left: auto">%s</span></span><b style="display: block; font-weight: %s; margin: 2px 0">%s</b>%s</a>' % ("background: #F1F3F6; box-shadow: inset 3px 0 0 %s" % NAVY if on else "", MUTED, who, ws, w, "600" if on else "500", t, st)
lst = ('<div style="width: 300px; flex: none; %s; overflow: hidden; align-self: stretch">' % WHITE
  + '<div style="padding: 10px 12px; border-bottom: 1px solid #EDF0F4; display: flex; align-items: center; gap: 6px"><b>自分</b><span style="font-size: 12px; color: %s">3</span><span style="margin-left: auto; font-size: 12px; color: %s">新しい順 ▾</span></div>' % (MUTED, MUTED)
  + li(True, "湊 さくら", "ミナト企画", "承認したのに動かない", "09:40", pill("うまく動かない") + " " + pill("進行中", "#DCE4F2", NAVY))
  + li(False, "北村 透", "北村デザイン", "請求書の宛名を変えたい", "昨日", pill("お金・プラン") + " " + pill("返事待ち"))
  + li(False, "太田 誠", "オオタ物流", "人数の上限を一時的に増やせるか", "10/30", pill("お金・プラン") + " " + pill("進行中", "#DCE4F2", NAVY)) + '</div>')
msg = lambda who, bg, c, when, body_, note="", inner=False: '<div style="display: flex; gap: 10px">%s<div style="flex: 1; min-width: 0"><div style="font-size: 12px"><b style="font-weight: 600">%s</b> <span style="color: %s">%s</span></div><div style="margin-top: 4px; padding: 10px 12px; border-radius: 10px; %s">%s</div>%s</div></div>' % (av(c, bg, 28), who, MUTED, when, "background: #FFF8EE; border: 1px solid #F1D9A8" if inner else "background: #F7F8FA", body_, '<div style="font-size: 11px; color: %s; margin-top: 4px">%s</div>' % (MUTED, note) if note else "")
thread = ('<div style="flex: 1; min-width: 0; %s; display: flex; flex-direction: column">' % WHITE
  + '<div style="padding: 12px 16px; border-bottom: 1px solid #EDF0F4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><div style="min-width: 0"><b style="font-size: 15px">承認したのに動かない</b><div style="font-size: 12px; color: %s">湊 さくら ・ 合同会社ミナト企画 ・ 11/02 09:40</div></div>' % MUTED
  + '<span style="margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap">' + btn("担当 高本 ▾") + btn("進行中 ▾") + btn("後で ▾") + btn("済みにする", "p") + '</span></div>'
  + '<div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 14px">'
  + msg("湊 さくら", "#186F69", "湊", "09:40", "請求書を送るチケット（KN-212）を承認したのですが、30 分たっても「実行待ち」のままです。PC はつけています。", "付いてきた情報：画面 チケット KN-212 ・ Chrome 130 ・ PC つながっている（09:38 に確認）")
  + msg("高本（運営）", "#131B27", "高", "09:58", "社内メモ：中を見る（見るだけ）で実行の記録を確認。GMAIL_WORK の期限切れで止まっている。本人に預け直してもらえば動く", "社内メモ ・ 先方には見えない", True)
  + '</div>'
  + '<div style="border-top: 1px solid #EDF0F4; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px"><div style="display: flex; gap: 4px">' + chip("返す", True) + chip("社内メモ") + '</div>'
  + '<div style="border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 10px 12px; min-height: 72px">湊さま　お問い合わせありがとうございます。実行の記録を確かめたところ、預けている Gmail のログイン情報（GMAIL_WORK）の期限が切れて止まっていました。右上の顔 › 自分の設定 › 預けたログイン情報 から「預け直す」をお願いします。預け直すと、実行待ちのものがすぐ動きます。</div>'
  + '<div style="display: flex; align-items: center; gap: 8px"><span style="font-size: 12px; color: %s">／ で定型文 ・ ナレッジのページを貼れる</span><span style="margin-left: auto; display: flex; gap: 6px">%s%s</span></div></div></div>' % (MUTED, btn("返して返事待ちにする"), btn("返す", "p")))
iside = ('<aside aria-label="問い合わせのワークスペース" style="width: 280px; flex: none; background: #FFFFFF; border-left: 1px solid #DDE2E9; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box">'
  + '<div style="display: flex; gap: 10px; align-items: center">' + icon("ミ", "#186F69", 32) + two('<b>合同会社ミナト企画</b>', "チーム（仮）・ 8 人") + '</div>'
  + "".join('<div><div style="font-size: 11px; color: %s">%s</div><div>%s</div></div>' % (MUTED, a, b) for a, b in [("送った人", "湊 さくら ・ 管理者"), ("この人の PC", dot("つながっている")), ("止まった実行（7 日）", warn("3 件") + ' <span style="font-size: 12px">ログイン情報の期限 2</span>'), ("請求", ok("払われた")), ("これまでの問い合わせ", "2 件（どちらも済み）")])
  + '<div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #EDF0F4; padding-top: 12px">' + btn("1 社を開く", "", "OpWs.dc.html") + btn("中を見る", "", "OpPeek.dc.html") + '</div></aside>')
page("OpInbox.dc.html", "運営 問い合わせ", [("問い合わせ", ""), ("自分", "")], '<div style="display: flex; gap: 12px; align-items: stretch; flex: 1">' + lst + thread + '</div>', sub=isub, side=iside, pad="16px 16px")

# ============ お知らせ ============
KIND = {"障害": bad("障害"), "メンテ": warn("メンテ"), "リリース": pill("リリース", "#DCE4F2", NAVY)}
body = (ttl("お知らせ", "全部のワークスペースか、選んだワークスペースに出す", btn("＋ お知らせを書く", "p", "OpNoticeNew.dc.html"))
  + '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + chip("すべて", True) + chip("障害") + chip("メンテ") + chip("リリース") + chip("下書き") + '</div>'
  + table(["種類", "題", "誰に", "状態", "出した人"], [
      [KIND["障害"], '<a href="OpNotice.dc.html" style="color: #131B27">分身の実行が遅れています</a>', "全部", dot("原因が分かった ・ 11/02 09:40〜", RED), "高本"],
      [KIND["メンテ"], '<a href="OpNoticeNew.dc.html" style="color: #131B27">11/10（月）2:00〜3:00 メンテナンス</a>', "全部", dot("予定 ・ 11/03 10:00 に出す", AMBER), "高本"],
      [KIND["リリース"], "チケットにスレッドができました", "全部", dot("出した 10/28"), "高本"],
      [KIND["リリース"], "取引先の場所を足しました", "チーム・ビジネス（仮）", dot("出した 10/14"), "佐野"],
      [KIND["リリース"], "ナレッジの取り込み（Obsidian・Notion）", "全部", '<span style="color: #8A94A3">下書き</span>', "佐野"]])
  + '<div style="font-size: 12px; color: %s">顧客には「困ったとき・お知らせ」の一覧に出る。障害とメンテは上の帯にも出て、メンテ中はメンテナンス中の画面になる。メールは、使えなくなるメンテのときだけ各ワークスペースの管理者に届く</div>' % MUTED)
NL = page("OpNotices.dc.html", "運営 お知らせ", [("お知らせ", "")], body)

seg = lambda items, cur: '<div style="display: inline-flex; border: 1px solid #DDE2E9; border-radius: 8px; overflow: hidden">' + "".join('<span style="padding: 6px 14px; font-size: 12px; %s">%s</span>' % ("background: %s; color: #FFFFFF" % NAVY if t == cur else "background: #FFFFFF; color: %s" % MUTED, t) for t in items) + '</div>'
form = ('<div style="flex: 1 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 14px">'
  + card('<div style="display: flex; flex-direction: column; gap: 14px"><div>' + lab("種類") + seg(["リリース", "障害", "メンテ"], "メンテ") + '</div>'
    + '<div>' + lab("題") + field("11/10（月）2:00〜3:00 メンテナンス") + '</div>'
    + '<div>' + lab("本文") + '<div style="border: 1px solid #DDE2E9; border-radius: 6px; padding: 10px 12px; min-height: 110px">データベースの入れ替えのため、11/10（月）2:00〜3:00 の間 Kaname を使えません。<br>・ 実行中の分身の仕事は、始まる前に区切りまで進めて止めます<br>・ この間に承認したものは「実行待ち」になり、終わってから動きます</div></div>'
    + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"><div>' + lab("メンテの時間") + field("11/10 2:00 〜 3:00") + '</div><div>' + lab("影響する部分") + field("画面・分身の実行・PC とのつながり ▾") + '</div></div></div>')
  + card('<div style="display: flex; flex-direction: column; gap: 12px"><div>' + lab("誰に") + '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + chip("全部のワークスペース", True) + chip("プランで選ぶ") + chip("ワークスペースを選ぶ") + '</div></div>'
    + '<div>' + lab("出す場所") + check("お知らせの一覧", True) + check("上の帯（3 日前から・閉じられる）", True) + check("メンテ中はメンテナンス中の画面・ログインの画面にも", True) + check("各ワークスペースの管理者にメールでも届ける（メンテのとき）", True) + '</div>'
    + '<div>' + lab("いつ出すか") + '<div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">' + chip("すぐ") + chip("日を決める", True) + field("11/03 10:00") + '</div></div></div>')
  + '</div>')
prev = ('<div style="flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 10px"><div style="font-size: 12px; color: %s">顧客にはこう見える</div>' % MUTED
  + '<div style="%s; overflow: hidden"><div style="background: #FFF8EE; border-bottom: 1px solid #F1D9A8; padding: 8px 14px; font-size: 12px; display: flex; gap: 8px; align-items: center">%s<span style="flex: 1">11/10（月）2:00〜3:00 はメンテナンスで使えません</span><a href="#">詳しく</a><span style="color: #8A94A3">×</span></div><div style="padding: 10px 14px; font-size: 12px; color: %s">上の帯</div></div>' % (WHITE, warn("メンテ"), MUTED)
  + card('<div style="display: flex; gap: 8px; align-items: center">' + warn("メンテ") + '<b>11/10（月）2:00〜3:00 メンテナンス</b></div><div style="font-size: 12px; color: %s; margin-top: 6px">データベースの入れ替えのため、11/10（月）2:00〜3:00 の間 Kaname を使えません。…</div><div style="font-size: 11px; color: %s; margin-top: 6px">困ったとき・お知らせ の一覧</div>' % (MUTED, MUTED))
  + '<div style="font-size: 12px; color: %s">メンテ中の画面は「はじめて・空・失敗」のメンテナンス中 を見る</div></div>' % MUTED)
body = (ttl("お知らせを書く", "", btn("下書きにする") + btn("11/03 10:00 に出す", "p", "OpNotices.dc.html")) + '<div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start">' + form + prev + '</div>')
page("OpNoticeNew.dc.html", "運営 お知らせを書く", [("お知らせ", "OpNotices.dc.html"), ("お知らせを書く", "")], body)

steps = ["調べている", "原因が分かった", "様子を見ている", "直った"]
upd = lambda w, st, t, who: '<div style="display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid #EDF0F4"><span style="width: 96px; flex: none; font-size: 12px; color: %s">%s</span><span style="flex: 1">%s<div style="margin-top: 4px">%s</div><div style="font-size: 11px; color: %s">%s</div></span></div>' % (MUTED, w, bad(st) if st != "直った" else ok(st), t, MUTED, who)
body = (ttl("分身の実行が遅れています", "障害 ・ 全部のワークスペース ・ 11/02 09:40〜", btn("書き直す") + btn("直ったにする", "p"))
  + '<div style="display: flex; align-items: center; gap: 0; flex-wrap: wrap">' + "".join('<span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 12px; %s">%s%s</span>%s' % ("font-weight: 600; color: %s" % RED if i == 1 else ("color: #131B27" if i < 1 else "color: #8A94A3"), '<span style="width: 18px; height: 18px; border-radius: 99px; display: grid; place-items: center; font-size: 10px; color: #FFFFFF; background: %s">%s</span>' % (RED if i <= 1 else "#B8C0CC", "✓" if i < 1 else i + 1), t, '<span style="color: #B8C0CC">—</span>' if i < 3 else "") for i, t in enumerate(steps)) + '</div>'
  + '<div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start"><div style="flex: 1 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 12px">'
  + card('<b>状態を足す</b><div style="display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0">' + chip("原因が分かった") + chip("様子を見ている", True) + chip("直った") + '</div><div style="border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 10px 12px; min-height: 60px">送る順番の仕組みを入れ替えました。遅れていた実行は順に動いています。様子を見ています。</div><div style="display: flex; margin-top: 10px"><span style="margin-left: auto">%s</span></div>' % btn("足して出す", "p"))
  + card('<b>これまで</b>' + upd("11/02 10:20", "原因が分かった", "送る順番の仕組みが詰まっていました。入れ替えています。データは消えていません。", "高本") + upd("11/02 09:40", "調べている", "分身の実行が始まるまでに時間がかかっています。調べています。", "高本"))
  + '</div><div style="flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 12px">'
  + card('<b>影響する部分</b>' + "".join('<div style="display: flex; padding: 8px 0; border-top: 1px solid #EDF0F4; margin-top: 6px"><span style="flex: 1">%s</span>%s</div>' % (a, b) for a, b in [("画面", dot("ふつう")), ("分身の実行", dot("遅れている", RED)), ("PC とのつながり", dot("ふつう"))]))
  + card('<b>出している場所</b><div style="font-size: 12px; color: %s; margin-top: 6px">お知らせの一覧 ・ 上の帯（直ったら 1 日で消える）・ 困ったとき・お知らせ の稼働状況</div>' % MUTED)
  + '</div></div>')
page("OpNotice.dc.html", "運営 障害のお知らせ", [("お知らせ", "OpNotices.dc.html"), ("分身の実行が遅れています", "")], body)

# ============ 請求 ============
brow = lambda ws, plan, amt, st, paid, act="": [ws, plan, amt, st, paid, act]
body = (ttl("請求", "請求書払い ・ 月末締め 翌月 1 日に出す ・ 月末払い", pill("10 月分は 11/01 に出した（46 件）") + btn("書き出す（CSV）"))
  + '<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">' + field("10 月分（11/01 に出した） ▾") + chip("すべて 46", True) + chip("お支払い待ち 34") + chip("払われた 12") + chip("期限を過ぎた 2（前の月の分）") + '</div>'
  + '<div style="display: flex; gap: 10px; flex-wrap: wrap">' + stat("10 月分", "¥ 1,207,800", "税込 ・ 46 件 ・ 無料は請求なし") + stat("お支払い待ち", "34 件", "期限 11/30 ・ 払われた 12 件") + stat("期限を過ぎた", "¥ 49,500", "2 件 ・ 前の月の分", RED) + '</div>'
  + table(["ワークスペース", "プラン", "金額（税込）", "状態", "入金", ""], [
      brow('<a href="OpWsBilling.dc.html" style="color: #131B27">北村デザイン事務所</a>', "チーム", "¥16,500", bad("9 月分 期限を過ぎた 9 日"), "—", btn("入金を記録", "p", "OpPay.dc.html")),
      brow("株式会社ハル製作所", "チーム", "¥33,000", bad("8・9 月分 未入金 ・ 止めている"), "—", btn("入金を記録", "", "OpPay.dc.html")),
      brow('<a href="OpWsBilling.dc.html" style="color: #131B27">合同会社ミナト企画</a>', "チーム", "¥16,500", pill("出した ・ 期限 11/30"), "—", btn("入金を記録", "", "OpPay.dc.html")),
      brow("株式会社サクラ会計", "ビジネス", "¥44,000", ok("払われた"), "11/01 ・ 佐野"), brow("株式会社オオタ物流", "ビジネス", "¥44,000", ok("払われた"), "11/02 ・ 佐野")])
  + '<div style="font-size: 12px; color: %s">月の初めに、前の月の請求書がまとめて下書きになる（プランの版と人数から）。確かめて「まとめて出す」と、各ワークスペースの請求書の画面と請求先のメールに届く。期限を過ぎたものは前の月の分も上に出す。入金は 1 件ずつ記録する（銀行とつないだ自動の消し込み・カード払いは後のフェーズ）。値段は仮</div>' % MUTED)
BL = page("OpBills.dc.html", "運営 請求", [("請求", "")], body)
s = modal(BL, mhead("入金を記録", "OpBills.dc.html", icon("¥", GREEN, 28), "北村デザイン事務所 ・ 9 月分 ¥16,500（期限 10/31）")
  + mbody('<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"><div>' + lab("入金日") + field("11/02") + '</div><div>' + lab("金額") + field("¥16,500") + '</div></div>'
    + '<div>' + lab("振込名義", "（任意）") + field("キタムラデザイン") + '</div>'
    + '<div style="display: flex; gap: 8px; align-items: center; background: #E3F1E7; border-radius: 8px; padding: 8px 12px; font-size: 12px">%s<span>請求額と同じ → 払われた にする</span></div>' % ok("差 ¥0")
    + '<div style="font-size: 12px; color: %s">足りないときは差を残して「未入金」のまま。多いときは次の請求から引くかを選ぶ。記録すると、顧客の請求書の画面も「払われた」になり、運営の記録に残る</div>' % MUTED)
  + mfoot(btn("やめる", "", "OpBills.dc.html"), btn("記録する", "p", "OpBills.dc.html")), 520, "入金を記録")
save("OpPay.dc.html", "運営 入金を記録", s)

# ============ 配るもの ============
def msub(cur):
    return build("配るもの", [("", [("OpTypes.dc.html", SV % IC["list"], "業務の型と操作", "12", False), ("OpTemplates.dc.html", "形", "ひな形", "4", False), ("OpPlans.dc.html", "¥", "プラン", "3", False)])], cur, "配るものは全部のワークスペースに効く。版で持ち、前の版に戻せる")
body = (ttl("業務の型と操作", "全社向け。顧客には欄と説明だけが見え、中の作りは見えない", btn("＋ 業務の型を上げる", "p", "OpTypeUpload.dc.html"))
  + card('<div style="display: flex; align-items: center; gap: 10px">' + icon("操", "#131B27", 30) + two("<b>ブラウザで操作する</b> v1.4", "汎用の操作 1 つ。初めてのサイトも動かし、うまくいったら動かし方を記録して次から使う") + '<span style="margin-left: auto; display: flex; gap: 6px; align-items: center">' + ok("検査 通った") + btn("版を見る") + '</span></div>')
  + table(["業務の型", "版", "使っているワークスペース", "検査", "最後に出した日", ""], [
      [two("<b style='font-weight: 500'>請求書を送る</b>", "経理"), "v1.3", "31", ok("通った"), "10/30", '<span style="color: #8A94A3">⋯</span>'],
      [two("<b style='font-weight: 500'>問い合わせに返す</b>", "サポート"), "v2.0", "27", ok("通った"), "10/22", '<span style="color: #8A94A3">⋯</span>'],
      [two("<b style='font-weight: 500'>経費の申請</b>", "経理"), "v1.1", "24", ok("通った"), "10/02", '<span style="color: #8A94A3">⋯</span>'],
      [two("<b style='font-weight: 500'>求人の応募文</b>", "採用"), "v0.9", "6", warn("v1.0 が検査で止まった"), "09/18", btn("直す")]])
  + '<div style="font-size: 12px; color: %s">節目①は 全社向けの型を上げる・版を出す まで。会社向けの型・テスト 5 場面の画面・記録した動かし方の一覧は節目②</div>' % MUTED)
TP = page("OpTypes.dc.html", "運営 配るもの 業務の型", [("配るもの", ""), ("業務の型と操作", "")], body, sub=msub("OpTypes.dc.html"))
chk = lambda t, n, okk=True: '<div style="display: flex; gap: 8px; padding: 6px 0; border-top: 1px solid #EDF0F4"><span style="color: %s; width: 16px">%s</span><span style="flex: 1">%s</span><span style="font-size: 12px; color: %s">%s</span></div>' % (GREEN if okk else RED, "✓" if okk else "×", t, MUTED, n)
s = modal(TP, mhead("業務の型を上げる", "OpTypes.dc.html", icon("型", NAVY, 28), "請求書を送る ・ v1.3 → v1.4")
  + mbody('<div style="display: flex; gap: 10px; align-items: center; border: 1px dashed #B8C0CC; border-radius: 8px; padding: 12px">' + icon("zip", "#4A5563", 32) + two("invoice-send-1.4.0.zip", "skill-creator で作った一式 ・ 48 KB") + '<a href="#" style="margin-left: auto; font-size: 12px">選び直す</a></div>'
    + '<div><b style="font-size: 13px">機械の検査</b>' + chk("必須の節（いつ使う・確かめること・書式・注意と禁止・使う操作）", "そろっている") + chk("資格情報・会社や人の名前が入っていない", "0 件") + chk("テスト場面が 5 以上", "6 場面 ・ 全部通った") + chk("版と変更点", "宛名の敬称を直した") + '</div>'
    + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"><div>' + lab("誰に") + field("全部のプラン ▾") + '</div><div>' + lab("今使っているワークスペースには") + field("「新しい版があります」と出す ▾") + '</div></div>'
    + '<div style="font-size: 12px; color: %s">新しく使い始めるワークスペースにはすぐ v1.4 が入る。今使っているところは、そこの権限のある人が切り替えるまで v1.3 のまま。前の版に戻せる</div>' % MUTED)
  + mfoot(btn("やめる", "", "OpTypes.dc.html"), btn("v1.4 を出す", "p", "OpTypes.dc.html"), left='<span style="font-size: 12px; color: %s">検査が通らない一式は出せない</span>' % MUTED), 620, "業務の型を上げる")
save("OpTypeUpload.dc.html", "運営 業務の型を上げる", s)
PTABS = lambda cur: tabs([("now", "いまのプラン", "OpPlans.dc.html"), ("prop", "変える案 1", "OpPlanReview.dc.html"), ("log", "記録", "OpPlanLog.dc.html")], cur)
pl = lambda n, price, rows, cnt, rec=False, note="": '<div style="flex: 1 1 240px; %s; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px%s"><div style="display: flex; align-items: center; gap: 8px"><b style="font-size: 14px">%s</b><span style="margin-left: auto; font-size: 12px; color: %s">v1 ・ %s</span></div><div style="font-size: 18px; font-weight: 700">%s</div>%s%s<div style="margin-top: auto; padding-top: 6px">%s</div></div>' % (WHITE, "; box-shadow: 0 0 0 2px #DCE4F2; border-color: #22345C" if rec else "", n, MUTED, cnt, price, "".join('<div style="display: flex; gap: 8px; font-size: 12px; padding: 4px 0; border-top: 1px solid #EDF0F4"><span style="color: %s; width: 90px; flex: none">%s</span><span>%s</span></div>' % (MUTED, a, b) for a, b in rows), note, btn("変える案を作る", "", "OpPlanEdit.dc.html"))
body = (ttl("プラン", "値段と中身。変えるときは新しい版の案を作り、別の人が決める", btn("＋ プランを足す"))
  + PTABS("now")
  + '<div style="display: flex; gap: 10px; align-items: center; background: #FFF8EE; border: 1px solid #F1D9A8; border-radius: 10px; padding: 8px 14px; font-size: 12px">' + icon("仮", AMBER, 22) + '<span>値段はまだ仮です。決めたら新しい版として出します（顧客の「プランを変える」と請求書に出る値段もここから）</span></div>'
  + '<div style="display: flex; gap: 12px; flex-wrap: wrap">'
  + pl("無料", "¥0", [("人数", "3 人まで"), ("分身の実行", "月 50 回"), ("ファイル", "1 GB"), ("使えるもの", "チケット・承認・ナレッジ")], "21 か所")
  + pl("チーム", '¥15,000 <span style="font-size: 12px; font-weight: 400; color: #4A5563">／月・税別</span>', [("人数", "10 人まで"), ("分身の実行", "人ごとの枠"), ("ファイル", "10 GB"), ("使えるもの", "＋ 取引先・承認の決まり")], "19 か所", True, '<a href="OpPlanReview.dc.html" style="display: flex; gap: 6px; align-items: center; background: #F1F3F6; border-radius: 8px; padding: 6px 10px; font-size: 12px; text-decoration: none; color: #131B27">' + warn("案") + '<span>v2 ¥18,000 ・ 高本さんが決めるのを待っている</span></a>')
  + pl("ビジネス", '¥40,000 <span style="font-size: 12px; font-weight: 400; color: #4A5563">／月・税別</span>', [("人数", "30 人まで"), ("分身の実行", "人ごとの枠（多め）"), ("ファイル", "50 GB"), ("使えるもの", "＋ クライアントの場所・記録の書き出し")], "8 か所")
  + '</div><div style="font-size: 12px; color: %s">変える流れ：「値段の案」ができる人が案を作る → 「値段を決める」ができる別の人が影響を見て決める → いまの顧客へのお知らせが自動で出る → 決めた日に効く。すべて「記録」に残る</div>' % MUTED)
page("OpPlans.dc.html", "運営 配るもの プラン", [("配るもの", ""), ("プラン", "")], body, sub=msub("OpPlans.dc.html"))

# ============ 配るもの › ひな形（D-125.72・A128） ============
body = (ttl("ひな形", "新しいワークスペースが最初に使う形。取り込んだら各ワークスペースで独立して直せる", btn("＋ ひな形を足す"))
  + table(["ひな形", "版", "使い始めたワークスペース", "新しい版を取り込んだ", "最後に出した日", ""], [
      [two("<b style='font-weight: 500'>種別とチケットの形</b>", "タスク・QA・課題・会議 と、種別ごとの欄の並び・必須"), "v3", "48", "31 ／ 46", "10/20", btn("新しい版")],
      [two("<b style='font-weight: 500'>作業の段</b>", "未着手・作業中・確認中・承認待ち・実行中・完了（確認中から先は製品が固定）"), "v2", "48", "48 ／ 48", "09/15", btn("新しい版")],
      [two("<b style='font-weight: 500'>分類の軸</b>", "決まった軸と、よく使う値の例"), "v1", "48", "—", "09/01", btn("新しい版")],
      [two("<b style='font-weight: 500'>層の形</b>", "一人・数人・部署あり の 3 つから選ぶ"), "v1", "48", "—", "09/01", btn("新しい版")]])
  + card('<b>新しい版を出すと</b><div style="font-size: 13px; margin-top: 6px; line-height: 1.8">1. 新しく始めるワークスペースはすぐ新しい版で始まる<br>2. もう使っているワークスペースには「新しい版があります」と知らせが届き、管理者が差分を見て取り込むか選ぶ（D-125.72）<br>3. 取り込まなければ今のまま。各ワークスペースが直したところは消さない</div>')
  + '<div style="font-size: 12px; color: %s">運営が業界ごとに作り込むことはしない。チケットのひな形（終わったチケットを型にする）は作らない（D-126.16）。版を出す前に本人確認を取り直す</div>' % MUTED)
page("OpTemplates.dc.html", "運営 配るもの ひな形", [("配るもの", ""), ("ひな形", "")], body, sub=msub("OpTemplates.dc.html"))

# ============ 運営の人 ============
Y = '<span style="color: %s">✓</span>' % GREEN; N = '<span style="color: #B8C0CC">—</span>'
body = (ttl("運営の人", "運営の場所に入れる人と、できること", btn("＋ 運営の人を足す", "p"))
  + table(["人", "問い合わせ", "中を見る", "お金", "止める", "お知らせ", "配るもの", "値段の案", "値段を決める", "運営の人"], [
      [two('<span style="display: inline-flex; gap: 8px; align-items: center">%s高本 聖斗</span>' % av("高", "#6B5B99", 24), "運営の管理者 ・ パスキー"), Y, Y, Y, Y, Y, Y, Y, Y, Y],
      [two('<span style="display: inline-flex; gap: 8px; align-items: center">%s佐野 美穂</span>' % av("佐", "#186F69", 24), "サポート ・ パスキー"), Y, Y, Y, N, Y, N, Y, N, N],
      [two('<span style="display: inline-flex; gap: 8px; align-items: center">%s木村 直人</span>' % av("木", "#2F4B7C", 24), "お金 ・ パスキー"), N, N, Y, N, N, N, Y, N, N]])
  + '<div style="font-size: 12px; color: %s">運営の人はパスキーでしか入れない。値段は案を作る人と決める人を分ける（自分の案は自分で決められない。「値段を決める」ができる人が 1 人しかいない間だけ、本人確認を取り直して自分で決められる）。「中を見る」「止める」「入金を記録」「値段を決める」の前には本人確認を取り直す。運営の人の操作はすべて、その相手のワークスペースの「記録」に残る</div>' % MUTED)
page("OpTeam.dc.html", "運営 運営の人", [("運営の人", "")], body)


# ============ 値段を変える ============
diff = lambda k, a, b_, chg=True: '<div style="display: flex; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid #EDF0F4; font-size: 13px"><span style="width: 110px; flex: none; color: %s">%s</span><span style="%s">%s</span>%s</div>' % (MUTED, k, "color: #8A94A3; text-decoration: line-through" if chg else "", a, ' <span style="color: #8A94A3">→</span> <b style="font-weight: 600">%s</b>' % b_ if chg else "")
radio = lambda on, t, note="": '<label style="display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid %s; border-radius: 8px; %s"><span style="width: 16px; height: 16px; margin-top: 2px; flex: none; border-radius: 99px; border: %s"></span><span>%s<span style="display: block; font-size: 12px; color: %s">%s</span></span></label>' % (NAVY if on else "#DDE2E9", "box-shadow: 0 0 0 2px #DCE4F2" if on else "", "5px solid %s" % NAVY if on else "1px solid #B8C0CC", t, MUTED, note)
AFF = [["ミナト企画", "8 人", "¥15,000", "2027/2〜 ¥18,000"], ["ENGINE BASE", "5 人", "¥15,000", "2027/2〜 ¥18,000"], ["北村デザイン", "4 人", "¥15,000", "2027/2〜 ¥18,000"], ["ハル製作所", "6 人", "止めている", "再開した月〜"]]
impact = (card('<b>影響</b><div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px">' + stat("いまのチームの顧客", "19 か所", "止めている 1 を含む") + stat("月の売上（税別）", "+ ¥57,000", "2027 年 2 月分から") + stat("新しく入る人", "12/01 から", "¥18,000 で始まる") + '</div>')
  + table(["ワークスペース", "人数", "いま", "変わったあと"], AFF) + '<div style="font-size: 12px; color: %s">ほか 15 か所も同じ（すべて見る・CSV）</div>' % MUTED)
form = ('<div style="flex: 1 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 12px">'
  + card('<b>変えるところ</b>' + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px"><div>' + lab("値段（月・税別）", "いま ¥15,000") + field("¥18,000") + '</div><div>' + lab("人数", "いま 10 人まで") + field("12 人まで") + '</div><div>' + lab("分身の実行") + field("人ごとの枠（変えない）", True) + '</div><div>' + lab("ファイル") + field("10 GB（変えない）", True) + '</div></div>')
  + card('<b>いまの顧客（19 か所）は</b><div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">'
    + radio(True, "お知らせから 90 日たってから新しい値段", "決めた日にお知らせを出し、90 日たった最初の月の分から ¥18,000。日数は変えられる（30 日より短くはできない）" + '<span style="display: inline-flex; gap: 6px; align-items: center; margin-left: 8px">%s</span>' % field("90 日"))
    + radio(False, "ずっと今の値段のまま", "いまの顧客は v1（¥15,000）のまま。新しく入る人だけ ¥18,000。中身の変化（12 人まで）も v1 の顧客には効かない")
    + '<div style="font-size: 12px; color: %s">値下げ・中身を増やすだけの版は、いまの顧客にも次の請求からすぐ効く（この欄は出ない）</div></div>' % MUTED)
  + card('<b>新しく入る人</b><div style="display: flex; gap: 8px; align-items: center; margin-top: 8px">' + chip("決めたらすぐ") + chip("日を決める", True) + field("12/01") + '</div>')
  + card(lab("理由", "必須 ・ お知らせの文のもとにもなる") + '<div style="border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 10px 12px; min-height: 56px">チームの使われ方が増え、人数の上限に当たる会社が多いため。人数を 12 人まで広げ、値段を見直す</div>')
  + '</div>')
body = (ttl("チームの値段を変える案", "v1 → v2 ・ 作る人 佐野", btn("下書きにする") + btn("決める人に回す", "p", "OpPlanReview.dc.html"))
  + '<div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start">' + form + '<div style="flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 12px">' + impact
  + card('<b>決める人</b><div style="margin-top: 6px; display: flex; gap: 8px; align-items: center">%s高本 聖斗<span style="font-size: 12px; color: %s">「値段を決める」ができる人</span></div><div style="font-size: 12px; color: %s; margin-top: 6px">自分の案は自分で決められない</div>' % (av("高", "#6B5B99", 24), MUTED, MUTED)) + '</div></div>')
page("OpPlanEdit.dc.html", "運営 値段を変える案", [("配るもの", ""), ("プラン", "OpPlans.dc.html"), ("チームの値段を変える案", "")], body, sub=msub("OpPlans.dc.html"))

body = (ttl("プラン", "値段と中身。変えるときは新しい版の案を作り、別の人が決める") + PTABS("prop")
  + '<div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start"><div style="flex: 1 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 12px">'
  + card('<div style="display: flex; align-items: center; gap: 8px">' + warn("決める人を待っている") + '<b>チーム v1 → v2</b><span style="margin-left: auto; font-size: 12px; color: %s">佐野 ・ 11/04 16:40 に回した</span></div>' % MUTED
    + diff("値段（月・税別）", "¥15,000", "¥18,000") + diff("人数", "10 人まで", "12 人まで") + diff("分身の実行", "人ごとの枠", "", False) + diff("ファイル", "10 GB", "", False)
    + diff("いまの顧客", "お知らせから 90 日たった最初の月（2027 年 2 月分）から", "", False) + diff("新しく入る人", "12/01 から", "", False)
    + '<div style="font-size: 12px; color: %s; padding-top: 8px; border-top: 1px solid #EDF0F4">理由：チームの使われ方が増え、人数の上限に当たる会社が多いため。人数を 12 人まで広げ、値段を見直す</div>' % MUTED)
  + card('<b>決めると起きること</b><div style="font-size: 13px; margin-top: 6px; line-height: 1.8">1. チーム v2 ができる（v1 は残り、いまの顧客は 2027 年 1 月分まで v1）<br>2. いまの顧客 19 か所の管理者にお知らせが出る（文は下で直せる）。設定の「プランと支払い」にも変わる日と値段が出る<br>3. 12/01 から、新しく入る人と「プランを変える」でチームを選ぶ人は ¥18,000<br>4. 2027 年 2 月分の請求書から ¥18,000（下書きの段で運営が確かめる）</div>')
  + card(lab("お知らせの文", "決めたら出る") + '<div style="border: 1px solid #DDE2E9; border-radius: 8px; padding: 10px 12px; font-size: 13px">チームプランの料金を 2027 年 2 月分から月 ¥18,000（税別）に改めます。あわせて人数の上限を 10 人から 12 人に広げます。それまでは今の料金のままです。ご不明な点は「困ったとき・お知らせ」からお問い合わせください。</div>')
  + '</div><div style="flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 12px">' + impact + '</div></div>'
  + '<div style="display: flex; gap: 8px; align-items: center; background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 10px 14px; flex-wrap: wrap"><span style="font-size: 12px; color: %s; flex: 1">決める前に本人確認を取り直す（パスキー）。決めた人・時刻・理由・前後の値段は「記録」に残り、消せない</span>%s%s</div>' % (MUTED, btn("差し戻す（理由を書く）"), btn("決める", "p", "OpPlanLog.dc.html")))
page("OpPlanReview.dc.html", "運営 値段の案を決める", [("配るもの", ""), ("プラン", "OpPlans.dc.html"), ("変える案", "")], body, sub=msub("OpPlans.dc.html"))

lg2 = lambda w, who, what, why="": '<div style="display: flex; gap: 12px; align-items: flex-start; padding: 10px 16px; border-top: 1px solid #EDF0F4"><span style="width: 100px; flex: none; font-size: 12px; color: %s">%s</span><span style="flex: 1; min-width: 0"><b style="font-weight: 500">%s</b> %s%s</span></div>' % (MUTED, w, who, what, '<span style="display: block; font-size: 11px; color: %s">%s</span>' % (MUTED, why) if why else "")
body = (ttl("プラン", "値段と中身。変えるときは新しい版の案を作り、別の人が決める", btn("書き出す")) + PTABS("log")
  + '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + chip("すべて", True) + chip("無料") + chip("チーム") + chip("ビジネス") + '</div>'
  + '<div style="%s; overflow: hidden">' % WHITE
  + lg2("11/04 16:40", "佐野", "が チーム v2 の案を直して、高本に回した", "値段 ¥20,000 → ¥18,000 ・ 人数 10 → 12 人を足した")
  + lg2("11/04 15:10", "高本", "が チーム v2 の案を差し戻した", "理由：上げ幅が大きい。人数の上限を広げるなら考える")
  + lg2("11/04 11:20", "佐野", "が チーム v2 の案を作った", "¥15,000 → ¥20,000 ・ いまの顧客は 90 日後から")
  + lg2("10/14 09:30", "高本", "が ビジネス v1 の使えるもの に「クライアントの場所」を足した（中身を増やすだけ・すぐ効いた）", "決めた人 佐野 ・ 本人確認 あり")
  + lg2("04/01 10:00", "高本", "が 無料・チーム・ビジネス の v1 を出した", "はじめの値段（運営の人が 1 人だけの間・本人確認を取り直して自分で決めた）")
  + '</div><div style="font-size: 12px; color: %s">消せない・直せない。決めた版は、どのワークスペースがどの版にいるかと一緒に残る</div>' % MUTED)
page("OpPlanLog.dc.html", "運営 プランの記録", [("配るもの", ""), ("プラン", "OpPlans.dc.html"), ("記録", "")], body, sub=msub("OpPlans.dc.html"))

# 顧客の側：値段が変わる知らせ（ワークスペースの設定）
ws = load("WsSettings.dc.html")
old = re.search(r'チーム</span><span style="font-size: 11px; color: #4A5563">10 人まで ・ いま 5 人 ・ 次の請求 12/01 ¥15,000</span>', ws)
assert old, "ws plan row"
ws = ws.replace(old.group(0), 'チーム</span><span style="font-size: 11px; color: #4A5563">10 人まで ・ いま 5 人 ・ 次の請求 12/01 ¥15,000</span><span style="display: flex; gap: 6px; align-items: center; margin-top: 6px; background: #FFF8EE; border: 1px solid #F1D9A8; border-radius: 8px; padding: 6px 10px; font-size: 12px">' + warn("変わる") + '<span>2027 年 2 月分から ¥18,000（税別）・ 人数は 12 人まで に広がる。それまでは今のまま（お知らせ 11/05）</span></span>', 1)
ws = ws.replace("<title>ワークスペース 設定</title>", "<title>ワークスペース 設定（値段が変わる知らせ）</title>")
open(P + "WsPriceChange.dc.html", "w", encoding="utf-8").write(ws); print("WsPriceChange")
# ============ 顧客の側 ============
CB = lambda name, title, crumbs, body, side="": page(name, title, crumbs, body, side=side, ph="チケット・ナレッジ・決定を探す")
nt = lambda k, t, w, b_: '<div style="display: flex; gap: 12px; padding: 12px 16px; border-top: 1px solid #EDF0F4"><span style="width: 70px; flex: none">%s</span><span style="flex: 1; min-width: 0"><b style="font-weight: 500">%s</b><span style="display: block; font-size: 12px; color: %s">%s</span></span><span style="font-size: 12px; color: %s; white-space: nowrap">%s</span></div>' % (KIND[k], t, MUTED, b_, MUTED, w)
body = (ttl("困ったとき・お知らせ", "", btn("問い合わせる", "p", "EdInquiry.dc.html"))
  + '<div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start"><div style="flex: 1 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 10px"><b>お知らせ</b>'
  + '<div style="%s; overflow: hidden">' % WHITE + nt("障害", "分身の実行が遅れています", "11/02 10:20", "原因が分かった ・ 送る順番の仕組みを入れ替えています。データは消えていません")
  + nt("メンテ", "11/10（月）2:00〜3:00 メンテナンス", "11/03", "この間は使えません。承認したものは終わってから動きます") + nt("リリース", "チケットにスレッドができました", "10/28", "チケットごとに人と話して調整できます") + nt("リリース", "取引先の場所を足しました", "10/14", "先方の人を招いて、依頼と検収をやり取りできます") + '</div></div>'
  + '<div style="flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 12px">'
  + card('<b>いまの稼働状況</b>' + "".join('<div style="display: flex; padding: 8px 0; border-top: 1px solid #EDF0F4; margin-top: 6px"><span style="flex: 1">%s</span>%s</div>' % (a, b) for a, b in [("画面", dot("ふつう")), ("分身の実行", dot("遅れている", RED)), ("PC とのつながり", dot("ふつう"))]))
  + card('<b>自分の問い合わせ</b>' + "".join('<a href="MeInquiry.dc.html" style="display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid #EDF0F4; margin-top: 6px; color: #131B27; text-decoration: none"><span style="flex: 1">%s<span style="display: block; font-size: 11px; color: %s">%s</span></span>%s</a>' % (a, MUTED, b, c) for a, b, c in [("PC をつけているのに実行待ちのまま", "11/02 ・ 運営から返事あり", pill("返事あり", "#DCE4F2", NAVY)), ("ナレッジの取り込みの形式", "10/20", pill("済み"))]))
  + card('<b>使い方</b><div style="font-size: 12px; color: %s; margin-top: 6px">分からないことは、まず自分の AI に聞くと早い。キーボードの操作は「?」で出る</div>' % MUTED)
  + '</div></div>')
HP = CB("MeHelp.dc.html", "困ったとき・お知らせ", [("困ったとき・お知らせ", "")], body)
s = modal(HP, mhead("問い合わせる", "MeHelp.dc.html", "", "Kaname の運営に届く。返事はここと画面の知らせに届く")
  + mbody('<div>' + lab("何について") + '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + chip("使い方") + chip("うまく動かない", True) + chip("お金・プラン") + chip("ほか") + '</div></div>'
    + '<div>' + lab("題") + field("PC をつけているのに実行待ちのまま") + '</div>'
    + '<div>' + lab("内容") + '<div style="border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 10px 12px; min-height: 90px">請求書を送るチケット（KN-212）を承認したのですが、30 分たっても「実行待ち」のままです。PC はつけています。</div></div>'
    + '<div style="display: flex; gap: 8px; align-items: center">' + btn("＋ ファイル・画面の写し") + '</div>'
    + check("いま見ている画面の情報を付ける", True, "画面の場所・時刻・ブラウザ・PC がつながっているか。チケットの中身や会話は付けない")
    + '<div style="font-size: 12px; color: %s">運営は、支援と障害の対応のためにワークスペースの中を見ることがあります（利用規約）</div>' % MUTED)
  + mfoot(btn("やめる", "", "MeHelp.dc.html"), btn("送る", "p", "MeHelp.dc.html")), 560, "問い合わせる")
save("EdInquiry.dc.html", "問い合わせる", s)
# 障害の帯
s = MAIN
bar_end = s.index("</span></div>", s.index('class="kn-bar"')) + len("</span></div>")
s = s[:bar_end] + '\n  <div role="status" style="flex: none; background: #FBE4E4; border-bottom: 1px solid #F0C2C2; padding: 8px 24px; font-size: 12px; display: flex; gap: 10px; align-items: center">' + bad("障害") + '<span style="flex: 1">分身の実行が遅れています（11/02 09:40〜）・ 原因が分かった ・ データは消えていません。承認したものは順に動きます</span><a href="MeHelp.dc.html">詳しく</a><span style="color: #8A94A3">×</span></div>' + s[bar_end:]
save("MnIncident.dc.html", "チケット 障害のお知らせの帯", s)

# 自分の問い合わせ（顧客の側）
body = (ttl("PC をつけているのに実行待ちのまま", "うまく動かない ・ 11/02 09:40 に送った", pill("返事あり", "#DCE4F2", NAVY) + btn("解決したので済みにする"))
  + '<div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start"><div style="flex: 1 1 560px; min-width: 0; %s; display: flex; flex-direction: column">' % WHITE
  + '<div style="padding: 16px; display: flex; flex-direction: column; gap: 14px">'
  + msg("高本 聖斗", "#6B5B99", "高", "11/02 09:40", "請求書を送るチケット（EG-128）を承認したのですが、30 分たっても「実行待ち」のままです。PC はつけています。", "付けた情報：画面 チケット EG-128 ・ Chrome 130 ・ PC つながっている（09:38）")
  + msg("Kaname 運営（佐野）", "#131B27", "運", "11/02 10:15", "お問い合わせありがとうございます。実行の記録を確かめたところ、預けている Gmail のログイン情報（GMAIL_WORK）の期限が切れて止まっていました。右上の顔 › 自分の設定 › 預けたログイン情報 から「預け直す」をお願いします。預け直すと、実行待ちのものがすぐ動きます。")
  + '</div><div style="border-top: 1px solid #EDF0F4; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px"><div style="border: 1px solid #DDE2E9; border-radius: 8px; padding: 10px 12px; min-height: 56px; color: %s">返事を書く</div><div style="display: flex; gap: 8px; align-items: center"><span style="font-size: 12px; color: %s">返事は運営の受信箱に届く</span><span style="margin-left: auto; display: flex; gap: 6px">%s%s</span></div></div></div>' % (MUTED, MUTED, btn("＋ ファイル"), btn("送る", "p"))
  + '<div style="flex: 1 1 280px; min-width: 0; display: flex; flex-direction: column; gap: 12px">' + card('<b>すぐできること</b><div style="margin-top: 8px">%s</div>' % btn("預けたログイン情報を開く", "", "MeSecrets.dc.html"))
  + card('<b>この問い合わせ</b><div style="font-size: 12px; color: %s; margin-top: 6px">運営は支援のためにワークスペースの中を見ることがあります（利用規約）。見たときは、誰が・いつ・なぜ見たかがワークスペースの記録に残ります。社内メモは運営の中だけで、ここには出ません</div>' % MUTED) + '</div></div>')
CB("MeInquiry.dc.html", "自分の問い合わせ", [("困ったとき・お知らせ", "MeHelp.dc.html"), ("PC をつけているのに実行待ちのまま", "")], body)
