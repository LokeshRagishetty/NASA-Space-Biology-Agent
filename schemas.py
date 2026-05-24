import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def validate_bcrypt_password_size(value: str) -> str:
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be 72 bytes or fewer for bcrypt.")
    return value


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=72)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        username = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
            raise ValueError("Username may contain letters, numbers, dots, underscores, and hyphens only.")
        return username

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValueError("Enter a valid email address.")
        return email

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_bcrypt_password_size(value)


class UserLogin(BaseModel):
    # The same field accepts either a username or an email address.
    username: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=72)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_bcrypt_password_size(value)


class UserProfile(BaseModel):
    id: int
    username: str
    email: str
    google_id: Optional[str] = None
    avatar_url: Optional[str] = None
    auth_provider: str = "password"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserProfile


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(..., min_length=20)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    answer: str


class ChatHistoryResponse(BaseModel):
    id: int
    question: str
    answer: str
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str
