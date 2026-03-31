import os
import io
import uuid
import logging
from typing import Optional
from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

class MusicGenerator:
    """
    Generates music clips using Google's Lyria 3 family of models.
    Supports text-to-music and image-to-music generation.
    """

    def __init__(self, project_id: Optional[str] = None, location: str = "us-central1"):
        """
        Initializes the GenAI client for Lyria music generation.
        """
        self.project_id = project_id or os.getenv("GOOGLE_CLOUD_PROJECT")
        self.location = location
        self.model_id = os.getenv("LYRIA_MODEL_ID", "lyria-3-clip-preview")

        self.client = genai.Client(
            vertexai=True,
            project=self.project_id,
            location=self.location
        )
        
        # Output directory for temporary music files
        self.output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp_avatars")
        os.makedirs(self.output_dir, exist_ok=True)

    def generate_scene_music(self, scene_description: str, image_path: Optional[str] = None) -> str:
        """
        Generates a 30-second background music clip inspired by the scene context and/or image.
        
        Args:
            scene_description: The text description of the scene.
            image_path: Optional path to the scene illustration to use as multimodal input.
            
        Returns:
            The filename (or path) of the generated MP3 clip.
        """
        prompt = f"Create a 30-second atmospheric background music clip for a children's fairytale scene. " \
                 f"The scene is: {scene_description}. " \
                 f"Instrumental only, no vocals. Whimsical, magical, and high-fidelity sound."

        contents = [prompt]
        if image_path and os.path.exists(image_path):
            with open(image_path, "rb") as f:
                image_bytes = f.read()
                contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
            logger.info(f"🎵 Generating music from image + text: {scene_description}...")
        else:
            logger.info(f"🎵 Generating music from text only: {scene_description}...")

        try:
            response = self.client.models.generate_content(
                model=self.model_id,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO", "TEXT"],
                ),
            )

            filename = f"music_{uuid.uuid4().hex[:8]}.mp3"
            audio_path = os.path.join(self.output_dir, filename)

            # Parse the response to extract audio data
            audio_data = None
            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    audio_data = part.inline_data.data
                    break
            
            if audio_data:
                with open(audio_path, "wb") as f:
                    f.write(audio_data)
                logger.info(f"✓ Background music generated at {audio_path}")
                return filename # Return filename for frontend access
            else:
                logger.error("❌ Lyria response did not contain audio data.")
                return ""

        except Exception as e:
            logger.error(f"❌ Failed to generate music with Lyria: {e}")
            return ""

if __name__ == "__main__":
    # Test Lyria music generation
    gen = MusicGenerator()
    try:
        music_file = gen.generate_scene_music("a magical forest with glowing mushrooms and tiny fairies")
        print(f"Generated music: {music_file}")
    except Exception as ex:
        print(f"Test failed: {ex}")
