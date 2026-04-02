import logging
import json
import asyncio
import base64
import re
import uuid
import copy
from typing import List, Dict, Any
from fastapi import APIRouter, WebSocket
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.agent import root_agent as puck_agent
from google.genai.types import Modality
from app.agents.tools import illustration_callbacks, badge_callbacks, movement_callbacks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
router = APIRouter()

session_service = InMemorySessionService()
puck_runner = Runner(app_name="puck_adventure", agent=puck_agent, session_service=session_service)

def transform_adk_to_gemini_format(event) -> List[Dict]:
    """Converts ADK events to official Gemini Live API format for frontend compatibility"""
    results = []

    # 1. Transcription (keep as is or wrap)
    ot = getattr(event, 'output_transcription', None)
    if ot:
        text = getattr(ot, 'text', "")
        final = getattr(ot, 'final', False)
        # logger.info(f"📝 [ADK Event] Transcription: '{text}' (final: {final})")
        results.append({
            "serverContent": {
                "outputTranscription": {
                    "text": text,
                    "finished": final
                }
            }
        })
    
    # 2. Content (Audio/Text) -> Wrap in official modelTurn structure
    content = getattr(event, 'content', None)
    if content:
        parts = getattr(content, 'parts', [])
        gemini_parts = []
        for part in parts:
            if hasattr(part, 'inline_data') and part.inline_data:
                audio_base64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                # logger.info(f"🔊 [ADK Event] Audio part: {len(audio_base64)} chars") # SILENCED to keep console clean
                gemini_parts.append({"inlineData": {"data": audio_base64, "mimeType": "audio/pcm;rate=16000"}})
            elif hasattr(part, 'text') and part.text:
                # logger.info(f"💬 [ADK Event] Puck says: '{part.text[:100]}...'")
                gemini_parts.append({"text": part.text})
        
        if gemini_parts:
            results.append({
                "serverContent": {
                    "modelTurn": {
                        "parts": gemini_parts
                    }
                }
            })

    # 3. Tool Calls (Forward to frontend if any)
    tool_calls = getattr(event, 'tool_calls', None)
    if tool_calls:
        gemini_tool_calls = []
        for tc in tool_calls:
            # Try to handle both direct and nested structure
            fc = getattr(tc, 'function_call', tc)
            gemini_tool_calls.append({
                "name": getattr(fc, 'name', 'unknown'),
                "args": getattr(fc, 'args', {}),
                "id": getattr(fc, 'id', str(uuid.uuid4()))
            })
        if gemini_tool_calls:
            # logger.info(f"🛠️ [ADK Event] Forwarding {len(gemini_tool_calls)} tool calls")
            results.append({
                "type": "TOOL_CALL",
                "data": {
                    "functionCalls": gemini_tool_calls
                }
            })

    # 4. Tool Responses (Forward results like URLs to frontend)
    tool_responses = getattr(event, 'tool_responses', None)
    if tool_responses:
        for tr in tool_responses:
            # Handle list of function responses
            f_responses = getattr(tr, 'function_responses', [])
            for fr in f_responses:
                response_val = getattr(fr, 'response', {})
                if isinstance(response_val, dict):
                    result_text = str(response_val.get('result', ''))
                    # logger.info(f"🔎 [ADK Event] Checking tool response result content: {result_text}")
                    if "/avatars/" in result_text:
                        # Improved regex to catch the URL more reliably
                        match = re.search(r'(/avatars/[\w\-\.]+\.(png|jpg|jpeg|webp|mp4))', result_text)
                        if match:
                            url = match.group(1)
                            # logger.info(f"🎨 [ADK Event] Pushing illustration URL to frontend: {url}")
                            results.append({"type": "ILLUSTRATION", "data": {"url": url}})

    # 5. Turn Complete
    if not getattr(event, 'partial', False):
        # logger.info("🏁 [ADK Event] Turn complete")
        results.append({"serverContent": {"turnComplete": True}})

    if results:
        # Create a clean summary for logging instead of raw objects
        log_summary = []
        for r in results:
            if "serverContent" in r:
                sc = r["serverContent"]
                if "modelTurn" in sc: log_summary.append("MODAL_TURN (Audio/Text)")
                elif "outputTranscription" in sc: log_summary.append(f"TRANSCRIPTION: {sc['outputTranscription'].get('text')[:30]}...")
                elif "turnComplete" in sc: log_summary.append("TURN_COMPLETE")
            else:
                log_summary.append(r.get("type", "UNKNOWN"))
        
        # logger.info(f"📤 [ADK Event] Sending to frontend: {', '.join(log_summary)}")
    return results

@router.websocket("/puck_live/{user_id}/{session_id}")
async def websocket_puck_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()
    
    # Get story mode from query params (default to live)
    story_mode = websocket.query_params.get("mode", "live")
    exercise_mode = websocket.query_params.get("exercise_mode", "solar_power")
    logger.info(f"🔍 Puck Agent Connected: {user_id}/{session_id} (Mode: {story_mode}, Exercise: {exercise_mode})")

    # Determine instructions based on mode
    current_instruction = puck_agent.instruction
    if story_mode == "agent":
        current_instruction = """You are Puck, a magical narrator. 
A special story has been prepared for the child. 
Your ONLY task is to read the story provided in the 'STORY BLUEPRINT' message.
1. DO NOT invent your own stories or talk about rabbits/meadows.
2. Once you receive the blueprint, say: "I have the magic story! Let's begin."
3. Read the story exactly as written, step by step.
4. Stop for physical exercises and wait for them to finish.
"""
        logger.info("🧠 Session instruction set to NARRATOR mode.")
    else:
        logger.info("🌿 Session instruction set to LIVE mode.")

    exercise_append = ""
    if exercise_mode == "sky_magic":
        exercise_append = "\n\nEXERCISE FOCUS (Sky Magic): When asking the child to perform exercises or movements, focus ONLY on arms and upper body (like flying, waving wands, reaching for the stars)."
    elif exercise_mode == "earth_magic":
        exercise_append = "\n\nEXERCISE FOCUS (Earth Magic): When asking the child to perform exercises or movements, focus ONLY on legs and lower body (like stomping, jumping, running, balancing)."
    else:
        exercise_append = "\n\nEXERCISE FOCUS (Solar Power): When asking the child to perform exercises or movements, use full body movements."
        
    current_instruction += exercise_append

    # Create a session-local runner with the desired instruction
    # Use copy for shallow copy to avoid overriding global puck_agent but sharing tools
    local_puck = copy.copy(puck_agent)
    local_puck.instruction = current_instruction
    local_runner = Runner(app_name="puck_adventure", agent=local_puck, session_service=session_service)


    async def send_illustration(url: str, music_url: str = None):
        try:
            # logger.info(f"🎨 [WebSocket] Pushing illustration and music: {url}, {music_url}")
            payload = {
                "type": "ILLUSTRATION", 
                "data": {
                    "url": url,
                    "musicUrl": music_url
                }
            }
            await websocket.send_text(json.dumps(payload))
        except Exception as e:
            logger.error(f"Error sending illustration via websocket: {e}")
            
    async def send_badge(badge_id: str):
        try:
            # logger.info(f"🏅 [WebSocket] Pushing badge DIRECTLY to frontend: {badge_id}")
            # The frontend expects a TOOL_CALL with name awardBadge
            await websocket.send_text(json.dumps({
                "type": "TOOL_CALL",
                "data": {
                    "functionCalls": [{
                        "name": "awardBadge",
                        "args": {"badgeId": badge_id},
                        "id": str(uuid.uuid4())
                    }]
                }
            }))
        except Exception as e:
            logger.error(f"Error sending badge via websocket: {e}")

    async def send_movement(activity_type: str, energy: int):
        try:
            # logger.info(f"⚡ [WebSocket] Pushing movement: {activity_type} (+{energy})")
            payload = {
                "type": "MOVEMENT_RECORDED",
                "data": {
                    "activityType": activity_type,
                    "energyGained": energy
                }
            }
            await websocket.send_text(json.dumps(payload))
        except Exception as e:
            logger.error(f"Error sending movement via websocket: {e}")

    illustration_callbacks.append(send_illustration)
    badge_callbacks.append(send_badge)
    movement_callbacks.append(send_movement)

    session = await session_service.get_session(app_name="puck_adventure", user_id=user_id, session_id=session_id)
    if not session:
        await session_service.create_session(app_name="puck_adventure", user_id=user_id, session_id=session_id)

    run_config = RunConfig(
        response_modalities=[Modality.AUDIO],
        streaming_mode=StreamingMode.BIDI,
        session_resumption=types.SessionResumptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck"))
        )
    )

    live_request_queue = LiveRequestQueue()
    if story_mode == "agent":
        # logger.info("🚀 Sending initial Narrator trigger for Agent Mode.")
        live_request_queue.send_content(types.Content(parts=[types.Part(text="I am ready to tell the Storysmith story! Please give me the blueprint.")]))
    else:
        live_request_queue.send_content(types.Content(parts=[types.Part(text="Hello!")]))

    async def upstream_task():
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message:
                    live_request_queue.send_realtime(types.Blob(mime_type="audio/pcm;rate=16000", data=message["bytes"]))
                elif "text" in message:
                    try:
                        data = json.loads(message["text"])
                        msg_type = data.get("type", "")
                        
                        if msg_type == "audio":
                            audio_data = base64.b64decode(data["data"])
                            live_request_queue.send_realtime(types.Blob(mime_type="audio/pcm;rate=16000", data=audio_data))
                        elif msg_type == "image":
                            image_data = base64.b64decode(data["data"])
                            live_request_queue.send_realtime(types.Blob(mime_type="image/jpeg", data=image_data))
                        elif "text" in data:
                            # logger.info(f"📥 [WebSocket] Received text from frontend: {data['text'][:50]}...")
                            live_request_queue.send_content(types.Content(parts=[types.Part(text=data["text"])]))
                    except Exception as e:
                        logger.error(f"Error parsing upstream JSON: {e}")
        except Exception as e:
            if "disconnect" not in str(e).lower():
                logger.error(f"❌ Puck Upstream error: {e}")

    async def downstream_task():
        try:
            await websocket.send_text(json.dumps({"type": "SETUP COMPLETE", "setupComplete": True}))
            # logger.info("✅ Green light sent to frontend! Waiting for reaction...")

            async for event in local_runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                transformed_events = transform_adk_to_gemini_format(event)
                # Log event for debugging tool calls
                # logger.info(f"DEBUG: ADK Event: {event}")
                for transformed_event in transformed_events:
                    await websocket.send_text(json.dumps(transformed_event))
        except Exception as e:
            logger.error(f"❌ Puck Downstream error: {e}")

    try:
        await asyncio.gather(upstream_task(), downstream_task())
    finally:
        if send_illustration in illustration_callbacks:
            illustration_callbacks.remove(send_illustration)
        if send_badge in badge_callbacks:
            badge_callbacks.remove(send_badge)
        if send_movement in movement_callbacks:
            movement_callbacks.remove(send_movement)
        live_request_queue.close()