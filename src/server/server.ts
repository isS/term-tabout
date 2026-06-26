import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { SessionManager } from '../engine/watcher.js';
import { JsonTitlesStore } from '../utils/titles.js';
import { groupSessions } from '../utils/groups.js';
import {
  closeSession,
  copyToClipboard,
  getGhosttyTabs,
  getTabTitle,
  killSession,
  setTtyTitle,
  teleportToSession,
} from '../utils/terminal.js';
import type { SessionWithMeta } from '../types.js';

export interface ServerOptions {
  home: string;
  /** 0 = 让内核选随机端口；用 server.address() 取实际值 */
  port?: number;
}

export interface RunningServer {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** Resolve absolute path of bundled web/ assets, relative to dist/server/server.js */
function webDir(): string {
  const here = url.fileURLToPath(import.meta.url);
  // dist/server/server.js → ../../src/web (during dev) or ../web (after build copies)
  // 我们在 build 后把 src/web 拷到 dist/web，因此用 ../web
  return path.resolve(path.dirname(here), '..', 'web');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface SessionsPayload {
  groups: ReturnType<typeof groupSessions>;
  totals: {
    sessions: number;
    cwds: number;
    saved: number;
    stale: number;
    oldestStartedAt: number | null;
  };
}

function buildPayload(
  sessions: SessionWithMeta[],
  titles: JsonTitlesStore,
  home: string
): SessionsPayload {
  // titles 已在 watcher.attach 时合入 SessionWithMeta，但保险起见再合并一次
  const merged = sessions.map((s) => ({
    ...s,
    title: s.title ?? titles.get(s.pid),
  }));
  const groups = groupSessions(merged, home);
  const cwds = new Set(sessions.map((s) => s.cwd));
  const oldest = sessions.length
    ? Math.min(...sessions.map((s) => s.startedAt))
    : null;
  return {
    groups,
    totals: {
      sessions: sessions.length,
      cwds: cwds.size,
      saved: sessions.filter((s) => s.saved).length,
      stale: sessions.filter((s) => !s.alive).length,
      oldestStartedAt: oldest,
    },
  };
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const manager = new SessionManager({ home: opts.home });
  const titles = new JsonTitlesStore(opts.home);
  await titles.load();

  // 当前最新 session 快照 + SSE client 列表
  let latest: SessionWithMeta[] = await manager.getActiveSessions();
  const sseClients = new Set<http.ServerResponse>();

  function broadcast(): void {
    const payload = JSON.stringify(buildPayload(latest, titles, opts.home));
    const frame = `event: sessions\ndata: ${payload}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(frame);
      } catch {
        // ignore broken pipe; cleanup happens on 'close'
      }
    }
  }

  // 订阅 watcher → 更新 latest + 广播
  const stopWatch = manager.watch((next) => {
    latest = next;
    broadcast();
  });

  const server = http.createServer((req, res) => {
    const start = Date.now();
    // 仅记录 POST 与 4xx/5xx：GET 太密集（含 /api/events 长连 + 静态资源），刷屏
    res.on('finish', () => {
      const dur = Date.now() - start;
      const m = req.method || '?';
      const p = (req.url || '').split('?')[0];
      // 跳过静态资源 (.css/.js/.svg/.png/.ico) 与 favicon，其余都 log
      if (!/\.(css|js|svg|png|ico|woff2?)$/.test(p) && p !== '/favicon.ico') {
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${m} ${p} → ${res.statusCode} (${dur}ms)`);
      }
    });
    handleRequest(req, res).catch((err) => {
      console.error('handler error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: (err as Error).message }));
      } else {
        res.end();
      }
    });
  });

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const u = new URL(req.url || '/', `http://${req.headers.host}`);
    const p = u.pathname;
    res.setHeader('cache-control', 'no-store');

    // ── API ────────────────────────────────────────────
    if (p === '/api/sessions' && req.method === 'GET') {
      const payload = buildPayload(latest, titles, opts.home);
      sendJson(res, 200, payload);
      return;
    }

    if (p === '/api/events' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('connection', 'keep-alive');
      res.flushHeaders?.();
      // initial snapshot
      const payload = JSON.stringify(buildPayload(latest, titles, opts.home));
      res.write(`event: sessions\ndata: ${payload}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (p === '/api/rename' && req.method === 'POST') {
      const body = await readJson<{ pid: number; title: string }>(req);
      if (!body || typeof body.pid !== 'number' || typeof body.title !== 'string') {
        sendJson(res, 400, { error: 'expected {pid, title}' });
        return;
      }
      const trimmed = body.title.trim();
      if (!trimmed) {
        sendJson(res, 400, { error: 'title cannot be empty' });
        return;
      }
      await titles.set(body.pid, trimmed);
      // 同步把 OSC 写到对应 tty —— rename 立刻反映到终端 tab
      const ttyResult = await setTtyTitle(body.pid, trimmed);
      // 重新 fetch sessions 让 broadcast 反映新 title
      latest = await manager.getActiveSessions();
      broadcast();
      sendJson(res, 200, { ok: true, tty: ttyResult });
      return;
    }

    if (p === '/api/reset-title' && req.method === 'POST') {
      const body = await readJson<{ pid: number }>(req);
      if (!body || typeof body.pid !== 'number') {
        sendJson(res, 400, { error: 'expected {pid}' });
        return;
      }
      await titles.delete(body.pid);
      latest = await manager.getActiveSessions();
      broadcast();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (p === '/api/teleport' && req.method === 'POST') {
      const body = await readJson<{ pid: number }>(req);
      if (!body || typeof body.pid !== 'number') {
        sendJson(res, 400, { error: 'expected {pid}' });
        return;
      }
      const target = latest.find((s) => s.pid === body.pid);
      if (!target) {
        sendJson(res, 404, { error: `no session with pid ${body.pid}` });
        return;
      }

      // 同 cwd 多 PID 时按 startedAt vs tabIndex 顺序配对，
      // 算出 target PID 该跳到哪个 Ghostty tab —— 否则全都跳到 cwd 命中的第一个 tab。
      let tabIndexHint: number | undefined;
      if ((target.term || '').toLowerCase() === 'ghostty') {
        const allTabs = await getGhosttyTabs();
        const matchingTabs = allTabs
          .filter((t) => t.cwd === target.cwd)
          .sort((a, b) => a.windowIndex - b.windowIndex || a.tabIndex - b.tabIndex);
        const sameCwdSessions = latest
          .filter(
            (s) =>
              s.alive &&
              (s.term || '').toLowerCase() === 'ghostty' &&
              s.cwd === target.cwd
          )
          .sort((a, b) => a.startedAt - b.startedAt);
        const pidIdx = sameCwdSessions.findIndex((s) => s.pid === target.pid);
        if (pidIdx >= 0 && pidIdx < matchingTabs.length) {
          tabIndexHint = matchingTabs[pidIdx].tabIndex;
        }
      }

      const r = await teleportToSession(body.pid, target.term, target.cwd, {
        tabIndexHint,
      });
      // 1002 = osascript not permitted to send keystrokes — System Events accessibility.
      // 1719/1728/-25211 = osascript not allowed to access System Events at all.
      const stderr = (r.stderr || '').toLowerCase();
      const needsAccessibility =
        stderr.includes('1002') ||
        stderr.includes('-1719') ||
        stderr.includes('-1728') ||
        stderr.includes('-25211') ||
        stderr.includes('辅助访问') ||
        stderr.includes('发送按键');
      const payload: typeof r & { needsAccessibility?: boolean; hint?: string } = { ...r };
      if (needsAccessibility) {
        payload.needsAccessibility = true;
        payload.hint =
          'macOS 输入监控/辅助功能权限未授予 node。打开"系统设置 → 隐私与安全性 → 辅助功能"，把运行 term-tabout 的 node 可执行文件添加进去并启用，然后重启 server。';
      }
      sendJson(res, r.exitCode === 0 ? 200 : 500, payload);
      return;
    }

    if (p === '/api/kill' && req.method === 'POST') {
      // "Close terminal" 而不是裸 SIGTERM —— zsh 默认会忽略 SIGTERM。
      // closeSession 先 SIGHUP（让 shell 走 zshexit），还活着再 SIGKILL 兜底。
      // 如果 caller 显式传 signal（脚本/调试），尊重显式选择，跳过升级。
      const body = await readJson<{ pid: number; signal?: NodeJS.Signals }>(req);
      if (!body || typeof body.pid !== 'number') {
        sendJson(res, 400, { error: 'expected {pid, signal?}' });
        return;
      }
      if (body.signal) {
        killSession(body.pid, body.signal);
        sendJson(res, 200, { ok: true, pid: body.pid, signaled: [body.signal] });
        return;
      }
      const r = await closeSession(body.pid);
      sendJson(res, 200, { ok: true, pid: body.pid, signaled: r.signaled, stillAlive: r.alive });
      return;
    }

    if (p === '/api/reveal-node' && req.method === 'POST') {
      // 在 Finder 里高亮当前运行的 node 二进制 + 同时打开"辅助功能"设置面板。
      // 用户拖一下就能授权。
      const { exec } = await import('node:child_process');
      const nodePath = process.execPath;
      exec(`open -R "${nodePath.replace(/"/g, '\\"')}"`, () => {});
      exec(`open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`, () => {});
      sendJson(res, 200, { ok: true, nodePath });
      return;
    }

    if (p === '/api/pull-titles' && req.method === 'POST') {
      // 把终端模拟器里当前的 tab title 抓回来，diff titles.json 并广播。
      //
      // iTerm / Terminal.app: tab 有 tty，per-PID 单点匹配。
      // Ghostty: tab 没 tty，按 cwd 单点会让"同 cwd 多个 shell 全拿同一 name"。
      // 改为批量取所有 Ghostty tab，按 startedAt 顺序与同 cwd 的 PID 配对。
      const updates: Array<{ pid: number; title: string }> = [];
      const probes: Array<{ pid: number; term: string; title: string | null }> = [];

      const ghosttyByCwd = new Map<string, SessionWithMeta[]>();
      const others: SessionWithMeta[] = [];
      for (const s of latest) {
        if (!s.alive) continue;
        if ((s.term || '').toLowerCase() === 'ghostty') {
          const arr = ghosttyByCwd.get(s.cwd) ?? [];
          arr.push(s);
          ghosttyByCwd.set(s.cwd, arr);
        } else {
          others.push(s);
        }
      }

      // Ghostty: 批量 + 配对
      if (ghosttyByCwd.size > 0) {
        const allTabs = await getGhosttyTabs();
        const tabsByCwd = new Map<string, typeof allTabs>();
        for (const t of allTabs) {
          const arr = tabsByCwd.get(t.cwd) ?? [];
          arr.push(t);
          tabsByCwd.set(t.cwd, arr);
        }
        for (const [cwd, sessions] of ghosttyByCwd) {
          const tabs = tabsByCwd.get(cwd) ?? [];
          // PID 按 startedAt 升序（先开的对前面的 tab）；tab 按 window→index 升序
          const sortedSessions = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
          const sortedTabs = [...tabs].sort(
            (a, b) => a.windowIndex - b.windowIndex || a.tabIndex - b.tabIndex
          );
          const n = Math.min(sortedSessions.length, sortedTabs.length);
          for (let i = 0; i < n; i++) {
            const s = sortedSessions[i];
            const title = sortedTabs[i].name;
            probes.push({ pid: s.pid, term: s.term, title });
            if (title && title !== titles.get(s.pid)) {
              await titles.set(s.pid, title);
              updates.push({ pid: s.pid, title });
            }
          }
          // 多出来的 session（tab 已被关掉但 state 还在）记 probed 但跳过更新
          for (let i = n; i < sortedSessions.length; i++) {
            probes.push({ pid: sortedSessions[i].pid, term: 'ghostty', title: null });
          }
        }
      }

      // 非 Ghostty: 老逻辑（按 tty 单点匹配）
      await Promise.all(
        others.map(async (s) => {
          const title = await getTabTitle(s.pid, s.term, s.cwd);
          probes.push({ pid: s.pid, term: s.term, title });
          if (title && title !== titles.get(s.pid)) {
            await titles.set(s.pid, title);
            updates.push({ pid: s.pid, title });
          }
        })
      );

      if (updates.length) {
        latest = await manager.getActiveSessions();
        broadcast();
      }
      sendJson(res, 200, {
        ok: true,
        updates,
        probedCount: probes.length,
        supportedCount: probes.filter((p) => p.title !== null).length,
      });
      return;
    }

    if (p === '/api/forget' && req.method === 'POST') {
      const body = await readJson<{ pid: number; force?: boolean }>(req);
      if (!body || typeof body.pid !== 'number') {
        sendJson(res, 400, { error: 'expected {pid, force?}' });
        return;
      }
      const r = await manager.forgetPid(body.pid, { force: !!body.force });
      if (r.removed) {
        latest = await manager.getActiveSessions();
        broadcast();
      }
      sendJson(res, r.removed ? 200 : 409, r);
      return;
    }

    if (p === '/api/purge-stale' && req.method === 'POST') {
      const n = await manager.purgeStale();
      if (n > 0) {
        latest = await manager.getActiveSessions();
        broadcast();
      }
      sendJson(res, 200, { ok: true, purged: n });
      return;
    }

    if (p === '/api/save' && req.method === 'POST') {
      const body = await readJson<{ cwd: string; saved: boolean }>(req);
      if (!body || typeof body.cwd !== 'string' || typeof body.saved !== 'boolean') {
        sendJson(res, 400, { error: 'expected {cwd, saved}' });
        return;
      }
      await toggleSavedYaml(opts.home, body.cwd, body.saved);
      latest = await manager.getActiveSessions();
      broadcast();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (p === '/api/copy' && req.method === 'POST') {
      const body = await readJson<{ text: string }>(req);
      if (!body || typeof body.text !== 'string') {
        sendJson(res, 400, { error: 'expected {text}' });
        return;
      }
      try {
        await copyToClipboard(body.text);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
      return;
    }

    // ── Static UI ──────────────────────────────────────
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    const rel = p === '/' ? '/index.html' : p;
    const file = path.join(webDir(), rel);
    // 防 path traversal
    if (!file.startsWith(webDir())) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    try {
      const data = await fs.readFile(file);
      const ext = path.extname(file);
      res.statusCode = 200;
      res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
      res.end(data);
    } catch {
      sendJson(res, 404, { error: 'not found', path: p });
    }
  }

  await new Promise<void>((resolve) => {
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('failed to read server address');
  }
  const actualPort = addr.port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;

  return {
    server,
    port: actualPort,
    url: baseUrl,
    close: async () => {
      await stopWatch();
      for (const c of sseClients) {
        try {
          c.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: http.IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function toggleSavedYaml(home: string, cwd: string, saved: boolean): Promise<void> {
  const file = path.join(home, 'saved.yaml');
  let lines: string[] = [];
  try {
    const raw = await fs.readFile(file, 'utf-8');
    lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    lines = [];
  }
  const set = new Set(lines);
  if (saved) set.add(cwd);
  else set.delete(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  const body = Array.from(set).sort().join('\n') + (set.size ? '\n' : '');
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, file);
}
