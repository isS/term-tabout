/**
 * 把 startedAt 渲染成绝对时间。
 * - 同一天：HH:MM
 * - 7 天内：Mon HH:MM
 * - 更早：MM-DD HH:MM
 */
export function formatStartedAt(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  if (sameDay) return `${hh}:${mm}`;
  const diffDays = Math.floor((now - ms) / 86_400_000);
  if (diffDays < 7) {
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return `${wk} ${hh}:${mm}`;
  }
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hh}:${mm}`;
}

/**
 * 时长 / 相对时间格式化："2h 18m" / "47m" / "1d 4h" / "12s"
 * 单一函数兼顾 running（绝对时长）与 last（相对时间），调用方自己算 delta。
 */
export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day >= 1) return `${day}d ${hr % 24}h`;
  if (hr >= 1) return `${hr}h ${pad2(min % 60)}m`;
  if (min >= 1) return `${min}m`;
  return `${sec}s`;
}

export function formatRelative(ms: number, now: number = Date.now()): string {
  return formatDuration(now - ms);
}

/** 路径用 ~ 缩写 */
export function tildify(p: string, home: string): string {
  if (p === home) return '~';
  if (p.startsWith(home + '/')) return '~' + p.slice(home.length);
  return p;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
