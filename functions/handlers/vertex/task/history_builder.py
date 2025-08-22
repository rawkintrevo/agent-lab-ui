# functions/handlers/vertex/task/history_builder.py
from google.cloud import storage
from google.genai.types import Content, Part
from common.core import db, logger


async def get_full_message_history(chat_id: str, leaf_message_id: str | None) -> list[dict]:
    """Reconstructs the conversation history leading up to a specific message."""
    if not leaf_message_id: return []
    messages_collection = db.collection("chats").document(chat_id).collection("messages")
    all_docs = {doc.id: doc.to_dict() for doc in messages_collection.stream()}
    history = []
    current_id = leaf_message_id
    while current_id and current_id in all_docs:
        history.insert(0, all_docs[current_id])
        current_id = all_docs[current_id].get("parentMessageId")
    logger.info(f"Full history reconstructed with {len(history)} messages for chat {chat_id}.")
    return history


async def _build_adk_content_from_history(conversation_history: list[dict]) -> tuple[Content, int]:
    """Constructs a multi-part ADK Content object from the conversation history."""
    adk_parts, total_char_count = [], 0
    storage_client = storage.Client()

    for message in conversation_history:
        role = "model" if message.get("participant", "").startswith("assistant:") else "user"
        message_texts = [p.get("text", "") for p in message.get("parts", []) if "text" in p]
        if message_texts:
            full_text = "\n".join(message_texts).strip()
            if full_text:
                adk_parts.append(Part.from_text(text=f"{role}: {full_text}"))
                total_char_count += len(full_text)

        for part_data in message.get("parts", []):
            if file_info := part_data.get("file_data"):
                uri, mime_type = file_info.get("file_uri"), file_info.get("mime_type")
                if not (uri and mime_type and uri.startswith("gs://")): continue
                try:
                    bucket_name, blob_name = uri.split('/', 3)[2:]
                    blob = storage_client.bucket(bucket_name).blob(blob_name)
                    if mime_type.startswith("image/"):
                        image_bytes = blob.download_as_bytes()
                        adk_parts.append(Part.from_bytes(data=image_bytes, mime_type=mime_type))
                    elif mime_type.startswith("text/"):
                        text_content = blob.download_as_text()
                        adk_parts.append(Part.from_text(text=f"{role} uploaded file '{blob_name}':\n{text_content}"))
                    else:
                        adk_parts.append(Part.from_uri(file_uri=uri, mime_type=mime_type))
                except Exception as e:
                    logger.error(f"Failed to download/process GCS URI {uri}: {e}")
                    adk_parts.append(Part.from_text(text=f"[{role} Error: Could not load content from {uri}]"))

    if not adk_parts:
        adk_parts.append(Part.from_text(text=""))
    return Content(role="user", parts=adk_parts), total_char_count