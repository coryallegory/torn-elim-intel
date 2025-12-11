(function () {
    const dom = {
        apikeyInput: document.getElementById("apikey-input"),
        apikeyStatus: document.getElementById("apikey-status"),
        apikeyApply: document.getElementById("apikey-apply"),
        ffapikeyInput: document.getElementById("ffapikey-input"),
        ffapikeyStatus: document.getElementById("ffapikey-status"),
        ffapikeyApply: document.getElementById("ffapikey-apply"),
        userBox: document.getElementById("userinfo-box"),
        userInfoContent: document.getElementById("user-info-content"),
        teamTableBody: document.getElementById("team-table-body"),
        teamTableHeaders: document.querySelectorAll("#team-table thead th[data-col]"),
        playerTableBody: document.getElementById("player-table-body"),
        playerTableHeaders: document.querySelectorAll("#player-table thead th[data-col]"),
        levelMinInput: document.getElementById("level-min"),
        levelMaxInput: document.getElementById("level-max"),
        bsMinInput: document.getElementById("bs-min"),
        bsMaxInput: document.getElementById("bs-max"),
        filterOkayOnly: document.getElementById("filter-okay-only"),
        locationFilter: document.getElementById("location-filter"),
        metadataTimerLabel: document.getElementById("metadata-refresh-timer"),
        metadataIcon: document.getElementById("metadata-refresh-icon"),
        teamTimerLabel: document.getElementById("team-refresh-timer"),
        teamIcon: document.getElementById("team-refresh-icon")
    };

    const LOCATION = Object.freeze({
        ARGENTINA: "Argentina",
        CANADA: "Canada",
        CAYMAN_ISLANDS: "Cayman Islands",
        CHINA: "China",
        HAWAII: "Hawaii",
        JAPAN: "Japan",
        MEXICO: "Mexico",
        SOUTH_AFRICA: "South Africa",
        SWITZERLAND: "Switzerland",
        UAE: "UAE",
        UNITED_KINGDOM: "United Kingdom",
        TORN: "Torn"
    });

    const LOCATION_SYNONYMS = buildLocationSynonymMap();

    const intervals = { metadata: null, team: null, countdown: null };
    const teamFetchInFlight = new Map();
    const teamRefreshStart = new Map();
    const sortState = {
        team: { column: null, direction: "asc" },
        player: { column: null, direction: "asc" }
    };
    let metadataRefreshInFlight = null;
    let metadataRefreshStart = 0;

    function ensureValidSelectedTeam() {
        const teams = Array.isArray(state.teams) ? state.teams : [];
        const availableIds = new Set(
            teams
                .map(t => t?.id)
                .filter(id => id !== undefined && id !== null)
        );

        Object.keys(state.teamPlayers || {}).forEach(idStr => {
            if (idStr === null || idStr === undefined) return;
            const parsed = Number(idStr);
            if (!Number.isNaN(parsed)) {
                availableIds.add(parsed);
            } else {
                availableIds.add(idStr);
            }
        });

        const current = state.selectedTeamId;
        if (current !== null && current !== undefined && availableIds.has(current)) {
            return current;
        }

        const fallback = teams[0]?.id ?? Array.from(availableIds)[0] ?? null;
        state.saveSelectedTeamId(fallback ?? null);
        return fallback;
    }

    function init() {
        state.loadFromStorage();
        dom.apikeyInput.value = state.apikey || "";
        dom.ffapikeyInput.value = state.ffapikey || "";

        if (state.user) {
            dom.userBox.classList.remove("hidden");
            renderUserInfo();
        }

        if (state.apikey) {
            const hasCachedTeams = Array.isArray(state.teams) && state.teams.length > 0;
            const hasCachedPlayers = state.teamPlayers && Object.keys(state.teamPlayers).length > 0;
            if (hasCachedTeams || hasCachedPlayers) {
                ensureValidSelectedTeam();
                renderTeams();
                renderPlayers();
            }
            validateAndStart();
        } else {
            showNoKey();
            loadStaticSnapshot();
        }

        if (state.ffapikey) {
            validateFfApiKey(true);
        } else {
            showNoFfKey();
        }

        dom.apikeyApply.addEventListener("click", () => {
            const key = dom.apikeyInput.value.trim();
            if (!key) {
                showNoKey();
                return;
            }
            state.saveApiKey(key);
            validateAndStart();
        });

        dom.ffapikeyApply.addEventListener("click", () => {
            const key = dom.ffapikeyInput.value.trim();
            state.saveFfApiKey(key);
            validateFfApiKey();
        });

        attachFilterListeners();
        attachSortListeners();
    }

    async function validateAndStart() {
        dom.apikeyStatus.textContent = "Validating...";
        dom.apikeyStatus.classList.remove("status-error");

        const data = await api.getUser(state.apikey);
        if (data.error || !data.profile) {
            stopIntervals();
            clearAuthenticatedState();
            showNoKey("API key invalid");
            await loadStaticSnapshot();
            return;
        }

        state.user = data.profile;
        dom.apikeyStatus.textContent = "API key loaded";
        dom.apikeyStatus.classList.remove("status-error");
        dom.userBox.classList.remove("hidden");

        renderUserInfo();
        await refreshMetadata(true);
        startMetadataCountdown();
        startTeamCountdown();
        if (state.selectedTeamId) {
            refreshTeamPlayers(true);
        }
    }

    function stopIntervals() {
        if (intervals.metadata) clearInterval(intervals.metadata);
        if (intervals.team) clearInterval(intervals.team);
        if (intervals.countdown) clearInterval(intervals.countdown);
        intervals.metadata = intervals.team = intervals.countdown = null;
    }

    function showNoKey(message = "No API key loaded") {
        dom.apikeyStatus.textContent = message;
        dom.apikeyStatus.classList.add("status-error");
    }

    function clearAuthenticatedState() {
        state.user = null;
        dom.userInfoContent.innerHTML = "";
        dom.userBox.classList.add("hidden");
        dom.metadataTimerLabel.textContent = "Next refresh: --";
        dom.teamTimerLabel.textContent = "Next refresh: --";
        dom.metadataIcon.classList.add("hidden");
        dom.teamIcon.classList.add("hidden");

        state.metadataTimestamp = 0;
        localStorage.setItem("metadataTimestamp", "0");

        state.teams = [];
        state.selectedTeamId = null;
        state.teamPlayers = {};
        state.teamPlayersTimestamp = {};
        localStorage.setItem("teamPlayers", JSON.stringify(state.teamPlayers));
        localStorage.setItem("teamPlayersTimestamp", JSON.stringify(state.teamPlayersTimestamp));

        renderTeams();
        renderPlayers();
    }

    async function loadStaticSnapshot() {
        try {
            const res = await fetch("elimination_participants.json", { cache: "no-cache" });
            if (!res.ok) {
                console.warn("No static elimination snapshot available.");
                return;
            }

            const payload = await res.json();
            const teams = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.teams)
                    ? payload.teams
                    : [];

            if (!teams.length) return;

            state.teams = teams.map(t => ({
                id: t.id,
                name: t.name,
                participants: t.participants ?? (t.players?.length ?? 0),
                score: t.score ?? "--",
                wins: t.wins ?? "--",
                losses: t.losses ?? "--",
                lives: t.lives ?? "--",
                position: t.position ?? "--",
                eliminated: t.eliminated ?? "--"
            }));

            state.teamPlayers = {};
            state.teamPlayersTimestamp = {};
            teams.forEach(team => {
                const players = (team.players || []).map(p => ensurePlayerDefaults({ ...p }));
                state.cacheTeamPlayers(team.id, players);
            });

            state.saveSelectedTeamId(state.teams[0]?.id || null);
            renderTeams();
            renderPlayers();
        } catch (err) {
            console.warn("Failed to load static elimination snapshot", err);
        }
    }

    function showNoFfKey() {
        state.ffApiKeyValid = false;
        dom.ffapikeyStatus.textContent = "Not configured";
        dom.ffapikeyStatus.classList.add("status-error");
    }

    async function validateFfApiKey(isInit = false) {
        const key = state.ffapikey;
        if (!key) {
            showNoFfKey();
            return;
        }

        dom.ffapikeyStatus.textContent = "Validating...";
        dom.ffapikeyStatus.classList.remove("status-error");

        const data = await api.checkFfKey(key);
        const valid = data && !data.error && (data.valid === true || data.success === true || data.status === "ok" || data.ok === true || data.authorized === true || (!("valid" in data) && !("success" in data) && !data.status));

        if (!valid) {
            state.ffApiKeyValid = false;
            dom.ffapikeyStatus.textContent = data && data.error ? "FFScouter key invalid" : "FFScouter key rejected";
            dom.ffapikeyStatus.classList.add("status-error");
            return;
        }

        state.ffApiKeyValid = true;
        const label = data && (data.message || data.status_message || data.status) ? (data.message || data.status_message || data.status) : "FFScouter key accepted";
        dom.ffapikeyStatus.textContent = label;
        dom.ffapikeyStatus.classList.remove("status-error");

        if (!isInit && state.selectedTeamId) {
            refreshTeamPlayers(true);
        }
    }

    async function refreshMetadata(force = false) {
        if (metadataRefreshInFlight) {
            await metadataRefreshInFlight;
            return;
        }

        const now = Date.now();
        if (!force && !state.shouldRefreshMetadata(now)) return;
        if (now - metadataRefreshStart < state.MIN_REFRESH_MS) return;

        metadataRefreshStart = now;
        dom.metadataIcon.classList.remove("hidden");

        const refreshPromise = (async () => {
            const [userData, teamData] = await Promise.all([
                api.getUser(state.apikey),
                api.getTeams(state.apikey)
            ]);

            if (!userData.error && userData.profile) {
                state.user = userData.profile;
                renderUserInfo();
            }

            if (!teamData.error && teamData.elimination) {
                state.teams = teamData.elimination;
                ensureValidSelectedTeam();
                renderTeams();
            }

            state.cacheMetadata(state.user, state.teams);
            dom.metadataIcon.classList.add("hidden");
        })();

        metadataRefreshInFlight = refreshPromise;
        try {
            await refreshPromise;
        } finally {
            metadataRefreshInFlight = null;
        }
    }

    function renderUserInfo() {
        const u = state.user;
        if (!u) return;

        const stateColor = mapStateColor(u.status.state);
        const statusText = simplifyStatus(u.status);

        dom.userInfoContent.innerHTML = `
            <div><strong>${u.name}</strong> [${u.level}]</div>
            <div class="${stateColor}">${statusText}</div>
        `;
    }

    function simplifyStatus(statusObj) {
        if (!statusObj) return "Unknown";
        const desc = statusObj.description || statusObj.state;
        if (desc.startsWith("Traveling to")) {
            return desc.replace("Traveling to", "Traveling (") + ")";
        } else if (desc.startsWith("Returning to Torn from")) {
            const place = desc.replace("Returning to Torn from ", "");
            return `Returning from ${place}`;
        }
        return desc;
    }

    function buildLocationSynonymMap() {
        const map = new Map();
        Object.values(LOCATION).forEach(loc => map.set(loc.toLowerCase(), loc));

        const synonyms = [
            ["canadian", LOCATION.CANADA],
            ["canada", LOCATION.CANADA],
            ["argentinian", LOCATION.ARGENTINA],
            ["argentina", LOCATION.ARGENTINA],
            ["cayman", LOCATION.CAYMAN_ISLANDS],
            ["cayman islands", LOCATION.CAYMAN_ISLANDS],
            ["china", LOCATION.CHINA],
            ["chinese", LOCATION.CHINA],
            ["hawaii", LOCATION.HAWAII],
            ["hawaiian", LOCATION.HAWAII],
            ["japan", LOCATION.JAPAN],
            ["japanese", LOCATION.JAPAN],
            ["mexico", LOCATION.MEXICO],
            ["mexican", LOCATION.MEXICO],
            ["south africa", LOCATION.SOUTH_AFRICA],
            ["southafrica", LOCATION.SOUTH_AFRICA],
            ["south african", LOCATION.SOUTH_AFRICA],
            ["switzerland", LOCATION.SWITZERLAND],
            ["swiss", LOCATION.SWITZERLAND],
            ["uae", LOCATION.UAE],
            ["emirati", LOCATION.UAE],
            ["united kingdom", LOCATION.UNITED_KINGDOM],
            ["uk", LOCATION.UNITED_KINGDOM],
            ["british", LOCATION.UNITED_KINGDOM],
            ["torn", LOCATION.TORN]
        ];

        synonyms.forEach(([key, value]) => map.set(key, value));
        return map;
    }

    function normalizeLocationName(rawName) {
        if (!rawName || typeof rawName !== "string") return null;
        const cleaned = rawName.trim().toLowerCase();
        if (!cleaned) return null;
        return LOCATION_SYNONYMS.get(cleaned) || null;
    }

    function extractHospitalLocation(statusObj) {
        if (!statusObj || !statusObj.description) return "Torn";
        const desc = statusObj.description.trim();

        // Try patterns like: In a Hawaiian hospital...
        const match = desc.match(/In\s+(?:a|an)?\s*([A-Za-z]+)\s+hospital/i);
        if (match && match[1]) {
            return match[1];
        }

        // Default if no city is named
        return "Torn";
    }

    function resolveHospitalLocation(statusObj) {
        const raw = extractHospitalLocation(statusObj);
        return normalizeLocationName(raw) || LOCATION.TORN;
    }

    function parseTravelDirection(statusObj) {
        const desc = (statusObj?.description || "").trim();
        const details = statusObj?.details || {};

        if (details.from) {
            return { direction: "from", place: details.from };
        }

        if (details.destination) {
            return { direction: "to", place: details.destination };
        }

        if (details.country) {
            return { direction: "to", place: details.country };
        }

        const returningMatch = desc.match(/returning to torn from\s+(.+)/i);
        if (returningMatch) {
            return { direction: "from", place: returningMatch[1] };
        }

        const travelingFromMatch = desc.match(/traveling from\s+(.+)/i);
        if (travelingFromMatch) {
            return { direction: "from", place: travelingFromMatch[1] };
        }

        const travelingToMatch = desc.match(/traveling to\s+(.+)/i);
        if (travelingToMatch) {
            return { direction: "to", place: travelingToMatch[1] };
        }

        return null;
    }

    function formatTravelingLocation(direction, destination) {
        if (!destination) return null;
        return direction === "from"
            ? `Traveling from ${destination}`
            : `Traveling to ${destination}`;
    }

    function determinePlayerLocation(statusObj) {
        if (!statusObj) return null;
        const stateValue = statusObj.state;

        if (stateValue === "Hospital") {
            return resolveHospitalLocation(statusObj);
        }

        if (stateValue === "Abroad") {
            const destination = normalizeLocationName(getAbroadDestination(statusObj));
            return destination || null;
        }

        if (stateValue === "Traveling") {
            const travel = parseTravelDirection(statusObj);
            if (!travel) return null;

            const normalized = normalizeLocationName(travel.place);
            if (!normalized) return null;
            return formatTravelingLocation(travel.direction, normalized);
        }

        if (stateValue === "Okay") {
            return LOCATION.TORN;
        }

        return LOCATION.TORN;
    }

    function getAbroadDestination(statusObj) {
        if (!statusObj) return null;
        const details = statusObj.details || {};
        if (details.destination) return details.destination;
        if (details.country) return details.country;

        const desc = statusObj.description || "";
        const parenMatch = desc.match(/\(([^)]+)\)/);
        if (parenMatch) return parenMatch[1];

        const inMatch = desc.match(/in\s+([A-Za-z\s]+)$/i);
        if (inMatch) return inMatch[1].trim();

        if (desc.includes(" ")) return desc.split(" ").slice(1).join(" ").trim();
        return null;
    }

    function appendBsEstimatePlaceholders(players) {
        players.forEach(p => {
            if (p.bs_estimate_human === undefined) {
                p.bs_estimate_human = "--";
            }
        });
    }

    function ensurePlayerDefaults(player) {
        if (!player) return player;

        const { rawData, location, ...rest } = player;
        const status = player.status || { state: "Unknown", description: "Unknown" };
        const canonicalLocation = player.location ?? determinePlayerLocation(status);
        const bsEstimateHuman = player.bs_estimate_human === undefined ? "--" : player.bs_estimate_human;
        const bsEstimateNumeric = deriveBsEstimateNumber(player);

        return {
            ...player,
            status,
            location: canonicalLocation,
            rawData: rawData || { ...rest },
            bs_estimate_human: bsEstimateHuman,
            bs_estimate: bsEstimateNumeric
        };
    }

    function transformPlayerFromApi(rawPlayer) {
        return ensurePlayerDefaults({
            ...rawPlayer,
            location: determinePlayerLocation(rawPlayer.status),
            rawData: rawPlayer
        });
    }

    function getPlayerIdentifier(player) {
        const candidates = ["id", "player_id", "user_id", "torn_id", "tornid"];
        for (const key of candidates) {
            if (player[key] !== undefined && player[key] !== null) {
                return player[key];
            }
        }
        return null;
    }

    async function maybeFetchFfScouterStats(players) {
        if (!state.ffApiKeyValid || !state.ffapikey || !players.length) return;
        const ids = players
            .map(getPlayerIdentifier)
            .filter(id => id !== null && id !== undefined);
        if (!ids.length) return;

        const idsCsv = ids.join(",");

        try {
            const data = await api.getFfStats(state.ffapikey, idsCsv);
            const statsMap = buildFfStatsMap(data);
            players.forEach(p => {
                const playerId = getPlayerIdentifier(p);
                if (playerId === null || playerId === undefined) return;

                const numericId = Number(playerId);
                const val = statsMap.get(numericId);
                if (val !== undefined) {
                    p.bs_estimate_human = val;
                    p.bs_estimate = deriveBsEstimateNumber(p);
                }
            });
        } catch (err) {
            console.error("Failed to fetch FFScouter stats", err);
        }
    }

    function buildFfStatsMap(resp) {
        const map = new Map();
        if (!resp || resp.error) return map;

        const entries = Array.isArray(resp)
            ? resp
            : Array.isArray(resp?.results)
                ? resp.results
                : Array.isArray(resp?.data)
                    ? resp.data
                    : [];

        entries.forEach(entry => addStatEntryToMap(map, entry));

        return map;
    }

    function addStatEntryToMap(map, entry) {
        const id = Number(entry?.player_id);
        const bs = entry?.bs_estimate_human ?? entry?.bs_estimate;
        if (Number.isNaN(id) || bs === undefined) return;

        map.set(id, bs);
    }

    function attachSortListeners() {
        addSortListeners(dom.teamTableHeaders, "team");
        addSortListeners(dom.playerTableHeaders, "player");
    }

    function addSortListeners(headers, tableType) {
        headers.forEach(th => {
            th.classList.add("sortable");
            th.addEventListener("click", () => handleSort(tableType, th.getAttribute("data-col")));
        });

        updateSortIndicators(tableType);
    }

    function handleSort(tableType, column) {
        const stateRef = sortState[tableType];
        if (!stateRef || !column) return;

        if (stateRef.column === column) {
            stateRef.direction = stateRef.direction === "asc" ? "desc" : "asc";
        } else {
            stateRef.column = column;
            stateRef.direction = "asc";
        }

        if (tableType === "team") {
            renderTeams();
        } else {
            renderPlayers();
        }
    }

    function updateSortIndicators(tableType) {
        const headers = tableType === "team" ? dom.teamTableHeaders : dom.playerTableHeaders;
        const { column, direction } = sortState[tableType];

        headers.forEach(th => {
            th.classList.remove("sorted-asc", "sorted-desc");
            const thCol = th.getAttribute("data-col");
            if (thCol && thCol === column) {
                th.classList.add(direction === "asc" ? "sorted-asc" : "sorted-desc");
            }
        });
    }

    function sortTeamsList(teams) {
        const { column, direction } = sortState.team;
        if (!column) return [...teams];

        return [...teams].sort((a, b) => compareValues(
            getTeamSortValue(a, column),
            getTeamSortValue(b, column),
            direction
        ));
    }

    function getTeamSortValue(team, column) {
        switch (column) {
            case "name":
                return (team.name || "").toLowerCase();
            case "eliminated":
                return team.eliminated ? 1 : 0;
            default:
                return team[column];
        }
    }

    function sortPlayersList(players) {
        const { column, direction } = sortState.player;
        if (!column) return [...players];

        return [...players].sort((a, b) => compareValues(
            getPlayerSortValue(a, column),
            getPlayerSortValue(b, column),
            direction
        ));
    }

    function getPlayerSortValue(player, column) {
        switch (column) {
            case "name":
                return (player.name || "").toLowerCase();
            case "status":
                return simplifyStatus(player.status).toLowerCase();
            case "last_action":
                if (player.last_action && player.last_action.timestamp !== undefined) {
                    return player.last_action.timestamp;
                }
                return player.last_action?.relative || null;
            case "bs_estimate_human":
                return parseBattlestatValue(player.bs_estimate_human);
            case "id":
            case "level":
            case "attacks":
                return Number(player[column]);
            default:
                return player[column];
        }
    }

    function parseBattlestatValue(value) {
        if (value === undefined || value === null || value === "--") return null;
        if (typeof value === "number") return value;
        if (typeof value !== "string") return value;

        const cleaned = value.replace(/,/g, "").trim();
        const lower = cleaned.toLowerCase();
        let multiplier = 1;

        if (lower.endsWith("b")) multiplier = 1e9;
        else if (lower.endsWith("m")) multiplier = 1e6;
        else if (lower.endsWith("k")) multiplier = 1e3;

        const numeric = parseFloat(cleaned);
        if (Number.isNaN(numeric)) return lower;
        return numeric * multiplier;
    }

    function deriveBsEstimateNumber(player) {
        const parsedDirect = parseBattlestatValue(player?.bs_estimate);
        if (typeof parsedDirect === "number" && !Number.isNaN(parsedDirect)) {
            return parsedDirect;
        }

        const parsedHuman = parseBattlestatValue(player?.bs_estimate_human);
        if (typeof parsedHuman === "number" && !Number.isNaN(parsedHuman)) {
            return parsedHuman;
        }

        return null;
    }

    function compareValues(a, b, direction) {
        const multiplier = direction === "asc" ? 1 : -1;

        if (a === b) return 0;
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;

        const aNum = typeof a === "number" ? a : Number(a);
        const bNum = typeof b === "number" ? b : Number(b);
        const aIsNum = !Number.isNaN(aNum);
        const bIsNum = !Number.isNaN(bNum);

        if (aIsNum && bIsNum) {
            if (aNum === bNum) return 0;
            return aNum > bNum ? multiplier : -multiplier;
        }

        const aStr = a.toString();
        const bStr = b.toString();
        return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: "base" }) * multiplier;
    }

    function formatTeamValue(value) {
        if (value === undefined || value === null || value === "") return "--";
        return value;
    }

    function renderTeams() {
        ensureValidSelectedTeam();
        const selected = state.selectedTeamId;
        dom.teamTableBody.innerHTML = "";

        const teams = sortTeamsList(state.teams);

        for (const t of teams) {
            const row = document.createElement("tr");
            if (t.id === selected) row.classList.add("selected-row");
            if (t.eliminated === true) row.classList.add("eliminated-row");

            row.innerHTML = `
                <td>${t.id}</td>
                <td>${t.name}</td>
                <td>${formatTeamValue(t.participants)}</td>
                <td>${formatTeamValue(t.score)}</td>
                <td>${formatTeamValue(t.wins)}</td>
                <td>${formatTeamValue(t.losses)}</td>
                <td>${formatTeamValue(t.lives)}</td>
                <td>${formatTeamValue(t.position)}</td>
                <td>${formatTeamValue(t.eliminated)}</td>
            `;

            row.addEventListener("click", () => handleTeamSelect(t.id));
            dom.teamTableBody.appendChild(row);
        }

        updateSortIndicators("team");
    }

    async function handleTeamSelect(teamId) {
        state.saveSelectedTeamId(teamId);
        state.selectedPlayersByTeam[teamId] = state.selectedPlayersByTeam[teamId] || null;
        renderTeams();
        await refreshTeamPlayers(false);
    }

    function handlePlayerSelect(teamId, playerId) {
        const currentSelected = state.selectedPlayersByTeam[teamId];
        state.selectedPlayersByTeam[teamId] = currentSelected === playerId ? null : playerId;
        renderPlayers();
    }

    async function refreshTeamPlayers(force = false) {
        const teamId = state.selectedTeamId;
        if (!teamId) return;

        if (!state.apikey) {
            renderPlayers();
            return;
        }

        const inFlight = teamFetchInFlight.get(teamId);
        if (inFlight) {
            await inFlight;
            renderPlayers();
            return;
        }

        const now = Date.now();
        const lastStart = teamRefreshStart.get(teamId) || 0;
        const should = force || state.shouldRefreshTeam(teamId, now);
        if (!should || now - lastStart < state.MIN_REFRESH_MS) {
            renderPlayers();
            return;
        }

        teamRefreshStart.set(teamId, now);
        const fetchPromise = (async () => {
            dom.teamIcon.classList.remove("hidden");

            let offset = 0;
            let combined = [];
            let callCount = 0;
            let keepPaging = true;

            while (keepPaging) {
                const data = await api.getTeamPlayers(teamId, offset, state.apikey);
                callCount++;

                if (data.error) {
                    console.error("Players fetch error:", data.error);
                    break;
                }

                const arr = (data.eliminationteam || []).map(transformPlayerFromApi);
                appendBsEstimatePlaceholders(arr);
                await maybeFetchFfScouterStats(arr);
                combined = combined.concat(arr);

                if (arr.length < 100) {
                    keepPaging = false;
                } else {
                    offset += 100;
                }
            }

            console.log(`Player refresh API calls: ${callCount}`);
            state.cacheTeamPlayers(teamId, combined);
            renderPlayers();
            dom.teamIcon.classList.add("hidden");
        })();

        teamFetchInFlight.set(teamId, fetchPromise);
        try {
            await fetchPromise;
        } finally {
            teamFetchInFlight.delete(teamId);
        }
    }

    function applyFilters(players) {
        const levelMin = parseInt(dom.levelMinInput.value || 0, 10);
        const levelMax = parseInt(dom.levelMaxInput.value || 100, 10);
        const bsMinInputVal = dom.bsMinInput.value.trim();
        const bsMaxInputVal = dom.bsMaxInput.value.trim();
        const bsMin = parseBattlestatValue(bsMinInputVal);
        const bsMax = parseBattlestatValue(bsMaxInputVal);
        const okayOnly = dom.filterOkayOnly.checked;
        const locationSelection = dom.locationFilter.value;

        const hasBsMin = bsMinInputVal !== "" && typeof bsMin === "number" && !Number.isNaN(bsMin);
        const hasBsMax = bsMaxInputVal !== "" && typeof bsMax === "number" && !Number.isNaN(bsMax);

        return players.filter(p => {
            const statusText = simplifyStatus(p.status);
            const playerLocation = p.location;
            if (p.level < levelMin || p.level > levelMax) return false;
            const bsValue = typeof p.bs_estimate === "number" ? p.bs_estimate : parseBattlestatValue(p.bs_estimate);
            const bsIsNumber = typeof bsValue === "number" && !Number.isNaN(bsValue);
            if (hasBsMin && (!bsIsNumber || bsValue < bsMin)) return false;
            if (hasBsMax && (!bsIsNumber || bsValue > bsMax)) return false;
            if (okayOnly) {
                const isOkayStatus = statusText === "Okay" || statusText.startsWith("In ");
                const isHospital = p.status?.state === "Hospital";
                if (!isOkayStatus || isHospital) return false;
            }
            if (locationSelection === "all") return true;

            if (locationSelection === "torn") {
                return playerLocation === LOCATION.TORN || (!playerLocation && st !== "Traveling" && st !== "Abroad");
            }

            if (locationSelection === "abroad") {
                return playerLocation && playerLocation !== LOCATION.TORN && !playerLocation.startsWith("Traveling ");
            }

            if (locationSelection === "traveling") {
                return typeof playerLocation === "string" && playerLocation.startsWith("Traveling ");
            }

            return playerLocation === locationSelection;
        });
    }

    function updateLocationFilterOptions(players) {
        const destinations = new Set();
        const travelingDestinations = new Set();

        players.forEach(p => {
            const loc = p.location;
            if (!loc || loc === LOCATION.TORN) return;
            if (loc.startsWith("Traveling ")) {
                travelingDestinations.add(loc);
            } else {
                destinations.add(loc);
            }
        });

        const previous = dom.locationFilter.value || "all";
        dom.locationFilter.innerHTML = "";

        const baseOptions = [
            { value: "all", label: "All" },
            { value: "torn", label: "Torn" },
            { value: "abroad", label: "Abroad (not in Torn)" },
            { value: "traveling", label: "Traveling" }
        ];

        const validValues = new Set();

        baseOptions.forEach(({ value, label }) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            dom.locationFilter.appendChild(opt);
            validValues.add(value);
        });

        Array.from(destinations)
            .sort((a, b) => a.localeCompare(b))
            .forEach(dest => {
                const opt = document.createElement("option");
                opt.value = dest;
                opt.textContent = dest;
                dom.locationFilter.appendChild(opt);
                validValues.add(dest);
            });

        Array.from(travelingDestinations)
            .sort((a, b) => a.localeCompare(b))
            .forEach(dest => {
                const opt = document.createElement("option");
                opt.value = dest;
                opt.textContent = dest;
                dom.locationFilter.appendChild(opt);
                validValues.add(dest);
            });

        if (validValues.has(previous)) {
            dom.locationFilter.value = previous;
        }
    }

    function renderPlayers() {
        const teamId = state.selectedTeamId;
        if (!teamId) {
            dom.playerTableBody.innerHTML = "";
            updateSortIndicators("player");
            return;
        }

        const players = (state.teamPlayers[teamId] || []).map(ensurePlayerDefaults);
        state.teamPlayers[teamId] = players;

        const selectedPlayerId = state.selectedPlayersByTeam[teamId] || null;

        updateLocationFilterOptions(players);
        const filtered = applyFilters(players);
        const sortedPlayers = sortPlayersList(filtered);

        const scrollContainer = dom.playerTableBody.parentElement;
        const prevScroll = scrollContainer ? scrollContainer.scrollTop : 0;

        dom.playerTableBody.innerHTML = "";

        const nowSec = Math.floor(Date.now() / 1000);

        for (const p of sortedPlayers) {
            const row = document.createElement("tr");
            const baseStatusText = simplifyStatus(p.status);
            const hospitalUntil = p.status.until;
            let statusClass = mapStateColor(p.status.state);
            let statusCellContent = baseStatusText;

            if (p.status.state === "Hospital" && hospitalUntil) {
                const remaining = hospitalUntil - nowSec;
                const countdownText = formatHMS(Math.max(0, remaining));
                statusClass = getHospitalCountdownClass(remaining);
                const loc = extractHospitalLocation(p.status);
                statusCellContent = `In hospital (${loc}) for <span class="countdown" data-until="${hospitalUntil}">${countdownText}</span>`;
            }

            const attackUrl = `https://www.torn.com/loader.php?sid=attack&user2ID=${p.id}`;

            row.innerHTML = `
                <td><a href="https://www.torn.com/profiles.php?XID=${p.id}" target="_blank" rel="noopener noreferrer">${p.id}</a></td>
                <td>${p.name}</td>
                <td>${p.level}</td>
                <td class="status-cell ${statusClass}">${statusCellContent}</td>
                <td>${p.last_action.relative}</td>
                <td>${p.attacks}</td>
                <td><a href="${attackUrl}" target="_blank" rel="noopener noreferrer">${p.bs_estimate_human || "--"}</a></td>
            `;

            const rawCell = document.createElement("td");
            rawCell.classList.add("hidden", "raw-data-cell");
            rawCell.textContent = JSON.stringify(p.rawData || {}, null, 0);
            row.appendChild(rawCell);

            if (selectedPlayerId === p.id) row.classList.add("selected-row");
            row.addEventListener("click", () => handlePlayerSelect(teamId, p.id));

            dom.playerTableBody.appendChild(row);
        }

        if (scrollContainer) scrollContainer.scrollTop = prevScroll;
        startCountdownUpdater();
        updateSortIndicators("player");
    }

    function startCountdownUpdater() {
        if (intervals.countdown) clearInterval(intervals.countdown);
        intervals.countdown = setInterval(() => {
            document.querySelectorAll(".countdown[data-until]").forEach(el => {
                const untilSec = parseInt(el.getAttribute("data-until"), 10);
                const nowSec = Math.floor(Date.now() / 1000);
                const remaining = untilSec - nowSec;
                const cell = el.closest(".status-cell");

                if (remaining <= 0) {
                    if (cell) {
                        cell.textContent = "Okay";
                        cell.className = "status-cell state-green";
                    }
                    el.removeAttribute("data-until");
                    return;
                }

                const colorClass = getHospitalCountdownClass(remaining);
                el.textContent = formatHMS(remaining);
                if (cell) cell.className = `status-cell ${colorClass}`;
            });
        }, 1000);
    }

    function formatHMS(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function getHospitalCountdownClass(remaining) {
        if (remaining < 10) return "state-red";
        if (remaining < 60) return "state-orange";
        return "state-yellow";
    }

    function mapStateColor(stateValue) {
        switch (stateValue) {
            case "Hospital": return "state-orange";
            case "Traveling": return "state-blue";
            case "Abroad": return "state-blue";
            case "Okay": return "state-green";
            default: return "";
        }
    }

    function attachFilterListeners() {
        dom.levelMinInput.addEventListener("change", renderPlayers);
        dom.levelMaxInput.addEventListener("change", renderPlayers);
        dom.bsMinInput.addEventListener("change", renderPlayers);
        dom.bsMaxInput.addEventListener("change", renderPlayers);
        dom.filterOkayOnly.addEventListener("change", renderPlayers);
        dom.locationFilter.addEventListener("change", renderPlayers);
    }

    function startMetadataCountdown() {
        if (intervals.metadata) clearInterval(intervals.metadata);
        intervals.metadata = setInterval(() => {
            const remaining = state.METADATA_REFRESH_MS - (Date.now() - state.metadataTimestamp);
            dom.metadataTimerLabel.textContent = `Next refresh: ${Math.max(0, Math.floor(remaining / 1000))}s`;
            if (remaining <= 0) refreshMetadata();
        }, 1000);
    }

    function startTeamCountdown() {
        if (intervals.team) clearInterval(intervals.team);
        intervals.team = setInterval(() => {
            const teamId = state.selectedTeamId;
            if (!teamId) {
                dom.teamTimerLabel.textContent = "Next refresh: --";
                return;
            }
            const last = state.teamPlayersTimestamp[teamId] || 0;
            const remaining = state.TEAM_REFRESH_MS - (Date.now() - last);
            dom.teamTimerLabel.textContent = `Next refresh: ${Math.max(0, Math.floor(remaining / 1000))}s`;
            if (remaining <= 0 && isTeamSectionVisible()) refreshTeamPlayers();
        }, 1000);
    }

    function isTeamSectionVisible() {
        return !dom.playerTableBody.closest("section").classList.contains("hidden");
    }

    window.app = {
        init,
        simplifyStatus,
        mapStateColor,
        formatHMS,
        applyFilters,
        getHospitalCountdownClass,
        renderPlayers
    };

    init();
})();
