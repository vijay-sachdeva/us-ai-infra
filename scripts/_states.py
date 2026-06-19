"""Shared crosswalks. Approximate, maintainer-tunable — used only for the Modeled siting map."""

ABBR_TO_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11",
    "FL": "12", "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30",
    "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49",
    "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56",
}

# State -> dominant EIA-930 balancing-authority code present in grid.json (else None -> median)
STATE_BA = {
    "PA": "PJM", "NJ": "PJM", "MD": "PJM", "DE": "PJM", "VA": "PJM", "WV": "PJM", "OH": "PJM", "DC": "PJM", "KY": "PJM",
    "IL": "MISO", "IN": "MISO", "MI": "MISO", "WI": "MISO", "MN": "MISO", "IA": "MISO", "MO": "MISO", "AR": "MISO",
    "LA": "MISO", "MS": "MISO", "ND": "MISO",
    "KS": "SWPP", "OK": "SWPP", "NE": "SWPP", "SD": "SWPP",
    "TX": "ERCO", "CA": "CISO", "NY": "NYIS",
    "ME": "ISNE", "NH": "ISNE", "VT": "ISNE", "MA": "ISNE", "RI": "ISNE", "CT": "ISNE",
    "GA": "SOCO", "AL": "SOCO", "FL": "SOCO",
    "NC": "DUK", "SC": "DUK", "TN": "DUK",
}

# State -> ISO/region bucket matching queue_by_iso.csv
STATE_ISO = {
    "PA": "PJM", "NJ": "PJM", "MD": "PJM", "DE": "PJM", "VA": "PJM", "WV": "PJM", "OH": "PJM", "DC": "PJM", "KY": "PJM",
    "IL": "MISO", "IN": "MISO", "MI": "MISO", "WI": "MISO", "MN": "MISO", "IA": "MISO", "MO": "MISO", "AR": "MISO",
    "LA": "MISO", "MS": "MISO", "ND": "MISO",
    "KS": "SPP", "OK": "SPP", "NE": "SPP", "SD": "SPP",
    "TX": "ERCOT", "CA": "CAISO", "NY": "NYISO",
    "ME": "ISO-NE", "NH": "ISO-NE", "VT": "ISO-NE", "MA": "ISO-NE", "RI": "ISO-NE", "CT": "ISO-NE",
    "GA": "Southeast", "AL": "Southeast", "FL": "Southeast", "NC": "Southeast", "SC": "Southeast", "TN": "Southeast",
    "WA": "Northwest", "OR": "Northwest", "ID": "Northwest", "MT": "Northwest", "WY": "Northwest",
    "UT": "West", "NV": "West", "AZ": "West", "CO": "West", "NM": "West",
}
