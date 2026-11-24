import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ov import *
MAIN = open(P + "Main.dc.html", encoding="utf-8").read()
def L(n): return open(P + n + ".dc.html", encoding="utf-8").read()
def after_header(s):
    hb = s.index("<header", s.index('class="kn-bar"')); he = s.index("</header>", hb) + 9
    return he
def replace_content(s, content):
    he = after_header(s); mend = s.rindex("</main>")
    return s[:he] + content + "\n " + s[mend:]
def firsttime(s):
    for n in ("18", "42", "9"):
        s = s.replace('<span class="kn-lbl" style="margin-left: auto; font-size: 12px; color: #4A5563">%s</span>' % n, '<span class="kn-lbl" style="margin-left: auto; font-size: 12px; color: #4A5563">0</span>')
    s = re.sub(r'<b class="kn-lbl" style="margin-left: auto; font-size: 11px; background: #B45309; color: #FFFFFF; border-radius: 99px; padding: 0 7px">2</b>', '', s)
    s = s.replace('<span style="width: 8px; height: 8px; flex: none; border-radius: 99px; background: #166534"></span><span class="kn-lbl">PC つながっている</span>', '<span style="width: 8px; height: 8px; flex: none; border-radius: 99px; background: #B45309"></span><span class="kn-lbl" style="color: #7A4A05">PC がまだ</span>')
    s = s.replace('title="PC つながっている" style="font-size: 12px; color: #166534;', 'title="PC がまだ" style="font-size: 12px; color: #7A4A05;')
    s = re.sub(r'(<button type="button" aria-label="お?知らせ（3 件）".*?)<b style="position: absolute; top: 2px; right: 2px;[^>]*>3</b>', r'\1', s, flags=re.S)
    return s
def empty(icon_m, bg, title, desc, actions, extra=""):
    return ('<div style="background: #FFFFFF; border: 1px dashed #B8C0CC; border-radius: 14px; padding: 36px 28px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center">'
            + icon(icon_m, bg, 48) + '<b style="font-size: 17px">%s</b><div style="font-size: 13px; color: %s; max-width: 460px; line-height: 1.7">%s</div><div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center">%s</div>%s</div>' % (title, MUTED, desc, actions, extra))
chk = lambda done, t, d, href, act: '<div style="display: flex; gap: 12px; align-items: flex-start; padding: 12px 0; border-top: 1px solid #EDF0F4"><span style="width: 22px; height: 22px; flex: none; border-radius: 99px; display: grid; place-items: center; font-size: 12px; %s">%s</span><span style="flex: 1"><b style="font-weight: 600; display: block; %s">%s</b><span style="font-size: 12px; color: %s; line-height: 1.6">%s</span></span>%s</div>' % ("background: #166534; color: #FFFFFF" if done else "border: 2px solid #B8C0CC; box-sizing: border-box", "✓" if done else "", "color: #4A5563; text-decoration: line-through" if done else "", t, MUTED, d, "" if done else btn(act, "p" if t.startswith("PC") else "", href))
todo = ('<aside style="width: 340px; flex: none; display: flex; flex-direction: column; gap: 12px">'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 12px; padding: 14px 16px">'
  + '<div style="display: flex; align-items: center; gap: 8px"><b style="font-size: 15px; flex: 1">はじめにやること</b><span style="font-size: 12px; color: %s">1 ／ 3</span></div>' % MUTED
  + '<div style="height: 6px; border-radius: 99px; background: #EEF0F4; margin: 8px 0 4px"><div style="width: 33%; height: 100%; border-radius: 99px; background: #166534"></div></div>'
  + chk(True, "パスキーを付ける", "登録のときに付けました", "#", "")
  + chk(False, "PC をつなぐ", "分身はあなたの PC で動く。つなぐまで、分身は話すだけで実行はしない", "EdPC.dc.html", "つなぐ")
  + chk(False, "ログイン情報を預ける", "分身に使わせるメール・サービスのログイン。値は誰にも見せない", "MeSecretAdd.dc.html", "預ける")
  + '<div style="font-size: 11px; color: %s; padding-top: 8px">いつでも続きから。全部終わると消える ・ <a href="#">いまは閉じる</a></div></div>' % MUTED
  + '<div style="background: #F7F8FA; border-radius: 12px; padding: 12px 16px; font-size: 12px; line-height: 1.8"><b style="font-weight: 600">いつでもできること</b><br><a href="WsInvite.dc.html">メンバーを招く</a> ・ <a href="KnNew.dc.html">ナレッジのページを書く</a> ・ <a href="WsShape.dc.html">チケットの形を自社に合わせる</a><br><span style="color: %s">はじめは「中小の営業・受託」のひな形（層 3・種別 4・やり方 5）で動いている</span></div>' % MUTED
  + '</aside>')
c = ('\n  <div style="display: flex; gap: 16px; padding: 18px 24px; flex: 1 0 auto; align-items: flex-start; flex-wrap: wrap">'
  + '<div style="flex: 1 1 520px; display: flex; flex-direction: column; gap: 14px">'
  + '<div style="font-size: 15px"><b>ようこそ、高本さん</b><span style="color: %s; font-size: 13px">　株式会社ENGINE BASE のワークスペースができました</span></div>' % MUTED
  + empty("＋", NAVY, "まだチケットはありません", "チケットは仕事の 1 単位。担当・期限・完了の条件を書くと、分身があなたの代わりに進め、確かめてから承認を待つ", btn("＋ チケットを作る", "p", "Create.dc.html") + btn("分身と話して作る", "", "StCreateAi.dc.html"),
          '<div style="font-size: 12px; color: %s; margin-top: 6px">はじめての 1 枚におすすめ：<a href="Create.dc.html">今月の請求書を送る</a> ・ <a href="Create.dc.html">問い合わせに返す</a> ・ <a href="Create.dc.html">見積を作る</a></div>' % MUTED)
  + '</div>' + todo + '</div>')
save("OnHome.dc.html", "はじめて入ったとき", firsttime(replace_content(MAIN, c)))

# 分身の部屋（PC がまだ）
R = L("Room")
he = after_header(R); mend = R.rindex("</main>")
c = ('\n  <div style="padding: 18px 24px; display: flex; flex-direction: column; gap: 14px; max-width: 980px">'
  + '<div style="display: flex; gap: 12px; align-items: center; background: #FFF8EE; border: 1px solid #F1D9A8; border-radius: 12px; padding: 14px 16px">' + icon("PC", "#B45309", 34) + '<span style="flex: 1"><b style="font-weight: 600; display: block">PC がまだつながっていません</b><span style="font-size: 12px; color: %s">分身はあなたの PC で動きます。いまは話すことだけできて、チケットを進める（実行する）ことはできません</span></span>%s</div>' % (MUTED, btn("PC をつなぐ（3 分）", "p", "EdPC.dc.html"))
  + empty("高", "#6B5B99", "高本のAI はまだ何も知りません", "仕事をするたびに、あなたの好み・会社の決まり・やり方を覚えていく。先に教えておくこともできる", btn("話してみる", "", "AiChat.dc.html") + btn("守ることを足す", "", "RoomAddRule.dc.html") + btn("やり方を作る", "", "RoomType.dc.html"),
          '<div style="font-size: 12px; color: %s; margin-top: 4px">ひな形から入っている：守ること 4（ワークスペース）・やり方 5</div>' % MUTED)
  + '</div>')
R2 = firsttime(R[:he] + c + "\n " + R[mend:])
R2 = R2.replace("高本 聖斗 の分身 ・ 高本の MacBook で働く ・ 2026/09/12 から一緒に働いている", "高本 聖斗 の分身 ・ 今日から ・ PC がまだ")
R2 = re.sub(r'<b style="margin-left: 4px; font-size: 11px; background: #6D4AA6; color: #FFFFFF; border-radius: 99px; padding: 0 6px">覚えたい 4</b>', '', R2)
save("OnRoom.dc.html", "分身の部屋（はじめて）", R2)

# ナレッジが空
K = L("KnHome")
a = K.index('<section style="flex: 1; min-width: 0; padding: 22px 28px; display: flex; flex-direction: column; gap: 16px">'); b = K.index("</section>", a) + 10
c = ('<section style="flex: 1; min-width: 0; padding: 22px 28px; display: flex; flex-direction: column; gap: 16px"><h1 style="font-size: 20px; margin: 0">ナレッジ</h1>'
  + empty("本", "#2F4B7C", "まだページはありません", "会社のやり方・手順・決まりを書いておくと、人も分身も毎回聞かずに済む。今あるメモや Wiki を取り込むのがいちばん早い", btn("取り込む（Obsidian・Notion・Markdown）", "p", "KnImport.dc.html") + btn("＋ ページを書く", "", "KnNew.dc.html"),
          '<div style="font-size: 12px; color: %s; margin-top: 4px">チケットが終わるたびに、分身が「ページにしておくとよいこと」を直す案に出す</div>' % MUTED) + '</section>')
K2 = K[:a] + c + K[b:]
K2 = re.sub(r'<aside aria-label="ナレッジの置き場" class="kn-sub".*?</aside>', '', K2, count=1, flags=re.S)
save("OnKnowledge.dc.html", "ナレッジ（はじめて）", firsttime(K2))

# 取引先が空
C = L("CuList")
a = C.index('<section style="flex: 1; min-width: 0; padding: 22px 28px; display: flex; flex-direction: column; gap: 14px">'); b = C.index("</section>", a) + 10
c = ('<section style="flex: 1; min-width: 0; padding: 22px 28px; display: flex; flex-direction: column; gap: 14px"><h1 style="font-size: 20px; margin: 0">取引先</h1>'
  + empty("取", "#186F69", "まだ取引先はありません", "取引先を足すと、その取引先のチケット・依頼・検収・決まり（宛名や締め）が 1 か所に集まる。先方の人を招けば、依頼を出してもらえる", btn("＋ 取引先", "p", "EdClient.dc.html"),
          '<div style="font-size: 12px; color: %s; margin-top: 4px">チケットに書いた会社名から、分身が取引先の候補を出すこともある</div>' % MUTED) + '</section>')
C2 = C[:a] + c + C[b:]
C2 = re.sub(r'<aside aria-label="取引先の中" class="kn-sub".*?</aside>', '', C2, count=1, flags=re.S)
save("OnClients.dc.html", "取引先（はじめて）", firsttime(C2))

# 読み込み中
sk = lambda w, h=12: '<span style="display: block; width: %s; height: %dpx; border-radius: 6px; background: linear-gradient(90deg, #EEF0F4, #F7F8FA, #EEF0F4)"></span>' % (w, h)
rows = "".join('<div style="display: flex; gap: 14px; align-items: center; padding: 14px 12px; border-top: 1px solid #EDF0F4">%s%s%s%s</div>' % (sk("44px", 18), sk("60px"), '<span style="flex: 1">' + sk(w) + '</span>', sk("70px")) for w in ["70%", "55%", "80%", "62%", "48%", "74%"])
c = ('\n  <div style="padding: 18px 24px; display: flex; flex-direction: column; gap: 14px">'
  + '<div style="display: flex; gap: 12px">' + "".join('<div style="flex: 1; background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px">%s%s</div>' % (sk("50%"), sk("30%", 22)) for _ in range(4)) + '</div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; overflow: hidden"><div style="padding: 12px">' + sk("180px", 14) + '</div>' + rows + '</div>'
  + '<div style="font-size: 12px; color: %s">読み込みが 3 秒より長いときだけ「読み込んでいます…」と出す。すぐ読めるときは何も出さない</div></div>' % MUTED)
save("OnLoading.dc.html", "読み込み中", replace_content(MAIN, c))

# 読み込めない・保存できない
c = ('\n  <div style="padding: 18px 24px; display: flex; flex-direction: column; gap: 14px; max-width: 980px">'
  + '<div style="display: flex; gap: 12px; align-items: center; background: #FDF3F3; border: 1px solid #F3C7C7; border-radius: 12px; padding: 14px 16px">' + icon("!", "#B91C1C", 30) + '<span style="flex: 1"><b style="font-weight: 600; display: block">チケットを読み込めませんでした</b><span style="font-size: 12px; color: %s">ネットにつながっていないか、Kaname が混み合っています。書きかけのものはこの PC に残っています</span></span>%s%s</div>' % (MUTED, btn("もう一度", "p"), btn("いまの様子（運営の知らせ）"))
  + '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px">'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 14px 16px; font-size: 13px"><b style="font-weight: 600">ほかの失敗の出し方</b><div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px">'
  + '<div style="display: flex; gap: 8px; align-items: center; border-radius: 8px; background: #131B27; color: #FFFFFF; padding: 8px 12px; font-size: 12px"><span style="flex: 1">保存できませんでした。つながったら自動でもう一度保存します</span><a href="#" style="color: #DCE4F2">いま試す</a></div>'
  + '<div style="display: flex; gap: 8px; align-items: center; border: 1px solid #F1D9A8; background: #FFF8EE; border-radius: 8px; padding: 8px 12px; font-size: 12px"><span style="flex: 1">オフラインです。読むことはできます。書いたものはつながったら送ります</span></div>'
  + '<div style="display: flex; gap: 8px; align-items: center; border: 1px solid #F3C7C7; background: #FDF3F3; border-radius: 8px; padding: 8px 12px; font-size: 12px"><span style="flex: 1">この画面を見る権限がありません。必要なら管理者に頼む</span><a href="#">頼む</a></div>'
  + '<div style="display: flex; gap: 8px; align-items: center; border: 1px solid #DDE2E9; background: #F7F8FA; border-radius: 8px; padding: 8px 12px; font-size: 12px"><span style="flex: 1">ほかの人が先にこのチケットを直しました。比べて選ぶ</span><a href="TdVersions.dc.html">比べる</a></div>'
  + '</div></div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 14px 16px; font-size: 12px; line-height: 1.8"><b style="font-weight: 600; font-size: 13px">失敗の書き方の決まり</b><br>・ 何が起きたか と 次に何をすればよいか を 1 文ずつ<br>・ 書きかけは消えないことを必ず言う<br>・ 自分でどうにもならないものは「いまの様子」へつなぐ<br>・ 中の番号（エラーコード）は小さく末尾に（運営に伝えるとき用）<br>・ 分身の失敗は チケットの「確認で落ちた」・知らせ・承認待ち に出す（専用の画面は作らない）</div>'
  + '</div></div>')
save("OnError.dc.html", "読み込めないとき", replace_content(MAIN, c))
