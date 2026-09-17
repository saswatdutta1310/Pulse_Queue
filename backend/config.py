import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PORT: int = 4000
    REDIS_HOST: str = os.getenv("REDIS_HOST", "127.0.0.1")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6379"))
    
    # PostgreSQL Configuration
    # Uses SQLite file as fallback if Postgres credentials are not passed
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "postgres")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "pulsequeue")
    
    # Note: the app uses synchronous SQLAlchemy (psycopg2), not asyncpg, so this
    # must NOT use the +asyncpg dialect despite the asyncpg package being installed.
    DATABASE_URL: str = ""

    def model_post_init(self, __context):
        if not self.DATABASE_URL:
            self.DATABASE_URL = (
                f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
                f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            )

    JWT_SECRET: str = os.getenv("JWT_SECRET", "pulsequeue-python-fastapi-jwt-secret-2026")
    REAPER_INTERVAL_MS: int = 2500
    MISSED_HEARTBEAT_THRESHOLD_MS: int = 5500

    class Config:
        env_file = ".env"

settings = Settings()
