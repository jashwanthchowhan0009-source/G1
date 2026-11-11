"""Travel: hotels, flights, trains, buses.

How booking works in G1 (POC):
* search_*  -> G1 builds the search on real sites with the exact dates/city and
               shows it on screen (safe).
* book_*    -> needs the owner's "yes". G1 opens the checkout and the owner pays
               with UPI/fingerprint on the device. G1 never stores card details.

Partner APIs (hotel/flight aggregators) plug in behind `Provider` later, so the
same voice command does the full booking with one confirm.
"""
from __future__ import annotations

import urllib.parse
from datetime import date
from typing import Any, Protocol

from . import skill

q = urllib.parse.quote_plus


class Provider(Protocol):
    """Implement this for a real partner API (hotel/flight aggregator)."""

    def search_hotels(self, city: str, checkin: str, checkout: str, guests: int) -> list[dict[str, Any]]: ...
    def book(self, offer_id: str) -> dict[str, Any]: ...


def _valid_date(s: str) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def hotel_links(city: str, checkin: str, checkout: str, guests: int, budget: int | None) -> list[dict[str, str]]:
    booking = (
        "https://www.booking.com/searchresults.html?"
        + urllib.parse.urlencode(
            {"ss": city, "checkin": checkin, "checkout": checkout, "group_adults": guests, "no_rooms": 1}
        )
    )
    words = f"hotels in {city} {checkin} to {checkout} for {guests}"
    if budget:
        words += f" under ₹{budget} per night"
    google = f"https://www.google.com/travel/search?q={q(words)}"
    return [{"site": "Booking.com", "url": booking}, {"site": "Google Hotels", "url": google}]


@skill(
    "search_hotels",
    "Find hotels for a city and dates. Dates as YYYY-MM-DD.",
    {
        "type": "object",
        "properties": {
            "city": {"type": "string"},
            "checkin": {"type": "string"},
            "checkout": {"type": "string"},
            "guests": {"type": "integer"},
            "max_price_per_night": {"type": "integer", "description": "INR, optional"},
        },
        "required": ["city", "checkin", "checkout"],
    },
)
def search_hotels(city: str, checkin: str, checkout: str, guests: int = 2, max_price_per_night: int | None = None):
    if not (_valid_date(checkin) and _valid_date(checkout)) or checkout <= checkin:
        return {"ok": False, "error": "need valid checkin/checkout dates (YYYY-MM-DD)"}
    return {"ok": True, "results": hotel_links(city, checkin, checkout, guests, max_price_per_night)}


@skill(
    "book_hotel",
    "Book a hotel room. Opens checkout for the owner to pay. Needs confirmation.",
    {
        "type": "object",
        "properties": {
            "city": {"type": "string"},
            "hotel_name": {"type": "string", "description": "Optional specific hotel"},
            "checkin": {"type": "string"},
            "checkout": {"type": "string"},
            "guests": {"type": "integer"},
        },
        "required": ["city", "checkin", "checkout"],
    },
    risk="confirm",
    summarize=lambda a: f"Hotel in {a.get('city')}"
    + (f" ({a['hotel_name']})" if a.get("hotel_name") else "")
    + f", {a.get('checkin')} → {a.get('checkout')}, {a.get('guests', 2)} guests",
)
def book_hotel(city: str, checkin: str, checkout: str, guests: int = 2, hotel_name: str | None = None):
    if not (_valid_date(checkin) and _valid_date(checkout)) or checkout <= checkin:
        return {"ok": False, "error": "need valid dates"}
    where = f"{hotel_name}, {city}" if hotel_name else city
    url = hotel_links(where, checkin, checkout, guests, None)[0]["url"]
    return {"ok": True, "open_url": url, "note": "Checkout open on screen. Pay with UPI to finish."}


@skill(
    "search_travel",
    "Find flights, trains or buses between two cities on a date (YYYY-MM-DD).",
    {
        "type": "object",
        "properties": {
            "mode": {"type": "string", "enum": ["flight", "train", "bus"]},
            "from_city": {"type": "string"},
            "to_city": {"type": "string"},
            "date": {"type": "string"},
        },
        "required": ["mode", "from_city", "to_city", "date"],
    },
)
def search_travel(mode: str, from_city: str, to_city: str, date: str):  # noqa: A002
    if not _valid_date(date):
        return {"ok": False, "error": "invalid date"}
    if mode == "flight":
        links = [{
            "site": "Google Flights",
            "url": f"https://www.google.com/travel/flights?q={q(f'Flights to {to_city} from {from_city} on {date}')}",
        }]
    elif mode == "train":
        links = [{"site": "IRCTC", "url": "https://www.irctc.co.in/nget/train-search"},
                 {"site": "Google", "url": f"https://www.google.com/search?q={q(f'trains {from_city} to {to_city} {date}')}"}]
    else:
        links = [{"site": "Google", "url": f"https://www.google.com/search?q={q(f'bus {from_city} to {to_city} {date}')}"}]
    return {"ok": True, "mode": mode, "results": links}


@skill(
    "book_ticket",
    "Book a flight/train/bus ticket. Opens checkout for the owner to pay. Needs confirmation.",
    {
        "type": "object",
        "properties": {
            "mode": {"type": "string", "enum": ["flight", "train", "bus"]},
            "from_city": {"type": "string"},
            "to_city": {"type": "string"},
            "date": {"type": "string"},
            "passengers": {"type": "integer"},
        },
        "required": ["mode", "from_city", "to_city", "date"],
    },
    risk="confirm",
    summarize=lambda a: f"{a.get('mode', '').title()} ticket {a.get('from_city')} → {a.get('to_city')} on {a.get('date')}"
    f", {a.get('passengers', 1)} passenger(s)",
)
def book_ticket(mode: str, from_city: str, to_city: str, date: str, passengers: int = 1):  # noqa: A002
    res = search_travel(mode, from_city, to_city, date)
    if not res.get("ok"):
        return res
    return {"ok": True, "open_url": res["results"][0]["url"], "note": "Checkout open on screen. Pay with UPI to finish."}
