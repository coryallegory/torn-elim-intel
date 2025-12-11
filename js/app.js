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
        playerTableBody: document.getElementById("player-table-body"),
        levelMinInput: document.getElementById("level-min"),
        levelMaxInput: document.getElementById("level-max"),
        filterOkayOnly: document.getElementById("filter-okay-only"),
        locationFilter: document.getElementById("location-filter"),
        metadataTimerLabel: document.getElementById("metadata-refresh-timer"),
        metadataIcon: document.getElementById("metadata-refresh-icon"),
        teamTimerLabel: document.getElementById("team-refresh-timer"),
        teamIcon: document.getElementById("team-refresh-icon")
    };

    const intervals = { metadata: null, team: null, countdown: null };
    const teamFetchInFlight = new Map();
    const teamRefreshStart = new Map();
    let metadataRefreshInFlight = null;
    let metadataRefreshStart = 0;

    function init() {
        state.loadFromStorage();
        dom.apikeyInput.value = state.apikey || "";
        dom.ffapikeyInput.value = state.ffapikey || "";

        if (state.apikey) {
            validateAndStart();
        } else {
            showNoKey();
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
    }

    async function validateAndStart() {
        dom.apikeyStatus.textContent = "Validating...";
        dom.apikeyStatus.classList.remove("status-error");

        const data = await api.getUser(state.apikey);
        if (data.error || !data.profile) {
            dom.apikeyStatus.textContent = "API key invalid";
            dom.apikeyStatus.classList.add("status-error");
            stopIntervals();
            return;
        }

        state.user = data.profile;
        dom.apikeyStatus.textContent = "API key loaded";
        dom.apikeyStatus.classList.remove("status-error");
        dom.userBox.classList.remove("hidden");

        renderUserInfo();
        refreshMetadata(true);
        startMetadataCountdown();
        startTeamCountdown();
    }

    function stopIntervals() {
        if (intervals.metadata) clearInterval(intervals.metadata);
        if (intervals.team) clearInterval(intervals.team);
        if (intervals.countdown) clearInterval(intervals.countdown);
        intervals.metadata = intervals.team = intervals.countdown = null;
    }

    function showNoKey() {
        dom.apikeyStatus.textContent = "No API key loaded";
        dom.apikeyStatus.classList.add("status-error");
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

    async function maybeFetchFfScouterStats(players) {
        if (!state.ffApiKeyValid || !state.ffapikey || !players.length) return;
        const idsCsv = players.map(p => p.id).join(",");

        try {
            const data = await api.getFfStats(state.ffapikey, idsCsv);
            const statsMap = buildFfStatsMap(data);
            players.forEach(p => {
                const val = statsMap.get(p.id);
                if (val) {
                    p.bs_estimate_human = val;
                }
            });
        } catch (err) {
            console.error("Failed to fetch FFScouter stats", err);
        }
    }

    function buildFfStatsMap(resp) {
        const map = new Map();
        if (!resp || resp.error) return map;

        const candidates = [resp.players, resp.data && resp.data.players, resp.data, resp.stats, resp.result];
        candidates.forEach(container => {
            if (!container) return;
            if (Array.isArray(container)) {
                container.forEach(entry => {
                    const id = entry.player_id || entry.id || entry.user_id || entry.torn_id || entry.tornid;
                    if (id === undefined || id === null) return;
                    const bs = entry.bs_estimate_human || entry.bs_estimate || entry.bsEstimateHuman || entry.bs_estimate_human_text;
                    if (bs !== undefined) {
                        const numericId = parseInt(id, 10);
                        map.set(Number.isNaN(numericId) ? id : numericId, bs);
                    }
                });
            } else if (typeof container === "object") {
                Object.entries(container).forEach(([key, value]) => {
                    if (value && typeof value === "object") {
                        const bs = value.bs_estimate_human || value.bs_estimate || value.bsEstimateHuman || value.bs_estimate_human_text;
                        if (bs !== undefined) {
                            const numericId = parseInt(key, 10);
                            map.set(Number.isNaN(numericId) ? key : numericId, bs);
                        }
                    }
                });
            }
        });

        return map;
    }

    function renderTeams() {
        const selected = state.selectedTeamId;
        dom.teamTableBody.innerHTML = "";

        for (const t of state.teams) {
            const row = document.createElement("tr");
            if (t.id === selected) row.classList.add("selected-row");

            row.innerHTML = `
                <td>${t.id}</td>
                <td>${t.name}</td>
                <td>${t.participants}</td>
                <td>${t.score}</td>
                <td>${t.wins}</td>
                <td>${t.losses}</td>
                <td>${t.lives}</td>
                <td>${t.position}</td>
                <td>${t.eliminated}</td>
            `;

            row.addEventListener("click", () => handleTeamSelect(t.id));
            dom.teamTableBody.appendChild(row);
        }
    }

    async function handleTeamSelect(teamId) {
        state.selectedTeamId = teamId;
        renderTeams();
        await refreshTeamPlayers(false);
    }

    async function refreshTeamPlayers(force = false) {
        const teamId = state.selectedTeamId;
        if (!teamId) return;

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

                const arr = data.eliminationteam || [];
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
        const okayOnly = dom.filterOkayOnly.checked;
        const locationSelection = dom.locationFilter.value;

        return players.filter(p => {
            const st = p.status.state;
            if (p.level < levelMin || p.level > levelMax) return false;
            if (okayOnly && st !== "Okay") return false;
            if (locationSelection === "all") return true;

            const destination = getAbroadDestination(p.status) || "Unknown";
            if (locationSelection === "torn") {
                return st !== "Abroad" && st !== "Traveling";
            }
            if (locationSelection === "abroad") {
                return st === "Abroad" || st === "Traveling";
            }
            if (locationSelection === "traveling") {
                return st === "Traveling";
            }
            return (st === "Abroad" || st === "Traveling") && destination === locationSelection;
        });
    }

    function updateLocationFilterOptions(players) {
        const destinations = new Set();
        players.forEach(p => {
            if (p.status.state === "Abroad" || p.status.state === "Traveling") {
                destinations.add(getAbroadDestination(p.status) || "Unknown");
            }
        });

        const previous = dom.locationFilter.value || "all";
        dom.locationFilter.innerHTML = "";

        const defaultOpt = document.createElement("option");
        defaultOpt.value = "all";
        defaultOpt.textContent = "All";
        dom.locationFilter.appendChild(defaultOpt);

        const tornOpt = document.createElement("option");
        tornOpt.value = "torn";
        tornOpt.textContent = "Torn";
        dom.locationFilter.appendChild(tornOpt);

        const abroadOpt = document.createElement("option");
        abroadOpt.value = "abroad";
        abroadOpt.textContent = "Abroad (not in Torn)";
        dom.locationFilter.appendChild(abroadOpt);

        const travelingOpt = document.createElement("option");
        travelingOpt.value = "traveling";
        travelingOpt.textContent = "Traveling";
        dom.locationFilter.appendChild(travelingOpt);

        Array.from(destinations)
            .sort((a, b) => a.localeCompare(b))
            .forEach(dest => {
                const opt = document.createElement("option");
                opt.value = dest;
                opt.textContent = dest;
                dom.locationFilter.appendChild(opt);
            });

        const staticOptions = new Set(["all", "torn", "abroad", "traveling"]);
        if (staticOptions.has(previous)) {
            dom.locationFilter.value = previous;
        } else if (Array.from(destinations).includes(previous)) {
            dom.locationFilter.value = previous;
        }
    }

    function renderPlayers() {
        const teamId = state.selectedTeamId;
        if (!teamId) {
            dom.playerTableBody.innerHTML = "";
            return;
        }

        const players = state.teamPlayers[teamId] || [];
        updateLocationFilterOptions(players);
        const filtered = applyFilters(players);

        const scrollContainer = dom.playerTableBody.parentElement;
        const prevScroll = scrollContainer ? scrollContainer.scrollTop : 0;

        dom.playerTableBody.innerHTML = "";

        const nowSec = Math.floor(Date.now() / 1000);

        for (const p of filtered) {
            const row = document.createElement("tr");
            const baseStatusText = simplifyStatus(p.status);
            const hospitalUntil = p.status.until;
            let statusClass = mapStateColor(p.status.state);
            let statusCellContent = baseStatusText;

            if (p.status.state === "Hospital" && hospitalUntil) {
                const remaining = hospitalUntil - nowSec;
                const countdownText = formatHMS(Math.max(0, remaining));
                statusClass = getHospitalCountdownClass(remaining);
                statusCellContent = `In hospital for <span class="countdown" data-until="${hospitalUntil}">${countdownText}</span>`;
            }

            row.innerHTML = `
                <td>${p.id}</td>
                <td>${p.name}</td>
                <td>${p.level}</td>
                <td class="status-cell ${statusClass}">${statusCellContent}</td>
                <td>${p.last_action.relative}</td>
                <td>${p.attacks}</td>
                <td>${p.bs_estimate_human || "--"}</td>
            `;

            dom.playerTableBody.appendChild(row);
        }

        if (scrollContainer) scrollContainer.scrollTop = prevScroll;
        startCountdownUpdater();
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
