const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.torn.com/v2';
const API_KEY = process.env.API_KEY;
const PAGE_SIZE = 100;
const DELAY_MS = 3000;

if (!API_KEY) {
  console.error('API_KEY environment variable is not set.');
  process.exit(1);
}

let lastRequestTime = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForThrottle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < DELAY_MS) {
    await delay(DELAY_MS - elapsed);
  }

  lastRequestTime = Date.now();
}

async function request(path) {
  await waitForThrottle();
  const url = `${API_BASE}${path}`;
  console.log(`Requesting ${url}`);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `ApiKey ${API_KEY}`
    }
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) {
    const errMsg = data.error.error || JSON.stringify(data.error);
    throw new Error(`API error: ${errMsg}`);
  }
  return data;
}

async function fetchTeams() {
  const data = await request('/torn/elimination');
  return Array.isArray(data.elimination) ? data.elimination : [];
}

async function fetchTeamMembers(teamId) {
  let offset = 0;
  const members = [];

  while (true) {
    const data = await request(`/torn/${teamId}/eliminationteam?limit=${PAGE_SIZE}&offset=${offset}`);
    const batch = Array.isArray(data.eliminationteam) ? data.eliminationteam : [];

    members.push(
      ...batch.map(player => ({
        id: player.player_id ?? player.id,
        name: player.name,
        level: player.level,
        status: player.status ?? null
      }))
    );

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return members;
}

async function main() {
  const teams = await fetchTeams();
  const summary = [];

  for (const team of teams) {
    const members = await fetchTeamMembers(team.id);
    summary.push({
      id: team.id,
      name: team.name,
      eliminated: Boolean(team.eliminated),
      alive: team.alive,
      members
    });
  }

  const outPath = path.resolve(__dirname, '..', 'elimination_participants.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${summary.length} teams to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
