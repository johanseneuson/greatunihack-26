"""Kaggle datasets used as mock bank accounts. Downloaded on demand (public, no Kaggle login needed)."""
import io
import logging
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from ..config import settings
from .ingest import ParsedStatement, parse_csv

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Dataset:
    slug: str  # Kaggle "owner/name"
    file: str  # CSV inside the archive
    title: str
    description: str
    license: str

    @property
    def key(self) -> str:
        return self.slug.split("/")[1]

    @property
    def path(self) -> Path:
        return settings.data_dir / "datasets" / self.key / self.file

    @property
    def url(self) -> str:
        return f"https://www.kaggle.com/datasets/{self.slug}"


DATASETS: dict[str, Dataset] = {
    d.key: d
    for d in [
        Dataset(
            slug="bukolafatunde/personal-finance",
            file="personal_transactions.csv",
            title="Household current account + 2 credit cards",
            description="~800 transactions over 21 months: fortnightly salary, mortgage, bills, groceries, card repayments.",
            license="Unknown (Kaggle) - demo use only",
        ),
        Dataset(
            slug="ismetsemedov/personal-budget-transactions-dataset",
            file="budget_data.csv",
            title="Everyday spending tracker",
            description="~3,600 day-to-day purchases over 2+ years (coffee, groceries, taxis, travel). Spending only - income is declared in the profile.",
            license="Apache 2.0",
        ),
    ]
}


def ensure_downloaded(ds: Dataset) -> Path:
    if ds.path.exists():
        return ds.path
    url = f"https://www.kaggle.com/api/v1/datasets/download/{ds.slug}"
    log.info("Downloading %s", url)
    req = urllib.request.Request(url, headers={"User-Agent": "finance-buddy-backend"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        blob = resp.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        member = next((n for n in zf.namelist() if Path(n).name == ds.file), None)
        if member is None:
            raise FileNotFoundError(f"{ds.file} not found in {ds.slug} archive ({zf.namelist()})")
        ds.path.parent.mkdir(parents=True, exist_ok=True)
        ds.path.write_bytes(zf.read(member))
    return ds.path


def load_dataset(key: str, default_account: str = "Everyday account") -> ParsedStatement:
    ds = DATASETS[key]
    return parse_csv(ensure_downloaded(ds).read_bytes(), default_account=default_account)
