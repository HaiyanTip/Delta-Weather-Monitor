import os
import sys
import json
import ssl
import time
import argparse
import urllib.request
from datetime import datetime
import pandas as pd
import pytz

sys.stdout.reconfigure(encoding='utf-8')

# --- CONFIGURATION ---
MASTER_CSV = "thanjavur_stations_rainfall_2026.csv"
BACKUP_CSV = r"E:\X\thanjavur_stations_rainfall_2026.csv"
SECRETS_FILE = "secrets.json"
IST = pytz.timezone('Asia/Kolkata')
NUM_DISTRICTS = 38
EXPECTED_STATIONS = 566


def get_api_url():
    """Retrieve secret API URL from environment variable or secrets.json."""
    env_url = os.environ.get("TNSMART_API_URL")
    if env_url:
        return env_url.strip()

    if os.path.exists(SECRETS_FILE):
        try:
            with open(SECRETS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                url = data.get("API_RAIN_URL")
                if url and "PASTE_" not in url:
                    return url.strip()
        except Exception as e:
            print(f"Warning: Could not read {SECRETS_FILE}: {e}")

    print("\n❌ Error: API URL not configured!")
    print(f"Please either create '{SECRETS_FILE}' (see secrets.example.json) or set the 'TNSMART_API_URL' environment variable.")
    sys.exit(1)


def build_metadata_lookup(master_csv_path):
    """
    Builds a metadata dictionary from the master CSV to guarantee exact matching
    of Sl_No, Location_Details, Started_On, Latitude, Longitude, and Status.
    """
    if not os.path.exists(master_csv_path):
        raise FileNotFoundError(f"Master CSV '{master_csv_path}' not found!")

    master_df = pd.read_csv(master_csv_path, low_memory=False)

    # Use 03-11-2026 or any date with the full 566-station network
    ref_df = master_df[master_df["Date"] == "03-11-2026"].copy()
    if len(ref_df) < EXPECTED_STATIONS:
        date_counts = master_df["Date"].value_counts()
        complete_dates = date_counts[date_counts == EXPECTED_STATIONS].index
        if not complete_dates.empty:
            ref_df = master_df[master_df["Date"] == complete_dates[0]].copy()
        else:
            ref_df = master_df.drop_duplicates(subset=["Sl_No"]).copy()

    ref_df["Sl_No"] = pd.to_numeric(ref_df["Sl_No"], errors="coerce")
    ref_df = ref_df.sort_values(by="Sl_No")

    lookup = {}
    for _, r in ref_df.iterrows():
        st_name = str(r["Station_Name"]).strip()
        sl = int(r["Sl_No"])
        meta = {
            "Sl_No": sl,
            "Station_Name": r["Station_Name"],
            "Location_Details": r.get("Location_Details", ""),
            "Started_On": r.get("Started_On", ""),
            "Latitude": r["Latitude"],
            "Longitude": r["Longitude"],
            "Status": r.get("Status", "Working")
        }
        # Disambiguate duplicate station names across districts
        if st_name == "Papanasam":
            if sl == 346:
                lookup[("Thanjavur", "Papanasam")] = meta
            else:
                lookup[("Tirunelveli", "Papanasam")] = meta
        else:
            lookup[st_name] = meta

    return lookup


def match_station_meta(meta_lookup, district_name, station_name):
    """Matches an API record to the master station metadata."""
    st_clean = station_name.strip()
    dist_clean = district_name.strip()
    if st_clean == "Papanasam":
        return meta_lookup.get((dist_clean, st_clean))
    return meta_lookup.get(st_clean)


def fetch_district_data(api_base_url, target_date_str, district_id, ssl_ctx, max_retries=4):
    """Fetches rainfall JSON array for a single district with polite retries."""
    url = f"{api_base_url}?date={target_date_str}&id={district_id}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
        }
    )
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=12) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(1.0 + attempt * 0.5)
            else:
                print(f"\n  ✖ Failed district {district_id} after {max_retries} attempts: {e}")
                return []
    return []


def fetch_single_day(api_base_url, target_date_obj, meta_lookup):
    """Fetches rainfall data for all 38 districts for a given date and returns clean records."""
    payload_date = target_date_obj.strftime("%Y-%m-%d")
    csv_date = target_date_obj.strftime("%d-%m-%Y")

    print(f"Fetching data for: {payload_date} ({csv_date})...", end="", flush=True)

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    all_raw_items = []
    # Sequential fetch with polite delay avoids triggering server-side 403 rate limits
    for did in range(1, NUM_DISTRICTS + 1):
        items = fetch_district_data(api_base_url, payload_date, did, ssl_ctx)
        if isinstance(items, list):
            all_raw_items.extend(items)
        time.sleep(0.08)

    records = []
    unmatched = []

    for it in all_raw_items:
        st_name = it.get("station_name", "")
        dist_name = it.get("district_name", "")
        meta = match_station_meta(meta_lookup, dist_name, st_name)

        if not meta:
            unmatched.append((dist_name, st_name))
            continue

        raw_rain = it.get("rainfall_recorded", "0")
        try:
            rain_val = f"{float(raw_rain):.2f}"
        except (ValueError, TypeError):
            rain_val = "0.00"

        records.append({
            "Date": csv_date,
            "Sl_No": meta["Sl_No"],
            "Station_Name": meta["Station_Name"],
            "Location_Details": meta["Location_Details"],
            "Started_On": meta["Started_On"],
            "Latitude": meta["Latitude"],
            "Longitude": meta["Longitude"],
            "Status": meta["Status"],
            "Rainfall_mm": rain_val
        })

    if records:
        day_df = pd.DataFrame(records).sort_values(by="Sl_No")
        max_rain = day_df["Rainfall_mm"].astype(float).max()
        wet_count = (day_df["Rainfall_mm"].astype(float) > 0).sum()
        status_msg = f" ✔ {len(day_df)} stations (Max: {max_rain:.1f} mm, Rainy stations: {wet_count})"
        if unmatched:
            status_msg += f" [{len(unmatched)} unmapped new station(s)]"
        print(status_msg)
        return day_df
    else:
        print(f" ⚠ No records returned.")
        return None


def get_dates_to_sync():
    """Finds all missing or incomplete dates in the CSV sequence up to today."""
    today = datetime.now(IST).date()

    if os.path.exists(MASTER_CSV):
        try:
            df = pd.read_csv(MASTER_CSV, usecols=["Date"], low_memory=False)
            if not df.empty:
                dates = pd.to_datetime(df["Date"], format="%d-%m-%Y", errors="coerce").dropna()
                if not dates.empty:
                    # Identify dates that are missing or incomplete (< 566 stations)
                    counts_by_date = df["Date"].value_counts()
                    complete_dates = set(
                        pd.to_datetime(d, format="%d-%m-%Y").date()
                        for d, count in counts_by_date.items()
                        if count >= EXPECTED_STATIONS
                    )

                    min_date = dates.min().date()
                    all_calendar_days = pd.date_range(start=min_date, end=today).date

                    missing_or_incomplete = [
                        d for d in all_calendar_days if d not in complete_dates
                    ]

                    # Always include today so morning observations can be refreshed with evening totals
                    if today not in missing_or_incomplete:
                        missing_or_incomplete.append(today)

                    return sorted(missing_or_incomplete)
        except Exception as err:
            print(f"Could not scan CSV dates ({err}). Defaulting to today...")

    return [today]


def sync_dates(dates_to_fetch):
    """Fetches data for the given dates and updates master CSV."""
    api_url = get_api_url()
    meta_lookup = build_metadata_lookup(MASTER_CSV)

    print("Loading master CSV...")
    master_df = pd.read_csv(MASTER_CSV, low_memory=False)
    initial_rows = len(master_df)

    updated_any = False

    for target_date in dates_to_fetch:
        new_day_df = fetch_single_day(api_url, target_date, meta_lookup)
        if new_day_df is not None and not new_day_df.empty:
            csv_date = target_date.strftime("%d-%m-%Y")
            # Overwrite/clean any existing rows for this date to prevent duplicates
            master_df = master_df[master_df["Date"] != csv_date]
            master_df = pd.concat([master_df, new_day_df], ignore_index=True)
            updated_any = True

    if updated_any:
        # Save to primary repo CSV
        master_df.to_csv(MASTER_CSV, index=False)
        print(f"\n✔ Successfully saved {MASTER_CSV}: {len(master_df)} rows (+{len(master_df) - initial_rows} net rows).")

        # Sync backup if present
        if os.path.exists(BACKUP_CSV):
            try:
                master_df.to_csv(BACKUP_CSV, index=False)
                print(f"✔ Successfully synced copy at {BACKUP_CSV}.")
            except Exception as e:
                print(f"Note: Could not overwrite {BACKUP_CSV} (file may be open in Excel): {e}")

        # Summary of latest dates
        dates_series = pd.to_datetime(master_df["Date"], format="%d-%m-%Y", errors="coerce").dropna()
        unique_dates = sorted(dates_series.dt.date.unique())
        print("\n==================================================")
        print(f"Total active dates in master: {len(unique_dates)}")
        print(f"Latest 7 dates: {[d.strftime('%d-%m-%Y') for d in unique_dates[-7:]]}")
        print("==================================================")
    else:
        print("\nNo new data was updated.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync daily rainfall from TNSMART API into master CSV.")
    parser.add_argument("--date", help="Sync specific date (YYYY-MM-DD)", type=str)
    parser.add_argument("--range", nargs=2, help="Sync date range (START_DATE END_DATE as YYYY-MM-DD)", type=str)
    args = parser.parse_args()

    if args.date:
        d = datetime.strptime(args.date, "%Y-%m-%d").date()
        target_dates = [d]
    elif args.range:
        d1 = datetime.strptime(args.range[0], "%Y-%m-%d").date()
        d2 = datetime.strptime(args.range[1], "%Y-%m-%d").date()
        target_dates = [d.date() for d in pd.date_range(d1, d2)]
    else:
        target_dates = get_dates_to_sync()

    print("\n==================================================")
    print(f"Dates scheduled for sync ({len(target_dates)} day(s)): ")
    print(f"{[d.strftime('%d-%m-%Y') for d in target_dates]}")
    print("==================================================")

    sync_dates(target_dates)
