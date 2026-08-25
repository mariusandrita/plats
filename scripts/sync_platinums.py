#!/usr/bin/env python3
"""Sync earned Platinum trophies from PSN into data/platinums.json.

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


def fetch_platinum(np_comm_id, auth_headers):
    """Returns (earned_at, trophy_name, trophy_detail, icon_url) or None."""
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
        return None

    plat = next(
        (t for t in json.loads(data).get("trophies", []) if t.get("trophyType") == "platinum" and t.get("earned")),
        None,
    )
    if not plat:
        return None

    def_status, def_data = http(defs_url + svc_suffix, headers=auth_headers)
    plat_def = {}
    if def_status == 200:
        plat_def = next(
            (t for t in json.loads(def_data).get("trophies", []) if t.get("trophyType") == "platinum"),
            {},
        ) or {}

    return (
        plat.get("earnedDateTime"),
        plat_def.get("trophyName"),
        plat_def.get("trophyDetail"),
        plat_def.get("trophyIconUrl"),
    )


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
        found = fetch_platinum(np_comm_id, auth_headers)
        if not found:
            print(f"  skip: {t['trophyTitleName']} (no trophy data)", file=sys.stderr)
            continue
        earned_at, name, detail, icon_url = found
        results.append({
            "game_title": t["trophyTitleName"],
            "platform": t.get("trophyTitlePlatform"),
            "np_communication_id": np_comm_id,
            "game_icon_url": t.get("trophyTitleIconUrl"),
            "platinum_trophy_name": name,
            "platinum_trophy_detail": detail,
            "platinum_icon_url": icon_url,
            "earned_at": earned_at,
        })
        print(f"  ok: {t['trophyTitleName']} -> {earned_at}", file=sys.stderr)
        time.sleep(0.15)

    results.sort(key=lambda r: r["earned_at"] or "", reverse=True)

    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(results)} platinums to {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
