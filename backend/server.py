from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import mimetypes
import os
from pathlib import Path
import re
import secrets
from threading import RLock
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlparse
from uuid import uuid4
from xml.etree import ElementTree as ET

import bcrypt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import jwt
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.middleware.cors import CORSMiddleware

load_dotenv()

ROOT_DIR = Path(__file__).parent
DATA_ROOT = Path(os.environ.get("YARD_DATA_DIR", str(ROOT_DIR))).expanduser()
DATA_FILE = Path(os.environ.get("YARD_DATA_FILE", str(DATA_ROOT / "data_store.json"))).expanduser()
UPLOADS_DIR = Path(os.environ.get("YARD_UPLOADS_DIR", str(DATA_ROOT / "uploads"))).expanduser()
UPLOADS_SVG_DIR = UPLOADS_DIR / "svg"
UPLOADS_VISUAL_DIR = UPLOADS_DIR / "visual"
LOCAL_COLLECTIONS = (
    "users",
    "institutions",
    "people",
    "projects",
    "publications",
    "events",
    "milestones",
    "conceptnotes",
)
LOCAL_STORE_LOCK = RLock()
DEFAULT_FRONTEND_ORIGINS = [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
DEFAULT_JWT_SECRET = "yard-dev-secret-change-me-2026-please"
DEFAULT_ADMIN_PASSWORD = "YardAccess2026!"
MAX_VISUAL_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_VISUALS_PER_ITEM = 8
PASSWORD_MIN_LENGTH = 10
TEMP_PASSWORD_EXPIRY_HOURS = 72
INVITE_LINK_EXPIRY_HOURS = 168
TEMP_PASSWORD_WORDS = (
    "amber", "apron", "basil", "beacon", "berry", "branch", "caper", "cedar",
    "citrus", "clove", "cobalt", "cumin", "dawn", "ember", "field", "fig",
    "flame", "folio", "forest", "frost", "ginger", "graph", "harbor", "hazel",
    "helium", "horizon", "iris", "juniper", "lantern", "maple", "matrix", "meadow",
    "mint", "mosaic", "nectar", "north", "olive", "orbit", "paper", "pepper",
    "plum", "quartz", "radar", "ripple", "rosemary", "saffron", "sage", "signal",
    "spruce", "stone", "sunset", "tensor", "thicket", "thyme", "truffle", "vector",
    "violet", "walnut", "wave", "willow",
)
PASSWORD_CHANGE_ALLOWED_PATHS = {
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/auth/permissions",
    "/api/health",
}

ET.register_namespace("", "http://www.w3.org/2000/svg")
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")


def parse_frontend_origins() -> List[str]:
    raw_value = os.environ.get("FRONTEND_URL", ",".join(DEFAULT_FRONTEND_ORIGINS))
    origins = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return origins or DEFAULT_FRONTEND_ORIGINS


def parse_bool_env(name: str, default: bool = False) -> bool:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def get_seed_file() -> Optional[Path]:
    configured_seed = (os.environ.get("YARD_SEED_FILE") or "").strip()
    if configured_seed:
        return Path(configured_seed).expanduser()

    private_seed = ROOT_DIR / "seed_data.private.json"
    if private_seed.exists():
        return private_seed

    return None


def get_explicit_frontend_origins() -> List[str]:
    return [origin.rstrip("/") for origin in ALLOWED_ORIGINS if origin and origin != "*"]


MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
USE_MONGO = bool(MONGO_URL and DB_NAME)
APP_ENV = (os.environ.get("APP_ENV") or os.environ.get("ENV") or os.environ.get("FASTAPI_ENV") or "development").strip().lower()
IS_PRODUCTION = APP_ENV in {"production", "prod"}

# Lazy-import motor/pymongo only when Mongo is actually configured,
# so the app can boot in JSON-only mode without pymongo's native deps.
client = None
db = None
ObjectId = None
if USE_MONGO:
    from bson import ObjectId as _ObjectId
    from motor.motor_asyncio import AsyncIOMotorClient
    ObjectId = _ObjectId
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

JWT_SECRET = os.environ.get("JWT_SECRET", DEFAULT_JWT_SECRET)
JWT_ALGORITHM = "HS256"
ALLOWED_ORIGINS = parse_frontend_origins()
SELF_REGISTRATION_ENABLED = parse_bool_env("ALLOW_SELF_REGISTRATION", default=False)
if "*" in ALLOWED_ORIGINS:
    raise RuntimeError("FRONTEND_URL cannot include '*' because Yard uses cookie-based authentication.")
COOKIE_SECURE_ENV = os.environ.get("COOKIE_SECURE")
if COOKIE_SECURE_ENV is None:
    COOKIE_SECURE = all(origin.startswith("https://") for origin in ALLOWED_ORIGINS if origin != "*")
else:
    COOKIE_SECURE = COOKIE_SECURE_ENV.lower() == "true"

api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

if not USE_MONGO:
    logger.warning("MONGO_URL/DB_NAME not configured; using local JSON storage at %s", DATA_FILE)
if JWT_SECRET == DEFAULT_JWT_SECRET:
    if IS_PRODUCTION:
        raise RuntimeError("JWT_SECRET must be set to a non-development value in production.")
    logger.warning("JWT_SECRET is using a development fallback. Set JWT_SECRET in production.")


class LocalStoreCorruptionError(RuntimeError):
    """Raised when the JSON fallback store cannot be parsed safely."""


def get_admin_password() -> str:
    configured = os.environ.get("ADMIN_PASSWORD")
    if configured:
        if IS_PRODUCTION and configured == DEFAULT_ADMIN_PASSWORD:
            raise RuntimeError("ADMIN_PASSWORD cannot use the development default in production.")
        return configured
    if IS_PRODUCTION:
        raise RuntimeError("ADMIN_PASSWORD must be set in production.")
    return DEFAULT_ADMIN_PASSWORD


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def clone_document(document: Any) -> Any:
    return deepcopy(document)


def local_store_template() -> Dict[str, List[Dict[str, Any]]]:
    return {collection: [] for collection in LOCAL_COLLECTIONS}


def read_local_store() -> Dict[str, List[Dict[str, Any]]]:
    if not DATA_FILE.exists():
        return local_store_template()

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except json.JSONDecodeError as exc:
        logger.error("Local data store at %s is not valid JSON; refusing to continue with a blank fallback", DATA_FILE)
        raise LocalStoreCorruptionError(
            f"Local data store at {DATA_FILE} is not valid JSON. Restore the file from backup or repair it before restarting Yard."
        ) from exc

    store = local_store_template()
    for collection in LOCAL_COLLECTIONS:
        items = payload.get(collection, [])
        store[collection] = items if isinstance(items, list) else []
    return store


async def check_storage_health() -> Dict[str, Any]:
    if USE_MONGO:
        try:
            await db.command("ping")
        except Exception as exc:
            logger.error("Mongo health check failed", exc_info=True)
            raise HTTPException(status_code=503, detail="MongoDB is unavailable") from exc
        return {"storage": "mongo", "storageStatus": "ok"}

    try:
        read_local_store()
    except LocalStoreCorruptionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"storage": "json", "storageStatus": "ok"}


def write_local_store(store: Dict[str, List[Dict[str, Any]]]) -> None:
    serializable = {collection: clone_document(store.get(collection, [])) for collection in LOCAL_COLLECTIONS}
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = DATA_FILE.with_suffix(".tmp")
    with open(tmp_file, "w", encoding="utf-8") as handle:
        json.dump(serializable, handle, indent=2, ensure_ascii=True)
    tmp_file.replace(DATA_FILE)


def matches_filters(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    return all(item.get(key) == value for key, value in filters.items())


async def list_collection(collection: str, limit: int = 200) -> List[Dict[str, Any]]:
    if USE_MONGO:
        return await db[collection].find({}, {"_id": 0}).to_list(limit)

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        return clone_document(store.get(collection, [])[:limit])


async def get_by_field(
    collection: str,
    field: str,
    value: Any,
    include_internal_id: bool = False,
) -> Optional[Dict[str, Any]]:
    if USE_MONGO:
        projection = None if include_internal_id else {"_id": 0}
        item = await db[collection].find_one({field: value}, projection)
        if item and not include_internal_id:
            item.pop("_id", None)
        return item

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        for item in store.get(collection, []):
            if item.get(field) == value:
                return clone_document(item)
    return None


async def count_collection(collection: str, filters: Optional[Dict[str, Any]] = None) -> int:
    filters = filters or {}
    if USE_MONGO:
        return await db[collection].count_documents(filters)

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        return sum(1 for item in store.get(collection, []) if matches_filters(item, filters))


async def insert_one(collection: str, document: Dict[str, Any]) -> Dict[str, Any]:
    doc = clone_document(document)
    if USE_MONGO:
        result = await db[collection].insert_one(doc)
        doc["_id"] = result.inserted_id
        return doc

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        if collection == "users" and not doc.get("id"):
            doc["id"] = uuid4().hex
        store.setdefault(collection, []).append(doc)
        write_local_store(store)
    return clone_document(doc)


async def insert_many(collection: str, documents: List[Dict[str, Any]]) -> None:
    docs = clone_document(documents)
    if not docs:
        return

    if USE_MONGO:
        await db[collection].insert_many(docs)
        return

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        store.setdefault(collection, []).extend(docs)
        write_local_store(store)


async def update_fields(
    collection: str,
    field: str,
    value: Any,
    updates: Dict[str, Any],
    unset_fields: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    if USE_MONGO:
        update_operations: Dict[str, Any] = {}
        if updates:
            update_operations["$set"] = updates
        if unset_fields:
            update_operations["$unset"] = {item: "" for item in unset_fields}
        if not update_operations:
            return await db[collection].find_one({field: value}, {"_id": 0})
        result = await db[collection].update_one({field: value}, update_operations)
        if result.matched_count == 0:
            return None
        updated = await db[collection].find_one({field: value}, {"_id": 0})
        return updated

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        for item in store.get(collection, []):
            if item.get(field) == value:
                item.update(clone_document(updates))
                if unset_fields:
                    for field_name in unset_fields:
                        item.pop(field_name, None)
                write_local_store(store)
                return clone_document(item)
    return None


async def append_to_list_field(
    collection: str,
    field: str,
    value: Any,
    list_field: str,
    item: Dict[str, Any],
    prepend: bool = False,
) -> Optional[Dict[str, Any]]:
    if USE_MONGO:
        push_payload: Dict[str, Any]
        if prepend:
            push_payload = {"$each": [item], "$position": 0}
        else:
            push_payload = item

        result = await db[collection].update_one({field: value}, {"$push": {list_field: push_payload}})
        if result.matched_count == 0:
            return None
        return await db[collection].find_one({field: value}, {"_id": 0})

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        for document in store.get(collection, []):
            if document.get(field) == value:
                document.setdefault(list_field, [])
                if prepend:
                    document[list_field].insert(0, clone_document(item))
                else:
                    document[list_field].append(clone_document(item))
                write_local_store(store)
                return clone_document(document)
    return None


async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    return await get_by_field("users", "email", email, include_internal_id=True)


async def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    if USE_MONGO:
        try:
            object_id = ObjectId(user_id)
        except Exception:
            return None
        return await db.users.find_one({"_id": object_id})

    return await get_by_field("users", "id", user_id, include_internal_id=True)


async def list_users(include_internal_id: bool = False) -> List[Dict[str, Any]]:
    if USE_MONGO:
        projection = None if include_internal_id else {"_id": 0}
        users = await db["users"].find({}, projection).to_list(500)
        if users and not include_internal_id:
            for user in users:
                user.pop("_id", None)
        return users

    with LOCAL_STORE_LOCK:
        store = read_local_store()
        return clone_document(store.get("users", [])[:500])


def parse_optional_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


LEGACY_PERSON_LINK_FIELDS = ("website", "github", "substack", "orcid")


def normalize_legacy_person_link_value(link_type: str, url: str) -> str:
    cleaned = (url or "").strip()
    if not cleaned:
        return ""
    if link_type == "orcid":
        return re.sub(r"^https?://orcid\.org/", "", cleaned, flags=re.IGNORECASE).rstrip("/")
    return cleaned


def get_visible_person_link_types(person: Dict[str, Any]) -> set[str]:
    links = person.get("links")
    if isinstance(links, list):
        link_types = {
            str(link.get("type") or "").strip()
            for link in links
            if isinstance(link, dict) and str(link.get("url") or "").strip()
        }
        if link_types:
            return link_types

    return {
        field
        for field in LEGACY_PERSON_LINK_FIELDS
        if str(person.get(field) or "").strip()
    }


def build_legacy_person_link_mirror_payload(
    person: Dict[str, Any],
    links: Optional[List[Dict[str, Any]]],
) -> Dict[str, str]:
    next_links = links if isinstance(links, list) else []
    next_by_type: Dict[str, str] = {}

    for link in next_links:
        if not isinstance(link, dict):
            continue
        link_type = str(link.get("type") or "").strip()
        link_url = str(link.get("url") or "").strip()
        if link_type not in LEGACY_PERSON_LINK_FIELDS or not link_url or link_type in next_by_type:
            continue
        next_by_type[link_type] = normalize_legacy_person_link_value(link_type, link_url)

    visible_types = get_visible_person_link_types(person)
    mirror_payload: Dict[str, str] = {}
    for field in LEGACY_PERSON_LINK_FIELDS:
        if field in next_by_type:
            mirror_payload[field] = next_by_type[field]
        elif field in visible_types:
            mirror_payload[field] = ""

    return mirror_payload


def is_feed_item_visible_by_date(value: Optional[str], now: Optional[datetime] = None) -> bool:
    """Return True when the feed item date is current/past or cannot be parsed.

    The activity feed is a historical surface, so future-dated items should stay hidden
    until their month/day has actually arrived. Month-only dates are treated at month
    precision rather than being expanded to a synthetic day.
    """
    if not value:
        return True

    current = now or datetime.now(timezone.utc)
    raw = value.strip()

    if re.fullmatch(r"\d{4}-\d{2}", raw):
        try:
            parsed = datetime.strptime(raw, "%Y-%m")
        except ValueError:
            return True
        return (parsed.year, parsed.month) <= (current.year, current.month)

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        try:
            parsed = datetime.strptime(raw, "%Y-%m-%d")
        except ValueError:
            return True
        return parsed.date() <= current.date()

    parsed = parse_optional_datetime(raw)
    if parsed is None:
        return True
    return parsed.date() <= current.date()


def parse_event_day(value: Optional[str]):
    if not value:
        return None
    raw = value.strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def is_event_upcoming(event: Dict[str, Any], today=None) -> bool:
    event_day = parse_event_day(event.get("date"))
    if event_day is None:
        return False
    comparison_day = today or datetime.now(timezone.utc).date()
    return event_day >= comparison_day


def get_user_token_version(user: Dict[str, Any]) -> int:
    raw_value = user.get("token_version", 0)
    try:
        return int(raw_value or 0)
    except (TypeError, ValueError):
        return 0


def user_must_change_password(user: Dict[str, Any]) -> bool:
    return bool(user.get("must_change_password", False))


def user_activation_pending(user: Dict[str, Any]) -> bool:
    return bool((user.get("activation_token_hash") or "").strip())


def get_temporary_password_expiry(user: Dict[str, Any]) -> Optional[datetime]:
    return parse_optional_datetime(user.get("temporary_password_expires_at"))


def is_temporary_password_expired(user: Dict[str, Any]) -> bool:
    expiry = get_temporary_password_expiry(user)
    return expiry is not None and expiry <= utc_now()


def get_activation_expiry(user: Dict[str, Any]) -> Optional[datetime]:
    return parse_optional_datetime(user.get("activation_expires_at"))


def is_activation_expired(user: Dict[str, Any]) -> bool:
    expiry = get_activation_expiry(user)
    return expiry is not None and expiry <= utc_now()


def validate_password_choice(password: str) -> str:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long")
    return password


def generate_temporary_password(word_count: int = 4) -> str:
    return "-".join(secrets.choice(TEMP_PASSWORD_WORDS) for _ in range(word_count))


def normalize_email_value(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def hash_activation_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def generate_activation_token() -> str:
    return secrets.token_urlsafe(32)


def infer_frontend_base_url(request: Optional[Request]) -> str:
    trusted_origins = get_explicit_frontend_origins()
    if request:
        origin = (request.headers.get("origin") or "").strip()
        if origin and origin.lower() != "null":
            cleaned_origin = origin.rstrip("/")
            if cleaned_origin in trusted_origins:
                return cleaned_origin

        referer = (request.headers.get("referer") or "").strip()
        if referer:
            parsed = urlparse(referer)
            if parsed.scheme and parsed.netloc:
                candidate = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
                if candidate in trusted_origins:
                    return candidate

    for origin in trusted_origins:
        if origin:
            return origin

    return "http://localhost:3001"


async def get_person_by_email(email: str, exclude_person_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    normalized = normalize_email_value(email)
    if not normalized:
        return None

    people = await list_collection("people", limit=500)
    for person in people:
        if exclude_person_id and person.get("id") == exclude_person_id:
            continue
        if normalize_email_value(person.get("email")) == normalized:
            return person
    return None


def password_state_response(user: Dict[str, Any]) -> Dict[str, Any]:
    expiry = get_temporary_password_expiry(user)
    activation_expiry = get_activation_expiry(user)
    password_changed_at = user.get("password_changed_at") or ""
    if not password_changed_at and not user_activation_pending(user):
        password_changed_at = user.get("created_at") or ""
    return {
        "mustChangePassword": user_must_change_password(user),
        "temporaryPasswordExpiresAt": expiry.isoformat() if expiry else "",
        "passwordResetAt": user.get("password_reset_at", ""),
        "passwordResetBy": user.get("password_reset_by", ""),
        "passwordChangedAt": password_changed_at,
        "activationPending": user_activation_pending(user),
        "activationExpiresAt": activation_expiry.isoformat() if activation_expiry else "",
        "activationExpired": is_activation_expired(user),
        "activationCompletedAt": user.get("activation_completed_at", ""),
    }


def serialize_user(user: Dict[str, Any]) -> Dict[str, Any]:
    user_id = str(user["_id"]) if "_id" in user else user.get("id", "")
    payload = {
        "id": user_id,
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user.get("role", "user"),
        "personId": user.get("person_id", "") or "",
    }
    payload.update(password_state_response(user))
    return payload


def get_user_lookup_field(user: Dict[str, Any]) -> tuple[str, Any]:
    if "_id" in user:
        return "_id", user["_id"]
    if user.get("id"):
        return "id", user["id"]
    return "email", user["email"]


async def ensure_user_person_link(user: Dict[str, Any]) -> Dict[str, Any]:
    person_id = (user.get("person_id") or "").strip()
    if person_id:
        linked = await get_by_field("people", "id", person_id)
        if linked:
            return user

    linked = await get_person_by_email(user.get("email", ""))
    if not linked:
        return user

    if linked.get("id") == person_id:
        return user

    updated_user = await update_fields("users", "email", user["email"], {"person_id": linked["id"]})
    return updated_user or {**user, "person_id": linked["id"]}


def build_people_lookup_maps(
    people: List[Dict[str, Any]],
) -> tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    people_by_email: Dict[str, Dict[str, Any]] = {}
    people_by_id: Dict[str, Dict[str, Any]] = {}
    for person in people:
        person_id = (person.get("id") or "").strip()
        if person_id:
            people_by_id[person_id] = person
        normalized_email = normalize_email_value(person.get("email"))
        if normalized_email:
            people_by_email[normalized_email] = person
    return people_by_email, people_by_id


async def create_user_access_for_person(
    person: Dict[str, Any],
    created_by: str,
    email_override: Optional[str] = None,
) -> Dict[str, Any]:
    person_id = (person.get("id") or "").strip()
    if person_id:
        existing_account = await get_by_field("users", "person_id", person_id, include_internal_id=True)
        if existing_account:
            raise HTTPException(status_code=400, detail="Yard access already exists for this profile")

    login_email = normalize_email_value(email_override or person.get("email"))
    if not login_email:
        raise HTTPException(status_code=422, detail="Email is required before Yard access can be created")

    other_person = await get_person_by_email(login_email, exclude_person_id=person.get("id"))
    if other_person:
        raise HTTPException(status_code=400, detail="Email is already used by another profile")

    if await get_user_by_email(login_email):
        raise HTTPException(status_code=400, detail="Email already registered")

    created_at = utc_now()
    expires_at = created_at + timedelta(hours=TEMP_PASSWORD_EXPIRY_HOURS)
    temporary_password = generate_temporary_password()
    account = await insert_one(
        "users",
        {
            "email": login_email,
            "password_hash": hash_password(temporary_password),
            "name": person.get("name", ""),
            "role": "user",
            "person_id": person_id,
            "created_at": created_at.isoformat(),
            "password_changed_at": created_at.isoformat(),
            "token_version": 0,
            "must_change_password": True,
            "temporary_password_expires_at": expires_at.isoformat(),
            "password_reset_at": created_at.isoformat(),
            "password_reset_by": created_by,
        },
    )

    return {
        "user": account,
        "temporaryPassword": temporary_password,
        "expiresAt": expires_at.isoformat(),
        "expiresInHours": TEMP_PASSWORD_EXPIRY_HOURS,
    }


def build_activation_invite_link(frontend_base_url: str, token: str) -> str:
    return f"{frontend_base_url.rstrip('/')}/activate?token={token}"


async def create_pending_user_for_person(
    person: Dict[str, Any],
    email_override: Optional[str] = None,
) -> Dict[str, Any]:
    person_id = (person.get("id") or "").strip()
    if person_id:
        existing_account = await get_by_field("users", "person_id", person_id, include_internal_id=True)
        if existing_account:
            raise HTTPException(status_code=400, detail="Yard login already exists for this profile")

    login_email = normalize_email_value(email_override or person.get("email"))
    if not login_email:
        raise HTTPException(status_code=422, detail="Email is required before a Yard login can be created")

    other_person = await get_person_by_email(login_email, exclude_person_id=person.get("id"))
    if other_person:
        raise HTTPException(status_code=400, detail="Email is already used by another profile")

    if await get_user_by_email(login_email):
        raise HTTPException(status_code=400, detail="Email already registered")

    created_at = utc_now().isoformat()
    return await insert_one(
        "users",
        {
            "email": login_email,
            "password_hash": "",
            "name": person.get("name", ""),
            "role": "user",
            "person_id": person_id,
            "created_at": created_at,
            "token_version": 0,
            "must_change_password": False,
        },
    )


async def issue_activation_invite_for_user(
    user: Dict[str, Any],
    invited_by: str,
    frontend_base_url: str,
) -> Dict[str, Any]:
    issued_at = utc_now()
    expires_at = issued_at + timedelta(hours=INVITE_LINK_EXPIRY_HOURS)
    token = generate_activation_token()
    lookup_field, lookup_value = get_user_lookup_field(user)
    updated_user = await update_fields(
        "users",
        lookup_field,
        lookup_value,
        {
            "activation_token_hash": hash_activation_token(token),
            "activation_expires_at": expires_at.isoformat(),
            "activation_created_at": issued_at.isoformat(),
            "activation_created_by": invited_by,
            "activation_completed_at": "",
            "must_change_password": False,
        },
        unset_fields=["temporary_password_expires_at", "password_reset_at", "password_reset_by"],
    )
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "user": updated_user,
        "inviteLink": build_activation_invite_link(frontend_base_url, token),
        "expiresAt": expires_at.isoformat(),
        "expiresInHours": INVITE_LINK_EXPIRY_HOURS,
    }


async def create_or_refresh_activation_invite_for_person(
    person: Dict[str, Any],
    created_by: str,
    frontend_base_url: str,
    email_override: Optional[str] = None,
) -> Dict[str, Any]:
    person_id = (person.get("id") or "").strip()
    login_email = normalize_email_value(email_override or person.get("email"))
    if not login_email:
        raise HTTPException(status_code=422, detail="Email is required before a Yard login can be created")

    other_person = await get_person_by_email(login_email, exclude_person_id=person.get("id"))
    if other_person:
        raise HTTPException(status_code=400, detail="Email is already used by another profile")

    existing_account = None
    if person_id:
        existing_account = await get_by_field("users", "person_id", person_id, include_internal_id=True)

    if existing_account:
        if not user_activation_pending(existing_account):
            raise HTTPException(status_code=400, detail="A Yard login already exists for this profile")

        owner_of_email = await get_user_by_email(login_email)
        if owner_of_email and owner_of_email.get("id") != existing_account.get("id"):
            raise HTTPException(status_code=400, detail="Email already registered")

        updates: Dict[str, Any] = {}
        if normalize_email_value(existing_account.get("email")) != login_email:
            updates["email"] = login_email
        if (existing_account.get("name") or "") != (person.get("name") or ""):
            updates["name"] = person.get("name", "")
        if (existing_account.get("person_id") or "") != person_id:
            updates["person_id"] = person_id
        if updates:
            lookup_field, lookup_value = get_user_lookup_field(existing_account)
            refreshed_account = await update_fields("users", lookup_field, lookup_value, updates)
            if refreshed_account:
                existing_account = refreshed_account
        return await issue_activation_invite_for_user(existing_account, created_by, frontend_base_url)

    created_account = await create_pending_user_for_person(person, email_override=login_email)
    return await issue_activation_invite_for_user(created_account, created_by, frontend_base_url)


async def ensure_indexes() -> None:
    if not USE_MONGO:
        return

    await db.users.create_index("email", unique=True)
    await db.people.create_index("id", unique=True)
    await db.projects.create_index("id", unique=True)
    await db.milestones.create_index("id", unique=True)
    await db.milestones.create_index("project")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str, token_version: int) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": utc_now() + timedelta(minutes=60),
        "type": "access",
        "ver": token_version,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, token_version: int) -> str:
    payload = {
        "sub": user_id,
        "exp": utc_now() + timedelta(days=7),
        "type": "refresh",
        "ver": token_version,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access_token: str, refresh_token: Optional[str] = None) -> None:
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=3600,
        path="/",
    )

    if refresh_token:
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=COOKIE_SECURE,
            samesite="lax",
            max_age=604800,
            path="/",
        )


async def get_current_user(request: Request) -> Dict[str, Any]:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")

        user = await get_user_by_id(payload["sub"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user = await ensure_user_person_link(user)

        token_version = payload.get("ver", 0)
        if token_version != get_user_token_version(user):
            raise HTTPException(status_code=401, detail="Session expired")

        if user_must_change_password(user) and request.url.path not in PASSWORD_CHANGE_ALLOWED_PATHS:
            raise HTTPException(status_code=403, detail="Password change required")

        return serialize_user(user)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


async def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    try:
        return await get_current_user(request)
    except HTTPException as exc:
        if exc.status_code in {401, 403}:
            return None
        raise


class LoginInput(BaseModel):
    email: str
    password: str


class RegisterInput(BaseModel):
    email: str
    password: str
    name: str

    @field_validator("password")
    @classmethod
    def check_password(cls, value: str) -> str:
        return validate_password_choice(value)


class ChangePasswordInput(BaseModel):
    currentPassword: Optional[str] = None
    newPassword: str

    @field_validator("newPassword")
    @classmethod
    def check_new_password(cls, value: str) -> str:
        return validate_password_choice(value)


class ActivateAccountInput(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def check_password(cls, value: str) -> str:
        return validate_password_choice(value)


# ── Permission helpers (B20) ────────────────────────────────────────────

def is_admin(user: Dict[str, Any]) -> bool:
    """True when the logged-in user has the admin role."""
    return user.get("role") == "admin"


async def get_linked_person(user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the linked person record for the logged-in user, or None."""
    person_id = (user.get("personId") or user.get("person_id") or "").strip()
    if person_id:
        linked = await get_by_field("people", "id", person_id)
        if linked:
            return linked
    return await get_person_by_email(user.get("email", ""))


def can_edit_person(user: Dict[str, Any], person: Dict[str, Any], linked_person: Optional[Dict[str, Any]]) -> bool:
    """Admin can edit anyone; a user can edit their own linked person record."""
    if is_admin(user):
        return True
    return linked_person is not None and linked_person.get("id") == person.get("id")


def normalize_id_list(values: Optional[List[str]]) -> List[str]:
    seen: set[str] = set()
    normalized: List[str] = []
    for value in values or []:
        cleaned = (value or "").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)
    return normalized


def get_project_lead_id(project: Dict[str, Any]) -> Optional[str]:
    explicit = (project.get("leadId") or "").strip()
    if explicit:
        return explicit
    legacy_list = normalize_id_list(project.get("leads") or [])
    if legacy_list:
        return legacy_list[0]
    legacy_single = (project.get("lead") or "").strip()
    return legacy_single or None


def get_project_member_ids(project: Dict[str, Any]) -> List[str]:
    lead_id = get_project_lead_id(project)
    source_ids = normalize_id_list(
        project.get("teamMemberIds")
        if isinstance(project.get("teamMemberIds"), list)
        else project.get("leads") or ([project.get("lead")] if project.get("lead") else [])
    )
    if lead_id:
        return [lead_id] + [member_id for member_id in source_ids if member_id != lead_id]
    return source_ids


def build_project_team_fields(lead_id: Optional[str], team_member_ids: Optional[List[str]]) -> Dict[str, Any]:
    clean_lead_id = (lead_id or "").strip()
    normalized_members = normalize_id_list(team_member_ids)
    if clean_lead_id:
        normalized_members = [clean_lead_id] + [member_id for member_id in normalized_members if member_id != clean_lead_id]
    elif normalized_members:
        clean_lead_id = normalized_members[0]

    return {
        "leadId": clean_lead_id or "",
        "teamMemberIds": normalized_members,
        # Compatibility fields for existing UI/data consumers during the transition.
        "lead": clean_lead_id or "",
        "leads": normalized_members,
    }


def slugify_project_id(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug or "project"


async def build_unique_project_id(title: str) -> str:
    base = slugify_project_id(title)
    candidate = base
    suffix = 2
    while await get_by_field("projects", "id", candidate):
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


async def ensure_people_exist(person_ids: List[str]) -> List[str]:
    missing: List[str] = []
    for person_id in normalize_id_list(person_ids):
        if not await get_by_field("people", "id", person_id):
            missing.append(person_id)
    return missing


async def ensure_projects_exist(project_ids: List[str]) -> List[str]:
    missing: List[str] = []
    for project_id in normalize_id_list(project_ids):
        if not await get_by_field("projects", "id", project_id):
            missing.append(project_id)
    return missing


async def require_project_editor(user: Dict[str, Any], project_id: str) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    linked_person = await get_linked_person(user)
    if not can_edit_project(user, project, linked_person):
        raise HTTPException(status_code=403, detail="Only a project lead or admin can manage project visuals")

    return project


def get_primary_project_lead_id(project: Dict[str, Any]) -> Optional[str]:
    return get_project_lead_id(project)


def can_edit_project(user: Dict[str, Any], project: Dict[str, Any], linked_person: Optional[Dict[str, Any]]) -> bool:
    """Admin can edit any project; the primary project lead can edit their own project."""
    if is_admin(user):
        return True
    if linked_person is None:
        return False
    return linked_person.get("id") == get_primary_project_lead_id(project)


def can_create_project(user: Dict[str, Any], linked_person: Optional[Dict[str, Any]]) -> bool:
    del linked_person
    return is_admin(user)


def is_project_member(project: Dict[str, Any], linked_person: Optional[Dict[str, Any]]) -> bool:
    if linked_person is None:
        return False
    return linked_person.get("id") in get_project_member_ids(project)


VALID_FEEDBACK_AUDIENCES = {"lead", "team", "review"}
VALID_FEEDBACK_BASE_AUDIENCES = {"lead", "team"}


def create_feedback_id() -> str:
    return f"fb-{uuid4().hex}"


def create_challenge_id() -> str:
    return f"ch{uuid4().hex}"


def normalize_feedback_base_audience(value: Optional[str]) -> str:
    if value == "lead":
        return "lead"
    return "team"


def normalize_feedback_include_reviewers(
    audience: Optional[str],
    include_reviewers: Optional[bool] = None,
) -> bool:
    if include_reviewers is not None:
        return bool(include_reviewers)
    return audience == "review"


def is_feedback_author(
    feedback_entry: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
) -> bool:
    if linked_person is None:
        return False

    linked_person_id = (linked_person.get("id") or "").strip()
    entry_author_id = (feedback_entry.get("authorId") or "").strip()
    if entry_author_id:
        return bool(linked_person_id and entry_author_id == linked_person_id)

    author_name = (feedback_entry.get("author") or "").strip()
    return bool(author_name and author_name == (linked_person.get("name") or "").strip())


def can_view_feedback_entry(
    user: Dict[str, Any],
    project: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
    feedback_entry: Dict[str, Any],
) -> bool:
    if is_admin(user):
        return True
    if linked_person is None:
        return False

    if is_feedback_author(feedback_entry, linked_person):
        return True

    audience = normalize_feedback_base_audience(feedback_entry.get("audience"))
    include_reviewers = normalize_feedback_include_reviewers(
        feedback_entry.get("audience"),
        feedback_entry.get("includeReviewers"),
    )
    if include_reviewers and can_access_review_surface(user, linked_person):
        return True
    if audience == "lead":
        return linked_person.get("id") == get_primary_project_lead_id(project)
    return is_project_member(project, linked_person)


def redact_project_feedback_for_viewer(
    project: Dict[str, Any],
    user: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    visible_feedback = [
        dict(entry)
        for entry in (project.get("feedback") or [])
        if can_view_feedback_entry(user, project, linked_person, entry)
    ]
    project_copy = dict(project)
    project_copy["feedback"] = visible_feedback
    return project_copy


def clean_export_line(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def append_markdown_section(lines: List[str], title: str, body_lines: List[str]) -> None:
    content = [line for line in body_lines if line is not None]
    if not any(str(line).strip() for line in content):
        return
    lines.extend(["", f"## {title}", ""])
    lines.extend(content)


def append_markdown_entry(lines: List[str], title: str, body_lines: List[str]) -> None:
    lines.extend(["", f"### {clean_export_line(title)}", ""])
    lines.extend(line for line in body_lines if line is not None)


def get_export_person_label(person_id: Optional[str], people_by_id: Dict[str, Dict[str, Any]]) -> str:
    if not person_id:
        return ""
    return people_by_id.get(person_id, {}).get("name") or person_id


def get_export_user_label(user: Dict[str, Any], linked_person: Optional[Dict[str, Any]]) -> str:
    if linked_person and linked_person.get("name"):
        return linked_person["name"]
    return user.get("name") or user.get("email") or user.get("id") or "Signed-in user"


def safe_project_export_filename(project_id: str, exported_on: str) -> str:
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "-", project_id or "project").strip("-") or "project"
    return f"yard-project-{safe_id}-{exported_on}.md"


def get_export_visual_filename(value: Optional[str]) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    filename = Path(unquote(parsed.path or value)).name
    return filename or value


def export_url_for_markdown(request: Request, value: Optional[str]) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if parsed.scheme and parsed.netloc:
        return cleaned
    if cleaned.startswith("/"):
        return f"{str(request.base_url).rstrip('/')}{cleaned}"
    return cleaned


def get_inline_visual_filenames(content: str) -> set[str]:
    filenames: set[str] = set()
    for match in re.finditer(r"!\[[^\]]*]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", content or ""):
        filename = get_export_visual_filename(match.group(1))
        if filename:
            filenames.add(filename)
    return filenames


def markdown_image_line(url: str, label: str) -> str:
    safe_label = clean_export_line(label).replace("[", "(").replace("]", ")") or "Visual"
    return f"![{safe_label}]({url})"


def feedback_export_audience_label(entry: Dict[str, Any]) -> str:
    audience = normalize_feedback_base_audience(entry.get("audience"))
    include_reviewers = normalize_feedback_include_reviewers(entry.get("audience"), entry.get("includeReviewers"))
    base = "Project lead" if audience == "lead" else "Project team"
    return f"{base} + programme support" if include_reviewers else base


def render_supporting_visuals_for_export(
    request: Request,
    urls: List[str],
    inline_filenames: Optional[set[str]] = None,
) -> List[str]:
    inline_filenames = inline_filenames or set()
    rendered: List[str] = []
    for index, url in enumerate(urls, start=1):
        filename = get_export_visual_filename(url)
        if filename and filename in inline_filenames:
            continue
        export_url = export_url_for_markdown(request, url)
        if export_url:
            rendered.extend([
                markdown_image_line(export_url, f"Visual {index}"),
                "",
            ])
    return rendered


def render_project_export_markdown(
    request: Request,
    project: Dict[str, Any],
    user: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
    people: List[Dict[str, Any]],
    milestones: List[Dict[str, Any]],
    concept_notes: List[Dict[str, Any]],
) -> str:
    people_by_id = {person.get("id"): person for person in people if person.get("id")}
    exported_at = utc_now()
    export_date = exported_at.strftime("%Y-%m-%d")
    export_timestamp = exported_at.strftime("%Y-%m-%d %H:%M UTC")
    lead_label = get_export_person_label(get_project_lead_id(project), people_by_id)
    contributor_labels = [
        get_export_person_label(person_id, people_by_id)
        for person_id in get_project_member_ids(project)
        if person_id and person_id != get_project_lead_id(project)
    ]
    contributor_labels = [label for label in contributor_labels if label]
    project_id = project.get("id") or ""

    lines: List[str] = [
        f"# {clean_export_line(project.get('title') or project_id or 'Project')}",
        "",
        f"_Snapshot exported on {export_timestamp}. Includes project content visible to {get_export_user_label(user, linked_person)} at export time._",
        "",
    ]

    meta_lines = []
    if lead_label:
        meta_lines.append(f"- Lead: {lead_label}")
    if contributor_labels:
        meta_lines.append(f"- Contributors: {', '.join(contributor_labels)}")
    append_markdown_section(lines, "Project Team", meta_lines)

    abstract_text = (project.get("abstract") or project.get("description") or "").strip()
    append_markdown_section(lines, "Abstract", [abstract_text] if abstract_text else [])

    related_note_lines = []
    for note in concept_notes:
        if project_id and project_id in (note.get("relatedProjects") or []):
            title = clean_export_line(note.get("title") or note.get("id"))
            if title:
                related_note_lines.append(f"- {title}")
    append_markdown_section(lines, "Related Concept Notes", related_note_lines)

    presentation_lines = []
    slides_url = (project.get("slidesUrl") or "").strip()
    if slides_url:
        presentation_lines.append(f"- Slides: {slides_url}")
    project_visuals = render_supporting_visuals_for_export(request, normalize_visual_list(project.get("svgUrls")) or [])
    presentation_lines.extend(project_visuals)
    append_markdown_section(lines, "Presentation Slides And Visuals", presentation_lines)

    current_challenges = sorted(
        project.get("currentChallenges") or [],
        key=lambda item: item.get("lastModified") or item.get("date") or "",
        reverse=True,
    )
    challenge_lines: List[str] = []
    for challenge in current_challenges:
        title = f"{challenge.get('lastModified') or challenge.get('date') or 'Undated'} — {normalize_challenge_severity(challenge.get('severity'))}"
        body = []
        if challenge.get("raisedBy"):
            body.append(f"Raised by: {challenge.get('raisedBy')}")
            body.append("")
        body.append((challenge.get("description") or "").strip())
        append_markdown_entry(challenge_lines, title, body)
    append_markdown_section(lines, "Current Challenges", challenge_lines)

    resolved_challenges = sorted(
        project.get("resolvedChallenges") or [],
        key=lambda item: item.get("resolvedDate") or item.get("lastModified") or item.get("date") or "",
        reverse=True,
    )
    resolved_lines: List[str] = []
    for challenge in resolved_challenges:
        title = f"{challenge.get('resolvedDate') or challenge.get('lastModified') or challenge.get('date') or 'Undated'} — {normalize_challenge_severity(challenge.get('severity'))}"
        body = []
        if challenge.get("resolvedBy"):
            body.append(f"Resolved by: {challenge.get('resolvedBy')}")
            body.append("")
        body.append((challenge.get("description") or "").strip())
        if challenge.get("resolutionNote"):
            body.extend(["", f"Resolution: {challenge.get('resolutionNote')}"])
        append_markdown_entry(resolved_lines, title, body)
    append_markdown_section(lines, "Resolved Challenges", resolved_lines)

    project_milestones = sorted(
        [
            milestone for milestone in milestones
            if (milestone.get("project") or milestone.get("projectId")) == project_id
        ],
        key=lambda item: item.get("dueDate") or "",
    )
    milestone_lines: List[str] = []
    for milestone in project_milestones:
        due_date = milestone.get("dueDate") or "No due date"
        status = compute_milestone_status(milestone)
        body = [f"- Due: {due_date}", f"- Status: {status}"]
        if milestone.get("completedDate"):
            body.append(f"- Completed: {milestone.get('completedDate')}")
        append_markdown_entry(milestone_lines, milestone.get("title") or "Milestone", body)
    append_markdown_section(lines, "Milestones", milestone_lines)

    progress_entries = [
        {**entry, "entryType": "updates"} for entry in (project.get("updates") or [])
    ] + [
        {**entry, "entryType": "feedback"} for entry in (project.get("feedback") or [])
    ]
    progress_entries = sorted(
        progress_entries,
        key=lambda item: item.get("lastModified") or item.get("date") or "",
        reverse=True,
    )
    progress_lines: List[str] = []
    for entry in progress_entries:
        date_label = entry.get("lastModified") or entry.get("date") or "Undated"
        title = entry.get("title") or ("Feedback" if entry.get("entryType") == "feedback" else "Update")
        body = []
        author = entry.get("author")
        if author:
            body.append(f"Author: {author}")
        if entry.get("entryType") == "feedback":
            body.append(f"Audience: {feedback_export_audience_label(entry)}")
        if body:
            body.append("")
        body.append((entry.get("content") or "").strip())
        if entry.get("entryType") == "updates":
            if entry.get("slidesUrl"):
                body.extend(["", f"Slides: {entry.get('slidesUrl')}"])
            visuals = render_supporting_visuals_for_export(
                request,
                normalize_visual_list(entry.get("svgUrls")) or [],
                get_inline_visual_filenames(entry.get("content") or ""),
            )
            if visuals:
                body.extend(["", "Supporting visuals:", "", *visuals])
        append_markdown_entry(progress_lines, f"{date_label} — {title}", body)
    append_markdown_section(lines, "Progress", progress_lines)

    return "\n".join(lines).strip() + "\n"


def can_add_project_feedback(
    user: Dict[str, Any],
    project: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
) -> bool:
    """Users with review access can add feedback unless they are the primary project lead."""
    if not can_access_review_surface(user, linked_person):
        return False
    if linked_person is None:
        return True
    return linked_person.get("id") != get_primary_project_lead_id(project)


def can_edit_feedback_entry(
    user: Dict[str, Any],
    project: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
    feedback_entry: Dict[str, Any],
) -> bool:
    if is_admin(user):
        return True
    if linked_person is None:
        return False
    if not is_feedback_author(feedback_entry, linked_person):
        return False
    return can_add_project_feedback(user, project, linked_person)


def build_unique_person_id_by_name(people: List[Dict[str, Any]]) -> Dict[str, str]:
    ids_by_name: Dict[str, set[str]] = {}
    for person in people:
        name = (person.get("name") or "").strip()
        person_id = (person.get("id") or "").strip()
        if not name or not person_id:
            continue
        ids_by_name.setdefault(name, set()).add(person_id)
    return {name: next(iter(person_ids)) for name, person_ids in ids_by_name.items() if len(person_ids) == 1}


def resolve_person_reference(
    value: str,
    people_by_id: Dict[str, Dict[str, Any]],
    unique_person_id_by_name: Dict[str, str],
) -> tuple[Optional[str], Optional[str]]:
    reference = (value or "").strip()
    if not reference:
        return None, None

    person = people_by_id.get(reference)
    if person:
        return (person.get("name") or "").strip() or reference, reference

    person_id = unique_person_id_by_name.get(reference)
    if person_id:
        return reference, person_id

    return reference, None


def normalize_feedback_identity_fields(
    feedback_entries: List[Dict[str, Any]],
    unique_person_id_by_name: Dict[str, str],
) -> tuple[List[Dict[str, Any]], bool]:
    changed = False
    seen_ids: set[str] = set()
    normalized_entries: List[Dict[str, Any]] = []

    for entry in feedback_entries:
        if not isinstance(entry, dict):
            normalized_entries.append(entry)
            continue

        normalized_entry = dict(entry)
        feedback_id = (normalized_entry.get("id") or "").strip()
        if not feedback_id or feedback_id in seen_ids:
            feedback_id = create_feedback_id()
            normalized_entry["id"] = feedback_id
            changed = True
        elif normalized_entry.get("id") != feedback_id:
            normalized_entry["id"] = feedback_id
            changed = True
        seen_ids.add(feedback_id)

        author_id = (normalized_entry.get("authorId") or "").strip()
        if author_id:
            if normalized_entry.get("authorId") != author_id:
                normalized_entry["authorId"] = author_id
                changed = True
        else:
            inferred_author_id = unique_person_id_by_name.get((normalized_entry.get("author") or "").strip())
            if inferred_author_id:
                normalized_entry["authorId"] = inferred_author_id
                changed = True

        normalized_entries.append(normalized_entry)

    return normalized_entries, changed


async def backfill_project_feedback_identity_fields() -> None:
    people = await list_collection("people", limit=1000)
    unique_person_id_by_name = build_unique_person_id_by_name(people)

    for project in await list_collection("projects", limit=1000):
        feedback_entries = project.get("feedback") or []
        if not isinstance(feedback_entries, list):
            continue

        normalized_feedback, changed = normalize_feedback_identity_fields(feedback_entries, unique_person_id_by_name)
        if changed:
            await update_fields("projects", "id", project["id"], {"feedback": normalized_feedback})
            logger.info("Migration: normalized feedback identities for project %s", project["id"])


def normalize_challenge_identity_fields(
    challenge_entries: List[Dict[str, Any]],
    people_by_id: Dict[str, Dict[str, Any]],
    unique_person_id_by_name: Dict[str, str],
    seen_ids: Optional[set[str]] = None,
) -> tuple[List[Dict[str, Any]], bool]:
    changed = False
    seen_ids = seen_ids if seen_ids is not None else set()
    normalized_entries: List[Dict[str, Any]] = []

    for entry in challenge_entries:
        if not isinstance(entry, dict):
            normalized_entries.append(entry)
            continue

        normalized_entry = dict(entry)
        challenge_id = (normalized_entry.get("id") or "").strip()
        if not challenge_id or challenge_id in seen_ids:
            challenge_id = create_challenge_id()
            normalized_entry["id"] = challenge_id
            changed = True
        elif normalized_entry.get("id") != challenge_id:
            normalized_entry["id"] = challenge_id
            changed = True
        seen_ids.add(challenge_id)

        raised_by = (normalized_entry.get("raisedBy") or "").strip()
        raised_by_id = (normalized_entry.get("raisedById") or "").strip()
        if raised_by_id:
            if normalized_entry.get("raisedById") != raised_by_id:
                normalized_entry["raisedById"] = raised_by_id
                changed = True
        else:
            display_name, inferred_id = resolve_person_reference(
                raised_by,
                people_by_id,
                unique_person_id_by_name,
            )
            if inferred_id:
                normalized_entry["raisedById"] = inferred_id
                changed = True
            if display_name and display_name != raised_by:
                normalized_entry["raisedBy"] = display_name
                changed = True

        resolved_by = (normalized_entry.get("resolvedBy") or "").strip()
        resolved_by_id = (normalized_entry.get("resolvedById") or "").strip()
        if resolved_by_id:
            if normalized_entry.get("resolvedById") != resolved_by_id:
                normalized_entry["resolvedById"] = resolved_by_id
                changed = True
        else:
            display_name, inferred_id = resolve_person_reference(
                resolved_by,
                people_by_id,
                unique_person_id_by_name,
            )
            if inferred_id:
                normalized_entry["resolvedById"] = inferred_id
                changed = True
            if display_name and display_name != resolved_by:
                normalized_entry["resolvedBy"] = display_name
                changed = True

        normalized_entries.append(normalized_entry)

    return normalized_entries, changed


async def backfill_project_challenge_identity_fields() -> None:
    people = await list_collection("people", limit=1000)
    people_by_id = {
        (person.get("id") or "").strip(): person
        for person in people
        if (person.get("id") or "").strip()
    }
    unique_person_id_by_name = build_unique_person_id_by_name(people)

    for project in await list_collection("projects", limit=1000):
        current_challenges = project.get("currentChallenges") or []
        resolved_challenges = project.get("resolvedChallenges") or []
        if not isinstance(current_challenges, list) or not isinstance(resolved_challenges, list):
            continue

        seen_ids: set[str] = set()
        normalized_current, current_changed = normalize_challenge_identity_fields(
            current_challenges,
            people_by_id,
            unique_person_id_by_name,
            seen_ids,
        )
        normalized_resolved, resolved_changed = normalize_challenge_identity_fields(
            resolved_challenges,
            people_by_id,
            unique_person_id_by_name,
            seen_ids,
        )

        if current_changed or resolved_changed:
            await update_fields(
                "projects",
                "id",
                project["id"],
                {
                    "currentChallenges": normalized_current,
                    "resolvedChallenges": normalized_resolved,
                },
            )
            logger.info("Migration: normalized challenge identities for project %s", project["id"])


def can_access_review_surface(user: Dict[str, Any], linked_person: Optional[Dict[str, Any]]) -> bool:
    if is_admin(user):
        return True
    if linked_person is None:
        return False

    role = linked_person.get("role")
    if role in {"staff", "coordinator", "management"}:
        return True

    return role == "pi"


def build_admin_user_summary(
    account: Dict[str, Any],
    people_by_email: Dict[str, Dict[str, Any]],
    people_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    summary = serialize_user(account)
    linked_person = None
    if people_by_id:
        linked_person = people_by_id.get((account.get("person_id") or "").strip())
    if not linked_person:
        linked_person = people_by_email.get(normalize_email_value(account.get("email")))
    expiry = get_temporary_password_expiry(account)
    summary.update({
        "linkedPersonId": linked_person.get("id") if linked_person else "",
        "linkedPersonName": linked_person.get("name") if linked_person else "",
        "linkedPersonRole": linked_person.get("role") if linked_person else "",
        "temporaryPasswordExpired": bool(expiry and expiry <= utc_now()),
    })
    return summary


# ── Update models for B20 ──────────────────────────────────────────────

class PersonUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    institution: Optional[str] = None
    title: Optional[str] = None
    researchDescription: Optional[str] = None
    skills: Optional[List[str]] = None
    email: Optional[str] = None
    links: Optional[List[Dict[str, Any]]] = None
    website: Optional[str] = None
    github: Optional[str] = None
    substack: Optional[str] = None
    orcid: Optional[str] = None
    showEmail: Optional[bool] = None
    showTeamsChat: Optional[bool] = None
    equipment: Optional[List[Dict[str, Any]]] = None
    publish: Optional[bool] = None  # Legacy compatibility field; ignored for profile saves

    @field_validator("role")
    @classmethod
    def check_role(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}, got {v}")
        return v

    @field_validator("institution")
    @classmethod
    def check_institution(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in VALID_INSTITUTIONS:
            raise ValueError(f"institution must be one of {VALID_INSTITUTIONS}, got {v}")
        return v

    @model_validator(mode="after")
    def check_at_least_one_field(self) -> "PersonUpdate":
        has_field = any([
            self.name is not None,
            self.role is not None,
            self.institution is not None,
            self.title is not None,
            self.researchDescription is not None,
            self.skills is not None,
            self.email is not None,
            self.links is not None,
            self.website is not None,
            self.github is not None,
            self.substack is not None,
            self.orcid is not None,
            self.showEmail is not None, self.showTeamsChat is not None, self.equipment is not None,
        ])
        if not has_field:
            raise ValueError("At least one field must be provided for update")
        return self


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    abstract: Optional[str] = None
    aims: Optional[str] = None
    status: Optional[str] = None
    institution: Optional[str] = None
    slidesUrl: Optional[str] = None
    svgUrls: Optional[List[str]] = None
    leads: Optional[List[str]] = None  # flat list of person IDs (B44)
    leadId: Optional[str] = None
    teamMemberIds: Optional[List[str]] = None
    publish: Optional[bool] = None  # Save mode: True = Publish, False/None = Save quietly

    @field_validator("slidesUrl")
    @classmethod
    def normalize_slides_url(cls, v: Optional[str]) -> Optional[str]:
        return normalize_embed_input(v, empty_as_none=False)

    @field_validator("svgUrls")
    @classmethod
    def normalize_svg_urls(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return normalize_visual_list(v)

    @field_validator("leads", "teamMemberIds")
    @classmethod
    def normalize_team_lists(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        return normalize_id_list(v)

    @field_validator("leadId")
    @classmethod
    def normalize_lead_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return v.strip()

    @field_validator("institution")
    @classmethod
    def check_project_institution(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v not in VALID_INSTITUTIONS:
            raise ValueError(f"institution must be one of {VALID_INSTITUTIONS}, got {v}")
        return v

    @model_validator(mode="after")
    def check_at_least_one_field(self) -> "ProjectUpdate":
        if not any([
            self.title is not None,
            self.description is not None,
            self.abstract is not None,
            self.aims is not None,
            self.status is not None,
            self.institution is not None,
            self.slidesUrl is not None,
            self.svgUrls is not None,
            self.leads is not None,
            self.leadId is not None,
            self.teamMemberIds is not None,
        ]):
            raise ValueError("At least one field must be provided for update")
        return self


class ProjectCreate(BaseModel):
    title: str
    institution: str
    leadId: str
    teamMemberIds: List[str] = Field(default_factory=list)
    summary: str
    type: str = "individual"

    @field_validator("title", "summary", "leadId")
    @classmethod
    def strip_required_string(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("This field is required")
        return cleaned

    @field_validator("institution")
    @classmethod
    def check_create_institution(cls, v: str) -> str:
        if v not in VALID_INSTITUTIONS:
            raise ValueError(f"institution must be one of {VALID_INSTITUTIONS}, got {v}")
        return v

    @field_validator("teamMemberIds")
    @classmethod
    def normalize_create_team_list(cls, v: List[str]) -> List[str]:
        return normalize_id_list(v)


VALID_ROLES = {"pi", "postdoc", "phd", "coordinator", "staff", "management"}
VALID_INSTITUTIONS = {"thornbridge", "lakemere", "aldhelm"}


def normalize_embed_input(value: Optional[str], *, empty_as_none: bool = True) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None if empty_as_none else ""
    if "<iframe" in cleaned and "src=" in cleaned:
        match = re.search(r'src=["\']([^"\']+)["\']', cleaned)
        if match:
            extracted = match.group(1).strip()
            if extracted:
                return extracted
            return None if empty_as_none else ""
    return cleaned


def xml_local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def sanitize_upload_basename(filename: str) -> str:
    stem = Path(filename or "visual").stem
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", stem).strip("-").lower()
    return slug or "visual"


def clean_svg_element(element: ET.Element) -> None:
    disallowed_tags = {
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "audio",
        "video",
        "canvas",
    }
    dangerous_url_prefixes = ("javascript:", "data:text/html", "vbscript:")

    for child in list(element):
        if xml_local_name(child.tag) in disallowed_tags:
            element.remove(child)
            continue
        clean_svg_element(child)

    for attribute in list(element.attrib.keys()):
        local_attr = xml_local_name(attribute).lower()
        value = (element.attrib.get(attribute) or "").strip()
        lowered = value.lower()

        if local_attr.startswith("on"):
            del element.attrib[attribute]
            continue

        if local_attr in {"href"} and lowered.startswith(dangerous_url_prefixes):
            del element.attrib[attribute]


def sanitize_svg_markup(raw_svg: str) -> str:
    try:
        root = ET.fromstring(raw_svg)
    except ET.ParseError as exc:
        raise ValueError("Invalid SVG file") from exc

    if xml_local_name(root.tag) != "svg":
        raise ValueError("Uploaded file must be an SVG")

    clean_svg_element(root)
    sanitized = ET.tostring(root, encoding="unicode")
    if not sanitized.lstrip().startswith("<?xml"):
        sanitized = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + sanitized
    return sanitized


def get_visual_extension(filename: str) -> str:
    return Path(filename or "").suffix.lower()


def detect_visual_media_type(filename: str) -> str:
    extension = get_visual_extension(filename)
    if extension == ".svg":
        return "image/svg+xml"
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def normalize_visual_list(values: Optional[List[str]]) -> Optional[List[str]]:
    if values is None:
        return None
    cleaned: List[str] = []
    for value in values:
        normalized = normalize_embed_input(value)
        if normalized:
            cleaned.append(normalized)
    deduped = list(dict.fromkeys(cleaned))
    if len(deduped) > MAX_VISUALS_PER_ITEM:
        raise ValueError(f"A maximum of {MAX_VISUALS_PER_ITEM} visuals is allowed")
    return deduped


def uploaded_visual_reference_from_url(value: Optional[str]) -> Optional[tuple[str, str]]:
    if not value or not isinstance(value, str):
        return None
    raw_value = value.strip()
    if not raw_value:
        return None

    parsed = urlparse(raw_value)
    path = parsed.path if (parsed.scheme or parsed.netloc) else raw_value
    for upload_kind, prefix in (("visual", "/api/uploads/visual/"), ("svg", "/api/uploads/svg/")):
        if not path.startswith(prefix):
            continue
        filename = unquote(path[len(prefix):]).strip().strip("/")
        if not filename:
            return None
        safe_name = Path(filename).name
        extension = Path(safe_name).suffix.lower()
        if upload_kind == "svg" and extension == ".svg":
            return (upload_kind, safe_name)
        if upload_kind == "visual" and extension in {".svg", ".png", ".jpg", ".jpeg"}:
            return (upload_kind, safe_name)
    return None


def collect_uploaded_visual_references_from_values(
    visual_urls: Optional[List[str]] = None,
    legacy_visual_url: Optional[str] = None,
) -> set[tuple[str, str]]:
    references: set[tuple[str, str]] = set()
    for value in visual_urls or []:
        reference = uploaded_visual_reference_from_url(value)
        if reference:
            references.add(reference)
    legacy_reference = uploaded_visual_reference_from_url(legacy_visual_url)
    if legacy_reference:
        references.add(legacy_reference)
    return references


def collect_referenced_uploaded_visual_references(projects: List[Dict[str, Any]]) -> set[tuple[str, str]]:
    referenced: set[tuple[str, str]] = set()
    for project in projects:
        referenced.update(
            collect_uploaded_visual_references_from_values(
                project.get("svgUrls"),
                project.get("svgUrl"),
            )
        )
        for update in project.get("updates") or []:
            referenced.update(
                collect_uploaded_visual_references_from_values(
                    update.get("svgUrls"),
                    update.get("svgUrl"),
                )
            )
    return referenced


def resolve_uploaded_visual_target(upload_kind: str, filename: str) -> Optional[Path]:
    if upload_kind == "visual":
        return (UPLOADS_VISUAL_DIR / filename).resolve()
    if upload_kind == "svg":
        return (UPLOADS_SVG_DIR / filename).resolve()
    return None


async def delete_orphaned_uploaded_visuals(candidate_references: set[tuple[str, str]]) -> None:
    if not candidate_references:
        return

    projects = await list_collection("projects", limit=1000)
    referenced_references = collect_referenced_uploaded_visual_references(projects)
    orphaned_references = candidate_references - referenced_references
    if not orphaned_references:
        return

    valid_roots = {
        "visual": UPLOADS_VISUAL_DIR.resolve(),
        "svg": UPLOADS_SVG_DIR.resolve(),
    }
    for upload_kind, filename in orphaned_references:
        target = resolve_uploaded_visual_target(upload_kind, filename)
        uploads_root = valid_roots.get(upload_kind)
        if target is None or uploads_root is None or uploads_root not in target.parents or not target.is_file():
            continue
        try:
            target.unlink()
        except OSError:
            logger.warning("Failed to delete orphaned visual upload %s", target, exc_info=True)


class PersonCreate(BaseModel):
    name: str
    role: str
    institution: str
    title: Optional[str] = None
    email: Optional[str] = None
    researchDescription: Optional[str] = None
    skills: Optional[List[str]] = None
    links: Optional[List[Dict[str, Any]]] = None
    website: Optional[str] = None
    github: Optional[str] = None
    substack: Optional[str] = None
    orcid: Optional[str] = None

    @field_validator("role")
    @classmethod
    def check_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}, got {v}")
        return v

    @field_validator("institution")
    @classmethod
    def check_institution(cls, v: str) -> str:
        if v not in VALID_INSTITUTIONS:
            raise ValueError(f"institution must be one of {VALID_INSTITUTIONS}, got {v}")
        return v

class AdminOnboardMemberInput(PersonCreate):
    pass


class PersonAccountCreateInput(BaseModel):
    email: Optional[str] = None


VALID_MILESTONE_TYPES = {"research", "publication", "dataset", "release", "hardware", "design", "IP", "milestone"}


def _validate_due_date(value: str) -> str:
    """Validate that a date string is YYYY-MM-DD or YYYY-MM."""
    try:
        if len(value) == 7:
            datetime.strptime(value, "%Y-%m")
        else:
            datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"dueDate must be YYYY-MM-DD or YYYY-MM format, got {value}")
    return value


def _validate_day(value: str, field_name: str = "date") -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"{field_name} must be YYYY-MM-DD format, got {value}")
    return value


def _parse_day(value: str) -> datetime:
    return datetime.strptime(_validate_day(value), "%Y-%m-%d")


def _format_day(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


class MilestoneCreate(BaseModel):
    project: str
    title: str
    dueDate: str
    type: str = "milestone"

    @field_validator("dueDate")
    @classmethod
    def check_due_date(cls, v: str) -> str:
        return _validate_due_date(v)

    @field_validator("type")
    @classmethod
    def check_type(cls, v: str) -> str:
        if v not in VALID_MILESTONE_TYPES:
            raise ValueError(f"type must be one of {VALID_MILESTONE_TYPES}, got {v}")
        return v


CONCEPT_NOTE_ACTIVE_DAYS = 56
CONCEPT_NOTE_ACTIVE_EXTENSION_DAYS = 30
VALID_CN_PROGRESS_KINDS = {"linked-project", "connection-made", "informed-discussion", "taken-forward"}
VALID_CN_TAKEN_FORWARD_TARGETS = {"existing-project", "new-project", "work-package"}


def compute_concept_note_active_until(created_at: str, days: int = CONCEPT_NOTE_ACTIVE_DAYS) -> str:
    return _format_day(_parse_day(created_at) + timedelta(days=days))


def is_concept_note_progressed(note: Dict[str, Any]) -> bool:
    return bool(note.get("progressSignals") or [])


def is_concept_note_active(note: Dict[str, Any], reference_day: Optional[str] = None) -> bool:
    active_until = note.get("activeUntil")
    if not active_until:
        return False
    comparison_day = reference_day or utc_now().strftime("%Y-%m-%d")
    return _parse_day(active_until) >= _parse_day(comparison_day) and not is_concept_note_progressed(note)


def get_concept_note_actor_id(user: Dict[str, Any]) -> str:
    return (
        user.get("personId")
        or user.get("person_id")
        or user.get("id")
        or user.get("email")
        or "system"
    )


def get_concept_note_actor_ids(
    user: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]] = None,
) -> List[str]:
    values = [
        linked_person.get("id") if linked_person else None,
        user.get("personId"),
        user.get("person_id"),
        user.get("id"),
        user.get("email"),
    ]
    actor_ids: List[str] = []
    for value in values:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in actor_ids:
            actor_ids.append(cleaned)
    return actor_ids


def can_create_concept_note(linked_person: Optional[Dict[str, Any]]) -> bool:
    return linked_person is not None


def can_edit_concept_note_content(
    user: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
    note: Dict[str, Any],
) -> bool:
    if is_admin(user):
        return True
    if linked_person is None:
        return False

    actor_ids = set(get_concept_note_actor_ids(user, linked_person))
    contributors = {
        (contributor_id or "").strip()
        for contributor_id in (note.get("contributors") or [])
        if (contributor_id or "").strip()
    }
    created_by = (note.get("createdBy") or "").strip()

    if created_by and created_by in actor_ids:
        return True
    return bool(actor_ids & contributors)


def can_manage_concept_note_contributors(
    user: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
    note: Dict[str, Any],
) -> bool:
    if is_admin(user):
        return True
    if linked_person is None:
        return False

    actor_ids = set(get_concept_note_actor_ids(user, linked_person))
    created_by = (note.get("createdBy") or "").strip()
    return bool(created_by and created_by in actor_ids)


def serialize_concept_note_for_user(
    note: Dict[str, Any],
    user: Dict[str, Any],
    linked_person: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    serialized = clone_document(note)
    if is_concept_note_progressed(note):
        serialized["frontstageState"] = "progressed"
    elif is_concept_note_active(note):
        serialized["frontstageState"] = "active"
    else:
        serialized["frontstageState"] = "all"
    if not can_access_review_surface(user, linked_person):
        serialized.pop("activeUntil", None)
    if not is_admin(user):
        serialized.pop("lastActiveExtension", None)
    return serialized


def build_concept_note_activity_author(note: Dict[str, Any], people_by_id: Dict[str, str]) -> str:
    contributors = note.get("contributors") or []
    names = [people_by_id.get(contributor, contributor) for contributor in contributors]
    if not names:
        return ""
    if len(names) <= 2:
        return ", ".join(names)
    return f"{', '.join(names[:2])} +{len(names) - 2}"


def normalize_concept_note_progress_signals(
    signals: List[Dict[str, Any]],
    actor_id: str,
    default_date: str,
) -> List[Dict[str, Any]]:
    normalized = []
    for signal in signals:
        signal_doc = deepcopy(signal)
        signal_doc["date"] = signal_doc.get("date") or default_date
        signal_doc["addedBy"] = signal_doc.get("addedBy") or actor_id
        normalized.append(signal_doc)
    return normalized


class ConceptNoteProgressSignal(BaseModel):
    kind: str
    date: Optional[str] = None
    addedBy: Optional[str] = ""
    projectId: Optional[str] = ""
    targetType: Optional[str] = ""
    note: Optional[str] = ""

    @field_validator("kind")
    @classmethod
    def check_kind(cls, v: str) -> str:
        if v not in VALID_CN_PROGRESS_KINDS:
            raise ValueError(f"kind must be one of {VALID_CN_PROGRESS_KINDS}, got {v}")
        return v

    @field_validator("date")
    @classmethod
    def check_date(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _validate_day(v, "date")
        return v

    @model_validator(mode="after")
    def check_progress_shape(self) -> "ConceptNoteProgressSignal":
        if self.kind == "linked-project" and not self.projectId:
            raise ValueError("projectId is required when kind is linked-project")

        if self.kind == "taken-forward":
            if self.targetType not in VALID_CN_TAKEN_FORWARD_TARGETS:
                raise ValueError(f"targetType must be one of {VALID_CN_TAKEN_FORWARD_TARGETS} when kind is taken-forward")
            if self.targetType == "existing-project" and not self.projectId:
                raise ValueError("projectId is required when taken-forward targets an existing project")

        return self


class ConceptNoteActiveExtension(BaseModel):
    previousActiveUntil: str
    extendedAt: str
    extendedBy: str

    @field_validator("previousActiveUntil", "extendedAt")
    @classmethod
    def check_dates(cls, v: str, info) -> str:
        return _validate_day(v, info.field_name)


def _normalize_string_list(values: List[str], label: str) -> List[str]:
    cleaned: List[str] = []
    for value in values:
        trimmed = value.strip()
        if trimmed and trimmed not in cleaned:
            cleaned.append(trimmed)
    if label == "contributors" and not cleaned:
        raise ValueError("contributors must include at least one person")
    return cleaned


class ConceptNoteCreate(BaseModel):
    title: str
    contributors: List[str] = Field(default_factory=list, min_length=1)
    rationale: str = ""
    relevance: str = ""
    preliminaryInsights: str = ""
    nextSteps: str = ""
    relatedProjects: List[str] = Field(default_factory=list)

    @field_validator("title", "rationale")
    @classmethod
    def check_required_text(cls, v: str, info) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError(f"{info.field_name} is required")
        return trimmed

    @field_validator("contributors")
    @classmethod
    def check_contributors(cls, v: List[str]) -> List[str]:
        return _normalize_string_list(v, "contributors")

    @field_validator("relatedProjects")
    @classmethod
    def check_related_projects(cls, v: List[str]) -> List[str]:
        return _normalize_string_list(v, "relatedProjects")


VALID_MILESTONE_STATUSES = {"on-track", "completed", "approaching", "overdue"}


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    dueDate: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    project: Optional[str] = None
    publish: Optional[bool] = None  # True = Publish (stamp lastModified), False/None = Save quietly

    @model_validator(mode="after")
    def check_at_least_one_field(self) -> "MilestoneUpdate":
        if not any([self.title, self.dueDate, self.type, self.status, self.project, self.publish is not None]):
            raise ValueError("At least one field must be provided for update")
        return self

    @field_validator("dueDate")
    @classmethod
    def check_due_date(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            _validate_due_date(v)
        return v

    @field_validator("type")
    @classmethod
    def check_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_MILESTONE_TYPES:
            raise ValueError(f"type must be one of {VALID_MILESTONE_TYPES}, got {v}")
        return v

    @field_validator("status")
    @classmethod
    def check_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_MILESTONE_STATUSES:
            raise ValueError(f"status must be one of {VALID_MILESTONE_STATUSES}, got {v}")
        return v


class MilestoneCompleteInput(BaseModel):
    completedDate: Optional[str] = None

    @field_validator("completedDate")
    @classmethod
    def check_completed_date(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            _validate_due_date(v)
        return v


class ConceptNoteUpdate(BaseModel):
    title: Optional[str] = None
    contributors: Optional[List[str]] = None
    rationale: Optional[str] = None
    relevance: Optional[str] = None
    preliminaryInsights: Optional[str] = None
    nextSteps: Optional[str] = None
    relatedProjects: Optional[List[str]] = None
    activeUntil: Optional[str] = None
    progressSignals: Optional[List[ConceptNoteProgressSignal]] = None
    relatedConceptNoteIds: Optional[List[str]] = None

    @model_validator(mode="after")
    def check_at_least_one_field(self) -> "ConceptNoteUpdate":
        if not any([
            self.title,
            self.contributors is not None,
            self.rationale,
            self.relevance,
            self.preliminaryInsights,
            self.nextSteps,
            self.relatedProjects is not None,
            self.activeUntil,
            self.progressSignals is not None,
            self.relatedConceptNoteIds is not None,
        ]):
            raise ValueError("At least one field must be provided for update")
        return self

    @field_validator("title", "rationale")
    @classmethod
    def check_optional_required_text(cls, v: Optional[str], info) -> Optional[str]:
        if v is None:
            return v
        trimmed = v.strip()
        if not trimmed:
            raise ValueError(f"{info.field_name} cannot be blank")
        return trimmed

    @field_validator("contributors")
    @classmethod
    def check_optional_contributors(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        return _normalize_string_list(v, "contributors")

    @field_validator("relatedProjects", "relatedConceptNoteIds")
    @classmethod
    def check_optional_string_lists(cls, v: Optional[List[str]], info) -> Optional[List[str]]:
        if v is None:
            return v
        return _normalize_string_list(v, info.field_name)

    @field_validator("activeUntil")
    @classmethod
    def check_active_until(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _validate_day(v, "activeUntil")
        return v


class ProjectUpdateCreate(BaseModel):
    title: str
    content: str
    author: str = ""
    date: Optional[str] = None
    slidesUrl: Optional[str] = None
    svgUrls: Optional[List[str]] = None
    publish: Optional[bool] = None

    @field_validator("slidesUrl")
    @classmethod
    def normalize_slides_url(cls, v: Optional[str]) -> Optional[str]:
        return normalize_embed_input(v)

    @field_validator("svgUrls")
    @classmethod
    def normalize_svg_urls(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return normalize_visual_list(v)


class FeedbackCreate(BaseModel):
    title: Optional[str] = ""
    content: str
    author: str = ""
    date: Optional[str] = None
    publish: Optional[bool] = None
    audience: str = "team"
    includeReviewers: Optional[bool] = None

    @field_validator("audience")
    @classmethod
    def check_audience(cls, v: str) -> str:
        if v not in VALID_FEEDBACK_AUDIENCES:
            raise ValueError(f"audience must be one of {VALID_FEEDBACK_AUDIENCES}, got {v}")
        return v

    @field_validator("title")
    @classmethod
    def normalize_title(cls, v: Optional[str]) -> str:
        return (v or "").strip()

    @field_validator("content")
    @classmethod
    def check_content(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("content cannot be empty")
        return v

    @field_validator("includeReviewers")
    @classmethod
    def check_include_reviewers(cls, v: Optional[bool]) -> Optional[bool]:
        if v is None:
            return None
        return bool(v)


VALID_CHALLENGE_SEVERITIES = {"blocking", "slowing"}


def normalize_challenge_severity(value: Optional[str]) -> Optional[str]:
    if value == "minor":
        return "slowing"
    return value


class ChallengeCreate(BaseModel):
    description: str
    severity: str = "slowing"
    raisedBy: str = ""
    date: Optional[str] = None
    publish: Optional[bool] = None

    @field_validator("description")
    @classmethod
    def check_description(cls, v: str) -> str:
        value = (v or "").strip()
        if not value:
            raise ValueError("description cannot be empty")
        return value

    @field_validator("severity")
    @classmethod
    def check_severity(cls, v: str) -> str:
        v = normalize_challenge_severity(v)
        if v not in VALID_CHALLENGE_SEVERITIES:
            raise ValueError(f"severity must be one of {VALID_CHALLENGE_SEVERITIES}, got {v}")
        return v


class ChallengeEdit(BaseModel):
    description: Optional[str] = None
    severity: Optional[str] = None
    publish: Optional[bool] = None

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        value = v.strip()
        if not value:
            raise ValueError("description cannot be empty")
        return value

    @model_validator(mode="after")
    def check_at_least_one_field(self) -> "ChallengeEdit":
        if not any([self.description, self.severity, self.publish is not None]):
            raise ValueError("At least one field must be provided for update")
        return self

    @field_validator("severity")
    @classmethod
    def check_severity(cls, v: Optional[str]) -> Optional[str]:
        v = normalize_challenge_severity(v)
        if v is not None and v not in VALID_CHALLENGE_SEVERITIES:
            raise ValueError(f"severity must be one of {VALID_CHALLENGE_SEVERITIES}, got {v}")
        return v


class ChallengeResolve(BaseModel):
    resolutionNote: Optional[str] = ""
    resolvedDate: Optional[str] = None


def compute_milestone_status(milestone: Dict[str, Any]) -> str:
    if milestone.get("status") == "completed" or milestone.get("completedDate"):
        return "completed"

    due_date_raw = milestone.get("dueDate", "")
    if not due_date_raw:
        return "on-track"

    try:
        if len(due_date_raw) <= 7:
            due_date = datetime.strptime(due_date_raw, "%Y-%m").replace(day=28)
        else:
            due_date = datetime.strptime(due_date_raw, "%Y-%m-%d")
    except ValueError:
        return "on-track"

    today = utc_now().date()
    due_day = due_date.date()
    if due_day < today:
        return "overdue"
    if (due_day - today).days <= 30:
        return "approaching"
    return "on-track"


def is_entry_surfaced(entry: Dict[str, Any]) -> bool:
    return entry.get("published", True) is not False


@api_router.get("/health")
async def health_check() -> Dict[str, Any]:
    return {
        "status": "ok",
        "storage": "mongo" if USE_MONGO else "json",
        "cookieSecure": COOKIE_SECURE,
    }


@api_router.get("/health/ready")
async def readiness_check() -> Dict[str, Any]:
    storage_health = await check_storage_health()
    return {
        "status": "ok",
        "ready": True,
        "cookieSecure": COOKIE_SECURE,
        **storage_health,
    }


async def normalize_project_team_update(
    project: Dict[str, Any],
    update_payload: Dict[str, Any],
) -> Dict[str, Any]:
    if not any(key in update_payload for key in ("leadId", "teamMemberIds", "leads")):
        return update_payload

    existing_lead_id = get_project_lead_id(project)
    supplied_lead_id = update_payload.get("leadId")
    supplied_team_member_ids = update_payload.get("teamMemberIds")
    supplied_legacy_leads = update_payload.get("leads")

    if supplied_team_member_ids is None:
        if supplied_legacy_leads is not None:
            supplied_team_member_ids = supplied_legacy_leads
        else:
            supplied_team_member_ids = get_project_member_ids(project)

    normalized_member_ids = normalize_id_list(supplied_team_member_ids)

    if supplied_lead_id is None:
        if existing_lead_id and existing_lead_id in normalized_member_ids:
            supplied_lead_id = existing_lead_id
        elif normalized_member_ids:
            supplied_lead_id = normalized_member_ids[0]
        else:
            supplied_lead_id = existing_lead_id

    team_fields = build_project_team_fields(supplied_lead_id, normalized_member_ids)
    if not team_fields["leadId"]:
        raise HTTPException(status_code=422, detail="A project lead is required")

    missing_people = await ensure_people_exist(team_fields["teamMemberIds"])
    if missing_people:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown team member id(s): {', '.join(missing_people)}",
        )

    normalized_payload = dict(update_payload)
    normalized_payload.pop("leadId", None)
    normalized_payload.pop("teamMemberIds", None)
    normalized_payload.pop("leads", None)
    normalized_payload.update(team_fields)
    return normalized_payload


@api_router.post("/auth/register")
async def register(data: RegisterInput, response: Response) -> Dict[str, Any]:
    if not SELF_REGISTRATION_ENABLED:
        raise HTTPException(
            status_code=403,
            detail="Self-registration is disabled. Ask a Yard administrator for an invite.",
        )

    email = normalize_email_value(data.email)
    if await get_user_by_email(email):
        raise HTTPException(status_code=400, detail="Email already registered")

    linked_person = await get_person_by_email(email)
    if linked_person and await get_by_field("users", "person_id", linked_person.get("id"), include_internal_id=True):
        raise HTTPException(status_code=400, detail="Yard access already exists for this profile")
    created_at = utc_now().isoformat()
    doc = {
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": "user",
        "person_id": linked_person.get("id", "") if linked_person else "",
        "created_at": created_at,
        "password_changed_at": created_at,
        "token_version": 0,
        "must_change_password": False,
    }
    created_user = await insert_one("users", doc)
    user_payload = serialize_user(created_user)
    access_token = create_access_token(user_payload["id"], email, get_user_token_version(created_user))
    refresh_token = create_refresh_token(user_payload["id"], get_user_token_version(created_user))
    set_auth_cookies(response, access_token, refresh_token)
    return user_payload


@api_router.post("/auth/login")
async def login(data: LoginInput, response: Response) -> Dict[str, Any]:
    email = normalize_email_value(data.email)
    user = await get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user_activation_pending(user):
        if is_activation_expired(user):
            raise HTTPException(
                status_code=401,
                detail="This invite link has expired. Ask a Yard administrator for a new invite.",
            )
        raise HTTPException(
            status_code=401,
            detail="Your Yard account is waiting for activation. Open your invite link to choose a password.",
        )
    if not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user_must_change_password(user) and is_temporary_password_expired(user):
        raise HTTPException(
            status_code=401,
            detail="Temporary password has expired. Contact an administrator for a new one.",
        )
    user = await ensure_user_person_link(user)

    user_payload = serialize_user(user)
    token_version = get_user_token_version(user)
    access_token = create_access_token(user_payload["id"], email, token_version)
    refresh_token = create_refresh_token(user_payload["id"], token_version)
    set_auth_cookies(response, access_token, refresh_token)
    return user_payload


@api_router.get("/auth/activation-status")
async def get_activation_status(token: str) -> Dict[str, Any]:
    cleaned_token = (token or "").strip()
    if not cleaned_token:
        raise HTTPException(status_code=422, detail="Invite token is required")

    user = await get_by_field(
        "users",
        "activation_token_hash",
        hash_activation_token(cleaned_token),
        include_internal_id=True,
    )
    if not user or not user_activation_pending(user):
        raise HTTPException(status_code=404, detail="This invite link is not valid anymore.")
    if is_activation_expired(user):
        raise HTTPException(status_code=410, detail="This invite link has expired. Ask a Yard administrator for a new one.")

    return {
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "expiresAt": user.get("activation_expires_at", ""),
    }


@api_router.post("/auth/activate-account")
async def activate_account(data: ActivateAccountInput) -> Dict[str, Any]:
    cleaned_token = (data.token or "").strip()
    if not cleaned_token:
        raise HTTPException(status_code=422, detail="Invite token is required")

    user = await get_by_field(
        "users",
        "activation_token_hash",
        hash_activation_token(cleaned_token),
        include_internal_id=True,
    )
    if not user or not user_activation_pending(user):
        raise HTTPException(status_code=404, detail="This invite link is not valid anymore.")
    if is_activation_expired(user):
        raise HTTPException(status_code=410, detail="This invite link has expired. Ask a Yard administrator for a new one.")

    updated_user = await update_fields(
        "users",
        "email",
        user["email"],
        {
            "password_hash": hash_password(data.password),
            "password_changed_at": utc_now().isoformat(),
            "activation_completed_at": utc_now().isoformat(),
            "must_change_password": False,
        },
        unset_fields=["activation_token_hash", "activation_expires_at", "activation_created_at", "activation_created_by"],
    )
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "email": updated_user.get("email", ""),
        "name": updated_user.get("name", ""),
        "activatedAt": updated_user.get("activation_completed_at", ""),
    }


@api_router.get("/auth/me")
async def get_me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return user


@api_router.post("/auth/change-password")
async def change_password(
    data: ChangePasswordInput,
    response: Response,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_record = await get_user_by_id(user["id"])
    if not user_record:
        raise HTTPException(status_code=404, detail="User not found")

    must_change = user_must_change_password(user_record)
    if not must_change:
        if not data.currentPassword or not verify_password(data.currentPassword, user_record["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

    if verify_password(data.newPassword, user_record["password_hash"]):
        raise HTTPException(status_code=400, detail="Choose a different password")

    next_version = get_user_token_version(user_record) + 1
    updated_user = await update_fields(
        "users",
        "email",
        user_record["email"],
        {
            "password_hash": hash_password(data.newPassword),
            "must_change_password": False,
            "token_version": next_version,
            "password_changed_at": utc_now().isoformat(),
        },
        unset_fields=["temporary_password_expires_at", "password_reset_at", "password_reset_by"],
    )
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")

    user_payload = serialize_user(updated_user)
    access_token = create_access_token(user_payload["id"], user_payload["email"], next_version)
    refresh_token = create_refresh_token(user_payload["id"], next_version)
    set_auth_cookies(response, access_token, refresh_token)
    return user_payload


@api_router.get("/auth/permissions")
async def get_permissions(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Return the editing permissions for the current user.

    Response shape:
      { isAdmin, linkedPersonId, editablePersonIds, editableProjectIds }
    """
    admin = is_admin(user)
    linked = await get_linked_person(user)
    linked_id = linked["id"] if linked else None

    if admin:
        # Admin can edit everything
        people = await list_collection("people", limit=300)
        projects = await list_collection("projects", limit=200)
        return {
            "isAdmin": True,
            "linkedPersonId": linked_id,
            "editablePersonIds": [p["id"] for p in people],
            "editableProjectIds": [p["id"] for p in projects],
        }

    editable_person_ids = [linked_id] if linked_id else []
    editable_project_ids = []
    if linked_id:
        projects = await list_collection("projects", limit=200)
        editable_project_ids = [
            p["id"] for p in projects if linked_id == get_primary_project_lead_id(p)
        ]

    return {
        "isAdmin": False,
        "linkedPersonId": linked_id,
        "editablePersonIds": editable_person_ids,
        "editableProjectIds": editable_project_ids,
    }


@api_router.post("/auth/logout")
async def logout(response: Response) -> Dict[str, str]:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response) -> Dict[str, Any]:
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")

        user = await get_user_by_id(payload["sub"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user = await ensure_user_person_link(user)
        if payload.get("ver", 0) != get_user_token_version(user):
            raise HTTPException(status_code=401, detail="Session expired")

        user_payload = serialize_user(user)
        access_token = create_access_token(
            user_payload["id"],
            user_payload["email"],
            get_user_token_version(user),
        )
        set_auth_cookies(response, access_token)
        return user_payload
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc


@api_router.get("/admin/users")
async def get_admin_users(user: Dict[str, Any] = Depends(get_current_user)) -> List[Dict[str, Any]]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can view user accounts")

    accounts = await list_users(include_internal_id=True)
    people = await list_collection("people", limit=500)
    people_by_email, people_by_id = build_people_lookup_maps(people)

    summaries = [build_admin_user_summary(account, people_by_email, people_by_id) for account in accounts]
    summaries.sort(key=lambda item: ((item.get("role") != "admin"), item.get("email", "")))
    return summaries


@api_router.post("/admin/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can reset passwords")
    if user_id == user.get("id"):
        raise HTTPException(status_code=400, detail="Use the password change flow for your current account")

    account = await get_user_by_id(user_id)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")

    temporary_password = generate_temporary_password()
    reset_at = utc_now()
    expires_at = reset_at + timedelta(hours=TEMP_PASSWORD_EXPIRY_HOURS)
    next_version = get_user_token_version(account) + 1
    reset_by = user.get("email") or user.get("name") or user.get("id")

    updated_user = await update_fields(
        "users",
        "email",
        account["email"],
        {
            "password_hash": hash_password(temporary_password),
            "must_change_password": True,
            "temporary_password_expires_at": expires_at.isoformat(),
            "password_reset_at": reset_at.isoformat(),
            "password_reset_by": reset_by,
            "token_version": next_version,
        },
    )
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")

    people = await list_collection("people", limit=500)
    people_by_email, people_by_id = build_people_lookup_maps(people)

    return {
        "user": build_admin_user_summary(updated_user, people_by_email, people_by_id),
        "temporaryPassword": temporary_password,
        "expiresAt": expires_at.isoformat(),
        "expiresInHours": TEMP_PASSWORD_EXPIRY_HOURS,
    }


@api_router.post("/admin/onboard-member")
async def admin_onboard_member(
    data: AdminOnboardMemberInput,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can onboard members")

    normalized_email = normalize_email_value(data.email)
    if not normalized_email:
        raise HTTPException(status_code=422, detail="Email is required when onboarding a member")
    if normalized_email and await get_person_by_email(normalized_email):
        raise HTTPException(status_code=400, detail="Email is already used by another profile")

    slug = data.name.lower().split()[-1] if data.name.split() else "person"
    existing = await get_by_field("people", "id", slug)
    if existing:
        i = 2
        while await get_by_field("people", "id", f"{slug}{i}"):
            i += 1
        slug = f"{slug}{i}"

    person = await insert_one(
        "people",
        {
            "id": slug,
            "name": data.name.strip(),
            "role": data.role,
            "institution": data.institution,
            "title": (data.title or "").strip(),
            "email": normalized_email,
            "researchDescription": (data.researchDescription or "").strip(),
            "skills": data.skills or [],
            "links": data.links or [],
            "website": (data.website or "").strip(),
            "github": (data.github or "").strip(),
            "substack": (data.substack or "").strip(),
            "orcid": (data.orcid or "").strip(),
            "equipment": [],
        },
    )

    access = await create_or_refresh_activation_invite_for_person(
        person,
        created_by=user.get("email") or user.get("name") or user.get("id", "admin"),
        frontend_base_url=infer_frontend_base_url(request),
        email_override=normalized_email,
    )
    people = await list_collection("people", limit=500)
    people_by_email, people_by_id = build_people_lookup_maps(people)

    return {
        "person": person,
        "user": build_admin_user_summary(access["user"], people_by_email, people_by_id),
        "inviteLink": access["inviteLink"],
        "expiresAt": access["expiresAt"],
        "expiresInHours": access["expiresInHours"],
    }


@api_router.post("/admin/people/{person_id}/create-account")
async def create_account_for_person(
    person_id: str,
    data: PersonAccountCreateInput,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can create Yard access")

    person = await get_by_field("people", "id", person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    normalized_email = normalize_email_value(data.email or person.get("email"))
    if not normalized_email:
        raise HTTPException(status_code=422, detail="Email is required before Yard access can be created")

    if normalize_email_value(person.get("email")) != normalized_email:
        other_person = await get_person_by_email(normalized_email, exclude_person_id=person_id)
        if other_person:
            raise HTTPException(status_code=400, detail="Email is already used by another profile")
        updated_person = await update_fields("people", "id", person_id, {"email": normalized_email})
        if not updated_person:
            raise HTTPException(status_code=404, detail="Person not found")
        person = updated_person

    access = await create_or_refresh_activation_invite_for_person(
        person,
        created_by=user.get("email") or user.get("name") or user.get("id", "admin"),
        frontend_base_url=infer_frontend_base_url(request),
        email_override=normalized_email,
    )
    people = await list_collection("people", limit=500)
    people_by_email, people_by_id = build_people_lookup_maps(people)

    return {
        "person": person,
        "user": build_admin_user_summary(access["user"], people_by_email, people_by_id),
        "inviteLink": access["inviteLink"],
        "expiresAt": access["expiresAt"],
        "expiresInHours": access["expiresInHours"],
    }


@api_router.get("/institutions")
async def get_institutions(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    del user
    return await list_collection("institutions", limit=100)


@api_router.get("/skill-taxonomy")
async def get_skill_taxonomy(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    del user
    seed_path = get_seed_file()
    if seed_path and seed_path.is_file():
        import json as _json
        with open(seed_path) as f:
            seed = _json.load(f)
        return seed.get("skillTaxonomy", {})
    return {}


@api_router.get("/people")
async def get_people(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    del user
    return await list_collection("people", limit=200)


@api_router.get("/people/{person_id}")
async def get_person(
    person_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    del user
    item = await get_by_field("people", "id", person_id)
    if not item:
        raise HTTPException(status_code=404, detail="Person not found")
    return item


@api_router.post("/people")
async def create_person(
    data: PersonCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can create people profiles")
    normalized_email = normalize_email_value(data.email)
    if normalized_email and await get_person_by_email(normalized_email):
        raise HTTPException(status_code=400, detail="Email is already used by another profile")
    # Generate a slug-style id from the name
    slug = data.name.lower().split()[-1]  # last name
    existing = await get_by_field("people", "id", slug)
    if existing:
        # append a number to make it unique
        i = 2
        while await get_by_field("people", "id", f"{slug}{i}"):
            i += 1
        slug = f"{slug}{i}"
    doc = {
        "id": slug,
        "name": data.name,
        "role": data.role,
        "institution": data.institution,
        "title": data.title or "",
        "email": normalized_email,
        "researchDescription": data.researchDescription or "",
        "skills": data.skills or [],
        "links": data.links or [],
        "website": data.website or "",
        "github": data.github or "",
        "substack": data.substack or "",
        "orcid": data.orcid or "",
        "equipment": [],
    }
    return await insert_one("people", doc)


@api_router.put("/people/{person_id}")
async def update_person(
    person_id: str,
    data: PersonUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    person = await get_by_field("people", "id", person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    linked = await get_linked_person(user)
    if not can_edit_person(user, person, linked):
        raise HTTPException(status_code=403, detail="You can only edit your own profile")
    update_payload = data.model_dump(exclude_none=True)
    admin_only_fields = {"name", "role", "institution"}
    if any(field in update_payload for field in admin_only_fields) and not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can change name, role, or institution")
    if "name" in update_payload:
        update_payload["name"] = update_payload["name"].strip()
        if not update_payload["name"]:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
    if "email" in update_payload:
        normalized_email = normalize_email_value(update_payload["email"])
        if normalized_email:
            existing_person = await get_person_by_email(normalized_email, exclude_person_id=person_id)
            if existing_person:
                raise HTTPException(status_code=400, detail="Email is already used by another profile")
        update_payload["email"] = normalized_email
    if "links" in update_payload:
        update_payload.update(build_legacy_person_link_mirror_payload(person, update_payload.get("links")))
    update_payload.pop("publish", None)
    if not update_payload:
        return person
    update_payload["lastModified"] = utc_now().strftime("%Y-%m-%d")
    updated = await update_fields("people", "id", person_id, update_payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Person not found")
    return updated


@api_router.get("/projects")
async def get_projects(user: Dict[str, Any] = Depends(get_current_user)) -> List[Dict[str, Any]]:
    projects = await list_collection("projects", limit=200)
    linked_person = await get_linked_person(user)
    return [redact_project_feedback_for_viewer(project, user, linked_person) for project in projects]


@api_router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    item = await get_by_field("projects", "id", project_id)
    if not item:
        raise HTTPException(status_code=404, detail="Project not found")
    linked_person = await get_linked_person(user)
    return redact_project_feedback_for_viewer(item, user, linked_person)


@api_router.get("/projects/{project_id}/export.md")
async def export_project_markdown(
    project_id: str,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Response:
    item = await get_by_field("projects", "id", project_id)
    if not item:
        raise HTTPException(status_code=404, detail="Project not found")

    linked_person = await get_linked_person(user)
    redacted_project = redact_project_feedback_for_viewer(item, user, linked_person)
    people = await list_collection("people", limit=400)
    milestones = await list_collection("milestones", limit=500)
    concept_notes = await list_collection("conceptnotes", limit=200)
    markdown = render_project_export_markdown(
        request,
        redacted_project,
        user,
        linked_person,
        people,
        milestones,
        concept_notes,
    )
    exported_on = utc_now().strftime("%Y-%m-%d")
    filename = safe_project_export_filename(project_id, exported_on)
    logger.info("Project export requested user=%s project=%s", user.get("email") or user.get("id"), project_id)
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/projects")
async def create_project(
    data: ProjectCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    linked = await get_linked_person(user)
    if not can_create_project(user, linked):
        raise HTTPException(status_code=403, detail="Only admins can create projects")

    team_fields = build_project_team_fields(data.leadId, data.teamMemberIds)
    if not team_fields["leadId"]:
        raise HTTPException(status_code=422, detail="A project lead is required")

    missing_people = await ensure_people_exist(team_fields["teamMemberIds"])
    if missing_people:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown team member id(s): {', '.join(missing_people)}",
        )

    project_id = await build_unique_project_id(data.title)
    doc = {
        "id": project_id,
        "title": data.title.strip(),
        "institution": data.institution,
        "type": data.type or "individual",
        "description": data.summary.strip(),
        "abstract": "",
        "aims": "",
        "status": "",
        "slidesUrl": "",
        "svgUrls": [],
        "updates": [],
        "feedback": [],
        "currentChallenges": [],
        "resolvedChallenges": [],
        "keyPublications": [],
        "lastModified": "",
    }
    doc.update(team_fields)
    return await insert_one("projects", doc)


@api_router.put("/projects/{project_id}")
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only a project lead or admin can edit this project")
    update_payload = data.model_dump(exclude_none=True)
    update_payload = await normalize_project_team_update(project, update_payload)
    previous_visual_references: set[tuple[str, str]] = set()
    unset_fields: List[str] = []
    if "svgUrls" in update_payload:
        previous_visual_references = collect_uploaded_visual_references_from_values(
            project.get("svgUrls"),
            project.get("svgUrl"),
        )
        unset_fields.append("svgUrl")
    # Save modes: user chooses Publish (stamps lastModified, visible activity) or Save quietly (silent).
    should_publish = update_payload.pop("publish", False)
    if should_publish:
        update_payload["lastModified"] = utc_now().strftime("%Y-%m-%d")
    updated = await update_fields("projects", "id", project_id, update_payload, unset_fields=unset_fields or None)
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    await delete_orphaned_uploaded_visuals(previous_visual_references)
    return updated


@api_router.post("/uploads/visual")
async def upload_visual_file(
    request: Request,
    projectId: str = Form(...),
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, str]:
    await require_project_editor(user, projectId)

    filename = file.filename or "visual"
    extension = get_visual_extension(filename)
    content_type = (file.content_type or "").lower()
    allowed_extensions = {".svg", ".png", ".jpg", ".jpeg"}
    allowed_content_types = {
        "image/svg+xml",
        "text/xml",
        "application/xml",
        "image/png",
        "image/jpeg",
        "image/jpg",
    }
    if extension not in allowed_extensions and content_type not in allowed_content_types:
        raise HTTPException(status_code=400, detail="Only SVG, PNG, and JPG files are supported")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded visual file is empty")
    if len(raw_bytes) > MAX_VISUAL_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Visual file is too large")

    if extension == ".svg":
        try:
            raw_text = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail="SVG file must be UTF-8 text") from exc

        try:
            file_bytes = sanitize_svg_markup(raw_text).encode("utf-8")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        file_bytes = raw_bytes

    UPLOADS_VISUAL_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = sanitize_upload_basename(filename)
    stored_name = f"{projectId}--{utc_now().strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}-{safe_name}{extension or '.bin'}"
    target = UPLOADS_VISUAL_DIR / stored_name
    target.write_bytes(file_bytes)

    public_path = f"/api/uploads/visual/{stored_name}"
    absolute_url = f"{str(request.base_url).rstrip('/')}{public_path}"
    return {
        "url": absolute_url,
        "path": public_path,
        "filename": stored_name,
    }


@api_router.get("/uploads/visual/{filename}")
async def serve_uploaded_visual(
    filename: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> FileResponse:
    del user
    safe_name = Path(filename).name
    target = (UPLOADS_VISUAL_DIR / safe_name).resolve()
    if not target.is_file() or UPLOADS_VISUAL_DIR.resolve() not in target.parents:
        raise HTTPException(status_code=404, detail="Visual file not found")

    media_type = detect_visual_media_type(safe_name)
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
    }
    if get_visual_extension(safe_name) == ".svg":
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox"

    return FileResponse(
        str(target),
        media_type=media_type,
        headers=headers,
    )


@api_router.delete("/uploads/visual/{filename}")
async def delete_uploaded_visual(
    filename: str,
    projectId: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    await require_project_editor(user, projectId)
    safe_name = Path(filename).name
    if "--" in safe_name and safe_name.split("--", 1)[0] != projectId:
        raise HTTPException(status_code=403, detail="This upload belongs to a different project")
    target = (UPLOADS_VISUAL_DIR / safe_name).resolve()
    uploads_root = UPLOADS_VISUAL_DIR.resolve()
    if uploads_root not in target.parents or get_visual_extension(safe_name) not in {".svg", ".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=404, detail="Visual file not found")

    referenced_visuals = collect_referenced_uploaded_visual_references(await list_collection("projects", limit=1000))
    if ("visual", safe_name) in referenced_visuals:
        return {"deleted": False, "reason": "still-referenced"}

    if target.is_file():
        try:
            target.unlink()
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Failed to delete visual file") from exc

    return {"deleted": True}


@api_router.get("/uploads/svg/{filename}")
async def serve_uploaded_svg(
    filename: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> FileResponse:
    del user
    safe_name = Path(filename).name
    target = (UPLOADS_SVG_DIR / safe_name).resolve()
    if not target.is_file() or UPLOADS_SVG_DIR.resolve() not in target.parents:
        raise HTTPException(status_code=404, detail="SVG file not found")

    return FileResponse(
        str(target),
        media_type="image/svg+xml",
        headers={
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@api_router.delete("/uploads/svg/{filename}")
async def delete_uploaded_svg(
    filename: str,
    projectId: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    await require_project_editor(user, projectId)
    safe_name = Path(filename).name
    if "--" in safe_name and safe_name.split("--", 1)[0] != projectId:
        raise HTTPException(status_code=403, detail="This upload belongs to a different project")
    target = (UPLOADS_SVG_DIR / safe_name).resolve()
    uploads_root = UPLOADS_SVG_DIR.resolve()
    if uploads_root not in target.parents or get_visual_extension(safe_name) != ".svg":
        raise HTTPException(status_code=404, detail="SVG file not found")

    referenced_visuals = collect_referenced_uploaded_visual_references(await list_collection("projects", limit=1000))
    if ("svg", safe_name) in referenced_visuals:
        return {"deleted": False, "reason": "still-referenced"}

    if target.is_file():
        try:
            target.unlink()
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Failed to delete SVG file") from exc

    return {"deleted": True}


@api_router.post("/projects/{project_id}/updates")
async def add_project_update(
    project_id: str,
    data: ProjectUpdateCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only the project lead or admin can add updates")
    publish_now = bool(data.publish)
    entry_date = data.date or utc_now().strftime("%Y-%m-%d")
    update_doc = {
        "title": data.title,
        "content": data.content,
        "author": linked.get("name") if linked else (user.get("name") or user.get("email")),
        "date": entry_date,
        "published": publish_now,
    }
    if publish_now:
        update_doc["lastModified"] = entry_date
    if data.slidesUrl:
        update_doc["slidesUrl"] = data.slidesUrl
    if data.svgUrls:
        update_doc["svgUrls"] = data.svgUrls
    updated_project = await append_to_list_field("projects", "id", project_id, "updates", update_doc, prepend=True)
    return update_doc


@api_router.post("/projects/{project_id}/feedback")
async def add_project_feedback(
    project_id: str,
    data: FeedbackCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_add_project_feedback(user, project, linked):
        raise HTTPException(status_code=403, detail="Only users with review access who are not the project lead can add feedback")
    entry_date = data.date or utc_now().strftime("%Y-%m-%d")
    feedback_doc = {
        "id": create_feedback_id(),
        "title": (data.title or "").strip(),
        "content": data.content,
        "author": linked.get("name") if linked else (user.get("name") or user.get("email")),
        "date": entry_date,
        "audience": normalize_feedback_base_audience(data.audience),
        "includeReviewers": normalize_feedback_include_reviewers(data.audience, data.includeReviewers),
        "published": False,
        "lastModified": entry_date,
    }
    if linked and linked.get("id"):
        feedback_doc["authorId"] = linked["id"]
    updated_project = await append_to_list_field("projects", "id", project_id, "feedback", feedback_doc, prepend=True)
    return feedback_doc


@api_router.post("/projects/{project_id}/challenges")
async def add_project_challenge(
    project_id: str,
    data: ChallengeCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only the project lead or admin can add challenges")
    publish_now = bool(data.publish)
    challenge_doc = {
        "id": create_challenge_id(),
        "description": data.description,
        "severity": data.severity,
        "raisedBy": linked.get("name") if linked else (user.get("name") or user.get("id")),
        "date": data.date or utc_now().strftime("%Y-%m-%d"),
        "published": publish_now,
    }
    if linked and linked.get("id"):
        challenge_doc["raisedById"] = linked["id"]
    if publish_now:
        challenge_doc["lastModified"] = challenge_doc["date"]
    updated_project = await append_to_list_field("projects", "id", project_id, "currentChallenges", challenge_doc)
    return challenge_doc


class EntryEdit(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    slidesUrl: Optional[str] = None
    svgUrls: Optional[List[str]] = None
    publish: Optional[bool] = None  # True = Publish (stamp lastModified), False/None = Save quietly
    audience: Optional[str] = None
    includeReviewers: Optional[bool] = None

    @field_validator("slidesUrl")
    @classmethod
    def normalize_slides_url(cls, v: Optional[str]) -> Optional[str]:
        return normalize_embed_input(v)

    @field_validator("svgUrls")
    @classmethod
    def normalize_svg_urls(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return normalize_visual_list(v)

    @field_validator("audience")
    @classmethod
    def check_audience(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v not in VALID_FEEDBACK_AUDIENCES:
            raise ValueError(f"audience must be one of {VALID_FEEDBACK_AUDIENCES}, got {v}")
        return v

    @field_validator("includeReviewers")
    @classmethod
    def check_include_reviewers(cls, v: Optional[bool]) -> Optional[bool]:
        if v is None:
            return None
        return bool(v)


@api_router.put("/projects/{project_id}/updates/{entry_index}")
async def edit_project_update(
    project_id: str,
    entry_index: int,
    data: EntryEdit,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only a project lead or admin can edit")
    updates = project.get("updates") or []
    if entry_index < 0 or entry_index >= len(updates):
        raise HTTPException(status_code=404, detail="Update entry not found")
    previous_visual_references: set[tuple[str, str]] = set()
    if data.svgUrls is not None:
        previous_visual_references = collect_uploaded_visual_references_from_values(
            updates[entry_index].get("svgUrls"),
            updates[entry_index].get("svgUrl"),
        )
    if data.title is not None:
        updates[entry_index]["title"] = data.title
    if data.content is not None:
        updates[entry_index]["content"] = data.content
    if data.slidesUrl is not None:
        if data.slidesUrl:
            updates[entry_index]["slidesUrl"] = data.slidesUrl
        else:
            updates[entry_index].pop("slidesUrl", None)
    if data.svgUrls is not None:
        updates[entry_index]["svgUrls"] = data.svgUrls
        updates[entry_index].pop("svgUrl", None)
    if data.publish:
        updates[entry_index]["published"] = True
        updates[entry_index]["lastModified"] = utc_now().strftime("%Y-%m-%d")
    updated = await update_fields("projects", "id", project_id, {"updates": updates})
    await delete_orphaned_uploaded_visuals(previous_visual_references)
    return updated


@api_router.put("/projects/{project_id}/feedback/{feedback_id}")
async def edit_project_feedback(
    project_id: str,
    feedback_id: str,
    data: EntryEdit,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    feedback_id = (feedback_id or "").strip()
    feedback = project.get("feedback") or []
    entry_index = next(
        (
            index
            for index, entry in enumerate(feedback)
            if isinstance(entry, dict) and (entry.get("id") or "").strip() == feedback_id
        ),
        -1,
    )
    if entry_index < 0:
        raise HTTPException(status_code=404, detail="Feedback entry not found")
    if not can_edit_feedback_entry(user, project, linked, feedback[entry_index]):
        raise HTTPException(status_code=403, detail="Only the feedback author or an admin can edit")
    next_content = data.content if data.content is not None else feedback[entry_index].get("content", "")
    if not (next_content or "").strip():
        raise HTTPException(status_code=422, detail="Feedback content cannot be empty")
    if data.title is not None:
        feedback[entry_index]["title"] = data.title.strip()
    if data.content is not None:
        feedback[entry_index]["content"] = data.content
    if data.audience is not None:
        feedback[entry_index]["audience"] = normalize_feedback_base_audience(data.audience)
    if data.audience is not None or data.includeReviewers is not None:
        feedback[entry_index]["includeReviewers"] = normalize_feedback_include_reviewers(
            data.audience if data.audience is not None else feedback[entry_index].get("audience"),
            data.includeReviewers,
        )
    feedback[entry_index]["published"] = False
    feedback[entry_index]["lastModified"] = utc_now().strftime("%Y-%m-%d")
    updated = await update_fields("projects", "id", project_id, {"feedback": feedback})
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return redact_project_feedback_for_viewer(updated, user, linked)


@api_router.put("/projects/{project_id}/challenges/{challenge_id}")
async def edit_project_challenge(
    project_id: str,
    challenge_id: str,
    data: ChallengeEdit,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only a project lead or admin can edit")

    challenge_id = (challenge_id or "").strip()
    challenges = project.get("currentChallenges") or []
    entry_index = next(
        (
            index
            for index, entry in enumerate(challenges)
            if isinstance(entry, dict) and (entry.get("id") or "").strip() == challenge_id
        ),
        -1,
    )
    if entry_index < 0:
        raise HTTPException(status_code=404, detail="Challenge not found")

    if data.description is not None:
        challenges[entry_index]["description"] = data.description
    if data.severity is not None:
        challenges[entry_index]["severity"] = data.severity
    if data.publish:
        challenges[entry_index]["published"] = True
        challenges[entry_index]["lastModified"] = utc_now().strftime("%Y-%m-%d")

    updated = await update_fields("projects", "id", project_id, {"currentChallenges": challenges})
    return updated


@api_router.post("/projects/{project_id}/challenges/{challenge_id}/resolve")
async def resolve_project_challenge(
    project_id: str,
    challenge_id: str,
    data: ChallengeResolve,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only a project lead or admin can edit")

    challenge_id = (challenge_id or "").strip()
    challenges = list(project.get("currentChallenges") or [])
    entry_index = next(
        (
            index
            for index, entry in enumerate(challenges)
            if isinstance(entry, dict) and (entry.get("id") or "").strip() == challenge_id
        ),
        -1,
    )
    if entry_index < 0:
        raise HTTPException(status_code=404, detail="Challenge not found")

    resolved_entry = {**challenges.pop(entry_index)}
    resolved_entry["resolvedDate"] = data.resolvedDate or utc_now().strftime("%Y-%m-%d")
    resolved_entry["resolvedBy"] = linked.get("name") if linked else (user.get("name") or user.get("email"))
    if linked and linked.get("id"):
        resolved_entry["resolvedById"] = linked["id"]
    resolved_entry["published"] = resolved_entry.get("published", True)
    if data.resolutionNote:
        resolved_entry["resolutionNote"] = data.resolutionNote
    resolved_entry["lastModified"] = resolved_entry["resolvedDate"]

    resolved_challenges = [resolved_entry, *(project.get("resolvedChallenges") or [])]
    update_payload = {
        "currentChallenges": challenges,
        "resolvedChallenges": resolved_challenges,
    }
    if is_entry_surfaced(resolved_entry):
        update_payload["lastModified"] = resolved_entry["resolvedDate"]
    updated = await update_fields(
        "projects",
        "id",
        project_id,
        update_payload,
    )
    return updated


@api_router.get("/publications")
async def get_publications(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    del user
    return await list_collection("publications", limit=200)


@api_router.get("/events")
async def get_events(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    del user
    return await list_collection("events", limit=100)


@api_router.get("/milestones")
async def get_milestones(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    del user
    items = await list_collection("milestones", limit=500)
    for milestone in items:
        milestone["computedStatus"] = compute_milestone_status(milestone)
    return items


@api_router.post("/milestones")
async def create_milestone(
    data: MilestoneCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await get_by_field("projects", "id", data.project)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only the project lead or admin can manage milestones")
    doc = data.model_dump()
    doc["id"] = f"m{uuid4().hex}"
    doc["status"] = "on-track"
    doc["createdBy"] = user["id"]
    await insert_one("milestones", doc)
    doc["computedStatus"] = compute_milestone_status(doc)
    return doc


@api_router.put("/milestones/{milestone_id}")
async def update_milestone(
    milestone_id: str,
    data: MilestoneUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    milestone = await get_by_field("milestones", "id", milestone_id)
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    project = await get_by_field("projects", "id", milestone.get("project"))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only the project lead or admin can manage milestones")
    update_payload = data.model_dump(exclude_none=True)
    should_publish = update_payload.pop("publish", False)
    if not update_payload:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    if "project" in update_payload and update_payload["project"] != milestone.get("project"):
        target_project = await get_by_field("projects", "id", update_payload["project"])
        if not target_project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not can_edit_project(user, target_project, linked):
            raise HTTPException(status_code=403, detail="Only the project lead or admin can move milestones into that project")
    if should_publish:
        update_payload["lastModified"] = utc_now().strftime("%Y-%m-%d")

    updated = await update_fields("milestones", "id", milestone_id, update_payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Milestone not found")

    updated["computedStatus"] = compute_milestone_status(updated)
    return updated


@api_router.post("/milestones/{milestone_id}/complete")
async def complete_milestone(
    milestone_id: str,
    data: MilestoneCompleteInput,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    milestone = await get_by_field("milestones", "id", milestone_id)
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    project = await get_by_field("projects", "id", milestone.get("project"))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only the project lead or admin can manage milestones")

    completed_date = data.completedDate or utc_now().strftime("%Y-%m-%d")
    updated = await update_fields(
        "milestones",
        "id",
        milestone_id,
        {
            "status": "completed",
            "completedDate": completed_date,
        },
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Milestone not found")

    updated["computedStatus"] = compute_milestone_status(updated)
    return updated


@api_router.post("/milestones/{milestone_id}/reopen")
async def reopen_milestone(
    milestone_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    milestone = await get_by_field("milestones", "id", milestone_id)
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    project = await get_by_field("projects", "id", milestone.get("project"))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    linked = await get_linked_person(user)
    if not can_edit_project(user, project, linked):
        raise HTTPException(status_code=403, detail="Only the project lead or admin can manage milestones")

    updated = await update_fields(
        "milestones",
        "id",
        milestone_id,
        {
            "status": "on-track",
        },
        unset_fields=["completedDate"],
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Milestone not found")

    updated["computedStatus"] = compute_milestone_status(updated)
    return updated


@api_router.get("/conceptnotes")
async def get_concept_notes(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    linked = await get_linked_person(user)
    concept_notes = await list_collection("conceptnotes", limit=200)
    return [serialize_concept_note_for_user(note, user, linked) for note in concept_notes]


@api_router.post("/conceptnotes")
async def create_concept_note(
    data: ConceptNoteCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    linked = await get_linked_person(user)
    if not can_create_concept_note(linked):
        raise HTTPException(status_code=403, detail="Only signed-in programme members with a profile can create concept notes")

    doc = data.model_dump()
    if linked["id"] not in doc.get("contributors", []):
        raise HTTPException(status_code=422, detail="Concept note contributors must include the signed-in user")
    for contributor_id in doc.get("contributors", []):
        person = await get_by_field("people", "id", contributor_id)
        if not person:
            raise HTTPException(status_code=404, detail=f"Contributor not found: {contributor_id}")

    missing_projects = await ensure_projects_exist(doc.get("relatedProjects", []))
    if missing_projects:
        raise HTTPException(status_code=404, detail=f"Project not found: {missing_projects[0]}")

    created_at = utc_now().strftime("%Y-%m-%d")
    doc["id"] = f"cn{uuid4().hex}"
    doc["createdBy"] = linked["id"]
    doc["createdAt"] = created_at
    doc["updatedAt"] = created_at
    doc["activeUntil"] = compute_concept_note_active_until(created_at)
    doc["progressSignals"] = []
    doc["relatedConceptNoteIds"] = []
    await insert_one("conceptnotes", doc)
    return serialize_concept_note_for_user(doc, user, linked)


@api_router.put("/conceptnotes/{note_id}")
async def update_concept_note(
    note_id: str,
    data: ConceptNoteUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    existing = await get_by_field("conceptnotes", "id", note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Concept note not found")

    linked = await get_linked_person(user)
    update_payload = data.model_dump(exclude_none=True)
    if not update_payload:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    admin_only_fields = {"activeUntil", "progressSignals", "relatedConceptNoteIds", "relatedProjects"}
    if any(field_name in update_payload for field_name in admin_only_fields) and not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can update concept note stewardship")

    ordinary_content_fields = {
        "title",
        "rationale",
        "relevance",
        "preliminaryInsights",
        "nextSteps",
    }
    if any(field_name in update_payload for field_name in ordinary_content_fields) and not can_edit_concept_note_content(user, linked, existing):
        raise HTTPException(status_code=403, detail="Only concept note contributors or admins can edit concept note content")

    if "contributors" in update_payload and not can_manage_concept_note_contributors(user, linked, existing):
        raise HTTPException(status_code=403, detail="Only the concept note creator or admin can update contributors")

    if "contributors" in update_payload:
        for contributor_id in update_payload["contributors"]:
            person = await get_by_field("people", "id", contributor_id)
            if not person:
                raise HTTPException(status_code=404, detail=f"Contributor not found: {contributor_id}")
        if not is_admin(user) and linked and linked["id"] not in update_payload["contributors"]:
            raise HTTPException(status_code=422, detail="Concept note contributors must include the signed-in user")

    if "relatedProjects" in update_payload:
        missing_projects = await ensure_projects_exist(update_payload["relatedProjects"])
        if missing_projects:
            raise HTTPException(status_code=404, detail=f"Project not found: {missing_projects[0]}")

    if "progressSignals" in update_payload:
        for signal in update_payload["progressSignals"]:
            project_id = signal.get("projectId")
            if project_id:
                project = await get_by_field("projects", "id", project_id)
                if not project:
                    raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
        update_payload["progressSignals"] = normalize_concept_note_progress_signals(
            update_payload["progressSignals"],
            actor_id=get_concept_note_actor_id(user),
            default_date=utc_now().strftime("%Y-%m-%d"),
        )

    if "relatedConceptNoteIds" in update_payload:
        for related_note_id in update_payload["relatedConceptNoteIds"]:
            if related_note_id == note_id:
                raise HTTPException(status_code=422, detail="A concept note cannot be related to itself")
            related_note = await get_by_field("conceptnotes", "id", related_note_id)
            if not related_note:
                raise HTTPException(status_code=404, detail=f"Related concept note not found: {related_note_id}")

    if any(field_name in update_payload for field_name in {
        "title",
        "contributors",
        "rationale",
        "relevance",
        "preliminaryInsights",
        "nextSteps",
        "relatedProjects",
        "progressSignals",
        "relatedConceptNoteIds",
    }):
        update_payload["updatedAt"] = utc_now().strftime("%Y-%m-%d")

    updated = await update_fields("conceptnotes", "id", note_id, update_payload)
    return serialize_concept_note_for_user(updated, user, linked)


@api_router.post("/conceptnotes/{note_id}/extend-active")
async def extend_concept_note_active_window(
    note_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can extend concept note visibility")

    existing = await get_by_field("conceptnotes", "id", note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Concept note not found")

    today = utc_now().strftime("%Y-%m-%d")
    previous_active_until = existing.get("activeUntil") or compute_concept_note_active_until(existing.get("createdAt") or today)
    extension_base = previous_active_until if _parse_day(previous_active_until) >= _parse_day(today) else today
    next_active_until = compute_concept_note_active_until(extension_base, days=CONCEPT_NOTE_ACTIVE_EXTENSION_DAYS)
    extension_record = {
        "previousActiveUntil": previous_active_until,
        "extendedAt": today,
        "extendedBy": get_concept_note_actor_id(user),
    }

    updated = await update_fields(
        "conceptnotes",
        "id",
        note_id,
        {
            "activeUntil": next_active_until,
            "lastActiveExtension": extension_record,
        },
    )
    linked = await get_linked_person(user)
    return serialize_concept_note_for_user(updated, user, linked)


@api_router.post("/conceptnotes/{note_id}/undo-active-extension")
async def undo_concept_note_active_extension(
    note_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only admins can undo concept note visibility changes")

    existing = await get_by_field("conceptnotes", "id", note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Concept note not found")

    previous = (existing.get("lastActiveExtension") or {}).get("previousActiveUntil")
    if not previous:
        raise HTTPException(status_code=400, detail="No active extension is available to undo")

    updated = await update_fields(
        "conceptnotes",
        "id",
        note_id,
        {"activeUntil": previous},
        unset_fields=["lastActiveExtension"],
    )
    linked = await get_linked_person(user)
    return serialize_concept_note_for_user(updated, user, linked)


@api_router.get("/dashboard/stats")
async def get_dashboard_stats(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, int]:
    del user
    people_count = await count_collection("people")
    projects_count = await count_collection("projects")
    publications_count = await count_collection("publications")
    events = await list_collection("events", limit=100)
    upcoming_events = sum(1 for event in events if is_event_upcoming(event))
    milestones = await list_collection("milestones", limit=500)
    projects = await list_collection("projects", limit=200)
    challenges = []
    for project in projects:
        challenges.extend(
            challenge
            for challenge in (project.get("currentChallenges") or [])
            if is_entry_surfaced(challenge)
        )
    milestones_due = sum(
        1 for milestone in milestones if compute_milestone_status(milestone) in ("approaching", "overdue")
    )
    concept_notes = await list_collection("conceptnotes", limit=200)
    active_concept_notes = sum(1 for note in concept_notes if is_concept_note_active(note))

    return {
        "members": people_count,
        "projects": projects_count,
        "publications": publications_count,
        "upcomingEvents": upcoming_events,
        "openChallenges": len(challenges),
        "milestonesDue": milestones_due,
        "conceptNotes": active_concept_notes,
    }


@api_router.get("/dashboard/activity")
async def get_dashboard_activity(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """Return the full activity feed — updates, challenges, completed milestones,
    publications, events, and concept note creation events — sorted newest-first.
    No cap: the frontend handles pagination / scroll."""
    del user
    projects = await list_collection("projects", limit=200)
    concept_notes = await list_collection("conceptnotes", limit=200)
    milestones = await list_collection("milestones", limit=500)
    publications = await list_collection("publications", limit=200)
    events = await list_collection("events", limit=100)
    people = await list_collection("people", limit=400)
    people_by_id = {person["id"]: person.get("name", person["id"]) for person in people}
    projects_by_id = {project["id"]: project for project in projects}
    activities: List[Dict[str, Any]] = []
    current_time = datetime.now(timezone.utc)

    for project in projects:
        for update in project.get("updates") or []:
            if not is_entry_surfaced(update):
                continue
            item = {
                "type": "update",
                "project": project["title"],
                "context": project["title"],
                "projectId": project["id"],
                "title": update.get("title", ""),
                "date": update.get("lastModified") or update.get("date", ""),
                "author": update.get("author", ""),
            }
            if is_feed_item_visible_by_date(item["date"], current_time):
                activities.append(item)
        for challenge in project.get("currentChallenges") or []:
            if not is_entry_surfaced(challenge):
                continue
            item = {
                "type": "challenge",
                "project": project["title"],
                "context": project["title"],
                "projectId": project["id"],
                "title": challenge.get("description", "")[:90],
                "date": challenge.get("lastModified") or challenge.get("date", ""),
                "author": challenge.get("raisedBy", ""),
                "severity": challenge.get("severity", ""),
            }
            if is_feed_item_visible_by_date(item["date"], current_time):
                activities.append(item)
        for challenge in project.get("resolvedChallenges") or []:
            if not is_entry_surfaced(challenge):
                continue
            item = {
                "type": "challenge-resolved",
                "project": project["title"],
                "context": project["title"],
                "projectId": project["id"],
                "title": challenge.get("description", "")[:90],
                "date": challenge.get("resolvedDate") or challenge.get("lastModified") or challenge.get("date", ""),
                "author": challenge.get("resolvedBy", ""),
                "severity": challenge.get("severity", ""),
            }
            if is_feed_item_visible_by_date(item["date"], current_time):
                activities.append(item)

    for milestone in milestones:
        if compute_milestone_status(milestone) != "completed":
            continue
        project_id = milestone.get("project") or milestone.get("projectId") or ""
        project = projects_by_id.get(project_id)
        item = {
            "type": "milestone",
            "project": project.get("title", "") if project else "",
            "context": project.get("title", "") if project else "",
            "projectId": project_id,
            "title": milestone.get("title", ""),
            "date": milestone.get("completedDate") or milestone.get("dueDate", ""),
            "author": "",
        }
        if is_feed_item_visible_by_date(item["date"], current_time):
            activities.append(item)

    for publication in publications:
        project_ids = publication.get("projectIds") or ([publication.get("projectId")] if publication.get("projectId") else [])
        primary_project_id = next((project_id for project_id in project_ids if project_id), "")
        primary_project = projects_by_id.get(primary_project_id)
        item = {
            "type": "publication",
            "project": primary_project.get("title", "") if primary_project else "",
            "context": publication.get("venue", ""),
            "projectId": primary_project_id,
            "title": publication.get("title", ""),
            "date": publication.get("date", ""),
            "author": publication.get("authors", ""),
        }
        if is_feed_item_visible_by_date(item["date"], current_time):
            activities.append(item)

    for event in events:
        item = {
            "type": "event",
            "project": "",
            "context": event.get("location", ""),
            "projectId": "",
            "eventId": event.get("id", ""),
            "title": event.get("name", ""),
            "date": event.get("date", ""),
            "author": "",
        }
        if is_feed_item_visible_by_date(item["date"], current_time):
            activities.append(item)

    for note in concept_notes:
        item = {
            "type": "concept-note",
            "project": "",
            "context": "",
            "projectId": "",
            "noteId": note.get("id", ""),
            "title": note.get("title", ""),
            "date": note.get("createdAt", ""),
            "author": build_concept_note_activity_author(note, people_by_id),
        }
        if is_feed_item_visible_by_date(item["date"], current_time):
            activities.append(item)

    activities.sort(key=lambda item: item.get("date", ""), reverse=True)
    return activities

async def seed_database() -> None:
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@yard.local").lower()
    admin_password = get_admin_password()
    existing_admin = await get_user_by_email(admin_email)

    if not existing_admin:
        created_at = utc_now().isoformat()
        await insert_one(
            "users",
            {
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "name": "Admin",
                "role": "admin",
                "created_at": created_at,
                "password_changed_at": created_at,
                "token_version": 0,
                "must_change_password": False,
            },
        )
        logger.info("Admin user created: %s", admin_email)
    elif not verify_password(admin_password, existing_admin["password_hash"]):
        await update_fields(
            "users",
            "email",
            admin_email,
            {
                "password_hash": hash_password(admin_password),
                "password_changed_at": utc_now().isoformat(),
                "must_change_password": False,
                "token_version": get_user_token_version(existing_admin) + 1,
            },
            unset_fields=["temporary_password_expires_at", "password_reset_at", "password_reset_by"],
        )
        logger.info("Admin password updated")

    seed_file = get_seed_file()
    if seed_file is None:
        logger.info("No seed file configured; skipping data seed")
        await ensure_indexes()
        await backfill_project_feedback_identity_fields()
        await backfill_project_challenge_identity_fields()
        return

    if not seed_file.exists():
        logger.warning("Configured seed file %s not found, skipping data seed", seed_file)
        await ensure_indexes()
        await backfill_project_feedback_identity_fields()
        await backfill_project_challenge_identity_fields()
        return

    with open(seed_file, "r", encoding="utf-8") as handle:
        seed = json.load(handle)

    collections = {
        "institutions": seed.get("institutions", []),
        "people": seed.get("people", []),
        "projects": seed.get("projects", []),
        "publications": seed.get("publications", []),
        "events": seed.get("events", []),
        "milestones": seed.get("milestones", []),
        "conceptnotes": seed.get("conceptNotes", []),
    }

    for collection, items in collections.items():
        if items and await count_collection(collection) == 0:
            await insert_many(collection, items)
            logger.info("Seeded %s %s", len(items), collection)

    await ensure_indexes()
    logger.info("Database seeding complete")

    # ── One-time migrations ──
    await run_migrations(seed)
    await backfill_project_feedback_identity_fields()
    await backfill_project_challenge_identity_fields()


async def run_migrations(seed: dict) -> None:
    """Apply incremental data patches to existing records."""
    for proj in seed.get("projects", []):
        existing = await get_by_field("projects", "id", proj["id"])
        if not existing:
            continue
        patches = {}
        # Backfill new fields for legacy records without treating seed data as authoritative.
        if proj.get("slidesUrl") and "slidesUrl" not in existing:
            patches["slidesUrl"] = proj["slidesUrl"]
        if proj.get("updates") and "updates" not in existing:
            patches["updates"] = proj["updates"]
        if proj.get("feedback") and "feedback" not in existing:
            patches["feedback"] = proj["feedback"]
        team_fields = build_project_team_fields(
            existing.get("leadId") or proj.get("leadId") or proj.get("lead"),
            existing.get("teamMemberIds") or proj.get("teamMemberIds") or existing.get("leads") or proj.get("leads"),
        )
        for field_name, field_value in team_fields.items():
            if existing.get(field_name) != field_value:
                patches[field_name] = field_value
        if patches:
            await update_fields("projects", "id", proj["id"], patches)
            logger.info("Migration: patched project %s with %s", proj["id"], list(patches.keys()))

    # Backfill equipment for legacy records that predate the field.
    for person in seed.get("people", []):
        if not person.get("equipment"):
            continue
        existing = await get_by_field("people", "id", person["id"])
        if not existing:
            continue
        if "equipment" not in existing:
            await update_fields("people", "id", person["id"], {"equipment": person["equipment"]})
            logger.info("Migration: synced equipment for %s", person["id"])

    # Migration 4: Normalize concept notes onto the active/progressed model.
    for existing_note in await list_collection("conceptnotes", limit=500):
        patches: Dict[str, Any] = {}
        unset_fields: List[str] = []

        if existing_note.get("contributors") is not None:
            contributors = _normalize_string_list(existing_note.get("contributors") or [], "contributors")
        else:
            legacy_author = (existing_note.get("author") or "").strip()
            contributors = [legacy_author] if legacy_author else []

        if contributors and existing_note.get("contributors") != contributors:
            patches["contributors"] = contributors

        created_at = existing_note.get("createdAt") or existing_note.get("date") or utc_now().strftime("%Y-%m-%d")
        if existing_note.get("createdAt") != created_at:
            patches["createdAt"] = created_at

        updated_at = existing_note.get("updatedAt") or existing_note.get("lastModified") or created_at
        if existing_note.get("updatedAt") != updated_at:
            patches["updatedAt"] = updated_at

        created_by = existing_note.get("createdBy") or (contributors[0] if contributors else "migration")
        if existing_note.get("createdBy") != created_by:
            patches["createdBy"] = created_by

        active_until = existing_note.get("activeUntil") or compute_concept_note_active_until(created_at)
        if existing_note.get("activeUntil") != active_until:
            patches["activeUntil"] = active_until

        progress_signals = existing_note.get("progressSignals") or []
        if not progress_signals and existing_note.get("activeProjectId"):
            progress_signals = normalize_concept_note_progress_signals(
                [{
                    "kind": "linked-project",
                    "projectId": existing_note["activeProjectId"],
                }],
                actor_id="migration",
                default_date=updated_at,
            )
        elif progress_signals:
            progress_signals = normalize_concept_note_progress_signals(
                progress_signals,
                actor_id="migration",
                default_date=updated_at,
            )
        if existing_note.get("progressSignals") != progress_signals:
            patches["progressSignals"] = progress_signals

        related_note_ids = _normalize_string_list(existing_note.get("relatedConceptNoteIds") or [], "relatedConceptNoteIds")
        if existing_note.get("relatedConceptNoteIds") != related_note_ids:
            patches["relatedConceptNoteIds"] = related_note_ids

        for field_name in ("author", "date", "lastModified", "status", "reviewPath", "activeProjectId", "comments", "description", "proposedBy", "tags"):
            if field_name in existing_note:
                unset_fields.append(field_name)

        if patches or unset_fields:
            await update_fields("conceptnotes", "id", existing_note["id"], patches, unset_fields=unset_fields or None)
            logger.info("Migration: normalized concept note %s", existing_note["id"])


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    await seed_database()
    try:
        yield
    finally:
        if client:
            client.close()


app = FastAPI(title="Yard API", lifespan=app_lifespan)
app.include_router(api_router)

cors_kwargs: Dict[str, Any] = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
    "allow_origins": ALLOWED_ORIGINS,
}

app.add_middleware(CORSMiddleware, **cors_kwargs)


FRONTEND_BUILD = ROOT_DIR.parent / "frontend_build"
if not FRONTEND_BUILD.is_dir():
    FRONTEND_BUILD = ROOT_DIR.parent / "frontend" / "build"

FRONTEND_INDEX = FRONTEND_BUILD / "index.html"
FRONTEND_STATIC = FRONTEND_BUILD / "static"
PRIMARY_FRONTEND_ORIGIN = next(iter(get_explicit_frontend_origins()), None)

if FRONTEND_STATIC.is_dir():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_STATIC)), name="static")


def frontend_redirect_target(path: str = "/login") -> str:
    if PRIMARY_FRONTEND_ORIGIN:
        return f"{PRIMARY_FRONTEND_ORIGIN.rstrip('/')}{path}"
    return path


def frontend_index_response() -> Response:
    response = FileResponse(str(FRONTEND_INDEX))
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def resolve_frontend_asset(full_path: str) -> Optional[Path]:
    if not FRONTEND_BUILD.is_dir():
        return None

    candidate = (FRONTEND_BUILD / full_path).resolve()
    build_root = FRONTEND_BUILD.resolve()
    if candidate != build_root and build_root not in candidate.parents:
        return None
    if candidate.is_file():
        return candidate
    return None


@app.get("/", include_in_schema=False)
async def root() -> Response:
    if FRONTEND_INDEX.is_file():
        return frontend_index_response()
    return RedirectResponse(url=frontend_redirect_target("/login"), status_code=307)


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str) -> Response:
    if full_path.startswith("api"):
        raise HTTPException(status_code=404, detail="Not found")

    if FRONTEND_INDEX.is_file():
        asset = resolve_frontend_asset(full_path)
        if asset:
            return FileResponse(str(asset))
        return frontend_index_response()

    return RedirectResponse(url=frontend_redirect_target(f"/{full_path}"), status_code=307)
