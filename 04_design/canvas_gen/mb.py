import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ov import *
ML = open(P + "MobileList.dc.html", encoding="utf-8").read()
H0 = ML[:ML.index("</helmet>") + 9]
# MobileList の頭には shellfix.py が足した幅 767 以下の決まり（kn-narrow）がある。写した絵には shellfix.py がもう一度足すので、ここでは外す（2 重にしない）
H0 = re.sub(r"/\* kn-narrow \*/\n(?:@media[^\n]*\n)*", "", H0)
TAIL = '\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":390,"height":844}}\'>\nclass Component extends DCLogic {\n  renderVals() { return {}; }\n}\n</script>\n</body>\n</html>\n'
SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">%s</svg>'
TABS = [("tk", "チケット", "MobileList.dc.html", '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>'), ("ap", "承認", "MbApprovals.dc.html", '<path d="M20 6 9 17l-5-5"></path>'), ("new", "", "MbCreate.dc.html", ""), ("ai", "AI", "MbAI.dc.html", '<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2M20 14h2M15 13v2M9 13v2"></path>'), ("menu", "メニュー", "MbMenu.dc.html", '<path d="M4 6h16M4 12h16M4 18h16"></path>')]
def tabbar(cur):
    out = '<nav aria-label="下のタブ" style="height: 60px; flex: none; border-top: 1px solid #DDE2E9; display: flex; background: #FFFFFF">'
    for k, t, h, ic in TABS:
        if k == "new":
            out += '<a href="%s" aria-label="チケットを作る" style="flex: 1; display: flex; align-items: center; justify-content: center; text-decoration: none"><span style="width: 44px; height: 44px; border-radius: 99px; background: #22345C; color: #FFFFFF; display: grid; place-items: center; font-size: 22px">＋</span></a>' % h
        else:
            on = k == cur
            badge = '<b style="position: absolute; top: 4px; margin-left: 18px; min-width: 16px; height: 16px; border-radius: 99px; background: #B45309; color: #FFFFFF; font-size: 10px; display: grid; place-items: center">9</b>' if k == "ap" else ""
            out += '<a href="%s"%s style="position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 11px; color: %s; text-decoration: none; %s">%s%s%s</a>' % (h, ' aria-current="page"' if on else "", NAVY if on else MUTED, "font-weight: 600" if on else "", SVG % ic, t, badge)
    return out + '</nav>'
# 前は見出しの右に鈴（BELL）を置いた。D-147 で上の帯（MBAR）に移した
_OLD_BELL = '<a href="MbNotify.dc.html" aria-label="お知らせ（3 件）" style="margin-left: auto; width: 44px; height: 44px; display: grid; place-items: center; color: #131B27; position: relative">' + SVG % '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path>' + '<span style="position: absolute; top: 6px; right: 6px; min-width: 16px; height: 16px; border-radius: 99px; background: #B45309; color: #FFFFFF; font-size: 10px; display: grid; place-items: center">3</span></a>'
# スマホの上の帯（D-147・2026-11-18 代表の直し・answer=0a262be577b2）：画面の外枠（components/k/shell.tsx）の幅 767 以下と同じ。
#   高さ 48px・左に会社の印と名前、右に 探す（虫眼鏡）・お知らせ・自分のアイコン。いまの場所と題は出さない（題は本文の h1）。
#   知らせ（鈴）は上の帯だけに置き、本文の見出しの右には置かない（前の決め＝見出しの右の鈴 は D-147 で置き換えた）
MBAR = ('<div class="kn-mbar" style="height: 48px; flex: none; background: #FFFFFF; border-bottom: 1px solid #DDE2E9; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px; box-sizing: border-box">'
        '<span aria-hidden="true" style="width: 24px; height: 24px; flex: none; border-radius: 6px; background: #22345C; color: #FFFFFF; display: grid; place-items: center; font-size: 12px; font-weight: 700">E</span>'
        '<span style="flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; font-weight: 600; color: #131B27">ENGINE BASE</span>'
        '<span style="display: flex; align-items: center">'
        '<button type="button" aria-label="探す" style="width: 44px; height: 44px; border: 0; background: transparent; color: #4A5563; display: grid; place-items: center; cursor: pointer">'
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg></button>'
        '<a href="MbNotify.dc.html" aria-label="お知らせ（3 件）" style="position: relative; width: 44px; height: 44px; display: grid; place-items: center; color: #131B27; text-decoration: none">'
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg>'
        '<b style="position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; border-radius: 9999px; background: #B45309; color: #FFFFFF; font-size: 10px; display: grid; place-items: center">3</b></a>'
        '<a href="TopMe.dc.html" aria-label="自分のメニュー" style="display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 4px; color: #4A5563; text-decoration: none">'
        '<span style="width: 28px; height: 28px; border-radius: 9999px; background: #6B5B99; color: #FFFFFF; display: grid; place-items: center; font-size: 12px">高</span>▾</a>'
        '</span></div>')
def phone(name, title, head, body, cur=None, foot=""):
    s = (H0 + '\n<div style="width: 390px; height: 844px; background: #F2F4F7; display: flex; flex-direction: column; overflow: hidden; position: relative">'
         + MBAR
         + '<div style="background: #FFFFFF; display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px 16px; border-bottom: 1px solid #EDF0F4; flex: none">' + head + '</div>'
         + '<div style="flex: 1; overflow: hidden; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px">' + body + '</div>' + foot + (tabbar(cur) if cur else "") + '</div>' + TAIL)
    save(name, title, s)
card = lambda inner, extra="": '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; padding: 12px 14px; %s">%s</div>' % (extra, inner)
H1 = lambda t, sub="": '<h1 style="font-size: 18px; margin: 0">%s</h1>%s' % (t, '<span style="color: %s; font-size: 13px">%s</span>' % (MUTED, sub) if sub else "")
BACK = lambda href, t: '<a href="%s" style="font-size: 22px; color: #131B27; text-decoration: none; width: 28px">‹</a><b style="font-size: 15px">%s</b>' % (href, t)
# 1 承認
def apc(key, t, why, chk, hum=True):
    return card('<div style="display: flex; gap: 6px; align-items: center; font-size: 11px; color: %s">%s<span>%s</span></div><b style="display: block; font-weight: 600; margin: 4px 0 2px">%s</b><div style="font-size: 12px; color: %s">%s</div>%s<div style="display: flex; gap: 8px; margin-top: 10px">%s%s</div>' % (MUTED, pill(key), why, t, MUTED, chk, ('<div style="margin-top: 6px; font-size: 12px; color: #7A4A05">□ 人が見る項目 1 つ</div>' if hum else ""), '<a href="MbApproveOne.dc.html" style="flex: 1; height: 40px; border: 1px solid #DDE2E9; border-radius: 8px; display: grid; place-items: center; text-decoration: none; color: #131B27; font-size: 13px">中身を見る</a>', '<a href="MbApproveOne.dc.html" style="flex: 1; height: 40px; border-radius: 8px; display: grid; place-items: center; text-decoration: none; background: #22345C; color: #FFFFFF; font-size: 13px">承認する</a>' if not hum else '<span style="flex: 1; height: 40px; border-radius: 8px; display: grid; place-items: center; background: #EEF0F4; color: #8A94A3; font-size: 13px">見てから承認</span>'))
phone("MbApprovals.dc.html", "スマホ 承認", H1("承認", "9 件"),
  '<div style="display: flex; gap: 6px; overflow-x: auto">' + chip("すべて 9", True) + chip("期限が今日 2") + chip("外に出す 3") + '</div>'
  + apc("EG-128", "セイコー様へ 11月分の請求書を送る", "高本のAI が作成 ・ 確認 ①② 通過", "1,716,000 円 ・ 送り先 山田様（CC 鈴木様）")
  + apc("KR-031", "入金の照合（10月分）", "田中のAI ・ 確認 すべて通過", "社内だけ ・ 差異 0 件", False)
  + apc("EG-127", "発注ナビ 応募文 3 本", "高本のAI ・ 確認 すべて通過", "3 社に送る（外に出ると取り消せない）", True)
  + '<a href="MbApproveOne.dc.html" style="height: 44px; border-radius: 10px; display: grid; place-items: center; text-decoration: none; border: 1px solid #22345C; color: #22345C; font-size: 14px; font-weight: 500; background: #FFFFFF">続けて裁く（1 件ずつ）</a>', "ap")
# 2 1件ずつ裁く
phone("MbApproveOne.dc.html", "スマホ 続けて裁く", BACK("MbApprovals.dc.html", "1 ／ 9") + '<span style="margin-left: auto; font-size: 12px; color: %s">期限 今日</span>' % MUTED,
  '<div style="font-size: 11px; color: %s">EG-128 ・ 営業 ・ 高本のAI が作成</div><b style="font-size: 17px">セイコー様へ 11月分の請求書を送る</b>' % MUTED
  + card('<div style="display: flex; gap: 10px; align-items: center">' + icon("P", "#B91C1C", 36) + '<span style="flex: 1"><b style="font-weight: 500; display: block">請求書 No.2026-1101.pdf</b><span style="font-size: 12px; color: %s">1,716,000 円 ・ 1 ページ</span></span><a href="#" style="font-size: 12px">開く</a></div>' % MUTED)
  + card('<b style="font-size: 13px; font-weight: 600">確認の結果</b><div style="font-size: 12px; line-height: 1.9; margin-top: 4px"><span style="color: #166534">✓ 金額が見積の月額と一致（機械）</span><br><span style="color: #166534">✓ インボイスの必須項目（機械）</span><br><span style="color: #166534">✓ 宛名と CC（AI 判定）</span></div>')
  + card('<b style="font-size: 13px; font-weight: 600; color: #7A4A05">あなたが見る項目</b><label style="display: flex; gap: 10px; align-items: center; margin-top: 8px; font-size: 14px"><span style="width: 22px; height: 22px; border-radius: 6px; border: 2px solid #B8C0CC"></span>送る前に PDF を目で見た</label>', "border-color: #F1D9A8; background: #FFF8EE")
  + '<div style="font-size: 12px; color: %s">送り先：経理部 山田様（CC 営業 鈴木様）・ 承認すると分身が送る</div>' % MUTED,
  None, '<div style="background: #FFFFFF; border-top: 1px solid #DDE2E9; padding: 10px 14px 18px; display: flex; gap: 8px; flex: none"><a href="#" style="flex: 1; height: 48px; border: 1px solid #DDE2E9; border-radius: 10px; display: grid; place-items: center; text-decoration: none; color: #B91C1C; font-size: 14px">差し戻す</a><a href="#" style="flex: 2; height: 48px; border-radius: 10px; display: grid; place-items: center; text-decoration: none; background: #B8C0CC; color: #FFFFFF; font-size: 14px; font-weight: 600">見てから承認して送る</a></div>')
# 3 ＋作る
phone("MbCreate.dc.html", "スマホ 作る", BACK("MobileList.dc.html", "チケットを作る"),
  '<div style="font-size: 12px; color: %s">話すか書くだけ。分身がチケットの形にする</div>' % MUTED
  + card('<div style="font-size: 15px; line-height: 1.7">セイコー様に 12 月分の作業報告書を年内に送る。形は 11 月と同じ</div><div style="display: flex; gap: 8px; margin-top: 10px"><span style="width: 40px; height: 40px; border-radius: 99px; background: #FDECEC; color: #B91C1C; display: grid; place-items: center">●</span><span style="font-size: 12px; color: %s; align-self: center">声で入れた ・ 0:09</span></div>' % MUTED)
  + card('<div style="display: flex; gap: 8px; align-items: center">' + icon("AI", NAVY, 22) + '<b style="font-size: 13px; font-weight: 600">高本のAI の案</b></div><div style="display: grid; grid-template-columns: 56px 1fr; gap: 6px; font-size: 13px; margin-top: 8px"><span style="color: %s">題名</span><span>セイコー様 12 月分の作業報告書を送る</span><span style="color: %s">取引先</span><span>セイコー株式会社</span><span style="color: %s">担当</span><span>高本（分身が実行）</span><span style="color: %s">期限</span><span>12/26（金）</span><span style="color: %s">やり方</span><span>作業報告書 v2</span></div><div style="font-size: 12px; color: #7A4A05; margin-top: 8px">完了の条件：11 月分と同じ形・山田様に送る</div>' % (MUTED, MUTED, MUTED, MUTED, MUTED), "border-color: #C9D6EE; background: #F3F6FC")
  + '<div style="display: flex; gap: 8px"><a href="#" style="flex: 1; height: 44px; border: 1px solid #DDE2E9; border-radius: 10px; display: grid; place-items: center; text-decoration: none; color: #131B27; background: #FFFFFF">直す</a><a href="MobileDetail.dc.html" style="flex: 2; height: 44px; border-radius: 10px; display: grid; place-items: center; text-decoration: none; background: #22345C; color: #FFFFFF; font-weight: 600">作る</a></div>', "tk")
# 4 AI
phone("MbAI.dc.html", "スマホ 分身", '<span style="width: 34px; height: 34px; border-radius: 99px; background: #DCE4F2; border: 2px solid #22345C; display: grid; place-items: center; color: #22345C; font-weight: 700">高</span><div><b style="display: block">高本のAI</b><span style="font-size: 11px; color: #166534">● MacBook で動いている</span></div>',
  card('<b style="font-size: 13px; font-weight: 600">いまやっている</b><div style="font-size: 13px; margin-top: 6px">EG-127 発注ナビ 応募文を出す</div><div style="height: 6px; border-radius: 99px; background: #EEF0F4; margin-top: 8px"><div style="width: 60%; height: 100%; background: #22345C; border-radius: 99px"></div></div><div style="font-size: 11px; color: ' + MUTED + '; margin-top: 4px">3 本中 2 本 ・ 3 分前から</div>')
  + card('<div style="display: flex; align-items: center"><b style="font-size: 13px; font-weight: 600; flex: 1">あなたを待っている</b>' + pill("承認 3", "#FCEBD5", "#7A4A05") + '</div><div style="font-size: 12px; color: ' + MUTED + '; margin-top: 4px">EG-128 請求書 ・ KR-031 照合 ・ EG-127 応募文</div>')
  + card('<div style="display: flex; align-items: center"><b style="font-size: 13px; font-weight: 600; flex: 1">覚えたいこと</b>' + pill("4", "#6D4AA6", "#FFFFFF") + '</div><div style="font-size: 12px; margin-top: 6px">セイコー様の見積は 5% 引いた額で出す？</div><div style="display: flex; gap: 6px; margin-top: 8px">' + btn("覚える") + btn("覚えない") + btn("あとで") + '</div>')
  + '<div style="font-size: 12px; color: ' + MUTED + '">知っていること・やったこと はメニューの「高本のAI」から（PC の大きな画面がおすすめ）</div>',
  "ai", '<div style="background: #FFFFFF; border-top: 1px solid #DDE2E9; padding: 8px 12px; flex: none; display: flex; gap: 8px; align-items: center"><span style="flex: 1; height: 40px; border: 1px solid #DDE2E9; border-radius: 99px; padding: 0 14px; display: flex; align-items: center; color: ' + MUTED + '; font-size: 13px">高本のAI と話す（壁打ち）</span><span style="width: 40px; height: 40px; border-radius: 99px; background: #EEF0F4; display: grid; place-items: center">🎙</span></div>')
# 5 メニュー
mrow = lambda ic, t, sub="", href="#", badge="": '<a href="%s" style="display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-top: 1px solid #EDF0F4; text-decoration: none; color: #131B27"><span style="width: 30px; height: 30px; border-radius: 8px; background: #EEF0F4; display: grid; place-items: center; color: #22345C">%s</span><span style="flex: 1"><span style="display: block; font-size: 14px">%s</span>%s</span>%s<span style="color: #B8C0CC">›</span></a>' % (href, ic, t, '<span style="font-size: 11px; color: %s">%s</span>' % (MUTED, sub) if sub else "", badge)
grp = lambda code, bg, t, n: '<a href="MobileList.dc.html" style="display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-top: 1px solid #EDF0F4; text-decoration: none; color: #131B27"><span style="width: 26px; height: 26px; border-radius: 6px; background: %s; color: #FFFFFF; font-size: 10px; display: grid; place-items: center">%s</span><span style="flex: 1; font-size: 14px">%s</span><span style="font-size: 12px; color: %s">%s</span></a>' % (bg, code, t, MUTED, n)
phone("MbMenu.dc.html", "スマホ メニュー", H1("メニュー"),
  '<a href="TopOrg.dc.html" style="display: flex; gap: 10px; align-items: center; background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; padding: 12px 14px; text-decoration: none; color: #131B27">' + icon("E", NAVY, 32) + '<span style="flex: 1"><b style="display: block">株式会社ENGINE BASE</b><span style="font-size: 11px; color: %s">管理者 ・ ワークスペースを切り替える</span></span><span style="color: #B8C0CC">›</span></a>' % MUTED
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; overflow: hidden">' + mrow("本", "ナレッジ", "", "MbKnowledge.dc.html").replace("border-top: 1px solid #EDF0F4; ", "", 1) + mrow("高", "高本のAI の部屋", "知っていること・やったこと", "MbAI.dc.html") + '</div>'
  + '<div style="font-size: 11px; color: %s; padding: 0 4px">グループ</div><div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; overflow: hidden">' % MUTED + grp("EG", "#186F69", "営業", 18).replace("border-top: 1px solid #EDF0F4; ", "", 1) + grp("JD", "#6D4AA6", "受託開発", 42) + grp("KR", "#B45309", "経理", 9) + '</div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; overflow: hidden">' + mrow("設", "自分の設定", "ログイン・PC・お知らせ", "MeProfile.dc.html").replace("border-top: 1px solid #EDF0F4; ", "", 1) + mrow("管", "ワークスペースの管理", "管理者だけ", "WsPeople.dc.html") + '</div>'
  + '<div style="font-size: 12px; color: #166534; padding: 0 4px">● PC（MacBook）がつながっている</div>', "menu")
# 6 知らせ
nrow = lambda ini, bg, t, sub, tag, tc, unread=True: '<div style="display: flex; gap: 10px; padding: 12px 14px; border-top: 1px solid #EDF0F4; background: %s"><span style="width: 32px; height: 32px; flex: none; border-radius: 99px; background: %s; color: #FFFFFF; font-size: 12px; display: grid; place-items: center">%s</span><span style="flex: 1; min-width: 0"><span style="display: block; font-size: 13px; line-height: 1.6">%s</span><span style="font-size: 11px; color: %s">%s</span></span><span style="align-self: flex-start; flex: none">%s</span></div>' % ("#FFFFFF" if unread else "#F7F8FA", bg, ini, t, MUTED, sub, pill(tag, *tc))
phone("MbNotify.dc.html", "スマホ お知らせ", BACK("MobileList.dc.html", "お知らせ") + '<a href="#" style="margin-left: auto; font-size: 12px">すべて既読</a>',
  '<div style="display: flex; gap: 6px">' + chip("未読 3", True) + chip("すべて") + chip("@ 1") + '</div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; overflow: hidden">'
  + nrow("AI", "#4A5563", "EG-128 の確認が終わり、あなたの承認を待っています", "4 時間前", "承認", ("#FCEBD5", "#7A4A05")).replace("border-top: 1px solid #EDF0F4; ", "", 1)
  + nrow("佐", "#186F69", "佐藤さんが EG-128 に書き込みました（期限を 11/02 に）", "10:41", "書き込み", ("#EEF0F4", MUTED))
  + nrow("佐", "#186F69", "佐藤さんが EG-119 を渡しました。返事の期限 11/03", "1 時間前", "受ける？", ("#FFF4E0", "#7A4A05"))
  + nrow("AI", "#4A5563", "EG-127 が止まりました：発注ナビの画面が変わっていた", "昨日", "止まった", ("#FDECEC", "#B91C1C"), False)
  + nrow("運", "#22345C", "11/10 2:00〜3:00 メンテナンス", "昨日", "運営", ("#EEF0F4", MUTED), False) + '</div>', "tk")
# 7 チケットのやり取り（スマホ）
msg = lambda ini, bg, who, when, t, chg="": '<div style="display: flex; gap: 10px"><span style="width: 28px; height: 28px; flex: none; border-radius: 99px; background: %s; color: #FFFFFF; font-size: 11px; display: grid; place-items: center">%s</span><div style="flex: 1; min-width: 0"><div style="font-size: 12px"><b style="font-weight: 600">%s</b> <span style="color: %s">%s</span></div><div style="font-size: 14px; line-height: 1.7">%s</div>%s</div></div>' % (bg, ini, who, MUTED, when, t, ('<div style="margin-top: 4px">%s</div>' % "".join(pill(c) + " " for c in chg.split("|"))) if chg else "")
phone("MbTalk.dc.html", "スマホ やり取り", BACK("MobileDetail.dc.html", "EG-128 のやり取り"),
  '<div style="display: flex; gap: 0; border-bottom: 1px solid #DDE2E9; margin: -12px -14px 0; background: #FFFFFF"><a href="MobileDetail.dc.html" style="flex: 1; text-align: center; padding: 10px; color: #4A5563; text-decoration: none; font-size: 13px">本文</a><a href="#" style="flex: 1; text-align: center; padding: 10px; color: #22345C; border-bottom: 2px solid #22345C; text-decoration: none; font-size: 13px; font-weight: 600">やり取り 1</a><a href="#" style="flex: 1; text-align: center; padding: 10px; color: #4A5563; text-decoration: none; font-size: 13px">高本のAI</a></div>'
  + msg("鈴", "#2F4B7C", "鈴木 一郎", "10:20", "10/19 の追加対応は先方の都合で無償にした件、反映が要るかもしれません。<span style=\"color: #22345C\">@高本</span> さん確認お願いします", "未決事項に足した")
  + '<div style="font-size: 12px; color: %s; padding-left: 38px">高本のAI が請求書を作り、確認を流した ・ 通った</div>' % MUTED
  + msg("佐", "#186F69", "佐藤 花子", "10:41", "無償で合意済みなら外してOKです。今日中に出せると助かります", "期限：11/01 → 11/02|優先度：中 → 高"),
  None, '<div style="background: #FFFFFF; border-top: 1px solid #DDE2E9; padding: 8px 12px 16px; flex: none"><div style="display: flex; gap: 6px; margin-bottom: 6px; font-size: 12px"><span style="border: 1px solid #DDE2E9; border-radius: 99px; padding: 2px 10px">状態 変えない ▾</span><span style="border: 1px solid #DDE2E9; border-radius: 99px; padding: 2px 10px">知らせる 佐藤・鈴木</span></div><div style="display: flex; gap: 8px; align-items: center"><span style="flex: 1; min-height: 40px; border: 1px solid #22345C; border-radius: 20px; padding: 8px 14px; font-size: 14px">了解です。外して今日中に送ります</span><span style="width: 40px; height: 40px; border-radius: 99px; background: #22345C; color: #FFFFFF; display: grid; place-items: center">↑</span></div></div>')
# 既存の 2 枚の下のタブをつなぐ
for n in ("MobileList", "MobileDetail"):
    f = P + n + ".dc.html"; s = open(f, encoding="utf-8").read()
    s = re.sub(r'<nav aria-label="下のタブ".*?</nav>', tabbar("tk"), s, count=1, flags=re.S)
    # スマホの上の帯（D-147）を外枠の 1 行目に置き、見出しの右の鈴を外す（何度流しても 1 回だけ）
    if 'class="kn-mbar"' not in s:
        i = s.index(">", s.index("<div", s.index("</helmet>"))) + 1
        s = s[:i] + "\n " + MBAR + s[i:]
    s = re.sub(r'\n  <a href="StOverlay\.dc\.html" aria-label="お?知らせ（3 件）".*?</a>', "", s, count=1, flags=re.S)
    open(f, "w", encoding="utf-8").write(s)

# スマホ：ナレッジ
kp = lambda t, sub_, badge="": '<a href="KnPage.dc.html" style="display: block; padding: 12px 14px; border-top: 1px solid #EDF0F4; text-decoration: none; color: #131B27"><b style="font-weight: 500">%s</b>%s<span style="display: block; font-size: 12px; color: %s">%s</span></a>' % (t, " " + badge if badge else "", MUTED, sub_)
phone("MbKnowledge.dc.html", "スマホ ナレッジ", H1("ナレッジ"),
  '<div style="display: flex; gap: 8px; align-items: center; background: #FFFFFF; border: 1px solid #22345C; border-radius: 12px; padding: 0 14px; height: 46px"><span style="color: %s">⌕</span><span style="font-size: 14px">請求書の送り方は？</span></div>' % MUTED
  + card('<div style="font-size: 12px; color: %s">答え（出典つき）</div><div style="font-size: 14px; line-height: 1.7; margin-top: 4px">毎月 25 日締めで翌月 1 日に請求書を作り、PDF をメールで送る。宛名と CC は取引先ごとの決まりに従う。</div><div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px">%s%s</div>' % (MUTED, pill("請求のルール ・ 版 4"), pill("取引先ごとの宛名の決め方")))
  + '<div style="display: flex; gap: 6px">' + chip("最近見た", True) + chip("自分が持ち主") + chip("確かめ期限 2") + '</div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; overflow: hidden">' + kp("請求のルール", "ワークスペース全体 ・ 請求 ・ 版 4").replace("border-top: 1px solid #EDF0F4; ", "", 1) + kp("取引先ごとの宛名の決め方", "請求 ・ 版 2") + kp("経理の月次の流れ", "ワークスペース全体 ・ 版 5", pill("確かめ期限", "#FCEBD5", "#7A4A05")) + kp("営業の進め方", "営業 ・ 版 3") + '</div>'
  + '<div style="font-size: 12px; color: %s">スマホでは読む・探す・確かめる まで。書く・直すは PC で（ページを開くと同じ作りが縦に並ぶ）</div>' % MUTED, "menu")
# スマホ：取引先
cr = lambda m, bg, n, sub_, right: '<a href="CuPage.dc.html" style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-top: 1px solid #EDF0F4; text-decoration: none; color: #131B27"><span style="width: 32px; height: 32px; flex: none; border-radius: 8px; background: %s; color: #FFFFFF; display: grid; place-items: center; font-weight: 700; font-size: 13px">%s</span><span style="flex: 1; min-width: 0"><b style="font-weight: 500; display: block">%s</b><span style="font-size: 12px; color: %s">%s</span></span>%s</a>' % (bg, m, n, MUTED, sub_, right)
phone("MbClients.dc.html", "スマホ 取引先", H1("取引先"),
  '<a href="CuRequests.dc.html" style="display: flex; gap: 10px; align-items: center; background: #FFF8EE; border: 1px solid #F1D9A8; border-radius: 12px; padding: 12px 14px; text-decoration: none; color: #131B27"><b style="flex: 1; font-weight: 600">届いた依頼 3 件</b><span style="font-size: 12px; color: #7A4A05">さばく ›</span></a>'
  + '<div style="display: flex; gap: 6px">' + chip("すべて 6", True) + chip("自分が担当 3") + chip("検収待ち 2") + '</div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; overflow: hidden">'
  + cr("セ", "#186F69", "セイコー株式会社", "動いている 4 ・ 今日 10:20", pill("依頼 1", "#FCEBD5", "#7A4A05")).replace("border-top: 1px solid #EDF0F4; ", "", 1)
  + cr("京", "#6D4AA6", "京蟻システム株式会社", "動いている 7 ・ 昨日", pill("依頼 2", "#FCEBD5", "#7A4A05"))
  + cr("ミ", "#B45309", "合同会社ミナト", "動いている 1 ・ 10/30", pill("検収待ち 1"))
  + cr("ソ", "#2F4B7C", "株式会社ソラ", "動いている 2 ・ 10/28", "") + '</div>'
  + '<div style="font-size: 12px; color: %s">スマホでは いま・依頼をさばく・検収を頼む まで。取引先を足す・決まりを直すは PC で</div>' % MUTED, "menu")
