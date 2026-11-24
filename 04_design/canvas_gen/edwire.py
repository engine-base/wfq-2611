import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ov import P, wire_buttons
MAP = {
 "RoomKnows": {"直す": "EdRule.dc.html"}, "RoomMemory": {"直す": "EdMemory.dc.html", "＋ 覚えさせる": "EdTeach.dc.html"},
 "CuList": {"＋ 取引先": "EdClient.dc.html"}, "CuShare": {"＋ 先方の人を招く": "EdContact.dc.html"},
 "WsPeople": {"＋ グループ": "EdGroup.dc.html"}, "WsRules": {"＋ 回す決まりを足す": "EdApproval.dc.html"},
 "WsShape": {"＋ 区画を足す": "EdSection.dc.html", "＋ 種別を足す": "EdKind.dc.html"}, "MePC": {"＋ PC をつなぐ": "EdPC.dc.html"},
 "TdMore": {"ほかのグループへ移す": "EdMove.dc.html", "種別を変えるタスク → 依頼 など": "EdTypeChange.dc.html"}, "OvGroup": {"＋ メンバーを足す": "WsInvite.dc.html"}, "Create": {"親チケットを決める": "EdParent.dc.html"}, "WsSettings": {"プランを変える": "EdPlan.dc.html", "消す手続き": "EdDeleteWs.dc.html"}, "MeProfile": {"抜ける": "EdLeaveWs.dc.html"}, "MeLogin": {"足す": "EdPasskey.dc.html"},
}
def txt(h): return re.sub(r"<[^>]+>", "", h).strip()
def firsttime(s):
    for n in ("18", "42", "9"):
        s = s.replace('<span class="kn-lbl" style="margin-left: auto; font-size: 12px; color: #4A5563">%s</span>' % n, '<span class="kn-lbl" style="margin-left: auto; font-size: 12px; color: #4A5563">0</span>')
    s = re.sub(r'<b class="kn-lbl" style="margin-left: auto; font-size: 11px; background: #B45309; color: #FFFFFF; border-radius: 99px; padding: 0 7px">2</b>', '', s)
    s = s.replace('<span style="width: 8px; height: 8px; flex: none; border-radius: 99px; background: #166534"></span><span class="kn-lbl">PC つながっている</span>', '<span style="width: 8px; height: 8px; flex: none; border-radius: 99px; background: #B45309"></span><span class="kn-lbl" style="color: #7A4A05">PC がまだ</span>')
    s = s.replace('title="PC つながっている" style="font-size: 12px; color: #166534;', 'title="PC がまだ" style="font-size: 12px; color: #7A4A05;')
    s = re.sub(r'(<button type="button" aria-label="お?知らせ（3 件）".*?)<b style="position: absolute; top: 2px; right: 2px;[^>]*>3</b>', r'\1', s, flags=re.S)
    return s
def run():
    for name, mp in MAP.items():
        f = P + name + ".dc.html"
        if not os.path.exists(f): continue
        s = open(f, encoding="utf-8").read(); o = s
        s = wire_buttons(s, mp)
        s = re.sub(r'<a href="#"([^>]*)>(.*?)</a>', lambda m: ('<a href="%s"%s>%s</a>' % (mp[txt(m.group(2))], m.group(1), m.group(2))) if txt(m.group(2)) in mp else m.group(0), s, flags=re.S)
        if name == "WsPeople":
            dots = [m.start() for m in re.finditer(r'<span style="color: #8A94A3; width: 16px; text-align: center">⋯</span>', s)]
            L = len('<span style="color: #8A94A3; width: 16px; text-align: center">⋯</span>')
            for i in reversed(dots[2:]):   # 3 人目から（はじめの 2 行は見本のまま）
                s = s[:i] + '<a href="EdMemberMenu.dc.html" style="color: #8A94A3; width: 16px; text-align: center; text-decoration: none">⋯</a>' + s[i + L:]
        if s != o: open(f, "w", encoding="utf-8").write(s)
    for n in ("OnHome", "OnRoom", "OnKnowledge", "OnClients"):
        f = P + n + ".dc.html"
        if os.path.exists(f):
            t = open(f, encoding="utf-8").read(); open(f, "w", encoding="utf-8").write(firsttime(t))
if __name__ == "__main__": run()
