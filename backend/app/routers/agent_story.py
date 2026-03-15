import os
import json
import logging
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

# Grab the Orchestrator URL from environment
orchestrator_url = os.environ.get("AGENT_SERVER_URL", "http://localhost:8004")
# Ensure it points to the agent card if it looks like a Cloud Run URL
if not orchestrator_url.endswith("agent-card.json") and "run.app" in orchestrator_url:
    orchestrator_url = f"{orchestrator_url.rstrip('/')}/a2a/agent/.well-known/agent-card.json"

orchestrator_agent = RemoteA2aAgent(
    name="gemini_tales_pipeline",
    agent_card=orchestrator_url,
    description="Remote orchestrator",
    httpx_client=create_authenticated_client(orchestrator_url)
)

session_service = InMemorySessionService()

from google.genai.types import Content, Part

@router.post("/chat_stream")
async def chat_stream(req: ChatRequest):
    async def event_generator():
        try:
            session_id = f"story_{req.user_id}"
            
            # 1. Ensure session exists FIRST
            print(f"DEBUG: Checking session {session_id} for user {req.user_id}")
            session = await session_service.get_session(
                app_name="gemini_tales_proxy", 
                user_id=req.user_id, 
                session_id=session_id
            )
            if not session:
                print(f"DEBUG: Session not found, creating it...")
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
                print(f"DEBUG: Session created: {session is not None}")
            
            # 2. Instantiate Runner AFTER session is ready
            print(f"DEBUG: Initializing Runner for {orchestrator_agent.name} at {orchestrator_url}")
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
                            # If it's the final output of the pipeline or content builder
                            if author in ["gemini_tales_pipeline", "content_builder", orchestrator_agent.name]:
                                yield json.dumps({"type": "result", "text": text_to_send}) + "\n"
                            else:
                                # Intermediate results can be shown as progress
                                yield json.dumps({"type": "progress", "text": f"🧠 {author} finished: {text_to_send[:50]}..."}) + "\n"

                    # Even if no content, show which agent is active
                    elif author and author != "research_loop":
                        agent_display_names = {
                            "researcher": "🕵️ Adventure Seeker",
                            "judge": "⚖️ Guardian of Balance",
                            "content_builder": "🧙‍♂️ Storysmith",
                            "orchestrator": "🪄 Orchestrator"
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
