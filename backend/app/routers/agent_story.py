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

@router.post("/chat_stream")
async def chat_stream(req: ChatRequest):
    # Create the runner per request to ensure thread safety
    runner = Runner(
        app_name="gemini_tales_proxy",
        agent=orchestrator_agent,
        session_service=session_service
    )
    
    async def event_generator():
        try:
            active_agent = ""
            async for event in runner.run(
                user_input=req.message,
                user_id=req.user_id,
            ):
                author = getattr(event, 'author', '')
                content = getattr(event, 'content', None)
                
                # We want to tell the frontend who is currently working and output the final result
                if getattr(event, 'partial', False):
                    continue
                    
                if content and getattr(content, 'parts', []):
                    text_parts = [p.text for p in content.parts if getattr(p, 'text', None)]
                    if text_parts:
                        full_text = "".join(text_parts)
                        if author == "gemini_tales_pipeline" or author == orchestrator_agent.name:
                            # Final result
                            yield json.dumps({"type": "result", "text": full_text}) + "\n"
                        else:
                            # Log intermediate results internally, but normally we just show progress to UI
                            yield json.dumps({"type": "progress", "text": f"🧠 [{author}] finished a thought..."}) + "\n"
                # Event might not have content but indicates an agent is running
                elif author:
                    if author != active_agent and author != orchestrator_agent.name and author != "research_loop":
                        active_agent = author
                        agent_display_names = {
                            "researcher": "🕵️ Adventure Seeker",
                            "judge": "⚖️ Guardian of Balance",
                            "content_builder": "🧙‍♂️ Storysmith",
                            "escalation_checker": "🛡️ Safety Checker"
                        }
                        display_name = agent_display_names.get(author, author)
                        yield json.dumps({"type": "progress", "text": f"⏳ {display_name} is working..."}) + "\n"

        except Exception as e:
            logger.error(f"Error streaming from orchestrator: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            
    return StreamingResponse(event_generator(), media_type="text/plain")
