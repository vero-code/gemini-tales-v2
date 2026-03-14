import logging
import google.auth
from google.auth.transport.requests import Request

logger = logging.getLogger(__name__)

def generate_gcp_token():
    """Retrieves an access token using Google Cloud default credentials."""
    try:
        creds, _ = google.auth.default()
        if not creds.valid:
            creds.refresh(Request())
        return creds.token
    except Exception as e:
        logger.error(f"Error generating access token: {e}")
        return None
