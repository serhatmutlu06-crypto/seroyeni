from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# 10-day sentence sequence with highlighted words
# Format: (sentence_before_red, red_word, sentence_after_red)
SENTENCE_SEQUENCE = [
    # Day 1: Nothing is random when you search for TRUTH.
    ("Nothing is random when you search for", "TRUTH", "."),
    # Day 2: Silence doesn't hide answers, it REVEALS them.
    ("Silence doesn't hide answers, it", "REVEALS", "them."),
    # Day 3: Everything shows ITSELF eventually.
    ("Everything shows", "ITSELF", "eventually."),
    # Day 4: Understanding comes ONLY after patience.
    ("Understanding comes", "ONLY", "after patience."),
    # Day 5: Some things speak TO those who listen.
    ("Some things speak", "TO", "those who listen."),
    # Day 6: The message is meant THOSE who stay.
    ("The message is meant", "THOSE", "who stay."),
    # Day 7: Not everyone is prepared WHO looks deeper.
    ("Not everyone is prepared", "WHO", "looks deeper."),
    # Day 8: Clarity arrives WAIT is respected.
    ("Clarity arrives", "WAIT", "is respected."),
    # Day 9: Answers belong FOR the persistent.
    ("Answers belong", "FOR", "the persistent."),
    # Day 10: Meaning appears PATIENTLY.
    ("Meaning appears", "PATIENTLY", "."),
]


# Define Models
class UserState(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    current_day: int = 0  # 0 means hasn't revealed yet, 1-10 for days
    last_reveal_time: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class RevealRequest(BaseModel):
    device_id: str

class RevealResponse(BaseModel):
    before_red: str
    red_word: str
    after_red: str
    day: int
    next_available_time: datetime
    is_final_day: bool

class UserStateResponse(BaseModel):
    device_id: str
    can_reveal: bool
    seconds_until_available: int
    next_available_time: Optional[datetime] = None
    current_day: int
    is_complete: bool  # True if all 10 days completed


@api_router.get("/")
async def root():
    return {"message": "Mystery API"}


@api_router.get("/user/{device_id}", response_model=UserStateResponse)
async def get_user_state(device_id: str):
    """Get or create user state"""
    user = await db.mystery_users.find_one({"device_id": device_id})
    
    if not user:
        # Create new user
        new_user = UserState(device_id=device_id)
        await db.mystery_users.insert_one(new_user.dict())
        user = new_user.dict()
    
    current_day = user.get("current_day", 0)
    is_complete = current_day >= 10
    
    # Check if user can reveal
    can_reveal = True
    seconds_until_available = 0
    next_available_time = None
    
    # If completed all 10 days, cannot reveal anymore
    if is_complete:
        can_reveal = False
    elif user.get("last_reveal_time"):
        last_reveal = user["last_reveal_time"]
        if isinstance(last_reveal, str):
            last_reveal = datetime.fromisoformat(last_reveal.replace('Z', '+00:00'))
        
        next_available = last_reveal + timedelta(hours=24)
        now = datetime.utcnow()
        
        if now < next_available:
            can_reveal = False
            seconds_until_available = int((next_available - now).total_seconds())
            next_available_time = next_available
    
    return UserStateResponse(
        device_id=user["device_id"],
        can_reveal=can_reveal,
        seconds_until_available=seconds_until_available,
        next_available_time=next_available_time,
        current_day=current_day,
        is_complete=is_complete
    )


@api_router.post("/reveal", response_model=RevealResponse)
async def reveal_sentence(request: RevealRequest):
    """Reveal today's sentence"""
    user = await db.mystery_users.find_one({"device_id": request.device_id})
    
    if not user:
        # Create new user
        new_user = UserState(device_id=request.device_id)
        await db.mystery_users.insert_one(new_user.dict())
        user = new_user.dict()
    
    current_day = user.get("current_day", 0)
    
    # Check if already completed all 10 days
    if current_day >= 10:
        raise HTTPException(
            status_code=403,
            detail="All sentences have been revealed."
        )
    
    # Check if user can reveal (24-hour cooldown)
    if user.get("last_reveal_time"):
        last_reveal = user["last_reveal_time"]
        if isinstance(last_reveal, str):
            last_reveal = datetime.fromisoformat(last_reveal.replace('Z', '+00:00'))
        
        next_available = last_reveal + timedelta(hours=24)
        now = datetime.utcnow()
        
        if now < next_available:
            seconds_remaining = int((next_available - now).total_seconds())
            raise HTTPException(
                status_code=403,
                detail=f"Please wait {seconds_remaining} seconds."
            )
    
    # Get today's sentence (current_day is 0-indexed for array, but displays as day 1-10)
    next_day = current_day + 1
    sentence_index = current_day  # 0-9
    before_red, red_word, after_red = SENTENCE_SEQUENCE[sentence_index]
    
    # Update user
    now = datetime.utcnow()
    next_available_time = now + timedelta(hours=24)
    
    await db.mystery_users.update_one(
        {"device_id": request.device_id},
        {"$set": {
            "last_reveal_time": now,
            "current_day": next_day,
            "updated_at": now,
        }}
    )
    
    return RevealResponse(
        before_red=before_red,
        red_word=red_word,
        after_red=after_red,
        day=next_day,
        next_available_time=next_available_time,
        is_final_day=(next_day >= 10)
    )


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
