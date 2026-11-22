"""K-638・K-639 の契約の試験の共通の手助け（試験ではない）。契約（08_api/openapi.yaml）の口の入力の形に値が合うかを jsonschema で見る。
OpenAPI 3.0 の nullable: true は、type が在る欄だけ type の並び（… と null）に直してから見る。"""
from __future__ import annotations

import copy
import pathlib

import jsonschema
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
OA = yaml.safe_load((ROOT / "08_api" / "openapi.yaml").read_text(encoding="utf-8"))
SCHEMAS = OA["components"]["schemas"]


def operation(op_id: str) -> dict:
    for methods in OA["paths"].values():
        for op in methods.values():
            if isinstance(op, dict) and op.get("operationId") == op_id:
                return op
    raise KeyError(op_id)


def _plain(node):
    if isinstance(node, list):
        return [_plain(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {k: _plain(v) for k, v in node.items() if k not in ("nullable", "x-required-by", "x-operation")}
    if node.get("nullable") and "type" in node:
        out["type"] = [node["type"], "null"]
    return out


def input_schema(op_id: str) -> dict:
    ref = operation(op_id)["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    return _plain(copy.deepcopy(SCHEMAS[ref.rsplit("/", 1)[1]]))


def fits(op_id: str, body: object) -> bool:
    v = jsonschema.Draft202012Validator(input_schema(op_id), format_checker=jsonschema.FormatChecker())
    return v.is_valid(body)


def response(op_id: str, status: str) -> dict:
    return operation(op_id)["responses"].get(status, {})
