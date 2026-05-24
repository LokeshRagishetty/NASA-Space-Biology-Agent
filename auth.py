import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import json

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from firebase_admin.exceptions import FirebaseError
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is required. Add it to your .env file.")

ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def _firebase_certificate_from_env() -> credentials.Certificate:
    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE") or os.getenv(
        "GOOGLE_APPLICATION_CREDENTIALS"
    )
    if service_account_path:
        return credentials.Certificate(service_account_path)

    service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if service_account_json:
        return credentials.Certificate(json.loads(service_account_json))

    project_id = os.getenv("FIREBASE_PROJECT_ID")
    private_key = os.getenv("FIREBASE_PRIVATE_KEY")
    client_email = os.getenv("FIREBASE_CLIENT_EMAIL")

    if not all([project_id, private_key, client_email]):
        raise RuntimeError(
            "Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, "
            "FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL."
        )

    return credentials.Certificate(
        {
            "type": "service_account",
            "project_id": project_id,
            "private_key": private_key.replace("\\n", "\n"),
            "client_email": client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": (
                "https://www.googleapis.com/robot/v1/metadata/x509/"
                f"{client_email.replace('@', '%40')}"
            ),
        }
    )


def get_firebase_app() -> firebase_admin.App:
    try:
        return firebase_admin.get_app()
    except ValueError:
        cert = _firebase_certificate_from_env()
        project_id = os.getenv("FIREBASE_PROJECT_ID")
        options = {"projectId": project_id} if project_id else None
        return firebase_admin.initialize_app(cert, options)


def verify_firebase_id_token(id_token: str) -> dict[str, Any]:
    try:
        return firebase_auth.verify_id_token(
            id_token,
            app=get_firebase_app(),
            check_revoked=True,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (ValueError, FirebaseError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, expired, or revoked Firebase ID token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def authenticate_user(db: Session, username_or_email: str, password: str) -> Optional[User]:
    lookup = username_or_email.strip().lower()
    user = (
        db.query(User)
        .filter((User.username == username_or_email.strip()) | (User.email == lookup))
        .first()
    )
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expires_at = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expires_at, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        username = payload.get("sub")
        if user_id is None or username is None:
            raise credentials_exception
        user_id = int(user_id)
    except (JWTError, ValueError) as exc:
        raise credentials_exception from exc

    user = db.query(User).filter(User.id == user_id, User.username == username).first()
    if user is None:
        raise credentials_exception
    return user
