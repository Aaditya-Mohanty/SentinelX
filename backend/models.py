import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from backend.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="analyst")  # admin, analyst, read-only, demo
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    endpoints = relationship("Endpoint", back_populates="user", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="user", cascade="all, delete-orphan")
    logs = relationship("SystemLog", back_populates="user", cascade="all, delete-orphan")
    chat_messages = relationship("AIChatMessage", back_populates="user", cascade="all, delete-orphan")


class Endpoint(Base):
    __tablename__ = "endpoints"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    hostname = Column(String, nullable=False)
    ip_address = Column(String, nullable=True)
    os = Column(String, nullable=False)  # linux, windows, macos, docker
    status = Column(String, default="offline")  # online, offline
    last_ping = Column(DateTime, default=datetime.datetime.utcnow)
    cpu_usage = Column(Float, default=0.0)
    ram_usage = Column(Float, default=0.0)
    disk_usage = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="endpoints")
    alerts = relationship("Alert", back_populates="endpoint", cascade="all, delete-orphan")
    logs = relationship("SystemLog", back_populates="endpoint", cascade="all, delete-orphan")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint_id = Column(Integer, ForeignKey("endpoints.id", ondelete="CASCADE"), nullable=True)
    severity = Column(String, nullable=False)  # low, medium, high, critical
    attack_type = Column(String, nullable=False)  # SSH Brute Force, SQL Injection, etc.
    mitre_id = Column(String, nullable=True)  # e.g., T1110
    tactic = Column(String, nullable=True)  # e.g., Credential Access
    description = Column(Text, nullable=True)
    status = Column(String, default="unresolved")  # unresolved, investigating, resolved
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="alerts")
    endpoint = relationship("Endpoint", back_populates="alerts")


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint_id = Column(Integer, ForeignKey("endpoints.id", ondelete="CASCADE"), nullable=False)
    log_type = Column(String, nullable=False)  # auth, system, process, network
    log_content = Column(Text, nullable=False)
    severity = Column(String, default="info")  # info, warning, error, critical
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="logs")
    endpoint = relationship("Endpoint", back_populates="logs")


class AIChatMessage(Base):
    __tablename__ = "ai_chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)  # user, assistant
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="chat_messages")
