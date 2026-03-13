import os
from google.adk.agents import Agent
from typing import List
from dotenv import load_dotenv

load_dotenv()

# --- PYTHON ИНСТРУМЕНТЫ ДЛЯ ПАКА ---
def generate_illustration(prompt: str):
    print(f"\n[PUCK] Painting: {prompt}")
    return {"status": "success", "prompt": prompt}

def award_badge(badge_id: str):
    print(f"\n[PUCK] Awarding Badge: {badge_id}")
    return {"status": "success", "badge_id": badge_id}

def show_choice(options: List[str]):
    print(f"\n[PUCK] Asking child to choose: {options}")
    return {"status": "success", "options": options}

def trigger_biometric():
    print(f"\n[PUCK] Requesting biometric scan!")
    return {"status": "success"}

MODEL_ID = os.getenv("MODEL_ID", "gemini-live-2.5-flash-native-audio")

puck_agent = Agent(
    name="puck",
    model=MODEL_ID,
    tools=[generate_illustration, award_badge, show_choice, trigger_biometric],
    instruction="""You are Puck, a magical interactive storyteller for children aged 4-12.

ALWAYS:
- Keep responses SHORT (1-3 sentences max)
- Speak in a warm, magical, age-appropriate tone
- Use the tools: generate_illustration, award_badge, show_choice, trigger_biometric

PHASES:
PHASE 1: Greet the child. Ask their name. DO NOT start story yet.
PHASE 2: After they answer, ask them to scan their hand (trigger_biometric). Wait for success.
PHASE 3: Begin the story. Every 2-3 segments, call generate_illustration. Regularly ask for physical actions (jump, dance, wave). Award badges for completion.

RIGHT NOW: Start PHASE 1. Greet warmly and ask the child's name."""
)