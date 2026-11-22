# K-638 認証の口の契約の形に足す分（契約 fuzz G36 の ST202：形どおりの入力が断られた・K-424 が入口の上限 429 を外して出た）
# 口の振る舞い（apps/api/src/features/F1/…）が 422 で断る形の誤りは、契約に書く。契約と口を同じ形にする（控え帳 2026-11-20 16:51）
_EMAIL = "^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$"   # 登録（createSignup）と同じ。NFKC で直し空白を全部除いた後に EMAIL_RE で見る口より狭く書く（全角・途中の空白は契約の外）
VALUE_RANGES = {
    "requestPasswordReset": {"email": {"pattern": _EMAIL}},   # apps/api/src/features/F1/password-reset/index.ts（形違いは 422 E-VAL-004）
    "requestAdminRecovery": {"pending": {"pattern": "\\S"}},   # apps/api/src/features/F1/admin-recovery/index.ts（空・空白だけは 422 欄 pending）
}
# 前からある鍵（signInWithPassword・verifySignInCode）の値域の表は K-639 が掃除する（表の写しを持つ試験 contract_shape_test.py を 1 本の葉だけが運ぶため）。ここでは INPUT_RULES で足す
INPUT_RULES = {
    "signInWithPassword": {"allOf": [{"properties": {"email": {"pattern": _EMAIL}}}]},   # apps/api/src/features/F1/login/sign-in.ts（形違いは 422 E-VAL-004）
    "verifySignInCode": {
        "allOf": [{"properties": {"pending": {"pattern": "\\S"}}}],   # 待ちの印が空・空白だけは 422 欄 pending
        # code と backup_code は、どちらか 1 つだけが文字で来る（null・数・真偽は 422。無い・両方も 422）。口の前処理 sign-in-code.ts の input と同じ
        "oneOf": [
            {"required": ["code"], "properties": {"code": {"type": "string"}}, "not": {"required": ["backup_code"]}},
            {"required": ["backup_code"], "properties": {"backup_code": {"type": "string"}}, "not": {"required": ["code"]}},
        ],
    },
}
