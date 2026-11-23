import Link from "next/link";
import { MOCKS } from "./mocks";

// 段 13・領域 ops2 の下絵のモックの索引（問い合わせ・お知らせ・請求・配るもの）。1 行 ＝ 1 つの状態
export default function MockF12Ops2Index() {
  return (
    <main className="k-root k-page" aria-labelledby="mock-f12-ops2-title">
      <header className="k-page-head">
        <h1 id="mock-f12-ops2-title">段 13 のモック（運営：問い合わせ・お知らせ・請求・配るもの）</h1>
        <p className="k-desc">本番と同じ部品で並べた運営の画面。幅を変えて見る（375・768・1440）</p>
      </header>
      <section aria-label="運営の状態">
        <h2>運営の状態</h2>
        <ul>
          {MOCKS.map((m) => (
            <li key={m.id}>
              <Link href={`/dev/mock/f12-ops2/${m.id}`}>
                {m.no} {m.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
