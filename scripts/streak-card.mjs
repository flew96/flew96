// Generates a streak stats SVG card: total contributions, current streak, longest streak.
// Usage: GITHUB_TOKEN=... node scripts/streak-card.mjs <login> <out.svg>
// For local testing: DATA_FILE=days.json TODAY=2026-11-28 node scripts/streak-card.mjs <login> <out.svg>
//   where days.json is [{ "date": "2026-11-01", "count": 3 }, ...] sorted by date
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const C = {
  bg: "#161b22",
  ring: "#a855f7",
  fire: "#e44c9a",
  currLabel: "#e44c9a",
  sideLabels: "#c9d1d9",
  currNum: "#c9d1d9",
  sideNums: "#c9d1d9",
  dates: "#8b949e",
  divider: "#30363d",
};

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "streak-card" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

async function fetchDays(login, token) {
  const { user } = await gql(
    token,
    `query($login:String!){user(login:$login){contributionsCollection{contributionYears}}}`,
    { login },
  );
  const years = user.contributionsCollection.contributionYears;
  const now = new Date();
  const parts = years.map((y) => {
    const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
    return `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${to}") {
      contributionCalendar{weeks{contributionDays{date contributionCount}}}}`;
  });
  const data = await gql(token, `query($login:String!){user(login:$login){${parts.join("\n")}}}`, { login });
  const byDate = new Map();
  for (const key of Object.keys(data.user)) {
    for (const w of data.user[key].contributionCalendar.weeks)
      for (const d of w.contributionDays) byDate.set(d.date, d.contributionCount);
  }
  return [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeStats(days, today) {
  days = days.filter((d) => d.date <= today);
  const total = days.reduce((s, d) => s + d.count, 0);
  const first = days.find((d) => d.count > 0)?.date ?? today;

  let longest = { len: 0, start: null, end: null };
  let run = { len: 0, start: null, end: null };
  for (const d of days) {
    if (d.count > 0) {
      run = run.len ? { len: run.len + 1, start: run.start, end: d.date } : { len: 1, start: d.date, end: d.date };
      if (run.len > longest.len) longest = { ...run };
    } else {
      run = { len: 0, start: null, end: null };
    }
  }

  // Current streak: today having no contributions yet doesn't break it.
  let i = days.length - 1;
  if (i >= 0 && days[i].date === today && days[i].count === 0) i--;
  let current = { len: 0, start: null, end: null };
  while (i >= 0 && days[i].count > 0) {
    current = { len: current.len + 1, start: days[i].date, end: current.end ?? days[i].date };
    i--;
  }
  return { total, first, current, longest };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(date, today) {
  const [y, m, d] = date.split("-").map(Number);
  const s = `${MONTHS[m - 1]} ${d}`;
  return y === Number(today.slice(0, 4)) ? s : `${s}, ${y}`;
}
function range(r, today) {
  if (!r.len) return "";
  if (r.start === r.end) return fmt(r.start, today);
  const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
  const start = sameYear ? fmt(r.start, `${r.start.slice(0, 4)}-01-01`) : fmt(r.start, today);
  return `${start} - ${fmt(r.end, today)}`;
}

function render({ total, first, current, longest }, today) {
  const W = 495, H = 195;
  const font = `font-family="'Segoe UI',Ubuntu,-apple-system,Helvetica,Arial,sans-serif"`;
  const col = (cx, num, numColor, label, labelColor, sub, numY, labelY, subY, extra = "") => `
  <g text-anchor="middle" ${font}>
    ${extra}
    <text x="${cx}" y="${numY}" fill="${numColor}" font-size="28" font-weight="700">${num}</text>
    <text x="${cx}" y="${labelY}" fill="${labelColor}" font-size="14" font-weight="${labelColor === C.currLabel ? 700 : 400}">${label}</text>
    <text x="${cx}" y="${subY}" fill="${C.dates}" font-size="12">${sub}</text>
  </g>`;

  // Ring with a gap at the top for the flame.
  const cx = W / 2, cy = 71, r = 40;
  const gap = 0.55; // radians on each side of 12 o'clock
  const a0 = -Math.PI / 2 + gap, a1 = -Math.PI / 2 - gap + 2 * Math.PI;
  const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const ring = `<path d="M${p(a0)} A${r} ${r} 0 1 1 ${p(a1)}" fill="none" stroke="${C.ring}" stroke-width="5" stroke-linecap="round"/>`;
  const flame = `<path transform="translate(${cx - 9} ${cy - r - 14})" fill="${C.fire}"
      d="M9 0C10.5 4.5 15 7 15 13.5C15 18 12.3 21 9 21C5.7 21 3 18 3 14C3 10.5 5 8.5 6.5 7C6.5 9.5 7.7 11 9 11.5C8.2 8 8.5 3.5 9 0Z"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="4.5" fill="${C.bg}"/>
  <line x1="165" y1="28" x2="165" y2="170" stroke="${C.divider}"/>
  <line x1="330" y1="28" x2="330" y2="170" stroke="${C.divider}"/>
  ${col(82.5, total.toLocaleString("en-US"), C.sideNums, "Total Contributions", C.sideLabels, `${fmt(first, today)} - Present`, 79, 115, 145)}
  ${col(cx, current.len, C.currNum, "Current Streak", C.currLabel, range(current, today), 81, 140, 165, ring + flame)}
  ${col(412.5, longest.len, C.sideNums, "Longest Streak", C.sideLabels, range(longest, today), 79, 115, 145)}
</svg>
`;
}

const [login, out] = process.argv.slice(2);
if (!login || !out) {
  console.error("usage: node scripts/streak-card.mjs <login> <out.svg>");
  process.exit(1);
}
const today = process.env.TODAY ?? new Date().toISOString().slice(0, 10);
const days = process.env.DATA_FILE
  ? JSON.parse(await readFile(process.env.DATA_FILE, "utf8"))
  : await fetchDays(login, process.env.GITHUB_TOKEN);
const stats = computeStats(days, today);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, render(stats, today));
console.log(`wrote ${out}: total=${stats.total} current=${stats.current.len} longest=${stats.longest.len}`);
