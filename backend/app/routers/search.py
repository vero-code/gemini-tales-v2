import logging
import json
import asyncio
from typing import List, Dict, Any
from fastapi import APIRouter, WebSocket
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Import agents
from app.agents.agent import root_agent as search_agent

logger = logging.getLogger(__name__)
router = APIRouter()

session_service = InMemorySessionService()
search_runner = Runner(app_name="search_adventure", agent=search_agent, session_service=session_service)

def transform_adk_to_gemini_format(event) -> List[Dict]:
    """Converts ADK events to Gemini Live API format"""
    results = []
    event_dict = json.loads(event.model_dump_json(exclude_none=True, by_alias=True))
    
    # 1. Output Transcription
    if "outputTranscription" in event_dict:
        results.append({
            "type": "OUTPUT_TRANSCRIPTION",
            "data": event_dict["outputTranscription"]
        })
    
    # 2. Audio
    if "content" in event_dict and event_dict["content"]:
        parts = event_dict["content"].get("parts", [])
        for part in parts:
            if "inlineData" in part:
                results.append({"type": "AUDIO", "data": part["inlineData"]["data"]})
            elif "text" in part:
                results.append({"type": "TEXT", "data": part["text"]})
    
    if not event_dict.get("partial"):
        results.append({"serverContent": {"turnComplete": True}})
    
    return results

@router.websocket("/search_live/{user_id}/{session_id}")
async def websocket_search_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()
    logger.info(f"🔍 Search Agent Connected: {user_id}/{session_id}")

    session = await session_service.get_session(app_name="search_adventure", user_id=user_id, session_id=session_id)
    if not session:
        await session_service.create_session(app_name="search_adventure", user_id=user_id, session_id=session_id)

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI
    )

    live_request_queue = LiveRequestQueue()
    live_request_queue.send_content(types.Content(parts=[types.Part(text="Hello! Say that you are ready to search.")]))

    async def upstream_task():
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message:
                    live_request_queue.send_realtime(types.Blob(mime_type="audio/pcm;rate=16000", data=message["bytes"]))
                elif "text" in message:
                    data = json.loads(message["text"])
                    if "text" in data:
                        live_request_queue.send_content(types.Content(parts=[types.Part(text=data["text"])]))
        except Exception as e:
            if "disconnect" not in str(e).lower():
                logger.error(f"❌ Search Upstream error: {e}")

    async def downstream_task():
        try:
            await websocket.send_text(json.dumps({"type": "SETUP_COMPLETE", "setupComplete": True}))
            logger.info("✅ Green light sent to frontend! Waiting for reaction...")

            async for event in search_runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                transformed_events = transform_adk_to_gemini_format(event)
                for transformed_event in transformed_events:
                    await websocket.send_text(json.dumps(transformed_event))
        except Exception as e:
            logger.error(f"❌ Search Downstream error: {e}")

    try:
        await asyncio.gather(upstream_task(), downstream_task())
    finally:
        live_request_queue.close()
