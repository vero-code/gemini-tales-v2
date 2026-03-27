import os
import io
import json
import uuid
import logging
from typing import Optional
from google import genai
from google.genai import types
import time
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

        # Initialize model and create separate chat sessions for different use cases
        image_model = os.getenv("VITE_MODEL_ID_IMAGE", "gemini-3.1-flash-image-preview")
        
        # Chat session for character portraits (1:1 aspect ratio)
        self.chat_avatar = self.client.chats.create(
            model=image_model,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="1:1",
                    image_size="1K"
                )
            )
        )
        
        # Chat session for scene illustrations (16:9 aspect ratio)
        self.chat_scene = self.client.chats.create(
            model=image_model,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="16:9",
                    image_size="2K"
                )
            )
        )
        
        self.output_dir = os.path.join(os.path.dirname(__file__), "temp_avatars")
        os.makedirs(self.output_dir, exist_ok=True)

    def generate_scene_illustration(self, scene_description: str) -> str:
        """
        Generates a full scene illustration for the story.
        
        Args:
            scene_description: Text description of the scene to illustrate.
            
        Returns:
            Path to the saved scene image.
        """
        prompt = f"""Create a magical fairytale scene illustration.
        
        Scene description: {scene_description}

CRITICAL STYLE REQUIREMENTS:
- Art style: Watercolor, whimsical children's book illustration
- Soft textures, gentle brushstrokes, and a warm color palette
- Composition: Full landscape scene
- Lighting: Magical, atmospheric lighting
- Feel: Enchanting and safe for children

The illustration should capture the mood of the story: {scene_description}"""

        logger.info(f"🎨 Generating scene illustration: {scene_description}...")
        
        # Add retry logic for 429 Errors
        retries = 3
        for i in range(retries):
            try:
                response = self.chat_scene.send_message(prompt)
                filename = f"scene_{uuid.uuid4().hex[:8]}.png"
                scene_path = self._save_image_from_response(response, filename)
                if scene_path:
                    logger.info(f"✓ Scene illustration generated at {scene_path}")
                    return scene_path
                raise Exception("No image in response")
            except Exception as e:
                if "429" in str(e) and i < retries - 1:
                    logger.warning(f"⚠️ Quota hit (429). Retrying in 5s... (Attempt {i+1}/{retries})")
                    time.sleep(5)
                else:
                    logger.error(f"❌ Failed to generate scene illustration: {e}")
                    raise e

    def generate_initial_avatar(self, appearance_description: str) -> str:
        """
        Generates the first portrait of Puck.
        
        Args:
            appearance_description: Text description of Puck's appearance.
            
        Returns:
            Path to the saved portrait image.
        """
        prompt = f"""Create a fairytale character portrait.

Character appearance (this is Puck, our magical narrator): {appearance_description}

CRITICAL STYLE REQUIREMENTS:
- Art style: Watercolor, whimsical children's book illustration
- Soft textures, gentle brushstrokes, and a warm color palette
- Background: Pure solid white (#FFFFFF) - absolutely no gradients or patterns
- Frame: Head and shoulders only, facing the viewer
- Lighting: Soft, magical glow, no harsh shadows
- Expression: Kind and curious

The white background is essential for character compositing."""

        logger.info(f"🎨 Generating initial avatar for: {appearance_description}...")
        response = self.chat_avatar.send_message(prompt)
        
        filename = f"portrait_{uuid.uuid4().hex[:8]}.png"
        portrait_path = self._save_image_from_response(response, filename)
        if not portrait_path:
            raise Exception("Failed to generate portrait - no image in response")
        
        logger.info(f"✓ Portrait generated at {portrait_path}")
        return portrait_path

    def generate_avatar_from_photo(self, photo_bytes: bytes, appearance_description: str) -> str:
        """
        Transforms a real photo into a stylized fairytale portrait.
        
        Args:
            photo_bytes: The raw bytes of the user's photo.
            appearance_description: Text context (e.g., name or color preferences).
            
        Returns:
            Path to the saved stylized portrait.
        """
        prompt = f"""Transform the person in this photo into Puck, a stylized fairytale narrator portrait.

Character details: {appearance_description}

PRESERVE from the original photo:
- The person's facial features, face shape, and likeness
- Their general expression and personality
- Any distinctive features (glasses, etc.)

TRANSFORM with this style:
- Art style: Watercolor, whimsical children's book illustration
- Soft textures, gentle brushstrokes, and a warm color palette
- Background: Pure solid white (#FFFFFF) - absolutely no gradients or patterns
- Frame: Head and shoulders, 3/4 view
- Lighting: Soft, magical glow
- Art style: Modern animated movie character (Pixar/Dreamworks aesthetic)

The result should be clearly recognizable as THIS specific person, but illustrated as a magical fairytale character."""

        logger.info("🎨 Transforming photo into a fairytale portrait...")
        
        # Send both the prompt AND the image
        response = self.chat_avatar.send_message([
            prompt,
            types.Part.from_bytes(data=photo_bytes, mime_type="image/jpeg")
        ])
        
        filename = f"portrait_{uuid.uuid4().hex[:8]}.png"
        portrait_path = self._save_image_from_response(response, filename)
        if not portrait_path:
            raise Exception("Failed to transform photo - no image in response")
        
        logger.info(f"✓ Photo-based portrait generated at {portrait_path}")
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
- SAME Puck, SAME face, SAME features, SAME magical elements — maintain perfect consistency
- Full body or 3/4 view to show the action
- Background: Pure solid white (#FFFFFF)
- Art style: EXACTLY the same watercolor, whimsical children's book style
- Maintain the same colors, lighting, and magical feel

The character must be immediately recognizable as the same person from the portrait."""

        logger.info(f"🖼️ Generating consistent action: {action_description}...")
        response = self.chat_avatar.send_message(prompt)
        
        filename = f"action_{uuid.uuid4().hex[:8]}.png"
        action_path = self._save_image_from_response(response, filename)
        if not action_path:
            raise Exception("Failed to generate action image - no image in response")
        
        logger.info(f"✓ Action image generated at {action_path}")
        return action_path

    def generate_animated_puck(self, appearance_description: str) -> str:
        """
        Generates a 4-second video of Puck using Veo 3.1.
        """
        prompt = f"""A magical fairytale animation of Puck. 
        Appearance: {appearance_description}.
        Puck is floating in a magical forest, blinking and smiling, with translucent wings gently fluttering. 
        Art style: Watercolor whimsical children's book illustration.
        Slow, gentle movement, magical atmosphere."""

        logger.info(f"🌿 Animating Puck with Veo 3.1: {appearance_description}...")
        
        video_model = os.getenv("VIDEO_MODEL_ID", "veo-3.1-generate-preview")
        operation = self.client.models.generate_videos(
            model=video_model,
            prompt=prompt,
            config=types.GenerateVideosConfig(
                aspect_ratio="16:9",
                resolution="720p",
                duration_seconds=4,
            )
        )

        # Poll until complete
        while not operation.done:
            logger.info("   Generating video...")
            time.sleep(5)
            operation = self.client.operations.get(operation)

        if not operation.response or not operation.response.generated_videos:
            raise Exception("Failed to generate animation - no video in response")

        generated_video = operation.response.generated_videos[0]
        filename = f"puck_anim_{uuid.uuid4().hex[:8]}.mp4"
        video_path = os.path.join(self.output_dir, filename)
        generated_video.video.save(video_path)

        logger.info(f"✓ Puck is alive! Video saved at {video_path}")
        return video_path

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
        # print(f"Generated portrait: {p_path}")
        
        a_path = gen.generate_consistent_action("the character is casting a magic spell with a wooden wand")
        # print(f"Generated action: {a_path}")
    except Exception as e:
        # print(f"Error: {e}")
        pass
