"""
Canonical data schema for wpr-prep-sports.

Frontend reads JSON serialized from these models. Keep field names stable —
the frontend depends on them.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class GameStatus(str, Enum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    FINAL = "final"
    POSTPONED = "postponed"
    CANCELLED = "cancelled"


class Sport(str, Enum):
    FOOTBALL = "football"
    BOYS_BASKETBALL = "boys_basketball"
    GIRLS_BASKETBALL = "girls_basketball"
    VOLLEYBALL = "volleyball"
    WRESTLING = "wrestling"
    BOYS_HOCKEY = "boys_hockey"
    GIRLS_HOCKEY = "girls_hockey"
    BASEBALL = "baseball"
    SOFTBALL = "softball"
    BOYS_SOCCER = "boys_soccer"
    GIRLS_SOCCER = "girls_soccer"
    BOYS_CROSS_COUNTRY = "boys_cross_country"
    GIRLS_CROSS_COUNTRY = "girls_cross_country"
    BOYS_TRACK = "boys_track"
    GIRLS_TRACK = "girls_track"


class ConferenceMembership(BaseModel):
    """A school may belong to different conferences for different sports."""
    sport: Sport
    conference: str  # e.g. "Wisconsin Valley", "Marawood South", "VFA"


class School(BaseModel):
    id: str  # slug, e.g. "wausau-east"
    name: str  # "Wausau East"
    full_name: str  # "Wausau East High School"
    mascot: str  # "Lumberjacks"
    city: str
    colors: list[str] = Field(default_factory=list)
    conferences: list[ConferenceMembership] = Field(default_factory=list)
    wiaa_division: dict[str, str] = Field(default_factory=dict)  # sport -> division ("D1", "D5", etc.)
    athletics_url: Optional[str] = None


class TeamScore(BaseModel):
    school_id: str
    name: str  # display name as scraped, in case of unmatched school
    score: Optional[int] = None
    logo_url: Optional[str] = None  # WIAA-hosted logo when available


class Game(BaseModel):
    id: str  # synthetic, e.g. "{sport}-{date}-{home_id}-{away_id}"
    sport: Sport
    season: str  # "2025-26"
    date: datetime  # game start datetime (timezone aware, US/Central)
    home: TeamScore
    away: TeamScore
    status: GameStatus
    conference: Optional[str] = None  # if conference game
    venue: Optional[str] = None
    sources: list[str] = Field(default_factory=list)  # ["bound", "wiaa"]


class StandingRow(BaseModel):
    school_id: str
    name: str
    conference_wins: int = 0
    conference_losses: int = 0
    overall_wins: int = 0
    overall_losses: int = 0
    points_for: Optional[int] = None
    points_against: Optional[int] = None


class Standing(BaseModel):
    sport: Sport
    season: str
    conference: str
    division: Optional[str] = None  # e.g. "Marawood North"
    rows: list[StandingRow]


class Meta(BaseModel):
    last_updated: datetime
    season: str
    sports_included: list[Sport]
    sources_used: list[str]


class Dataset(BaseModel):
    meta: Meta
    schools: list[School]
    games: list[Game]
    standings: list[Standing]
