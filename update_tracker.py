import os
import requests
import pandas as pd
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import pytz

# --- CONFIGURATION ---
URL = "https://beta-tnsmart.rimes.int/index.php/MIS/Rainfall/raingauge_stations"
CSV_FILE = "thanjavur_stations_rainfall_2026.csv"
FIXED_LOCATIONS_FILE = "fixed_locations.csv"
IST = pytz.timezone('Asia/Kolkata')

def fetch_single_day(target_date_obj):
    """Fetches rainfall data from TNSMART for a specific date and updates the CSV."""
    payload_date = target_date_obj.strftime("%Y-%m-%d")
    csv_date = target_date_obj.strftime("%d-%m-%Y")

    print(f"Fetching data for: {payload_date} ({csv_date})...")

    payload = {
        "date_on": payload_date,
        "district_id": "all",
        "search_submit": "View Data",
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    try:
        response = requests.post(URL, data=payload, headers=headers, timeout=25)
        soup = BeautifulSoup(response.text, "html.parser")
        table = soup.find("table")

        records = []
        if table:
            for row in table.find_all("tr")[1:]:
                cols = row.find_all("td")
                if len(cols) >= 8:
                    records.append({
                        "Date": csv_date,
                        "Sl_No": cols[0].text.strip(),
                        "Station_Name": cols[1].text.strip(),
                        "Location_Details": cols[2].text.strip(),
                        "Started_On": cols[3].text.strip(),
                        "Latitude": cols[4].text.strip(),
                        "Longitude": cols[5].text.strip(),
                        "Status": cols[6].text.strip(),
                        "Rainfall_mm": cols[7].text.strip() or "0",
                    })

        if records:
            new_df = pd.DataFrame(records)

            if os.path.exists(CSV_FILE):
                master_df = pd.read_csv(CSV_FILE)
                # Overwrite/clean any existing rows for this exact date to avoid duplicates
                master_df = master_df[master_df["Date"] != csv_date]
                master_df = pd.concat([master_df, new_df], ignore_index=True)
            else:
                master_df = new_df

            # Apply coordinate corrections if master file exists
            if os.path.exists(FIXED_LOCATIONS_FILE):
                loc_df = pd.read_csv(FIXED_LOCATIONS_FILE)
                for _, fix_row in loc_df.iterrows():
                    target_station = fix_row["Station_Name"]
                    correct_lat = fix_row["Latitude"]
                    correct_lon = fix_row["Longitude"]

                    # Force overwrite the bad TN-SMART coordinates with your correct ones
                    master_df.loc[
                        master_df["Station_Name"] == target_station, "Latitude"
                    ] = correct_lat
                    master_df.loc[
                        master_df["Station_Name"] == target_station, "Longitude"
                    ] = correct_lon

            # Save the cleanly formatted, corrected data back to the CSV
            master_df.to_csv(CSV_FILE, index=False)
            print(f"  ✔ Successfully saved {len(new_df)} records for {csv_date}.")
            return True
        else:
            print(f"  ⚠ No station records returned for {csv_date}.")
            return False

    except Exception as e:
        print(f"  ✖ Failed to fetch {csv_date}: {e}")
        return False

def get_dates_to_sync():
    """Finds all missing dates in the CSV sequence up to today."""
    today = datetime.now(IST).date()

    if os.path.exists(CSV_FILE):
        try:
            df = pd.read_csv(CSV_FILE, usecols=["Date"])
            if not df.empty:
                dates = pd.to_datetime(
                    df["Date"], format="%d-%m-%Y", errors="coerce"
                ).dropna()

                if not dates.empty:
                    existing_dates = set(dates.dt.date)
                    min_date = dates.min().date()

                    # Generate every single date from the earliest record up to today
                    all_calendar_days = pd.date_range(
                        start=min_date, end=today
                    ).date

                    # Find any day that is completely missing from the CSV
                    missing_dates = [
                        d for d in all_calendar_days if d not in existing_dates
                    ]

                    # Always include today to refresh morning readings with final evening totals
                    if today not in missing_dates:
                        missing_dates.append(today)

                    return sorted(missing_dates)

        except Exception as err:
            print(f"Could not scan CSV dates ({err}). Defaulting to today...")

    # Default fallback if CSV does not exist or has no dates
    return [today]

if __name__ == "__main__":
    dates_to_fetch = get_dates_to_sync()

    print("\n==================================================")
    print(f"Dates scheduled for sync ({len(dates_to_fetch)} day(s)): ")
    print(f"{[d.strftime('%d-%m-%Y') for d in dates_to_fetch]}")
    print("==================================================\n")

    for date_item in dates_to_fetch:
        fetch_single_day(date_item)
        
    print("\nUpdate complete!")
    
