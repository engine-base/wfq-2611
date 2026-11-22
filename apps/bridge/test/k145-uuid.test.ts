// K-145：Bridge の側の id の確かめを、契約の入口（isUuid＝z.uuid()）と同じ決まりにそろえる（D-129.42）。
//   Bridge は Electron のアプリで workspace の部品を持たないので、同じ文字列の UUID_RE を pairing.ts に 1 つ置き、vault.ts と この PC の印が使う。
//   行 ID は 11_tickets/K-145.md の表。テストはチケットのセッションが書き、実装より先にコミットする（D-128.125）
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CredentialError, withCredential } from "../src/vault";
import { sealedAnswer } from "./fake-kaname-vault";
import { loadMachineId, MACHINE_ID_FILE, UUID_RE } from "../src/pairing";

// 正式な uuid でない値（apps/api/test/k145_uuid_guard.test.ts の BAD_IDS と同じ並び）
const BAD_IDS = [
  "------------------------------------",
  "3fa85f64-5717-0562-b3fc-2c963f66afa6",
  "3fa85f64-5717-4562-b3fc-2c963f66afag",
  "3fa85f64-5717-4562-c3fc-2c963f66afa6",
  "3fa85f64-5717-9562-b3fc-2c963f66afa6",
  "",
  "not-a-uuid",
  "3fa85f64-5717-4562-b3fc-2c963f66afa60",
];
const GOOD_IDS = [
  "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "0193c5a0-5f3e-7c0a-9d4e-0b1a2c3d4e5f",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "3FA85F64-5717-4562-B3FC-2C963F66AFA6",
];
const JOB = "11111111-1111-4111-8111-111111111111";
const CRED = "22222222-2222-4222-8222-222222222222";

let server: Server;
let base = "";
const seen: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push(`${req.url} ${raw}`);
      // K-354：取り出しの答えは封（PC の鍵でしか開けない形）。切る段で替えた（carry）
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: sealedAnswer(JSON.parse(raw) as Record<string, unknown>, {
            login: "me@example.com",
            password: "S3cret-Plain!",
            totp_secret: null,
          }),
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
const deps = () => ({ apiBase: base, sessionId: () => `kpc_${"a".repeat(43)}`, timeoutMs: 2000 });

describe("K-145 Bridge の id の確かめ", () => {
  it("K145-BRG-001 鍵を受け取る：資格情報の id か仕事の id が正式な uuid でない 8 種は notfound「資格情報の指定が正しくありません」で、Kaname を 1 回も呼ばない。正しい v4・v7・nil・max・大文字は呼ぶ。UUID_RE の決まりは契約の isUuid と同じ（違う 8 つは false・正しい 5 つは true）", async () => {
    for (const bad of BAD_IDS) {
      for (const [job, cred] of [
        [JOB, bad],
        [bad, CRED],
      ]) {
        seen.length = 0;
        const p = withCredential(
          deps(),
          { jobId: job, credentialId: cred, destination: "example.com" },
          async () => "使った",
        );
        await expect(p, `job=${JSON.stringify(job)} cred=${JSON.stringify(cred)}`).rejects.toBeInstanceOf(
          CredentialError,
        );
        await p.catch((e: CredentialError) => {
          expect(e.kind).toBe("notfound");
          expect(e.message).toBe("資格情報の指定が正しくありません");
        });
        expect(seen, "Kaname を呼んだ").toEqual([]);
      }
    }
    for (const good of GOOD_IDS) {
      seen.length = 0;
      await expect(
        withCredential(deps(), { jobId: good, credentialId: good, destination: "example.com" }, async (c) => c.login),
      ).resolves.toBe("me@example.com");
      expect(seen.length, good).toBe(1);
      expect(seen[0]).toContain(`"job_id":"${good}"`);
    }
    expect(BAD_IDS.map((v) => UUID_RE.test(v))).toEqual(BAD_IDS.map(() => false));
    expect(GOOD_IDS.map((v) => UUID_RE.test(v))).toEqual(GOOD_IDS.map(() => true));
  });

  it("K145-BRG-002 この PC の印のファイルの中身が 36 個のハイフン・版の桁が 0・形違いなら作り直して正式な uuid を書く。正しい v4 はそのまま読む（大文字は小文字で）", () => {
    for (const bad of ["------------------------------------", "3fa85f64-5717-0562-b3fc-2c963f66afa6", "not-a-uuid"]) {
      const dir = mkdtempSync(join(tmpdir(), "k145-mid-"));
      writeFileSync(join(dir, MACHINE_ID_FILE), `${bad}\n`);
      const id = loadMachineId(dir);
      expect(id, bad).not.toBe(bad);
      expect(id, bad).toMatch(UUID_RE);
      expect(readFileSync(join(dir, MACHINE_ID_FILE), "utf8").trim()).toBe(id);
      expect(loadMachineId(dir), "2 回目も同じ").toBe(id);
    }
    const dir = mkdtempSync(join(tmpdir(), "k145-mid-ok-"));
    writeFileSync(join(dir, MACHINE_ID_FILE), "3FA85F64-5717-4562-B3FC-2C963F66AFA6\n");
    expect(loadMachineId(dir)).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  });
});
