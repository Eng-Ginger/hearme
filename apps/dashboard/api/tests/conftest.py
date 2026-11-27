import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from apps.dashboard.api.db import Store  # noqa: E402
from apps.dashboard.api.main import create_app  # noqa: E402


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "test.db")


@pytest.fixture
def client(store):
    """Empty DB, no seeding, no static web app."""
    return TestClient(create_app(store, seed_on_startup=False, web_dist=None))
