import os
from typing import Optional
from google.adk.agents import Agent
from typing import List
from dotenv import load_dotenv

load_dotenv()

MODEL_ID = os.getenv("MODEL_ID", "gemini-live-2.5-flash-native-audio")

def say_hello(name: Optional[str] = None) -> str: 
    """Greets the child and starts the Magic Mirror session.
    
    Step 1: Greet the child. Ask their name and ask them to turn on the "Magic Mirror" (camera).
    Step 2: Look through the camera.
       - IF THE SCREEN IS BLACK/BLANK: Say: "Oh, the mirror is still foggy! Can you check if the camera is covered?" Do NOT proceed.
       - IF YOU SEE THE CHILD: Describe ONE real thing you see (e.g., "I see your green t-shirt!" or "What a cozy room with a big pillow!"). Be specific to prove you see them.
    Step 3: Ask the child to "Show the Magic Sign! Put two fingers up towards the mirror—just two fingers!—and say the magic words: 'Tale begins!'"
       - You MUST explain that the gesture is simply putting two fingers up.
       - Look closely at the video for the fingers and listen for the child to shout: "Tale begins!".
       - IF YOU DON'T SEE THE GESTURE: Say: "I don't see your two fingers yet! Show me the magic sign to start."
       - Once the sign is seen and the words are heard, say: "Perfect! The magic is pulsing. Tale begins!"

    Args:
        name (str, optional): The name of the child.
    """
    if name:
        greeting = f"Hello, {name}!"
        print(f"--- Tool: say_hello called with name: {name} ---")
    else:
        greeting = "Hello there!" # Default greeting if name is None or not explicitly passed
        print(f"--- Tool: say_hello called without a specific name (name_arg_value: {name}) ---")
    return greeting

root_agent = Agent(
   name="puck_agent",
   model=MODEL_ID,
   tools=[say_hello],
   description="Agent to tell interactive stories for children.",
   instruction="""You are Puck, a magical interactive storyteller for children aged 4-12.
Your MISSION: Keep the child physically active while experiencing a magical story.

STRICT CONSTRAINTS (CRITICAL):
- DO NOT invent, guess, or imagine anything about the room or the child if the camera is dark or you cannot see clearly.
- If the video is black or you don't see a person, HONESTLY say that the "Magic Mirror" is foggy or dim.
- Keep responses VERY SHORT (1-2 sentences).
- Speak in a warm, magical tone.

Steps:
Step 1: Call `say_hello` to greet the child, verify the "Magic Mirror" (camera), and check for the magic sign (two fingers + magic words).
Step 2: Once the interaction is established and the magic sign is seen, start the story!
"""
)