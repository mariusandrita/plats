#!/usr/bin/env python3
"""Sync earned Platinum trophies from PSN into data/platinums.json.

For each platinum, also records the trophy that actually unlocked it (the
last non-platinum trophy earned in that game) plus rarity/earn-rate stats
for both, so the showcase can show "how it happened", not just that it did.

Usage:
    python3 scripts/sync_platinums.py <npsso>

The NPSSO token is read only from the command line argument — it is never
written to disk or logged. Get a fresh one by logging into
https://www.playstation.com then visiting
https://ca.account.sony.com/api/v1/ssocookie (copy the "npsso" value).
NPSSO tokens last ~2 months.
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CLIENT_ID = "09515159-7237-4370-9b40-3806e67c0891"
CLIENT_SECRET = "ucPjka5tntB2KqsP"
REDIRECT_URI = "com.scee.psxandroid.scecompcall://redirect"
SCOPE = "psn:mobile.v2.core psn:clientapp"
AUTH_URL = "https://ca.account.sony.com/api/authz/v3/oauth/authorize"
TOKEN_URL = "https://ca.account.sony.com/api/authz/v3/oauth/token"
HEADERS = {"User-Agent": "PlayStation/21090100 CFNetwork/1126", "Accept-Language": "en-US"}

RARITY_LABELS = {0: "Ultra Rare", 1: "Very Rare", 2: "Rare", 3: "Common"}

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "platinums.json")


def http(url, headers=None, data=None, method="GET"):
    req = urllib.request.Request(url, headers=headers or {}, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def get_access_token(npsso: str) -> str:
    params = {
        "access_type": "offline",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={**HEADERS, "Cookie": f"npsso={npsso}"})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        resp = opener.open(req, timeout=20)
        location = resp.headers.get("Location", "")
    except urllib.error.HTTPError as e:
        location = e.headers.get("Location", "")

    m = re.search(r"code=([^&]+)", location)
    if not m:
        print("Could not get an auth code — NPSSO is likely invalid or expired.", file=sys.stderr)
        sys.exit(1)

    body = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": m.group(1),
        "redirect_uri": REDIRECT_URI,
        "token_format": "jwt",
    }).encode()
    basic = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    status, data = http(TOKEN_URL, headers={
        **HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": f"Basic {basic}",
    }, data=body, method="POST")
    if status != 200:
        print(f"Token exchange failed: {status} {data}", file=sys.stderr)
        sys.exit(1)
    return json.loads(data)["access_token"]


def fetch_trophy_titles(auth_headers):
    all_titles, offset = [], 0
    while True:
        url = f"https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles?limit=100&offset={offset}"
        status, data = http(url, headers=auth_headers)
        if status != 200:
            print(f"trophyTitles error {status}", file=sys.stderr)
            break
        j = json.loads(data)
        page = j.get("trophyTitles", [])
        all_titles.extend(page)
        offset += len(page)
        if offset >= j.get("totalItemCount", 0) or not page:
            break
    return all_titles


def fetch_game_trophies(np_comm_id, auth_headers):
    """Returns (earned_list, defs_by_id) for one game, or (None, None) on failure."""
    earned_url = f"https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds/{np_comm_id}/trophyGroups/all/trophies"
    defs_url = f"https://m.np.playstation.com/api/trophy/v1/npCommunicationIds/{np_comm_id}/trophyGroups/all/trophies"

    status, data = http(earned_url, headers=auth_headers)
    svc_suffix = ""
    if status != 200:
        # PS4-era / legacy titles live under the older "trophy" service, not the
        # PS5-default "trophy2" service — retry once with that before giving up.
        svc_suffix = "?npServiceName=trophy"
        status, data = http(earned_url + svc_suffix, headers=auth_headers)
    if status != 200:
        return None, None

    earned = json.loads(data).get("trophies", [])

    def_status, def_data = http(defs_url + svc_suffix, headers=auth_headers)
    defs_by_id = {}
    if def_status == 200:
        for t in json.loads(def_data).get("trophies", []):
            defs_by_id[t["trophyId"]] = t

    return earned, defs_by_id


def describe_trophy(earned_entry, defs_by_id):
    d = defs_by_id.get(earned_entry["trophyId"], {})
    return {
        "name": d.get("trophyName"),
        "detail": d.get("trophyDetail"),
        "icon_url": d.get("trophyIconUrl"),
        "type": earned_entry.get("trophyType"),
        "rarity": RARITY_LABELS.get(earned_entry.get("trophyRare")),
        "earned_rate": earned_entry.get("trophyEarnedRate"),
        "earned_at": earned_entry.get("earnedDateTime"),
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/sync_platinums.py <npsso>", file=sys.stderr)
        sys.exit(1)
    npsso = sys.argv[1]

    access_token = get_access_token(npsso)
    auth_headers = {**HEADERS, "Authorization": f"Bearer {access_token}"}

    titles = fetch_trophy_titles(auth_headers)
    plat_games = [t for t in titles if t.get("earnedTrophies", {}).get("platinum", 0) >= 1]
    print(f"{len(titles)} games total, {len(plat_games)} with a platinum", file=sys.stderr)

    results = []
    for t in plat_games:
        np_comm_id = t["npCommunicationId"]
        earned, defs_by_id = fetch_game_trophies(np_comm_id, auth_headers)
        if earned is None:
            print(f"  skip: {t['trophyTitleName']} (no trophy data)", file=sys.stderr)
            continue

        earned_only = [e for e in earned if e.get("earned")]
        platinum = next((e for e in earned_only if e.get("trophyType") == "platinum"), None)
        if not platinum:
            print(f"  skip: {t['trophyTitleName']} (no earned platinum?)", file=sys.stderr)
            continue

        non_plat_earned = [e for e in earned_only if e.get("trophyType") != "platinum"]
        last_trophy_entry = max(non_plat_earned, key=lambda e: e.get("earnedDateTime") or "", default=None)

        entry = {
            "game_title": t["trophyTitleName"],
            "platform": t.get("trophyTitlePlatform"),
            "np_communication_id": np_comm_id,
            "game_icon_url": t.get("trophyTitleIconUrl"),
            "total_trophies": len(earned),
            "platinum": describe_trophy(platinum, defs_by_id),
            "unlocked_by": describe_trophy(last_trophy_entry, defs_by_id) if last_trophy_entry else None,
            "earned_at": platinum.get("earnedDateTime"),
        }
        results.append(entry)
        print(f"  ok: {t['trophyTitleName']} -> {entry['earned_at']} (unlocked by: {entry['unlocked_by']['name'] if entry['unlocked_by'] else '?'})", file=sys.stderr)
        time.sleep(0.15)

    results.sort(key=lambda r: r["earned_at"] or "", reverse=True)

    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(results)} platinums to {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
