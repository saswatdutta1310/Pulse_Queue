import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base
from config import settings

# Hybrid database connection engine:
# Tries PostgreSQL first; falls back cleanly to local SQLite database if Postgres is not initialized
DB_URI = os.getenv(
    "DATABASE_URL",
    f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
)

try:
    engine = create_engine(DB_URI, pool_pre_ping=True)
    with engine.connect() as conn:
        pass
    print(f"[Database] Connected successfully to PostgreSQL at {settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}")
except Exception as e:
    print(f"[Database] PostgreSQL connection failed ({e.__class__.__name__}). Falling back to durable local SQLite: sqlite:///pulsequeue.db")
    DB_URI = "sqlite:///pulsequeue.db"
    engine = create_engine(DB_URI, connect_args={"check_same_thread": False})


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)
    print("🐘 [Database] Schemas and tables verified/created.")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
