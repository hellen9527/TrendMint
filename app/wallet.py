"""Atomic credit wallet; uniquely keyed ledger prevents duplicate grants."""
from sqlalchemy import update, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models import User, CreditEntry

class InsufficientCredits(ValueError):
    pass


def adjust_credits(db: Session, user_id: int, delta: int, reason: str, ref: str) -> bool:
    """Changes wallet and adds ledger entry atomically inside caller transaction.

    Returns False when the exact reference has already been settled.
    No commit: caller commits all business state together.
    """
    if db.scalar(select(CreditEntry.id).where(CreditEntry.ref == ref)):
        return False
    stmt = update(User).where(User.id == user_id)
    if delta < 0:
        stmt = stmt.where(User.credits >= -delta)
    result = db.execute(stmt.values(credits=User.credits + delta))
    if result.rowcount != 1:
        raise InsufficientCredits("积分不足，请先购买积分包") if delta < 0 else ValueError("用户不存在")
    balance = db.scalar(select(User.credits).where(User.id == user_id))
    db.add(CreditEntry(user_id=user_id, delta=delta, balance_after=balance, reason=reason, ref=ref))
    db.flush()
    return True
