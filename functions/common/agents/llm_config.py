# functions/common/agents/llm_config.py
import os
from google.adk.models.lite_llm import LiteLlm
from google.genai import types as genai_types
from ..core import logger

BACKEND_LITELLM_PROVIDER_CONFIG = {
    "openai": {"prefix": "openai", "apiKeyEnv": "OPENAI_API_KEY"},
    "openai_compatible": {"prefix": "openai", "apiKeyEnv": None}, # User provides key/base
    "google_ai_studio": {"prefix": "gemini", "apiKeyEnv": "GEMINI_API_KEY"},
    "anthropic": {"prefix": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY"},
    "bedrock": {"prefix": "bedrock", "apiKeyEnv": "AWS_ACCESS_KEY_ID"}, # Needs others like SECRET, REGION
    "meta_llama": {"prefix": "meta_llama", "apiKeyEnv": "LLAMA_API_KEY"},
    "mistral": {"prefix": "mistral", "apiKeyEnv": "MISTRAL_API_KEY"},
    "watsonx": {"prefix": "watsonx", "apiKeyEnv": "WATSONX_APIKEY"}, # Needs WATSONX_URL, WATSONX_PROJECT_ID
    "deepseek": {"prefix": "deepseek", "apiKeyEnv": "DEEPSEEK_API_KEY"},
    "deepinfra": {"prefix": "deepinfra", "apiKeyEnv": "DEEPINFRA_API_KEY"},
    "replicate": {"prefix": "replicate", "apiKeyEnv": "REPLICATE_API_KEY"},
    "together_ai": {"prefix": "together_ai", "apiKeyEnv": "TOGETHER_AI_API_KEY"},
    "azure": {"prefix": "azure", "apiKeyEnv": "AZURE_API_KEY"}, # Needs AZURE_API_BASE, AZURE_API_VERSION
    "custom": {"prefix": None, "apiKeyEnv": None} # No prefix, user provides full string
}

async def prepare_llm_and_generation_config(merged_agent_and_model_config: dict, adk_agent_name: str, context_for_log: str = "") -> tuple[LiteLlm, genai_types.GenerateContentConfig | None]:
    """
    Prepares the LiteLlm model instance and the GenerateContentConfig from the merged configuration.
    """
    # --- Part 1: Prepare LiteLlm instance ---
    selected_provider_id = merged_agent_and_model_config.get("provider")
    base_model_name_from_config = merged_agent_and_model_config.get("modelString")
    user_api_base_override = merged_agent_and_model_config.get("litellm_api_base")
    user_api_key_override = merged_agent_and_model_config.get("litellm_api_key")

    if not selected_provider_id:
        logger.error(f"Missing 'provider' in model config for agent '{merged_agent_and_model_config.get('name', 'N/A')}' {context_for_log}.")
        raise ValueError("Model config is missing 'provider' field.")

    if not base_model_name_from_config:
        logger.warn(f"Missing 'modelString' for provider '{selected_provider_id}'. This may lead to errors.")

    provider_backend_config = BACKEND_LITELLM_PROVIDER_CONFIG.get(selected_provider_id)
    if not provider_backend_config:
        logger.error(f"Invalid 'provider': {selected_provider_id}. Cannot determine LiteLLM prefix or API key for agent '{adk_agent_name}'.")
        raise ValueError(f"Invalid provider ID: {selected_provider_id}")

    final_model_str_for_litellm = base_model_name_from_config
    if provider_backend_config["prefix"]:
        if selected_provider_id == "azure":
            if not base_model_name_from_config.startswith("azure/"): # LiteLLM expects "azure/your-deployment-name"
                final_model_str_for_litellm = f"azure/{base_model_name_from_config}"
        elif not base_model_name_from_config.startswith(provider_backend_config["prefix"] + "/"):
            final_model_str_for_litellm = f"{provider_backend_config['prefix']}/{base_model_name_from_config}"

    final_api_base = user_api_base_override
    final_api_key = user_api_key_override
    if not final_api_key and provider_backend_config["apiKeyEnv"]:
        final_api_key = os.getenv(provider_backend_config["apiKeyEnv"])
        if not final_api_key and provider_backend_config["apiKeyEnv"] not in ["AWS_ACCESS_KEY_ID", "WATSONX_APIKEY"]: # These have complex auth beyond just one key
            logger.warn(f"API key env var '{provider_backend_config['apiKeyEnv']}' for provider '{selected_provider_id}' not set, and no override provided. LiteLLM may fail if key is required by the provider or its default configuration.")

    if selected_provider_id == "azure":
        if not os.getenv("AZURE_API_BASE") and not final_api_base: # AZURE_API_BASE is critical for Azure
            logger.error("Azure provider selected, but AZURE_API_BASE is not set in environment and no API Base override provided. LiteLLM will likely fail.")
        if not os.getenv("AZURE_API_VERSION"): # AZURE_API_VERSION is also usually required
            logger.warn("Azure provider selected, but AZURE_API_VERSION is not set in environment. LiteLLM may require it.")

    if selected_provider_id == "watsonx":
        if not os.getenv("WATSONX_URL") and not final_api_base:
            logger.error("WatsonX provider: WATSONX_URL env var not set and not overridden by user. LiteLLM will likely fail.")
        if not os.getenv("WATSONX_PROJECT_ID") and not merged_agent_and_model_config.get("project_id"): # project_id can be in config or env
            logger.warn("WatsonX provider: WATSONX_PROJECT_ID env var not set and no project_id in agent_config. LiteLLM may require it.")

    logger.info(f"Configuring LiteLlm for agent '{adk_agent_name}' (Provider: {selected_provider_id}): "
                f"Model='{final_model_str_for_litellm}', API Base='{final_api_base or 'Default/Env'}', KeyIsSet={(not not final_api_key) or (selected_provider_id in ['bedrock', 'watsonx'])}")

    model_constructor_kwargs = {"model": final_model_str_for_litellm}
    if final_api_base:
        model_constructor_kwargs["api_base"] = final_api_base
    if final_api_key:
        model_constructor_kwargs["api_key"] = final_api_key

    # Specific handling for WatsonX project_id and space_id
    if selected_provider_id == "watsonx":
        project_id_for_watsonx = merged_agent_and_model_config.get("project_id") or os.getenv("WATSONX_PROJECT_ID")
        if project_id_for_watsonx:
            model_constructor_kwargs["project_id"] = project_id_for_watsonx
        else:
            # project_id is often required by LiteLLM for watsonx
            logger.warn(f"WatsonX project_id not found for agent {adk_agent_name}. This might be required by LiteLLM.")
        # space_id for watsonx deployments
        if base_model_name_from_config and base_model_name_from_config.startswith("deployment/"): # Heuristic for deployment models
            space_id_for_watsonx = merged_agent_and_model_config.get("space_id") or os.getenv("WATSONX_DEPLOYMENT_SPACE_ID")
            if space_id_for_watsonx:
                model_constructor_kwargs["space_id"] = space_id_for_watsonx
            else:
                logger.warn(f"WatsonX deployment model used for {adk_agent_name} but space_id not found. Deployment may fail or use default space.")

    actual_model_for_adk = LiteLlm(**model_constructor_kwargs)

    # --- Part 2: Prepare GenerateContentConfig ---
    model_params = merged_agent_and_model_config
    generate_config_kwargs = {}
    parameters_field = merged_agent_and_model_config.get("parameters", {})

    def flatten_parameters(params, prefix=''):
        flat = {}
        for k, v in params.items():
            if isinstance(v, dict) and any(isinstance(subv, dict) for subv in v.values()):
                nested_flat = flatten_parameters(v, prefix=prefix + k + '.')
                flat.update(nested_flat)
            else:
                flat[prefix + k] = v
        return flat

    flat_params = flatten_parameters(parameters_field)

    if "temperature" in flat_params:
        try: generate_config_kwargs["temperature"] = float(flat_params["temperature"])
        except (ValueError, TypeError): logger.warn(f"Invalid temperature: {flat_params['temperature']}")
    if "maxOutputTokens" in flat_params:
        try: generate_config_kwargs["max_output_tokens"] = int(flat_params["maxOutputTokens"])
        except (ValueError, TypeError): logger.warn(f"Invalid maxOutputTokens: {flat_params['maxOutputTokens']}")
    if "topP" in flat_params:
        try: generate_config_kwargs["top_p"] = float(flat_params["topP"])
        except (ValueError, TypeError): logger.warn(f"Invalid topP: {flat_params['topP']}")
    if "topK" in flat_params:
        try: generate_config_kwargs["top_k"] = int(flat_params["topK"])
        except (ValueError, TypeError): logger.warn(f"Invalid topK: {flat_params['topK']}")
    if "stopSequences" in model_params and isinstance(model_params["stopSequences"], list):
        generate_config_kwargs["stop_sequences"] = [str(seq) for seq in model_params["stopSequences"]]

    generate_content_config = None
    if generate_config_kwargs:
        logger.info(f"Agent '{adk_agent_name}' has model generation parameters: {generate_config_kwargs}")
        generate_content_config = genai_types.GenerateContentConfig(**generate_config_kwargs)

    return actual_model_for_adk, generate_content_config