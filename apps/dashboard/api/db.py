"""SQLite storage (stdlib sqlite3). One row per (cell, hour) with summed counts."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS counts (
    cell_id       TEXT    NOT NULL,
    hour          INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    fast_passes   INTEGER NOT NULL DEFAULT 0 CHECK (fast_passes >= 0),
    urgent_alerts INTEGER NOT NULL DEFAULT 0 CHECK (urgent_alerts >= 0),
    PRIMARY KEY (cell_id, hour)
);
CREATE TABLE IF NOT EXISTS pois (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    kind  TEXT NOT NULL CHECK (kind IN ('school', 'bus_stop')),
    lat   REAL NOT NULL,
    lon   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as con:
            con.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        try:
            yield con
            con.commit()
        finally:
            con.close()

    # ---- writes -------------------------------------------------------------
    def add_counts(self, rows: Iterable[tuple[str, int, int, int]]) -> int:
        """Upsert-add (cell_id, hour, fast_passes, urgent_alerts). Returns rows touched."""
        rows = list(rows)
        with self.connect() as con:
            con.executemany(
                """
                INSERT INTO counts (cell_id, hour, fast_passes, urgent_alerts)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (cell_id, hour) DO UPDATE SET
                    fast_passes   = fast_passes   + excluded.fast_passes,
                    urgent_alerts = urgent_alerts + excluded.urgent_alerts
                """,
                rows,
            )
        return len(rows)

    def replace_pois(self, pois: Iterable[dict]) -> int:
        pois = list(pois)
        with self.connect() as con:
            con.execute("DELETE FROM pois")
            con.executemany(
                "INSERT INTO pois (name, kind, lat, lon) VALUES (:name, :kind, :lat, :lon)",
                pois,
            )
        return len(pois)

    def clear(self) -> None:
        with self.connect() as con:
            con.execute("DELETE FROM counts")
            con.execute("DELETE FROM pois")
            con.execute("DELETE FROM meta")

    def set_meta(self, key: str, value) -> None:
        with self.connect() as con:
            con.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

    # ---- reads --------------------------------------------------------------
    def get_meta(self) -> dict:
        with self.connect() as con:
            return {r["key"]: json.loads(r["value"]) for r in con.execute("SELECT * FROM meta")}

    def is_empty(self) -> bool:
        with self.connect() as con:
            return con.execute("SELECT COUNT(*) FROM counts").fetchone()[0] == 0

    def cell_totals(self, hour: int | None = None) -> list[sqlite3.Row]:
        sql = (
            "SELECT cell_id, SUM(fast_passes) AS fast_passes, SUM(urgent_alerts) AS urgent_alerts "
            "FROM counts {where} GROUP BY cell_id"
        )
        with self.connect() as con:
            if hour is None:
                return con.execute(sql.format(where="")).fetchall()
            return con.execute(sql.format(where="WHERE hour = ?"), (hour,)).fetchall()

    def pois(self) -> list[dict]:
        with self.connect() as con:
            return [dict(r) for r in con.execute("SELECT name, kind, lat, lon FROM pois ORDER BY kind, name")]

    def stats(self) -> dict:
        with self.connect() as con:
            r = con.execute(
                "SELECT COUNT(*) AS n, COUNT(DISTINCT cell_id) AS cells, "
                "COALESCE(SUM(fast_passes),0) AS fp, COALESCE(SUM(urgent_alerts),0) AS ua FROM counts"
            ).fetchone()
            n_pois = con.execute("SELECT COUNT(*) FROM pois").fetchone()[0]
        return {
            "rows": r["n"],
            "cells": r["cells"],
            "fast_passes": r["fp"],
            "urgent_alerts": r["ua"],
            "pois": n_pois,
        }
