from typing import Optional, Dict, Any

from sqlalchemy.orm import Session

from models import AuditLogModel


def log_audit(db: Session, action: str, details: Optional[Dict[str, Any]] = None) -> AuditLogModel:
    """Adds an audit log row to the session. Caller is responsible for commit()."""
    entry = AuditLogModel(action=action, details=details or {})
    db.add(entry)
    return entry
