# K-434 確認項目を読む・足す口（listTestSpecs・createTestSpec）の契約の形の表に足す分（K-325 の断片）
#   必須の欄（題名）と値域（題名）だけ。残りの表は空（登録先の決まりがチケットごとの住所を求める）
REQUIRED_INPUTS = {
    "createTestSpec": {"title"},
}
NO_REQUIRED_INPUTS = {}
PATH_PATTERNS = {}
VALUE_RANGES = {
    "createTestSpec": {
        "title": {"pattern": "\\S", "maxLength": 200},
    },
}
UNEXPRESSIBLE_422 = {}
AGENT_ANSWERS = {}
