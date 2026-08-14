import { mkdir, writeFile } from "node:fs/promises";

const username =
  process.env.USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "jiangyimonian";
const token = process.env.GITHUB_TOKEN;
const now = new Date();
const year = Number(process.env.YEAR || now.getUTCFullYear());

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const dateKey = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const yearStart = new Date(Date.UTC(year, 0, 1));
const yearEnd = new Date(Date.UTC(year, 11, 31));
const fetchEnd = year === now.getUTCFullYear() ? now : yearEnd;

const query = /* GraphQL */ `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "jiangyimonian-profile-readme",
  },
  body: JSON.stringify({
    query,
    variables: {
      login: username,
      from: yearStart.toISOString(),
      to: fetchEnd.toISOString(),
    },
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(payload.errors.map((error) => error.message).join("; "));
}

const levelByName = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const contributions = new Map();
for (const week of payload.data.user.contributionsCollection.contributionCalendar.weeks) {
  for (const day of week.contributionDays) {
    contributions.set(day.date, {
      count: day.contributionCount,
      level: levelByName[day.contributionLevel] ?? 0,
    });
  }
}

const gridStart = addDays(yearStart, -yearStart.getUTCDay());
const gridEnd = addDays(yearEnd, 6 - yearEnd.getUTCDay());
const cells = [];

for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
  const key = dateKey(cursor);
  const inYear = cursor.getUTCFullYear() === year;
  const contribution = contributions.get(key) || { count: 0, level: 0 };
  cells.push({
    date: key,
    x: Math.round((cursor - gridStart) / 604800000),
    y: cursor.getUTCDay(),
    inYear,
    ...contribution,
  });
}

const cell = 11;
const gap = 3;
const pad = 18;
const cols = Math.max(...cells.map((item) => item.x)) + 1;
const rows = 7;
const width = pad * 2 + cols * cell + (cols - 1) * gap;
const height = pad * 2 + rows * cell + (rows - 1) * gap;
const point = (item) => [
  pad + item.x * (cell + gap) + cell / 2,
  pad + item.y * (cell + gap) + cell / 2,
];

const todayKey = dateKey(now);
const pastDays = cells.filter(
  (item) => item.inYear && item.date <= todayKey && item.date >= dateKey(yearStart),
);
const snakePath = pastDays
  .map((item, index) => {
    const [x, y] = point(item);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  })
  .join(" ");

const todayCell = cells.find((item) => item.date === todayKey);

function svg(theme) {
  const dark = theme === "dark";
  const colors = dark
    ? ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
    : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
  const background = dark ? "#0d1117" : "#ffffff";
  const snake = dark ? "#58a6ff" : "#2f81f7";
  const today = dark ? "#f778ba" : "#d1242f";

  const rects = cells
    .map((item) => {
      const x = pad + item.x * (cell + gap);
      const y = pad + item.y * (cell + gap);
      const opacity = item.inYear ? 1 : 0;
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${colors[item.level]}" opacity="${opacity}"><title>${item.date}: ${item.count} contributions</title></rect>`;
    })
    .join("\n");

  const marker = todayCell
    ? (() => {
        const [x, y] = point(todayCell);
        return `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="${today}" stroke-width="2" opacity="0.9"><title>Today: ${todayKey}</title></circle>`;
      })()
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${username}'s ${year} GitHub contribution snake">
<style>
@media (prefers-reduced-motion: reduce) {
  .snake-head { animation: none; }
}
</style>
<rect width="100%" height="100%" fill="${background}" />
${rects}
<path d="${snakePath}" fill="none" stroke="${snake}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.28" />
<circle class="snake-head" r="5" fill="${snake}">
  <animateMotion dur="10s" repeatCount="indefinite" path="${snakePath}" />
</circle>
${marker}
</svg>
`;
}

await mkdir("dist", { recursive: true });
await writeFile("dist/github-contribution-grid-snake.svg", svg("light"));
await writeFile("dist/github-contribution-grid-snake-dark.svg", svg("dark"));
