// Generates an SVG line chart of the user's contributions over the last 31 days.
// Usage: GITHUB_TOKEN=... node scripts/activity-graph.mjs <login> <out.svg>
// For local testing: DATA_FILE=days.json node scripts/activity-graph.mjs <login> <out.svg>
//   where days.json is [{ "date": "2026-11-01", "count": 3 }, ...]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const DAYS = 31;
const C = {
  bg: "#161b22",
  text: "#c9d1d9",
  muted: "#8b949e",
  grid: "#30363d",
  title: "#e44c9a",
  line: "#a855f7",
  point: "#e44c9a",
  area: "#a855f7",
};
const TITLE = "Contributions over the last 31 days";

async function fetchDays(login, token) {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (DAYS - 1)));
  const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){contributionsCollection(from:$from,to:$to){
      contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "activity-graph" },
    body: JSON.stringify({ query, variables: { login, from: from.toISOString(), to: to.toISOString() } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  const days = json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }));
  return days.slice(-DAYS);
}

function niceMax(v) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function render(days) {
  const W = 1200, H = 420, R = 6;
  const L = 70, Rm = 30, T = 70, B = 60;
  const pw = W - L - Rm, ph = H - T - B;
  const max = niceMax(Math.max(0, ...days.map((d) => d.count)));
  const n = days.length;
  const x = (i) => L + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v) => T + ph - (v / max) * ph;

  const grid = [];
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    const yy = y(v).toFixed(1);
    grid.push(`<line x1="${L}" y1="${yy}" x2="${W - Rm}" y2="${yy}" stroke="${C.grid}" stroke-dasharray="${k ? "4 4" : "0"}"/>`);
    grid.push(`<text x="${L - 12}" y="${yy}" dy="4" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`);
  }
  const xLabels = days
    .map((d, i) => `<text x="${x(i).toFixed(1)}" y="${T + ph + 24}" text-anchor="middle">${Number(d.date.slice(8, 10))}</text>`)
    .join("");

  const pts = days.map((d, i) => [x(i), y(d.count)]);
  const line = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const dots = days
    .map((d, i) => `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="4" fill="${C.point}"><title>${d.date}: ${d.count}</title></circle>`)
    .join("");
  const total = days.reduce((s, d) => s + d.count, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.area}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${C.area}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="${R}" fill="${C.bg}"/>
  <text x="${W / 2}" y="40" text-anchor="middle" fill="${C.title}" font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" font-size="22" font-weight="600">${TITLE}</text>
  <text x="${W - Rm}" y="40" text-anchor="end" fill="${C.muted}" font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" font-size="14">${total} total</text>
  <g fill="${C.muted}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12">${grid.join("")}${xLabels}</g>
  <path d="${area}" fill="url(#fill)"/>
  <path d="${line}" fill="none" stroke="${C.line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
</svg>
`;
}

const [login, out] = process.argv.slice(2);
if (!login || !out) {
  console.error("usage: node scripts/activity-graph.mjs <login> <out.svg>");
  process.exit(1);
}
const days = process.env.DATA_FILE
  ? JSON.parse(await readFile(process.env.DATA_FILE, "utf8"))
  : await fetchDays(login, process.env.GITHUB_TOKEN);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, render(days));
console.log(`wrote ${out} (${days.length} days)`);
