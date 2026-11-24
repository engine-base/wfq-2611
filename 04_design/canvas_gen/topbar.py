import re, os
P = os.environ.get("KANAME_CANVAS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "canvas") + "/"
EG = '<span style="width: 18px; height: 18px; border-radius: 4px; background: #186F69; color: #FFFFFF; font-size: 9px; display: grid; place-items: center; font-weight: 700">EG</span>'
T = ("チケット", "Main.dc.html"); G = (EG + "営業", "Overview.dc.html"); AI = ("高本のAI", "Room.dc.html"); KN = ("知っていること", "RoomKnows.dc.html")
CR = {
 "Main": [T, ("自分に関わるもの", None)], "Overview": [G, ("概要", None)], "List": [G, ("一覧", None)],
 "Calendar": [G, ("カレンダー", None)], "Gantt": [G, ("ガント", None)], "Create": [T, ("作る", None)],
 "StCreateAi": [T, ("作る", None)], "StOverlay": [T, ("自分に関わるもの", None)],
 "TicketDetail": [G, ("一覧", "List.dc.html"), ("EG-128", None)], "StEdit": [G, ("一覧", "List.dc.html"), ("EG-128", None)],
 "StAiPanel": [G, ("一覧", "List.dc.html"), ("EG-128", None)], "StRunning": [G, ("一覧", "List.dc.html"), ("EG-127", None)],
 "StFailed": [G, ("一覧", "List.dc.html"), ("EG-126", None)],
 "Approvals": [("承認待ち", None)], "Room": [AI, ("ようす", None)], "AiChat": [AI, ("話す", None)], "RoomDone": [AI, ("やったこと", None)],
 "RoomKnows": [AI, KN, ("必ず守ること", None)], "RoomAddRule": [AI, KN, ("必ず守ること", None)], "RoomWays": [AI, KN, ("やり方", None)],
 "RoomMemory": [AI, KN, ("覚えていること", None)], "RoomWants": [AI, KN, ("覚えたいこと", None)],
}
SEARCH = '<label style="display: flex; align-items: center; gap: 6px; height: 32px; width: 280px; max-width: 34vw; border: 1px solid #DDE2E9; border-radius: 99px; padding: 0 12px; background: #F7F8FA; color: #4A5563; box-sizing: border-box"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><span style="position: absolute; left: -9999px">探す</span><input type="search" placeholder="チケット・ナレッジ・決定を探す" style="border: 0; background: transparent; flex: 1; font-size: 12px; min-width: 0; font-family: inherit"><span style="border: 1px solid #DDE2E9; border-radius: 4px; padding: 0 4px; font-size: 10px">⌘K</span></label>'
def BELL(active): return ('<button type="button" aria-label="お知らせ（3 件）"%s style="position: relative; width: 36px; height: 36px; border: 0; border-radius: 99px; background: %s; color: %s; display: grid; place-items: center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg><b style="position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; border-radius: 99px; background: #B45309; color: #FFFFFF; font-size: 10px; display: grid; place-items: center">3</b></button>'
    % ((' aria-expanded="true"', "#DCE4F2", "#22345C") if active else ("", "transparent", "#131B27")))
ME = '<button type="button" aria-label="自分のメニュー" style="display: flex; align-items: center; gap: 4px; height: 36px; border: 0; background: transparent; color: #4A5563; padding: 0 4px"><span style="width: 28px; height: 28px; border-radius: 99px; background: #6B5B99; color: #FFFFFF; display: grid; place-items: center; font-size: 12px">高</span>▾</button>'
def bar(name, extra=""):
    parts = []
    for t, h in CR[name]:
        parts.append(('<a href="%s" style="display: inline-flex; align-items: center; gap: 6px; color: #4A5563; text-decoration: none">%s</a>' % (h, t)) if h else '<b style="font-weight: 500; color: #131B27">%s</b>' % t)
    crumbs = '<span style="color: #B8C0CC">›</span>'.join(parts)
    return ('\n  <div class="kn-bar" style="height: 48px; flex: none; background: #FFFFFF; border-bottom: 1px solid #DDE2E9; display: flex; align-items: center; gap: 10px; padding: 0 16px 0 24px; box-sizing: border-box">'
            '<nav aria-label="いまの場所" style="display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; white-space: nowrap; overflow: hidden">%s</nav>'
            '<span style="margin-left: auto; display: flex; align-items: center; gap: 8px">%s%s%s%s</span></div>' % (crumbs, extra, SEARCH, BELL(name == "StOverlay"), ME))
def strip_cluster(h):
    # remove search / bell / me elements from a header
    h = re.sub(r'<label[^>]*>(?:(?!</label>).)*?探す(?:(?!</label>).)*?</label>', '', h, flags=re.S)
    h = re.sub(r'<button type="button" aria-label="(お?知らせ[^"]*|自分のメニュー)".*?</button>', '', h, flags=re.S)
    h = re.sub(r'<span style="display: flex; align-items: center; gap: 6px; height: 32px; width: 280px[^"]*">探す.*?⌘K</span></span>', '', h, flags=re.S)
    h = re.sub(r'<span style="position: relative; width: 36px; height: 36px; border-radius: 99px; background: #DCE4F2[^"]*">.*?</svg></span>', '', h, flags=re.S)
    h = re.sub(r'\s*<span style="width: 28px; height: 28px; border-radius: 99px; background: #6B5B99; color: #FFFFFF; display: grid; place-items: center; font-size: 12px">高</span>(?=\s*</span>)', '', h)
    # drop now-empty clusters
    h = re.sub(r'\s*<span style="(?:margin-left: auto; )?display: flex; gap: 6px; align-items: center[^"]*">\s*</span>', '', h)
    return h
for name in CR:
    f = P + name + ".dc.html"; s = open(f, encoding="utf-8").read()
    if 'class="kn-bar"' in s: print("skip", name); continue
    extra = ""
    mi = s.index("<main"); me = s.index(">", mi) + 1
    mtag = s[mi:me]
    rest = s[me:]
    hm = re.match(r'\s*<header.*?</header>', rest, flags=re.S)
    if hm:
        h = strip_cluster(hm.group(0))
        if name == "TicketDetail": h = ""  # header was only the breadcrumb
        elif name == "StEdit":
            pm = re.search(r'<span style="margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px.*?鈴</span></span>', h, flags=re.S)
            extra = pm.group(0).replace("margin-left: auto; ", "") if pm else ""
            h = ""
        elif name == "StAiPanel":
            h = h.replace('<span style="color: #4A5563">営業 › 一覧 › EG-128</span><b style="margin-left: 8px">', '<b>')
        rest = h + rest[hm.end():]
    if name in ("StFailed", "StRunning"):
        st = re.search(r'style="([^"]*)"', mtag).group(1)
        mtag = '<main style="flex: 1; min-width: 0; display: flex; flex-direction: column">'
        end = rest.rindex("</main>")
        rest = '\n  <div style="%s">%s</div>\n ' % (st.replace("flex: 1; min-width: 0; ", "flex: 1 0 auto; "), rest[:end]) + rest[end:]
    s = s[:mi] + mtag + bar(name, extra) + rest
    open(f, "w", encoding="utf-8").write(s); print("ok", name)
