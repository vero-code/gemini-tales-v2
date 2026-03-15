import logging
import asyncio
import ssl
import certifi
import websockets
from fastapi import APIRouter, WebSocket
from app.services.gcp_auth import generate_gcp_token

logger = logging.getLogger(__name__)
router = APIRouter()

@router.websocket("/proxy")
async def gemini_live_proxy(websocket: WebSocket):
    """
    WebSocket proxy for Gemini Live API.
    Extracts Project ID and Model from the query string and connects to Google Cloud.
    """
    await websocket.accept()
    # logger.info("🔌 New WebSocket client connected to proxy")
    
    server_websocket = None
    
    try:
        query_params = dict(websocket.query_params)
        project_id = query_params.get("project")
        
        if not project_id:
            logger.error("❌ Project ID is missing in the WebSocket connection URL")
            await websocket.close(code=1008, reason="Project ID is required in URL query parameters")
            return

        service_url = "wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"

        bearer_token = generate_gcp_token()
        if not bearer_token:
            logger.error("❌ Failed to generate Google Cloud credentials")
            await websocket.close(code=1008, reason="Authentication failed on server")
            return

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {bearer_token}",
        }
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        
        # logger.info(f"🚀 Connecting to Gemini API: {service_url.split('?')[0]}...")
        
        async with websockets.connect(
            service_url, additional_headers=headers, ssl=ssl_context
        ) as s_ws:
            server_websocket = s_ws
            # logger.info("✅ Connected to Gemini API successfully")

            # Channel: Browser -> Google
            async def client_to_server():
                try:
                    while True:
                        try:
                            message = await websocket.receive()
                            if message["type"] == "websocket.disconnect":
                                break
                        except Exception:
                            break
                            
                        if "text" in message:
                            text_data = message["text"]
                            if '"service_url"' in text_data:
                                continue
                            
                            text_data = text_data.replace('"generation_connfig"', '"generation_config"')
                            await server_websocket.send(text_data)
                        elif "bytes" in message:
                            await server_websocket.send(message["bytes"])
                except Exception as e:
                    if "closed" not in str(e).lower():
                        logger.error(f"❌ C->S error: {e}")

            # Channel: Google -> Browser
            async def server_to_client():
                try:
                    async for message in server_websocket:
                        if isinstance(message, bytes):
                            try:
                                decoded_msg = message.decode('utf-8')
                                await websocket.send_text(decoded_msg)
                            except UnicodeDecodeError:
                                await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except Exception as e:
                    if "closed" not in str(e).lower():
                        logger.error(f"❌ S->C error: {e}")

            # Run both concurrently, but ensure both terminate if one does
            done, pending = await asyncio.wait(
                [asyncio.create_task(client_to_server()), asyncio.create_task(server_to_client())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            
            for task in pending:
                task.cancel()

    except Exception as e:
        if "closed" not in str(e).lower():
            logger.error(f"Proxy error: {e}")
    finally:
        if server_websocket:
            code = getattr(server_websocket, 'close_code', 'Unknown')
            reason = getattr(server_websocket, 'close_reason', 'No reason')
            # logger.info(f"🔌 Proxy connection closed. Google side: {code} ({reason})")
            try:
                await server_websocket.close()
            except Exception:
                pass
        # logger.info("🔌 Proxy connection closed")
