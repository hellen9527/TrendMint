"""Server-side owner provisioning. Public signup can NEVER make an admin."""
import argparse
from sqlalchemy import select
from app.db import create_tables, SessionLocal
from app.models import User

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    create_tables()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
        if not user:
            raise SystemExit("Register the account in the website first, then run this command.")
        user.is_admin = True
        db.commit()
        print(f"Owner account promoted: {user.email}")
