import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ov import *
from subnav import build, SV, IC
MAIN = open(P + "Main.dc.html", encoding="utf-8").read()
IC2 = dict(IC)
IC2.update({"user": '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>', "key": '<circle cx="8" cy="15" r="4"></circle><path d="M10.8 12.2 20 3M16 7l3 3"></path>',
  "pc": '<rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8M12 16v4"></path>', "lock": '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
  "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path>'})
def sub(cur):
    return build("自分の設定の中", [("アカウント", [("MeProfile.dc.html", SV % IC2["user"], "プロフィール", "", False), ("MeLogin.dc.html", SV % IC2["lock"], "ログインと安全", "", False)]),
        ("分身", [("MePC.dc.html", SV % IC2["pc"], "PC と使った量", "", False), ("MeSecrets.dc.html", SV % IC2["key"], "預けたログイン情報", "5", False)]),
        ("ワークスペースごと", [("MeNotify.dc.html", SV % IC2["bell"], "お知らせ", "", False)])], cur, "アカウントは 1 人 1 つ。預けたログイン情報とお知らせはワークスペースごと")
def page(name, title, crumb, body, cur=None):
    s = MAIN
    a = s.index('<nav aria-label="いまの場所"'); b = s.index("</nav>", a) + 6
    s = s[:a] + '<nav aria-label="いまの場所" style="display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; white-space: nowrap; overflow: hidden"><a href="MeProfile.dc.html" style="color: #4A5563; text-decoration: none">自分の設定</a><span style="color: #B8C0CC">›</span><b style="font-weight: 500; color: #131B27">%s</b></nav>' % crumb + s[b:]
    bar_end = s.index("</span></div>", s.index('class="kn-bar"')) + len("</span></div>")
    mend = s.rindex("</main>")
    s = s[:bar_end] + '\n  <div style="display: flex; flex: 1 0 auto; min-height: 0">' + sub(cur or name) + '<section style="flex: 1; min-width: 0; padding: 22px 28px; display: flex; flex-direction: column; gap: 14px; max-width: 900px">' + body + '</section></div>\n ' + s[mend:]
    save(name, title, s); return s
def ttl(h, note, act=""): return '<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap"><h1 style="font-size: 20px; margin: 0">%s</h1><span style="font-size: 12px; color: %s">%s</span>%s</div>' % (h, MUTED, note, '<span style="margin-left: auto; display: flex; gap: 6px">%s</span>' % act if act else "")
def blk(t, rows, right=""): return '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px"><div style="display: flex; align-items: center; padding: 12px 0 4px"><b style="font-weight: 600; flex: 1">%s</b>%s</div>%s</div>' % (t, right, "".join('<div style="display: flex; gap: 14px; align-items: center; padding: 12px 0; border-top: 1px solid #EDF0F4; flex-wrap: wrap"><span style="flex: 1 1 240px; min-width: 0"><span style="display: flex; align-items: center; gap: 6px">%s</span><span style="font-size: 11px; color: %s">%s</span></span><span style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">%s</span></div>' % (a, MUTED, b, c) for a, b, c in rows))
def av(c, bg, n=28): return '<span style="width: %dpx; height: %dpx; flex: none; border-radius: 99px; background: %s; color: #FFFFFF; font-size: %dpx; display: grid; place-items: center">%s</span>' % (n, n, bg, n // 2.5, c)
OKP = lambda t: pill(t, "#E8F5EC", "#166534"); WARN = lambda t: pill(t, "#FFF4E0", "#7A4A05"); BAD = lambda t: pill(t, "#FDECEC", "#B91C1C")
sel = lambda v: field(v + " ▾").replace("min-height: 34px", "min-height: 30px")
# ---------- プロフィール ----------
def inp(v, focus=False, w="100%", warn=""):
    st = "border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2" if focus else "border: 1px solid #DDE2E9"
    return '<input value="%s" style="width: %s; max-width: 520px; box-sizing: border-box; height: 36px; %s; border-radius: 8px; padding: 0 10px; font-family: inherit; font-size: 14px; color: #131B27; background: #FFFFFF">' % (v, w, st)
def vrow(label, hint, control, status=""):
    return ('<div style="padding: 12px 0; border-top: 1px solid #EDF0F4; display: flex; flex-direction: column; gap: 6px"><div style="display: flex; align-items: baseline; gap: 8px"><b style="font-weight: 500">%s</b><span style="font-size: 11px; color: %s">%s</span><span style="margin-left: auto; font-size: 11px">%s</span></div>%s</div>' % (label, MUTED, hint, status, control))
SAVED = '<span style="color: #166534">✓ 保存しました</span>'
def vblk(t, rows, note=""): return '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px 6px"><div style="display: flex; align-items: center; padding: 12px 0 4px"><b style="font-weight: 600; flex: 1">%s</b><span style="font-size: 11px; color: %s">%s</span></div>%s</div>' % (t, MUTED, note, "".join(rows))
def profile(name="高本 聖斗", call="高本", focus=False, count=None, status=""):
    cnt = ('<span style="font-size: 11px; color: %s">%s</span>' % (MUTED, count)) if count else ""
    return (vblk("自分", [
        vrow("顔", "ワークスペースのみんなと、自分の分身の部屋に出る", '<div style="display: flex; gap: 10px; align-items: center">' + av(call[0], "#6B5B99", 48) + btn("写真を選ぶ") + btn("文字に戻す") + '<span style="font-size: 11px; color: %s">写真がなければ、呼ばれ方の 1 文字目を出す</span></div>' % MUTED),
        vrow("名前", "正式な名前。長くてもよい（100 文字まで）", '<div style="display: flex; gap: 8px; align-items: center">' + inp(name, focus) + cnt + '</div>', status),
        vrow("呼ばれ方", "狭い所・@ で呼ぶとき・分身が呼ぶときに使う短い名前（20 文字まで）", inp(call, w="240px")),
        vrow("メール", "ログインと知らせに使う。変えると新しいアドレスに確かめのメールが届く", '<div style="display: flex; gap: 8px; align-items: center">' + inp("takamoto@engine-base.example").replace("<input ", "<input readonly ") + btn("変える") + '</div>')],
        "変えたらすぐ保存される（保存のボタンはない）"))
body = (ttl("プロフィール", "アカウント全体に効く")
  + profile()
  + blk("見え方", [("言語", "いまは日本語だけ。ほかの言語はあとで足せる作りにしてある", pill("日本語")), ("見た目", "", chip("明るい", True) + chip("暗い") + chip("PC に合わせる")), ("週のはじめ", "カレンダーとガント", chip("日曜") + chip("月曜", True)), ("時間帯", "", sel("東京（UTC+9）"))])
  + blk("入っているワークスペース", [(icon("E", NAVY, 22) + "株式会社ENGINE BASE", "管理者 ・ 営業", ""), (icon("高", "#6B5B99", 22) + "高本 聖斗（個人）", "自分だけ", ""), (icon("京", "#6D4AA6", 22) + "京蟻システム株式会社", "メンバー", btn("抜ける"))]))
page("MeProfile.dc.html", "自分の設定 プロフィール", "プロフィール", body)
# ---------- 長い名前を直しているところ ----------
LONG = "ヴィクトリア・アレクサンドラ・ファン・デル・ベルク・高本"
prev_row = lambda label, html: '<div style="display: flex; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid #EDF0F4"><span style="width: 120px; flex: none; font-size: 11px; color: %s">%s</span><div style="flex: 1; min-width: 0">%s</div></div>' % (MUTED, label, html)
ell = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis'
preview = ('<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px 10px"><div style="display: flex; align-items: center; padding: 12px 0 4px"><b style="font-weight: 600; flex: 1">ほかの画面での見え方</b><span style="font-size: 11px; color: %s">長い名前でも崩れない</span></div>' % MUTED
  + prev_row("右上の顔・アバター", '<span style="display: inline-flex; gap: 8px; align-items: center">' + av("ヴ", "#6B5B99", 28) + '<span style="font-size: 12px; color: %s">呼ばれ方の 1 文字目</span></span>' % MUTED)
  + prev_row("一覧の担当者（狭い）", '<div style="width: 150px; display: flex; gap: 6px; align-items: center; border: 1px dashed #DDE2E9; padding: 4px 6px; border-radius: 6px">' + av("ヴ", "#6B5B99", 20) + '<span style="%s; font-size: 13px" title="%s">ヴィクトリア</span></div><span style="font-size: 11px; color: %s">狭い所は呼ばれ方。指を乗せると正式な名前が出る</span>' % (ell, LONG, MUTED))
  + prev_row("メンバーの一覧", '<div style="max-width: 360px; display: flex; gap: 8px; align-items: center; border: 1px dashed #DDE2E9; padding: 6px 8px; border-radius: 6px">' + av("ヴ", "#6B5B99", 26) + '<span style="min-width: 0; flex: 1"><span style="display: block; %s">%s</span><span style="font-size: 11px; color: %s">victoria@engine-base.example</span></span></div><span style="font-size: 11px; color: %s">入りきらないところは「…」で切り、全部は指を乗せると出る</span>' % (ell, LONG, MUTED, MUTED))
  + prev_row("やり取り・プロフィール", '<span style="font-size: 13px; line-height: 1.6"><b style="font-weight: 500">%s</b>　折り返して全部出す</span>' % LONG)
  + prev_row("@ で呼ぶ", '<span style="color: #22345C; background: #EEF3FD; border-radius: 4px; padding: 0 4px">@ヴィクトリア</span> <span style="font-size: 11px; color: %s">呼ばれ方を使う</span>' % MUTED)
  + '</div>')
body = (ttl("プロフィール", "アカウント全体に効く")
  + profile(LONG, "ヴィクトリア", True, "%d ／ 100" % len(LONG), SAVED + '<span style="color: %s"> ・ 11:20</span>' % MUTED)
  + preview)
page("MeProfileEdit.dc.html", "自分の設定 名前を直す", "プロフィール", body, "MeProfile.dc.html")
# ---------- ログインと安全 ----------
TFA_OFF = blk("2 段階認証", [("認証アプリ", "入るときに、パスキーやパスワードに加えて、スマホの認証アプリの 6 けたも打つ。付けるかどうかは自由（パスワードだけで入る人は必須）", pill("付けていない") + btn("付ける", "p", "Me2FA.dc.html"))], '<span style="font-size: 11px; color: #4A5563">いまはパスキーで入っているので、付けなくても 2 段階になっている</span>')
TFA_ON = blk("2 段階認証", [("認証アプリ", "1Password ・ 11/02 に付けた ・ 入るたびに 6 けたを打つ", pill("付けている", "#E8F5EC", "#166534") + btn("付け直す", "", "Me2FA.dc.html") + btn("外す", "d")), ("バックアップコード", "端末をなくしたときに使う。1 つ 1 回", pill("残り 10") + btn("作り直す", "", "MeBackup.dc.html"))])
TFA = TFA_OFF
dev = lambda ic, t, sub_, now=False: '<div style="display: flex; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid #EDF0F4"><span style="color: #4A5563">%s</span><span style="flex: 1"><span style="display: block">%s%s</span><span style="font-size: 11px; color: %s">%s</span></span>%s</div>' % (SV % IC2["pc"] if ic == "pc" else '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"></rect><path d="M11 18h2"></path></svg>', t, " " + OKP("この端末") if now else "", MUTED, sub_, "" if now else btn("切る"))
act = lambda when, t, warn=False: '<div style="display: flex; gap: 12px; padding: 8px 0; border-top: 1px solid #EDF0F4; font-size: 13px"><span style="width: 90px; color: %s; font-size: 12px">%s</span><span style="flex: 1; color: %s">%s</span></div>' % (MUTED, when, "#7A4A05" if warn else "#131B27", t)
body = (ttl("ログインと安全", "大事な変更の前には、本人確認を取り直す")
  + '<div style="display: flex; gap: 12px; align-items: center; background: #F1FAF4; border: 1px solid #CDE8D5; border-radius: 10px; padding: 12px 16px">' + icon("✓", "#166534", 28) + '<span style="flex: 1"><b style="font-weight: 600">安全な状態です</b><span style="display: block; font-size: 12px; color: %s">パスキーで入っている ・ 知らない端末なし ・ 最後の確かめ 11/02</span></span></div>' % MUTED
  + blk("入り方", [("パスキー", "指や顔で入る。フィッシングに強い（おすすめ）", OKP("2 つ") + btn("足す")), ("パスワード", "使うなら 12 文字以上。パスキーを持たずパスワードだけで入る人は、2 段階認証が必ず要る", pill("使っていない") + btn("決める", "", "MeTotp.dc.html"))])
  + TFA
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px"><div style="display: flex; align-items: center; padding: 12px 0 4px"><b style="font-weight: 600; flex: 1">パスキー</b></div>'
  + (dev("pc", "MacBook Pro（Touch ID）", "9/12 に作った ・ 最後に使った 今日 09:30") + dev("ph", "iPhone（Face ID）", "9/12 に作った ・ 最後に使った 11/01")).replace(btn("切る"), btn("取り消す")) + '</div>'
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px"><div style="display: flex; align-items: center; padding: 12px 0 4px"><b style="font-weight: 600; flex: 1">入っている端末</b><a href="#" style="font-size: 12px; color: #B91C1C">この端末以外をすべて切る</a></div>'
  + dev("pc", "MacBook Pro ・ Chrome", "東京 ・ いま", True) + dev("ph", "iPhone ・ Kaname アプリ", "東京 ・ 2 時間前") + dev("pc", "Windows ・ Edge", "大阪 ・ 10/30 ・ 覚えがなければ切る") + '<div style="font-size: 11px; color: %s; padding: 8px 0 12px">操作がないと 12 時間で切れ、長くても 7 日で入り直す。場所や端末が急に変わったときも入り直す</div></div>' % MUTED
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px 10px"><div style="padding: 12px 0 4px"><b style="font-weight: 600">最近の安全の記録</b></div>'
  + act("今日 09:30", "MacBook Pro でパスキーで入った") + act("11/02 10:51", "まとめて承認の前に本人確認を取り直した") + act("10/30 18:02", "新しい端末（Windows ・ 大阪）で入った → メールで知らせた", True) + act("10/28 14:00", "ログイン情報 GMAIL_WORK を上書きした") + '</div>')
page("MeLogin.dc.html", "自分の設定 ログインと安全", "ログインと安全", body)
page("MeLogin2FA.dc.html", "自分の設定 2 段階認証を付けている", "ログインと安全", body.replace(TFA_OFF, TFA_ON), "MeLogin.dc.html")
# ---------- PC と使った量 ----------
# MePC の持ち主は k257.py（今の画面に在る操作を描き足した・K-257）。ここで書き直すと描き足しが消えるので書かない
# ---------- 預けたログイン情報 ----------
def sec(name, desc, used, st, dest=""):
    # 使われ方は「これまでに N 回 ・ 最後 MM/DD」の 1 行だけ（代表の答え answer=e34268dbfbac・使うもの・この 1 か月の回数・チケット番号は出さない・K-356）
    d = ('<span style="display: block; font-size: 11px; color: #186F69; margin-top: 2px">使える場所：' + dest + '</span>') if dest else ""
    return ('<div style="display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-top: 1px solid #EDF0F4"><span style="color: #4A5563">' + SV % IC2["key"] + '</span>'
        + '<span style="flex: 1; min-width: 0"><code style="font-size: 13px; font-weight: 600">' + name + '</code><span style="display: block; font-size: 11px; color: ' + MUTED + '">' + desc + '</span>' + d + '</span>'
        + '<span style="width: 170px; font-size: 12px; color: ' + MUTED + '">' + used + '</span><span style="width: 110px">' + st + '</span>'
        + '<span style="display: flex; gap: 6px">' + btn("上書き", "", "MeSecretEdit.dc.html") + btn("消す", "d") + '</span></div>')
body = (ttl("預けたログイン情報", "分身が使うパスワード・鍵・値。名前で呼び、値は誰にも見せない", btn("＋ 預ける", "p", "MeSecretAdd.dc.html"))
  + '<div style="display: flex; gap: 10px; align-items: center; background: #F7F8FA; border-radius: 10px; padding: 10px 14px; font-size: 12px">' + icon("鍵", NAVY, 24) + '<span style="flex: 1; line-height: 1.7">保存した値はあなたにも分身にも見えません。分身は名前で頼むだけで、値を入れるのは PC の実行器です。入れてよいのは「使える場所」だけ。できるのは <b style="font-weight: 600">上書き</b> と <b style="font-weight: 600">消す</b> だけ。</span></div>'
  + '<div style="display: flex; gap: 6px; align-items: center">' + chip("株式会社ENGINE BASE", True) + chip("高本 聖斗（個人）") + chip("京蟻システム") + '<span style="margin-left: auto; font-size: 12px; color: %s">ワークスペースごとに分かれる</span></div>' % MUTED
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; overflow: hidden"><div style="display: flex; gap: 12px; padding: 8px 16px; font-size: 11px; color: %s; background: #FAFBFC"><span style="width: 16px"></span><span style="flex: 1">名前</span><span style="width: 170px">使われ方</span><span style="width: 110px">状態</span><span style="width: 120px"></span></div>' % MUTED
  + sec("GMAIL_WORK", "会社の Gmail（送信用）", "これまでに 18 回 ・ 最後 11/01", OKP("使える"), "mail.google.com ・ smtp.gmail.com")
  + sec("HACCHU_NAVI_LOGIN", "発注ナビのログイン", "これまでに 22 回 ・ 最後 今日", OKP("使える"), "hacchu-navi.example")
  + sec("FREEE_API_KEY", "会計ソフトの API キー", "これまでに 3 回 ・ 最後 10/29", WARN("あと 1 日で期限"), "api.freee.co.jp")
  + sec("SEIKO_PORTAL", "セイコー様の請求書システム（見るだけ）", "これまでに 1 回 ・ 最後 11/01", OKP("使える"), "portal.seiko.example（見るだけ）")
  + sec("MAIL_SIGNATURE", "メールの署名（値）", "これまでに 9 回 ・ 最後 10/31", OKP("使える"))
  + '</div><div style="font-size: 12px; color: %s">ワークスペース全体や層で共有するログイン情報は、ワークスペースの管理 › 設定 で管理者が預ける（自分のものと同じ名前なら、自分のものが先）</div>' % MUTED)
SP = page("MeSecrets.dc.html", "自分の設定 預けたログイン情報", "預けたログイン情報", body)
# ---------- 預ける（小窓） ----------
s = modal(SP, mhead("ログイン情報を預ける", "MeSecrets.dc.html", icon("鍵", NAVY, 28), "保存したら、値は二度と見られない")
  + mbody('<div>' + lab("名前", "（英大文字と _ 。分身はこの名前で頼む）") + field('<code style="font-weight: 600">FREEE_API_KEY</code>') + '</div>'
  + '<div>' + lab("説明", "（任意）") + field("会計ソフトの API キー（11 月に作り直したもの）") + '</div>'
  + '<div>' + lab("値") + '<div style="display: flex; gap: 8px; align-items: center; border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 0 10px; height: 38px"><span style="flex: 1; letter-spacing: 3px; color: #131B27">••••••••••••••••••••••</span><span style="font-size: 11px; color: %s">貼り付けた ・ 40 文字</span></div></div>' % MUTED
  + '<div>' + lab("使える場所", "（この宛先にだけ入れる・送る。ほかの所では使わない）") + '<div style="border: 1px solid #DDE2E9; border-radius: 8px; padding: 6px 8px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center">' + pill("api.freee.co.jp ×", "#E3F1EF", "#186F69") + '<span style="font-size: 12px; color: #4A5563">＋ 足す</span></div><div style="font-size: 11px; color: #4A5563; margin-top: 4px">分身がほかの所で入れようとしたら止めて、あなたに知らせる</div></div>'
  + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"><div>' + lab("使えるワークスペース") + field("株式会社ENGINE BASE ▾") + '</div><div>' + lab("期限", "（任意・近づいたら知らせる）") + field("2027/11/10 ▾") + '</div></div>'
  + '<div style="background: #F7F8FA; border-radius: 8px; padding: 10px 12px; font-size: 12px; display: flex; flex-direction: column; gap: 4px"><span>・ 値はワークスペースごとの鍵で暗号にして保存する。画面にも分身の会話にも出さない</span><span>・ 使えるのはあなたの分身の実行だけ（同じワークスペースのほかの人の分身は使えない）</span><span>・ 入れたあとの画面の写しや文字に値が映ったら、分身に渡す前に隠す</span><span>・ 使ったときは、名前・宛先・時刻だけがチケットの実行の記録に残る</span></div>')
  + mfoot(btn("やめる", "", "MeSecrets.dc.html"), btn("本人確認して保存", "p", "MeSecrets.dc.html"), left='<span style="font-size: 12px; color: %s">保存の前にパスキーで本人確認を取り直す</span>' % MUTED), 560, "ログイン情報を預ける")
save("MeSecretAdd.dc.html", "ログイン情報を預ける", s)
# ---------- 知らせ ----------
CH = ["受け箱（ベル）", "メール（まとめて）"]   # デスクトップ・スマホは後のフェーズ（D-128.92）
def nrow(ev, note, on, lock0=True):
    cells = ""
    for i, v in enumerate(on):
        if i == 0: cells += '<td style="text-align: center; padding: 10px 0; border-top: 1px solid #EDF0F4"><span style="font-size: 11px; color: %s">いつも</span></td>' % MUTED
        else: cells += '<td style="text-align: center; padding: 10px 0; border-top: 1px solid #EDF0F4">%s</td>' % check("", v).replace("padding: 4px 0", "padding: 0; justify-content: center")
    return '<tr><td style="padding: 10px 0; border-top: 1px solid #EDF0F4">%s<span style="display: block; font-size: 11px; color: %s">%s</span></td>%s</tr>' % (ev, MUTED, note, cells)
tbl = ('<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 4px 18px 10px"><table style="border-collapse: collapse; width: 100%"><thead><tr><th style="text-align: left; font-size: 12px; color: #4A5563; font-weight: 500; padding: 10px 0">出来事</th>' + "".join('<th style="font-size: 12px; color: #4A5563; font-weight: 500; width: 96px">%s</th>' % c for c in CH) + '</tr></thead><tbody>'
  + nrow("承認を待っている", "自分が承認する人のとき", [1, 1]) + nrow("@ で呼ばれた・やり取りで知らせる人にされた", "", [1, 1]) + nrow("渡された・配られた", "返事の期限つき", [1, 1])
  + nrow("分身が止まった・落ちて直せない", "PC が切れた・ログイン情報が切れた など", [1, 1]) + nrow("分身が実行を終えた", "やったことは分身の部屋でも見られる", [1, 0])
  + nrow("自分が担当・承認するチケットが動いた", "状態・期限の変化", [1, 0]) + nrow("覚えたいこと・直す案が出た", "分身の部屋・ナレッジ", [1, 0]) + nrow("新しい端末で入った", "安全のため止められない", [1, 1])
  + '</tbody></table><div style="font-size: 11px; color: %s; padding-top: 8px">メールは、受け箱で読んでいないものだけを 30 分ごとにまとめて送る。デスクトップとスマホへの知らせは後のフェーズ</div></div>' % MUTED)
body = (ttl("知らせ", "ワークスペースごとに決める")
  + '<div style="display: flex; gap: 6px; align-items: center">' + chip("株式会社ENGINE BASE", True) + chip("高本 聖斗（個人）") + chip("京蟻システム") + '<a href="#" style="margin-left: auto; font-size: 12px">この設定をほかのワークスペースにも写す</a></div>'
  + tbl
  + blk("静かにする時間", [("夜と休みの日", "このあいだはメールを送らない（受け箱にはたまる）", sel("平日 20:00〜8:00 ・ 土日")), ("いま止める", "", chip("1 時間") + chip("今日いっぱい") + chip("明日の朝まで")), ("止めていても知らせる", "急ぎのものだけ", check("承認を待っている（期限が今日）", True) + check("分身が止まった", True))]))
page("MeNotify.dc.html", "自分の設定 知らせ", "知らせ", body)

# 上書き（ログイン情報）は ID とパスワードを両方入れ直す（代表の答え answer=e34268dbfbac・モック cred-edit と同じ SEIKO_PORTAL・K-356）
s2 = modal(SP, mhead("SEIKO_PORTAL を上書きする", "MeSecrets.dc.html", icon("鍵", NAVY, 28), "前の値は消え、戻せない。見ることもできない")
  + mbody('<div>' + lab("新しいログイン ID", "（パスワードだけを替えるときも、ID とパスワードを両方入れる）") + field("") + '</div>'
  + '<div>' + lab("新しいパスワード") + '<div style="display: flex; gap: 8px; align-items: center; border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 0 10px; height: 38px"><span style="flex: 1; letter-spacing: 3px">••••••••••••</span></div></div>'
  + '<div>' + lab("使える場所") + '<div style="border: 1px solid #DDE2E9; border-radius: 8px; padding: 6px 8px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center">' + pill("portal.seiko.example ×", "#E3F1EF", "#186F69") + '<span style="font-size: 12px; color: #4A5563">＋ 足す</span></div></div>'
  + '<div>' + lab("期限") + field("2027/11/10 ▾") + '</div>'
  + '<div>' + lab("なぜ上書きするか", "（任意・記録に残る）") + field("サービスの側でパスワードを変えたため", True) + '</div>'
  + '<div style="background: #F7F8FA; border-radius: 8px; padding: 10px 12px; font-size: 12px">このあと実行される分から新しい値を使う。いま実行中のもの（なし）はそのまま</div>')
  + mfoot(btn("やめる", "", "MeSecrets.dc.html"), btn("本人確認して上書き", "p", "MeSecrets.dc.html")), 540, "上書きする")
save("MeSecretEdit.dc.html", "ログイン情報を上書きする", s2)
