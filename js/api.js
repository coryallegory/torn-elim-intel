window.api = {
    BASE: "https://api.torn.com/v2",

    async request(url, apikey) {
        try {
            const res = await fetch(url + `&key=${apikey}`);
            const data = await res.json();

            // Log errors
            if (data.error) {
                console.error("API Error:", data.error);
                return { error: data.error };
            }

            return data;
        } catch (err) {
            console.error("Network/API exception:", err);
            return { error: { code: -1, error: "Network error" } };
        }
    },

    getUser(apikey) {
        return this.request(`${this.BASE}/user/?selections=profile`, apikey);
    },

    getTeams(apikey) {
        return this.request(`${this.BASE}/torn/elimination/?elimination=true`, apikey);
    },

    getTeamPlayers(teamId, offset, apikey) {
        return this.request(
            `${this.BASE}/torn/${teamId}/eliminationteam?limit=100&offset=${offset}`,
            apikey
        );
    }
};

// legacy handle
window.TornAPI = window.api;
