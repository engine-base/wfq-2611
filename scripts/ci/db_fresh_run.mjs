#!/usr/bin/env node
// 手元では使い捨ての DB を作って命令（vitest など）を流し、終わったら必ず捨てる道具（K-627）。
//
//   node scripts/ci/db_fresh_run.mjs [--dry-run | --list-tmp] -- <命令…>
//
// 由来：spec-sync の L（層の棚卸し）の DB の層が、手元の古い kaname_test（migration が途中で止まった残り物）で偽の赤になった。
//   手元の DB を作り直す（Docker・本人の DB に触る）のではなく、層の検査が自分で使い捨ての DB を作って捨てる。
//
// 動き：
//   ・DATABASE_URL が env に在れば（CI の容れ物・手元で自分で渡した時）、何も作らずその DB のまま命令を流す
//   ・無ければ、管理者の接続（DATABASE_URL_ADMIN の道を /postgres に替えた物。無ければ postgres://postgres:postgres@127.0.0.1:55433/postgres）で
//     kaname_tmp_<英数 8 字> を作り、DATABASE_URL をそれにして命令を流し、成功でも失敗でも中断でも DB を捨てる
//   ・命令の終わりの値をそのまま返す。作れなければ命令を流さず 1。捨てられなければ名前を標準エラーに出して 1（名前は kaname_tmp_ で残る）
//   ・--dry-run は DB に触らず、選んだ DB と命令を出すだけ。--list-tmp は残っている kaname_tmp_ の DB を 1 行ずつ出す（手で捨てる用）
//   ・名前が kaname_tmp_ で始まらない DB は絶対に捨てない（kaname_dev・kaname_test を守る）
//   ・道具の知らせは標準エラー。標準出力は命令の出力（と --dry-run・--list-tmp の出力）だけ
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";

const TMP_PREFIX = "kaname_tmp_";
const TMP_NAME = /^kaname_tmp_[a-z0-9]{8}$/;
const DEFAULT_ADMIN = "postgres://postgres:postgres@127.0.0.1:55433/postgres";
const ADMIN_CONNECT_TIMEOUT_MS = 10_000;

const say = (msg) => process.stderr.write(`[db_fresh_run] ${msg}\n`);

// pg は packages/db が使っている版を使う（この道具は依存を足さない）
function loadPg() {
  const bases = ["../../packages/db/package.json", "../../package.json"];
  for (const rel of bases) {
    try {
      return createRequire(new URL(rel, import.meta.url))("pg");
    } catch {
      // 次の置き場を探す
    }
  }
  throw new Error("pg が見つからない（pnpm install を先に）");
}

// URL の道（DB の名前）だけを替える。問い合わせ（?…）は残す
function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

function adminUrl() {
  return withDb(process.env.DATABASE_URL_ADMIN || DEFAULT_ADMIN, "postgres");
}

function describeTarget(url) {
  const u = new URL(url);
  return `${u.host}${u.pathname}`; // 利用者名・パスワードは出さない
}

function randomName() {
  return `${TMP_PREFIX}${randomBytes(8).toString("hex").slice(0, 8)}`;
}

async function withAdmin(fn) {
  const { Client } = loadPg();
  const client = new Client({ connectionString: adminUrl(), connectionTimeoutMillis: ADMIN_CONNECT_TIMEOUT_MS });
  client.on("error", () => {}); // 切られた接続の知らせで落ちない（失敗は query の側で受ける）
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function createDb(name) {
  if (!TMP_NAME.test(name)) throw new Error(`作る名前が kaname_tmp_ の形でない: ${name}`);
  await withAdmin((c) => c.query(`create database "${name}"`));
}

// 捨てる前に必ず名前を見る（kaname_dev・kaname_test は捨てない）
async function dropDb(name) {
  if (!name.startsWith(TMP_PREFIX) || !TMP_NAME.test(name)) {
    throw new Error(`名前が kaname_tmp_ で始まらない DB は捨てない: ${name}`);
  }
  await withAdmin((c) => c.query(`drop database "${name}" with (force)`));
}

async function listTmp() {
  const rows = await withAdmin((c) =>
    c.query("select datname from pg_database where datname like 'kaname\\_tmp\\_%' order by datname"),
  );
  for (const r of rows.rows) process.stdout.write(`${r.datname}\n`);
}

function runCommand(cmd, env, onChild) {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { env, stdio: "inherit" });
    onChild(child);
    child.on("error", (e) => {
      say(`命令を起動できない: ${e.message}`);
      resolve(127);
    });
    child.on("close", (code, signal) => resolve(code ?? 128 + (os.constants.signals[signal] ?? 0)));
  });
}

async function runThrowaway(cmd) {
  const name = randomName();
  let child = null;
  let interrupted = null;
  const onSignal = (sig) => {
    interrupted = sig; // 中断は命令に渡し、命令が終わってから捨てる（命令の前なら流さない）
    child?.kill(sig);
  };
  const signals = ["SIGINT", "SIGTERM"];
  for (const s of signals) process.on(s, onSignal);

  let created = false;
  try {
    await createDb(name);
    created = true;
  } catch (e) {
    say(`使い捨ての DB を作れない（${describeTarget(adminUrl())}）: ${e.message}`);
    return 1;
  }
  say(`使い捨ての DB ${name} を作った`);

  const code = interrupted
    ? 128 + (os.constants.signals[interrupted] ?? 0)
    : await runCommand(cmd, { ...process.env, DATABASE_URL: withDb(adminUrl(), name) }, (c) => {
        child = c;
      });

  if (created) {
    try {
      await dropDb(name);
      say(`使い捨ての DB ${name} を捨てた`);
    } catch (e) {
      say(`使い捨ての DB ${name} を捨てられない（残っている・--list-tmp で見て手で捨てる）: ${e.message}`);
      return 1;
    }
  }
  for (const s of signals) process.off(s, onSignal);
  return code;
}

function parseArgs(argv) {
  const cut = argv.indexOf("--");
  const flags = cut === -1 ? argv : argv.slice(0, cut);
  const cmd = cut === -1 ? [] : argv.slice(cut + 1);
  const unknown = flags.filter((f) => f !== "--dry-run" && f !== "--list-tmp");
  return { dryRun: flags.includes("--dry-run"), list: flags.includes("--list-tmp"), cmd, unknown };
}

async function main() {
  const { dryRun, list, cmd, unknown } = parseArgs(process.argv.slice(2));
  if (unknown.length > 0 || (!list && cmd.length === 0)) {
    say("使い方: node scripts/ci/db_fresh_run.mjs [--dry-run | --list-tmp] -- <命令…>");
    return 2;
  }
  if (list) {
    try {
      await listTmp();
      return 0;
    } catch (e) {
      say(`管理 DB に着かない（${describeTarget(adminUrl())}）: ${e.message}`);
      return 1;
    }
  }
  const given = process.env.DATABASE_URL;
  if (dryRun) {
    process.stdout.write(`${given ? `既存の接続先：${describeTarget(given)}` : `使い捨ての DB：${randomName()}`}\n命令：${cmd.join(" ")}\n`);
    return 0;
  }
  if (given) {
    return runCommand(cmd, process.env, () => {}); // 渡された DB をそのまま使う（何も作らない・捨てない）
  }
  return runThrowaway(cmd);
}

process.exitCode = await main();
