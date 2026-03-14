import logging
import json
import asyncio
import base64
import re
import uuid
from typing import List, Dict, Any
from fastapi import APIRouter, WebSocket
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Import agents
from app.agents.agent import root_agent as puck_agent
from google.genai.types import Modality

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
        logger.info(f"📝 [ADK Event] Transcription: '{text}' (final: {final})")
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
                logger.info(f"🔊 [ADK Event] Audio part: {len(audio_base64)} chars")
                gemini_parts.append({"inlineData": {"data": audio_base64, "mimeType": "audio/pcm;rate=16000"}})
            elif hasattr(part, 'text') and part.text:
                logger.info(f"💬 [ADK Event] Text part: '{part.text}'")
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
            logger.info(f"🛠️ [ADK Event] Forwarding {len(gemini_tool_calls)} tool calls")
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
                    if "/avatars/" in result_text:
                        match = re.search(r'(/avatars/[a-zA-Z0-9_\-\.]+\.png)', result_text)
                        if match:
                            url = match.group(1)
                            logger.info(f"🎨 [ADK Event] Detected illustration URL in tool response: {url}")
                            results.append({"type": "ILLUSTRATION", "data": {"url": url}})

    # 5. Turn Complete
    if not getattr(event, 'partial', False):
        logger.info("🏁 [ADK Event] Turn complete")
        results.append({"serverContent": {"turnComplete": True}})

    return results

@router.websocket("/puck_live/{user_id}/{session_id}")
async def websocket_puck_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()
    logger.info(f"🔍 Puck Agent Connected: {user_id}/{session_id}")

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
                            live_request_queue.send_content(types.Content(parts=[types.Part(text=data["text"])]))
                    except Exception as e:
                        logger.error(f"Error parsing upstream JSON: {e}")
        except Exception as e:
            if "disconnect" not in str(e).lower():
                logger.error(f"❌ Puck Upstream error: {e}")

    async def downstream_task():
        try:
            await websocket.send_text(json.dumps({"type": "SETUP COMPLETE", "setupComplete": True}))
            logger.info("✅ Green light sent to frontend! Waiting for reaction...")

            async for event in puck_runner.run_live(
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
        live_request_queue.close()