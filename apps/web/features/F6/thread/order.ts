// やり取りの並び（古い順・新しい順）をその端末だけが覚える（K-392・⑮2）。
//   読めない・書けない（私的な窓・保存を止めている）ときは古い順のまま、何も出さない。
import type { Order } from "./views";

export const ORDER_STORE_KEY = "kaname.thread.order";

/** 覚えている並び（無い・読めないときは古い順） */
export function readOrder(): Order {
  try {
    return window.localStorage.getItem(ORDER_STORE_KEY) === "desc" ? "desc" : "asc";
  } catch {
    return "asc";
  }
}

/** 並びを覚える（書けなくても画面は替わる） */
export function writeOrder(order: Order): void {
  try {
    window.localStorage.setItem(ORDER_STORE_KEY, order);
  } catch {
    // 書けない端末では、この画面の間だけ替わる
  }
}
