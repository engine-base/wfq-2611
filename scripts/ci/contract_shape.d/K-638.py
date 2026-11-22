# K-638 認証の口の契約の形の表に足す分の写し（05_flow/screen_api.d/K-638.py と同じ言葉・K144-SHAPE-023 が契約と突き合わせる）
VALUE_RANGES = {
    "requestPasswordReset": {"email": {"pattern": "^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$"}},
    "requestAdminRecovery": {"pending": {"pattern": "\\S"}},
}
