// 契約（OpenAPI）と生成型。信頼源は 08_api/openapi.yaml。types.ts と registry.ts は scripts/ci/contract.mjs gen が生成する（手で直さない）。
export * from "./types.js";
export { ENDPOINTS, type EndpointDef, type EndpointKind } from "./registry.js";
export type { Ops, OpName } from "./ops.js";
import { z } from "zod";
const UUID = z.uuid();
/** 正式な uuid か（入口の形 z.uuid() と同じ確かめ：版と variant の桁まで見る・D-129.42・K-144）。道の値と問い合わせの確かめに使う */
export const isUuid = (v: string): boolean => UUID.safeParse(v).success;
export * from "./doc.js";
