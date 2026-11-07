"""Bank connections.

The platform's idea is "link your bank accounts". For the hackathon we ship a *sandbox* bank whose
accounts are backed by the Kaggle datasets. A real Open Banking provider (TrueLayer, Plaid, GoCardless
Bank Account Data, Yapily) plugs in by implementing `BankConnector.fetch()` to return the same
normalised rows (date, description, amount, raw_category, account) - everything downstream is shared.
"""
from abc import ABC, abstractmethod
from datetime import date

import pandas as pd

from ..config import settings
from .datasets import DATASETS, load_dataset


class BankConnector(ABC):
    id: str
    name: str
    description: str

    @abstractmethod
    def fetch(self) -> tuple[pd.DataFrame, int]:
        """Return (rows, date_shift_days)."""


class SandboxConnector(BankConnector):
    def __init__(self, dataset_key: str):
        ds = DATASETS[dataset_key]
        self.dataset_key = dataset_key
        self.id = f"sandbox:{dataset_key}"
        self.name = f"Sandbox Bank - {ds.title}"
        self.description = f"{ds.description} Source: {ds.url} ({ds.license})."

    def fetch(self) -> tuple[pd.DataFrame, int]:
        rows = load_dataset(self.dataset_key).rows
        shift = 0
        if settings.shift_demo_to_today and len(rows):
            # Make the history end yesterday so "the future" in forecasts is the real future.
            shift = (pd.Timestamp(date.today()) - pd.Timedelta(days=1) - rows["date"].max()).days
        return rows, shift


CONNECTORS: dict[str, BankConnector] = {c.id: c for c in (SandboxConnector(k) for k in DATASETS)}
