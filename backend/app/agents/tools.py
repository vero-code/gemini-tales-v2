import os
import logging
from typing import Optional
from app.avatar_generator import StoryAvatarGenerator

logger = logging.getLogger(__name__)

# Singleton for the generator
_generator: Optional[StoryAvatarGenerator] = None

def get_generator():
    global _generator
    if _generator is None:
        _generator = StoryAvatarGenerator()
    return _generator

def draw_story_scene(scene_description: str) -> str:
    """
    Creates a magical watercolor illustration for the current story scene.
    Call this whenever you start a new story or the scene changes significantly.
    The image will be displayed to the child in the 'Your story awaits' block.
    
    Args:
        scene_description: A detailed description of the scene to illustrate.
    """
    logger.info(f"🛠️ Tool call: draw_story_scene with description: {scene_description}")
    generator = get_generator()
    try:
        path = generator.generate_scene_illustration(scene_description)
        filename = os.path.basename(path)
        # The frontend serves /avatars/ from backend/app/temp_avatars
        url = f"/avatars/{filename}"
        logger.info(f"✅ Illustration generated: {url}")
        return url
    except Exception as e:
        logger.error(f"❌ Failed to generate illustration: {e}")
        return f"Error: {str(e)}"

def do_physical_exercise(exercise_name: str, magic_word: str) -> str:
    """
    Ask the child to perform a specific physical exercise while shouting a magic word.
    Use this to make the story interactive and keep the child moving.
    
    Args:
        exercise_name: The name or description of the exercise (e.g., 'Bunny Hops', 'Giant Steps', 'Spin like a whirlwind').
        magic_word: A funny magic word for the child to shout while exercising (e.g., 'Hocus Pocus', 'Bamboozle', 'Sparkle!').
    """
    logger.info(f"🛠️ Tool call: do_physical_exercise - {exercise_name} with magic word: {magic_word}")
    message = f"Great! Let's do some {exercise_name}! Shout '{magic_word}' while you do it!"
    return message
