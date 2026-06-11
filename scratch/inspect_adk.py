import os
import sys

# Add backend directory to path
sys.path.append(os.path.abspath("backend"))

from google.adk.runners import Runner
from google.adk.agents import Agent

agent = Agent(name="test", model="gemini-2.5-flash-native-audio-preview-12-2025")
runner = Runner(app_name="test_app", agent=agent)

print("Runner agent model:", runner.agent.model)
print("Underlying LLM / Client configuration:")
# Let's inspect runner or agent to see where the LLM or Client is stored.
# We can print attributes of runner.
print("Runner attributes:", dir(runner))
try:
    # Let's see if we can find where the client is initialized in Runner or its components
    print("Runner.agent attributes:", dir(runner.agent))
except Exception as e:
    print("Error:", e)
