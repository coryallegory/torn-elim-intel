(function () {
    // DOM refs
    const apikeyInput = document.getElementById("apikey-input");
    const apikeyStatus = document.getElementById("apikey-status");
    const apikeyApply = document.getElementById("apikey-apply");

    const userBox = document.getElementById("userinfo-box");
    const userInfoContent = document.getElementById("user-info-content");

    const teamTableBody = document.getElementById("team-table-body");

    const playerTableBody = document.getElementById("player-table-body");
    const levelMinInput = document.getElementById("level-min");
    const levelMaxInput = document.getElementById("level-max");
    const filterOkayOnly = document.getElementById("filter-okay-only");
    const filterTraveling = document.getElementById("filter-include-traveling");
    const filterAbroad = document.getElementById("filter-include-abroad");

    const metadataTimerLabel = document.getElementById("metadata-refresh-timer");
    const metadataIcon = document.getElementById("metadata-refresh-icon");

    const teamTimerLabel = document.getElementById("team-refresh-timer");
    const teamIcon = document.getElementById("team-refresh-icon");

    // --------------------------
    // Initialization
    // --------------------------
    AppState.loadFromStorage();
    apikeyInput.value = AppState.apikey || "";

    if (AppState.apikey) {
        validateAndStart();
    } else {
        apikeyStatus.textContent = "No API key loaded";
        apikeyStatus.classList.add("status-error");
    }

    apikeyApply.addEventListener("click", () => {
        const key = apikeyInput.value.trim();
        if (!key) {
            apikeyStatus.textContent = "No API key loaded";
            apikeyStatus.classList.add("status-error");
            return;
        }
        AppState.saveApiKey(key);
        validateAndStart();
    });

    // --------------------------
    // Validation and bootstrap
    // --------------------------
    async function validateAndStart() {
        apikeyStatus.textContent = "Validating...";
        apikeyStatus.classList.remove("status-error");

        const data = await TornAPI.getUser(AppState.apikey);
        if (data.error) {
            apikeyStatus.textContent = "API key invalid";
            apikeyStatus.classList.add("status-error");
            return;
        }

        AppState.user = data.profile;
        apikeyStatus.textContent = "API key loaded";
        apikeyStatus.classList.remove("status-error");
        userBox.classList.remove("hidden");

        renderUserInfo();

        // Start refresh cycles
        refreshMetadata(true);
        startMetadataCountdown();
        startTeamCountdown();

        attachFilterListeners();
    }

    // --------------------------
    // Metadata Refresh (User + Teams)
    // --------------------------
    async function refreshMetadata(force = false) {
        if (!force && !AppState.shouldRefreshMetadata()) return;

        metadataIcon.classList.remove("hidden");

        const [userData, teamData] = await Promise.all([
            TornAPI.getUser(AppState.apikey),
            TornAPI.getTeams(AppState.apikey)
        ]);

        // user
        if (!userData.error) {
            AppState.user = userData.profile;
            renderUserInfo();
        } else {
            console.error("User fetch error:", userData.error);
        }

        // teams
        if (!teamData.error && teamData.elimination) {
            AppState.teams = teamData.elimination;
            renderTeams();
        } else {
            console.error("Team fetch error:", teamData.error);
        }

        AppState.metadataTimestamp = Date.now();
        metadataIcon.classList.add("hidden");
    }

    // --------------------------
    // User Info UI
    // --------------------------
    function renderUserInfo() {
        const u = AppState.user;
        if (!u) return;

        const stateColor = mapStateColor(u.status.state);
        const statusText = simplifyStatus(u.status);

        userInfoContent.innerHTML = `
            <div><strong>${u.name}</strong> [${u.level}]</div>
            <div class="${stateColor}">${statusText}</div>
        `;
    }

    function simplifyStatus(statusObj) {
        if (!statusObj) return "Unknown";

        const desc = statusObj.description || statusObj.state;
        if (desc.startsWith("Traveling to")) {
            return desc.replace("Traveling to", "Traveling (");
        } else if (desc.startsWith("Returning to Torn from")) {
            const place = desc.replace("Returning to Torn from ", "");
            return `Returning from ${place}`;
        }
        return desc;
    }

    // --------------------------
    // Team Table
    // --------------------------
    function renderTeams() {
        const selected = AppState.selectedTeamId;
        const teams = AppState.teams;

        teamTableBody.innerHTML = "";

        for (const t of teams) {
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

            teamTableBody.appendChild(row);
        }
    }

    async function handleTeamSelect(teamId) {
        AppState.selectedTeamId = teamId;
        renderTeams();
        refreshTeamPlayers(true);
    }

    // --------------------------
    // Team Players Refresh
    // --------------------------
    async function refreshTeamPlayers(force = false) {
        const teamId = AppState.selectedTeamId;
        if (!teamId) return;

        const should = force || AppState.shouldRefreshTeam(teamId);
        if (!should) {
            renderPlayers();
            return;
        }

        teamIcon.classList.remove("hidden");

        // Fetch paginated
        let offset = 0;
        let combined = [];
        let callCount = 0;

        while (true) {
            const data = await TornAPI.getTeamPlayers(teamId, offset, AppState.apikey);
            callCount++;

            if (data.error) {
                console.error("Players fetch error:", data.error);
                break;
            }

            const arr = data.eliminationteam || [];
            combined = combined.concat(arr);

            if (arr.length < 100) break;
            offset += 100;
        }

        console.log(`Player refresh API calls: ${callCount}`);

        AppState.teamPlayers[teamId] = combined;
        AppState.teamPlayersTimestamp[teamId] = Date.now();

        renderPlayers();
        teamIcon.classList.add("hidden");
    }

    // --------------------------
    // Player Rendering with Filters
    // --------------------------
    function renderPlayers() {
        const teamId = AppState.selectedTeamId;
        if (!teamId) {
            playerTableBody.innerHTML = "";
            return;
        }

        const players = AppState.teamPlayers[teamId] || [];

        const levelMin = parseInt(levelMinInput.value || 0);
        const levelMax = parseInt(levelMaxInput.value || 100);
        const okayOnly = filterOkayOnly.checked;

        const includeTraveling = document.getElementById("filter-include-traveling").checked;
        const includeAbroad = document.getElementById("filter-include-abroad").checked;

        const filtered = players.filter(p => {
            const st = p.status.state;

            if (p.level < levelMin || p.level > levelMax) return false;

            if (okayOnly && st !== "Okay") return false;

            if (st === "Traveling" && !includeTraveling) return false;
            if (st === "Abroad" && !includeAbroad) return false;

            return true;
        });

        playerTableBody.innerHTML = "";

        for (const p of filtered) {
            const row = document.createElement("tr");

            const color = mapStateColor(p.status.state);
            const statusText = simplifyStatus(p.status);

            const hospitalUntil = p.status.until;
            let hospitalCell = "";
            if (hospitalUntil) {
                hospitalCell = `<span class="${color}" data-until="${hospitalUntil}" class="countdown"></span>`;
            }

            row.innerHTML = `
                <td>${p.id}</td>
                <td>${p.name}</td>
                <td>${p.level}</td>
                <td class="${color}">${statusText}</td>
                <td>${p.last_action.relative}</td>
                <td>${p.attacks}</td>
                <td>${p.score}</td>
                <td>${hospitalCell}</td>
            `;

            playerTableBody.appendChild(row);
        }

        startCountdownUpdater();
    }

    // --------------------------
    // Countdown (Hospital Only)
    // --------------------------
    let countdownInterval = null;

    function startCountdownUpdater() {
        if (countdownInterval) clearInterval(countdownInterval);

        countdownInterval = setInterval(() => {
            document.querySelectorAll("[data-until]").forEach(el => {
                const untilSec = parseInt(el.getAttribute("data-until"));
                const nowSec = Math.floor(Date.now() / 1000);
                let remaining = untilSec - nowSec;

                let colorClass = "state-green";
                if (remaining < 60) colorClass = "state-orange";
                if (remaining < 10) colorClass = "state-red";

                el.className = colorClass;

                if (remaining >= 0) {
                    el.textContent = formatHMS(remaining);
                } else {
                    el.textContent = "-" + formatHMS(Math.abs(remaining));
                }
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

    function mapStateColor(state) {
        switch (state) {
            case "Hospital": return "state-orange";
            case "Traveling": return "state-blue";
            case "Abroad": return "state-blue";
            case "Okay": return "state-green";
            default: return "";
        }
    }

    // --------------------------
    // Filter Listeners
    // --------------------------
    function attachFilterListeners() {
        levelMinInput.addEventListener("change", renderPlayers);
        levelMaxInput.addEventListener("change", renderPlayers);
        filterOkayOnly.addEventListener("change", renderPlayers);
        filterTraveling.addEventListener("change", renderPlayers);
        filterAbroad.addEventListener("change", renderPlayers);
    }

    // --------------------------
    // Countdown Timers
    // --------------------------
    function startMetadataCountdown() {
        setInterval(() => {
            const remaining = AppState.METADATA_REFRESH_MS - (Date.now() - AppState.metadataTimestamp);
            metadataTimerLabel.textContent = `Next refresh: ${Math.max(0, Math.floor(remaining / 1000))}s`;
            if (remaining <= 0) refreshMetadata();
        }, 1000);
    }

    function startTeamCountdown() {
        setInterval(() => {
            const teamId = AppState.selectedTeamId;
            if (!teamId) {
                teamTimerLabel.textContent = "Next refresh: --";
                return;
            }

            const last = AppState.teamPlayersTimestamp[teamId] || 0;
            const remaining = AppState.TEAM_REFRESH_MS - (Date.now() - last);
            teamTimerLabel.textContent = `Next refresh: ${Math.max(0, Math.floor(remaining / 1000))}s`;

            if (remaining <= 0) refreshTeamPlayers();
        }, 1000);
    }

})();
