import os
import json
import socket
import logging
import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from google.adk.agents import BaseAgent
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from app.authenticated_httpx import create_authenticated_client

logger = logging.getLogger(__name__)
router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    user_id: str = "default_user"

import socket

def get_orchestrator_url() -> str:
    is_local = False
    try:
        with socket.create_connection(("127.0.0.1", 8004), timeout=0.1):
            is_local = True
    except OSError:
        pass

    if is_local:
        url = "http://localhost:8004/a2a/agent/.well-known/agent-card.json"
        logger.info(f"Detected local agent orchestrator running on port 8004. Using {url}")
        return url

    # Fallback to environment
    url = os.environ.get("AGENT_SERVER_URL", "http://localhost:8004")
    if not url.endswith("agent-card.json") and "run.app" in url:
        url = f"{url.rstrip('/')}/a2a/agent/.well-known/agent-card.json"
    logger.info(f"Using configured remote/fallback orchestrator URL: {url}")
    return url

def get_orchestrator_agent() -> RemoteA2aAgent:
    url = get_orchestrator_url()
    return RemoteA2aAgent(
        name="gemini_tales_pipeline",
        agent_card=url,
        description="Remote orchestrator",
        httpx_client=create_authenticated_client(url)
    )

session_service = InMemorySessionService()

from google.genai.types import Content, Part

@router.post("/chat_stream")
async def chat_stream(req: ChatRequest):
    async def event_generator():
        try:
            session_id = f"story_{req.user_id}"
            
            # 1. Ensure session exists FIRST
            # print(f"DEBUG: Checking session {session_id} for user {req.user_id}")
            session = await session_service.get_session(
                app_name="gemini_tales_proxy", 
                user_id=req.user_id, 
                session_id=session_id
            )
            if not session:
                # print(f"DEBUG: Session not found, creating it...")
                await session_service.create_session(
                    app_name="gemini_tales_proxy", 
                    user_id=req.user_id, 
                    session_id=session_id
                )
                session = await session_service.get_session(
                    app_name="gemini_tales_proxy", 
                    user_id=req.user_id, 
                    session_id=session_id
                )
                # print(f"DEBUG: Session created: {session is not None}")
            
            # Resolve orchestrator agent dynamically
            orchestrator_agent = get_orchestrator_agent()
            
            # 2. Instantiate Runner AFTER session is ready
            # print(f"DEBUG: Initializing Runner for {orchestrator_agent.name}")
            runner = Runner(
                app_name="gemini_tales_proxy",
                agent=orchestrator_agent,
                session_service=session_service
            )

            # 3. Prepare content
            user_content = Content(
                role="user",
                parts=[Part(text=req.message)]
            )
            
            active_agent = ""
            async for event in runner.run_async(
                new_message=user_content,
                user_id=req.user_id,
                session_id=session_id,
            ):
                try:
                    author = getattr(event, 'author', '')
                    content = getattr(event, 'content', None)
                    is_partial = getattr(event, 'partial', False)
                    
                    # Log for debugging (visible in terminal)
                    if content:
                        logger.info(f"📩 [Event] Author: {author}, Content Type: {type(content)}")

                    if is_partial:
                        continue
                        
                    if content:
                        text_to_send = ""
                        
                        # Case 1: content is a raw string
                        if isinstance(content, str):
                            text_to_send = content
                        
                        # Case 2: content is an object with parts (Standard ADK/Gemini)
                        elif hasattr(content, 'parts'):
                            parts = content.parts or []
                            text_parts = []
                            for p in parts:
                                if hasattr(p, 'text') and p.text:
                                    text_parts.append(p.text)
                                elif isinstance(p, str):
                                    text_parts.append(p)
                            text_to_send = "".join(text_parts)
                        
                        if text_to_send:
                            agent_display_names = {
                                "researcher": "🕵️ Adventure Seeker",
                                "judge": "⚖️ Guardian of Balance",
                                "content_builder": "🧙‍♂️ Storysmith",
                                "escalation_checker": "✅ Safety Check",
                                "research_loop": "🔄 Research Loop",
                                "gemini_tales_pipeline": "🪄 Orchestrator",
                            }
                            display_name = agent_display_names.get(author, author)

                            # Final result: pipeline or content_builder finished
                            if author in ["gemini_tales_pipeline", "content_builder", orchestrator_agent.name]:
                                yield json.dumps({"type": "result", "text": text_to_send}) + "\n"
                                # After result — fetch and emit trace steps from orchestrator
                                try:
                                    orchestrator_base = get_orchestrator_url().split("/a2a/")[0]
                                    async with httpx.AsyncClient(timeout=5.0) as client:
                                        resp = await client.get(f"{orchestrator_base}/last_trace")
                                        if resp.status_code == 200:
                                            trace_data = resp.json()
                                            for step in trace_data.get("steps", []):
                                                yield json.dumps({
                                                    "type": "step",
                                                    "agent": step["agent"],
                                                    "display_name": step["display_name"],
                                                    "text": step["text"],
                                                }) + "\n"
                                except Exception as trace_err:
                                    logger.warning(f"Could not fetch pipeline trace: {trace_err}")
                            else:
                                # Intermediate step — emit full output as a 'step' event
                                yield json.dumps({
                                    "type": "step",
                                    "agent": author,
                                    "display_name": display_name,
                                    "text": text_to_send,
                                }) + "\n"

                    # No content — agent is still thinking: emit progress
                    elif author and author not in ("research_loop", "escalation_checker", "gemini_tales_pipeline"):
                        agent_display_names = {
                            "researcher": "🕵️ Adventure Seeker",
                            "judge": "⚖️ Guardian of Balance",
                            "content_builder": "🧙‍♂️ Storysmith",
                        }
                        display_name = agent_display_names.get(author, author)
                        yield json.dumps({"type": "progress", "text": f"⏳ {display_name} is thinking..."}) + "\n"

                except Exception as inner_e:
                    logger.error(f"Error processing event: {inner_e}")
                    continue

        except Exception as e:
            logger.error(f"Error streaming from orchestrator: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            
    return StreamingResponse(event_generator(), media_type="text/plain")
