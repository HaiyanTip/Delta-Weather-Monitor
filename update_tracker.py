import requests
import pandas as pd
from bs4 import BeautifulSoup
from datetime import datetime
import pytz
import os

URL = "https://beta-tnsmart.rimes.int/index.php/MIS/Rainfall/raingauge_stations"
CSV_FILE = "thanjavur_stations_rainfall_2026.csv"
FIXED_LOCATIONS_FILE = "fixed_locations.csv" # Your new master location file

ist = pytz.timezone('Asia/Kolkata')
today_date_obj = datetime.now(ist)

payload_date = today_date_obj.strftime("%Y-%m-%d")
csv_date = today_date_obj.strftime("%d-%m-%Y") 

def update_daily_rainfall():
    print(f"Fetching global state data for: {payload_date}...")
    
    payload = {"date_on": payload_date, "district_id": "all", "search_submit": "View Data"}
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    
    try:
        response = requests.post(URL, data=payload, headers=headers, timeout=20)
        soup = BeautifulSoup(response.text, 'html.parser')
        table = soup.find('table')
        
        todays_records = []
        if table:
            for row in table.find_all('tr')[1:]:
                cols = row.find_all('td')
                if len(cols) >= 8:
                    station_name = cols[1].text.strip()
                    
                    todays_records.append({
                        "Date": csv_date,
                        "Sl_No": cols[0].text.strip(),
                        "Station_Name": station_name,
                        "Location_Details": cols[2].text.strip(),
                        "Started_On": cols[3].text.strip(),
                        "Latitude": cols[4].text.strip(),
                        "Longitude": cols[5].text.strip(),
                        "Status": cols[6].text.strip(),
                        "Rainfall_mm": cols[7].text.strip() or "0"
                    })
        
        if todays_records:
            new_df = pd.DataFrame(todays_records)
            
            # Read the historical data and append today's data
            if os.path.exists(CSV_FILE):
                master_df = pd.read_csv(CSV_FILE)
                master_df = master_df[master_df['Date'] != csv_date]
                master_df = pd.concat([master_df, new_df], ignore_index=True)
            else:
                master_df = new_df
                
            # ==========================================
            # NEW: THE SELF-HEALING LOCATION OVERRIDE
            # ==========================================
            if os.path.exists(FIXED_LOCATIONS_FILE):
                print(f"Applying master coordinate overrides from {FIXED_LOCATIONS_FILE}...")
                loc_df = pd.read_csv(FIXED_LOCATIONS_FILE)
                
                # Loop through your custom fixes and apply them to the entire dataset
                for _, fix_row in loc_df.iterrows():
                    target_station = fix_row['Station_Name']
                    correct_lat = fix_row['Latitude']
                    correct_lon = fix_row['Longitude']
                    
                    # Force overwrite the bad TN-SMART coordinates with your correct ones
                    master_df.loc[master_df['Station_Name'] == target_station, 'Latitude'] = correct_lat
                    master_df.loc[master_df['Station_Name'] == target_station, 'Longitude'] = correct_lon

            # Save the cleanly formatted, corrected data back to the CSV
            master_df.to_csv(CSV_FILE, index=False)
            print(f"Success! Appended {len(new_df)} rows and secured coordinates in {CSV_FILE}.")
        else:
            print("No station data found for today.")
            
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    update_daily_rainfall()
