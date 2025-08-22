# functions/handlers/vertex/task/__init__.py
import asyncio
import traceback
from firebase_admin import firestore

from common.core import db, logger
from common.agents import instantiate_adk_agent_from_config
from .history_builder import get_full_message_history, _build_adk_content_from_history
from .agent_runner import _run_adk_agent, _run_vertex_agent, _run_a2a_agent


async def _execute_agent_run(chat_id: str, assistant_message_id: str, agent_id: str | None, model_id: str | None, adk_user_id: str):
    """The core logic that runs in the background task, now acting as an orchestrator."""
    logger.info(f"Starting execution for message {assistant_message_id} in chat {chat_id}.")
    messages_ref = db.collection("chats").document(chat_id).collection("messages")
    assistant_message_ref = messages_ref.document(assistant_message_id)
    events_collection_ref = assistant_message_ref.collection("events")

    assistant_message = assistant_message_ref.get().to_dict()
    if not assistant_message: raise ValueError(f"Assistant message {assistant_message_id} not found.")

    parent_id = assistant_message.get("parentMessageId")
    history = await get_full_message_history(chat_id, parent_id)
    adk_content, char_count = await _build_adk_content_from_history(history)
    assistant_message_ref.update({"inputCharacterCount": char_count})

    participant_ref = db.collection("agents").document(agent_id) if agent_id else db.collection("models").document(model_id)
    participant_config = participant_ref.get().to_dict()
    if not participant_config: raise ValueError(f"Participant config not found for ID: {agent_id or model_id}")

    agent_platform = participant_config.get("platform")

    if agent_id and agent_platform == 'a2a':
        return await _run_a2a_agent(participant_config, adk_content, events_collection_ref)

    if agent_id and agent_platform == 'google_vertex':
        resource_name = participant_config.get("vertexAiResourceName")
        if not resource_name or participant_config.get("deploymentStatus") != "deployed":
            raise ValueError(f"Agent {agent_id} is not successfully deployed.")
        return await _run_vertex_agent(resource_name, adk_content, adk_user_id, events_collection_ref)

    if model_id:
        model_agent_config = {"name": f"model_run_{model_id[:6]}", "agentType": "Agent", "modelId": model_id, "tools": []}
        local_adk_agent = await instantiate_adk_agent_from_config(model_agent_config)
        return await _run_adk_agent(local_adk_agent, adk_content, adk_user_id, events_collection_ref)

    return {"finalParts": [], "errorDetails": [f"No valid execution path for agentId: {agent_id}, modelId: {model_id}"]}


async def _run_agent_task_logic(data: dict):
    """Async logic for the task, with error handling."""
    chat_id, assistant_message_id = data.get("chatId"), data.get("assistantMessageId")
    assistant_message_ref = db.collection("chats").document(chat_id).collection("messages").document(assistant_message_id)
    try:
        assistant_message_ref.update({"status": "running"})
        result = await _execute_agent_run(
            chat_id=chat_id, assistant_message_id=assistant_message_id,
            agent_id=data.get("agentId"), model_id=data.get("modelId"),
            adk_user_id=data.get("adkUserId")
        )
        final_update = {
            "parts": result.get("finalParts", []),
            "status": "error" if result.get("errorDetails") else "completed",
            "errorDetails": result.get("errorDetails"),
            "completedTimestamp": firestore.SERVER_TIMESTAMP
        }
        assistant_message_ref.update(final_update)
        logger.info(f"Message {assistant_message_id} completed with status: {final_update['status']}")
    except Exception as e:
        error_msg = f"Task handler exception for message {assistant_message_id}: {type(e).__name__} - {e}"
        logger.error(f"{error_msg}\n{traceback.format_exc()}")
        assistant_message_ref.update({
            "status": "error", "errorDetails": firestore.ArrayUnion([error_msg]),
            "completedTimestamp": firestore.SERVER_TIMESTAMP
        })

def run_agent_task_wrapper(data: dict):
    """Synchronous wrapper to be called by the Cloud Task entry point."""
    asyncio.run(_run_agent_task_logic(data))