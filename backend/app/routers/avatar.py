import os
import asyncio
from typing import Dict, Optional
from fastapi import APIRouter, UploadFile, File, Form
from pydantic import BaseModel
from app.avatar_generator import StoryAvatarGenerator

router = APIRouter()

class AvatarRequest(BaseModel):
    description: str
    user_id: str = "test_user"

# Global generator instance map
generators: Dict[str, StoryAvatarGenerator] = {}

def get_generator(user_id: str) -> StoryAvatarGenerator:
    if user_id not in generators:
        generators[user_id] = StoryAvatarGenerator()
    return generators[user_id]

@router.post("/from-photo")
async def avatar_from_photo(
    file: UploadFile = File(...),
    description: str = Form("a magical character"),
    user_id: str = Form("test_user")
):
    generator = get_generator(user_id)
    photo_bytes = await file.read()
    
    loop = asyncio.get_event_loop()
    path = await loop.run_in_executor(None, generator.generate_avatar_from_photo, photo_bytes, description)
    
    url_path = f"/avatars/{os.path.basename(path)}?t={int(asyncio.get_event_loop().time())}"
    return {"path": url_path}

@router.post("/create")
async def create_avatar(request: AvatarRequest):
    generator = get_generator(request.user_id)
    loop = asyncio.get_event_loop()
    path = await loop.run_in_executor(None, generator.generate_initial_avatar, request.description)
    url_path = f"/avatars/{os.path.basename(path)}"
    return {"path": url_path}

@router.post("/action")
async def avatar_action(request: AvatarRequest):
    generator = get_generator(request.user_id)
    loop = asyncio.get_event_loop()
    path = await loop.run_in_executor(None, generator.generate_consistent_action, request.description)
    url_path = f"/avatars/{os.path.basename(path)}"
    return {"path": url_path}

@router.post("/animate")
async def animate_avatar(request: AvatarRequest):
    generator = get_generator(request.user_id)
    loop = asyncio.get_event_loop()
    path = await loop.run_in_executor(None, generator.generate_animated_puck, request.description)
    url_path = f"/avatars/{os.path.basename(path)}"
    return {"path": url_path}
