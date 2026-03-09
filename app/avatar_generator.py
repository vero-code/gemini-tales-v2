import os
import io
import json
import logging
from typing import Optional
from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

class StoryAvatarGenerator:
    """
    Generates consistent story characters using multi-turn chat with Gemini Nano Banana.
    """

    def __init__(self, project_id: Optional[str] = None, location: str = "us-central1"):
        """
        Initializes the Gemini client and creates a chat session.
        """
        self.project_id = project_id or os.getenv("GOOGLE_CLOUD_PROJECT")
        self.location = location
        
        if not self.project_id:
             # Try to get project ID from gcloud if not in env
             try:
                 import google.auth
                 _, project = google.auth.default()
                 self.project_id = project
             except Exception:
                 pass

        if not self.project_id:
            logger.warning("GOOGLE_CLOUD_PROJECT not set. Vertex AI may fail.")

        self.client = genai.Client(
            vertexai=True,
            project=self.project_id,
            location=self.location
        )

        # Create a chat session to maintain character consistency
        self.chat = self.client.chats.create(
            model="gemini-2.5-flash-image",
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"]
            )
        )
        
        self.output_dir = "temp_avatars"
        os.makedirs(self.output_dir, exist_ok=True)

    def generate_initial_avatar(self, appearance_description: str) -> str:
        """
        Generates the first portrait of the character.
        
        Args:
            appearance_description: Text description of the child's appearance.
            
        Returns:
            Path to the saved portrait image.
        """
        prompt = f"""Create a fairytale character portrait.

Character appearance: {appearance_description}

CRITICAL STYLE REQUIREMENTS:
- Art style: Watercolor, whimsical children's book illustration
- Soft textures, gentle brushstrokes, and a warm color palette
- Background: Pure solid white (#FFFFFF) - absolutely no gradients or patterns
- Frame: Head and shoulders only, facing the viewer
- Lighting: Soft, magical glow, no harsh shadows
- Expression: Kind and curious

The white background is essential for character compositing."""

        logger.info(f"🎨 Generating initial avatar for: {appearance_description}...")
        response = self.chat.send_message(prompt)
        
        portrait_path = self._save_image_from_response(response, "portrait.png")
        if not portrait_path:
            raise Exception("Failed to generate portrait - no image in response")
        
        logger.info(f"✓ Portrait generated at {portrait_path}")
        return portrait_path

    def generate_consistent_action(self, action_description: str) -> str:
        """
        Generates the same character performing a new action.
        
        Args:
            action_description: Description of what the character is doing.
            
        Returns:
            Path to the saved action image.
        """
        prompt = f"""Now create an illustration of this SAME character performing an action.

Action: {action_description}

CRITICAL REQUIREMENTS:
- SAME child, SAME face, SAME hair, SAME clothes — maintain perfect consistency with the previous portrait
- Full body or 3/4 view to show the action
- Background: Pure solid white (#FFFFFF)
- Art style: EXACTLY the same watercolor, whimsical children's book style
- Maintain the same colors, lighting, and magical feel

The character must be immediately recognizable as the same person from the portrait."""

        logger.info(f"🖼️ Generating consistent action: {action_description}...")
        response = self.chat.send_message(prompt)
        
        action_path = self._save_image_from_response(response, "action.png")
        if not action_path:
            raise Exception("Failed to generate action image - no image in response")
        
        logger.info(f"✓ Action image generated at {action_path}")
        return action_path

    def _save_image_from_response(self, response, filename: str) -> Optional[str]:
        """Helper to extract and save the image from a Gemini response."""
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                image_bytes = part.inline_data.data
                image = Image.open(io.BytesIO(image_bytes))
                file_path = os.path.join(self.output_dir, filename)
                image.save(file_path)
                return file_path
        return None

if __name__ == "__main__":
    # Simple test script
    gen = StoryAvatarGenerator()
    try:
        p_path = gen.generate_initial_avatar("a little girl with red pigtails in a green dress")
        print(f"Generated portrait: {p_path}")
        
        a_path = gen.generate_consistent_action("the character is casting a magic spell with a wooden wand")
        print(f"Generated action: {a_path}")
    except Exception as e:
        print(f"Error: {e}")
