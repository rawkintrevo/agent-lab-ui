# functions/common/adk_helpers.py
import re
from .core import logger, db
from google.adk.artifacts import GcsArtifactService
from .config import get_gcp_project_config


def generate_vertex_deployment_display_name(agent_config_name: str, agent_doc_id: str) -> str:
    base_name = agent_config_name or f"adk-agent-{agent_doc_id}"
    # Vertex AI display names must be 4-63 chars, start with letter, contain only lowercase letters, numbers, hyphens.
    sanitized_base = re.sub(r'[^a-z0-9-]+', '-', base_name.lower()).strip('-')
    if not sanitized_base: # If name was all invalid chars
        sanitized_base = f"agent-{agent_doc_id[:8]}" # Fallback using doc ID part

    # Ensure starts with a letter
    if not sanitized_base[0].isalpha():
        # Vertex display names must start with a letter.
        # Max length is 63. If prepending 'a-' makes it too long, truncate from the end of core_name.
        core_name = sanitized_base[:59] # Max 59 to allow for 'a-' prefix and ensure it's not too long
        deployment_display_name = f"a-{core_name}"
    else:
        deployment_display_name = sanitized_base
        # Ensure final length is within 63 characters
    deployment_display_name = deployment_display_name[:63]
    while len(deployment_display_name) < 4 and len(deployment_display_name) < 63 : # Check max length again here
        deployment_display_name += "x" # Pad if too short

    return deployment_display_name.strip('-')[:63] # Final strip and length check

async def get_model_config_from_firestore(model_id: str) -> dict:
    """Fetches a model configuration document from Firestore."""
    if not model_id:
        raise ValueError("model_id cannot be empty.")
    try:
        model_ref = db.collection("models").document(model_id)
        model_doc = model_ref.get()
        if not model_doc.exists:
            raise ValueError(f"Model with ID '{model_id}' not found in Firestore.")
        return model_doc.to_dict()
    except Exception as e:
        logger.error(f"Error fetching model config for ID '{model_id}' from Firestore: {e}")
        # Re-raise as a ValueError to be handled by the calling function
        raise ValueError(f"Could not fetch model configuration for ID '{model_id}'.")


async def get_adk_artifact_service() -> GcsArtifactService:
    """
    Initializes and returns a GCSArtifactService instance.
    This can be shared across different runs within the same function invocation.
    """
    try:
        project_id, _, _ = get_gcp_project_config()
        # Bucket for ADK artifacts, separate from context uploads
        bucket_name = f"{project_id}-adk-artifacts"
        # The GcsArtifactService might create the bucket if it doesn't exist,
        # but it's better to ensure it exists with correct permissions.
        # For now, we assume it will be created or exists.
        return GcsArtifactService(bucket_name=bucket_name)
    except Exception as e:
        logger.error(f"Failed to initialize GCSArtifactService: {e}")
        # Depending on requirements, could fallback to InMemoryArtifactService or raise
        raise ValueError("Could not create GCS Artifact Service for ADK.")

__all__ = [
    'generate_vertex_deployment_display_name',
    'get_adk_artifact_service',
    'get_model_config_from_firestore',
]