import os
import logging
import asyncio
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

# Global callbacks for notifying the frontend
illustration_callbacks = []

async def draw_story_scene(scene_description: str) -> str:
    """
    Creates a magical watercolor illustration for the current story scene.
    
    Args:
        scene_description: A detailed description of the scene to illustrate.
    """
    logger.info(f"🛠️ Tool call: draw_story_scene with description: {scene_description}")
    generator = get_generator()
    try:
        # Use to_thread to prevent blocking the main event loop while generating images
        path = await asyncio.to_thread(generator.generate_scene_illustration, scene_description)
        filename = os.path.basename(path)
        url = f"/avatars/{filename}"
        logger.info(f"✅ Illustration generated and available at: {url}")
        
        # Dispatch to any active websockets
        for cb in illustration_callbacks:
            try:
                # Add to event loop without waiting
                asyncio.create_task(cb(url))
            except Exception as e:
                logger.error(f"Error calling illustration callback: {e}")
                
        return f"Illustration ready at: {url}"
    except Exception as e:
        logger.error(f"❌ Failed to generate illustration: {e}")
        return f"Error drawing scene: {str(e)}"

def do_physical_exercise(exercise_name: str, magic_word: str) -> str:
    """
    Ask the child to perform a specific physical exercise while shouting a magic word.
    
    Args:
        exercise_name: The name or description of the exercise.
        magic_word: A funny magic word for the child to shout.
    """
    logger.info(f"🛠️ Tool call: do_physical_exercise - {exercise_name} with magic word: {magic_word}")
    return f"Exercise started: {exercise_name} with word {magic_word}"
