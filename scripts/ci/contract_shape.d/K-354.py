# K-354 PC がログイン情報を取り出す口の契約の形の表に足す分（K-325 の断片）
# apps/api/src/features/F3/credentials/resolve.ts の parseResolve（無ければ 422）
REQUIRED_INPUTS = {
    "resolveCredential": {"job_id", "credential_id", "destination", "executor_key"},
}
VALUE_RANGES = {
    "resolveCredential": {
        "destination": {"pattern": "\\S", "maxLength": 2048},   # 空・空白だけは 422（名前に読めない・253 字超は口の 403 E-CRED-016）
        "executor_key": {"maxLength": 200, "pattern": "^MCowBQYDK2VuAyEA[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$"},   # X25519 の SPKI の DER 44 バイト（頭の 12 バイトは決まった字）の base64
    },
}
UNEXPRESSIBLE_422: dict = {}   # 形の決まりは VALUE_RANGES に書いた。名前に読めない宛先は形でなく使える場所の外（403 E-CRED-016・代表の答え answer=431fc50df51b・f0f290e785a9）
