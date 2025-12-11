const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.torn.com/v2';
const FF_BASE = 'https://ffscouter.com/api/v1';
const PAGE_SIZE = 100;

const API_KEY = process.env.API_KEY;
const FF_API_KEY = process.env.FF_API_KEY || process.env.FFSCOUTER_API_KEY;
const REQUEST_DELAY_SECONDS = Number(process.env.REQUEST_DELAY_SECONDS || '3');
const DELAY_MS = Number.isFinite(REQUEST_DELAY_SECONDS) && REQUEST_DELAY_SECONDS >= 0
  ? REQUEST_DELAY_SECONDS * 1000
  : 3000;

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

async function requestTorn(path) {
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

async function requestFf(path) {
  if (!FF_API_KEY) return null;

  await waitForThrottle();
  const url = `${FF_BASE}${path}`;
  console.log(`Requesting ${url}`);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!res.ok) {
    console.warn(`FFScouter request failed: ${res.status} ${res.statusText}`);
    return null;
  }

  try {
    return await res.json();
  } catch (err) {
    console.warn('Failed to parse FFScouter response', err);
    return null;
  }
}

async function fetchTeams() {
  const data = await requestTorn('/torn/elimination');
  return Array.isArray(data.elimination) ? data.elimination : [];
}

async function fetchTeamMembers(teamId) {
  let offset = 0;
  const members = [];

  while (true) {
    const data = await requestTorn(`/torn/${teamId}/eliminationteam?limit=${PAGE_SIZE}&offset=${offset}`);
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

async function validateFfKey() {
  if (!FF_API_KEY) return false;
  const resp = await requestFf(`/check-key?key=${encodeURIComponent(FF_API_KEY)}`);
  if (!resp || resp.error) return false;

  const flags = [resp.valid, resp.success, resp.status === 'ok', resp.ok, resp.authorized];
  return flags.some(Boolean) || (!('valid' in resp) && !('success' in resp) && !resp.status);
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function fetchFfStats(playerIds) {
  if (!FF_API_KEY || !playerIds.length) return new Map();

  const statsMap = new Map();
  const chunks = chunk(playerIds, 100);

  for (const group of chunks) {
    const targets = group.join(',');
    const resp = await requestFf(`/get-stats?key=${encodeURIComponent(FF_API_KEY)}&targets=${targets}`);
    const entries = Array.isArray(resp)
      ? resp
      : Array.isArray(resp?.results)
        ? resp.results
        : Array.isArray(resp?.data)
          ? resp.data
          : [];

    entries.forEach(entry => {
      const id = Number(entry?.player_id);
      const bs = entry?.bs_estimate_human ?? entry?.bs_estimate;
      if (!Number.isNaN(id) && bs !== undefined) {
        statsMap.set(id, bs);
      }
    });
  }

  return statsMap;
}

async function hydratePlayersWithStats(players) {
  const ids = players.map(p => Number(p.id)).filter(id => !Number.isNaN(id));
  const statsMap = await fetchFfStats(ids);

  players.forEach(player => {
    const stat = statsMap.get(Number(player.id));
    player.bs_estimate_human = stat ?? '--';
  });
}

async function main() {
  const summary = [];

  const ffKeyValid = await validateFfKey();
  if (!ffKeyValid && FF_API_KEY) {
    console.warn('FFScouter key is not valid; continuing without FF stats.');
  }

  const teams = await fetchTeams();

  for (const team of teams) {
    const members = await fetchTeamMembers(team.id);
    if (ffKeyValid) {
      await hydratePlayersWithStats(members);
    } else {
      members.forEach(p => {
        p.bs_estimate_human = '--';
      });
    }

    summary.push({
      id: team.id,
      name: team.name,
      participants: team.participants ?? members.length,
      players: members.map(m => ({
        id: m.id,
        name: m.name,
        level: m.level,
        bs_estimate_human: m.bs_estimate_human ?? '--'
      }))
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
