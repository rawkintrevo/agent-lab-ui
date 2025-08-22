# functions/common/agents/agent_builder.py
import re
import os
import traceback
from google.adk.agents import Agent, SequentialAgent, LoopAgent, ParallelAgent # LlmAgent is aliased as Agent
from google.genai import types as genai_types

from .llm_config import prepare_llm_and_generation_config
from .tool_factory import prepare_tools_from_config
from ..core import logger
from ..adk_helpers import get_model_config_from_firestore

async def _prepare_llm_agent_kwargs(merged_config: dict, adk_agent_name: str, context_for_log: str = "") -> dict:
    """
    Prepares the keyword arguments for an LlmAgent by delegating to specialized helpers.
    This replaces the former monolithic `_prepare_agent_kwargs_from_config` function.
    """
    logger.info(f"Preparing kwargs for LlmAgent '{adk_agent_name}' {context_for_log}.")

    # 1. Delegate tool preparation
    instantiated_tools = await prepare_tools_from_config(merged_config, adk_agent_name)

    # 2. Delegate LLM and generation config preparation
    actual_model_for_adk, generate_content_config = await prepare_llm_and_generation_config(
        merged_config, adk_agent_name, context_for_log
    )

    # 3. Assemble the final kwargs
    agent_kwargs = {
        "name": adk_agent_name,
        "description": merged_config.get("description"),
        "model": actual_model_for_adk,
        "instruction": merged_config.get("systemInstruction"),
        "tools": instantiated_tools,
        "output_key": merged_config.get("outputKey"),
    }

    if generate_content_config:
        agent_kwargs["generate_content_config"] = generate_content_config

    return {k: v for k, v in agent_kwargs.items() if v is not None}


def sanitize_adk_agent_name(name_str: str, prefix_if_needed: str = "agent_") -> str:
    # ADK agent names should be valid Python identifiers.
    # Replace non-alphanumeric (excluding underscore) with underscore
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', name_str)
    # Remove leading/trailing underscores that might result from replacement
    sanitized = sanitized.strip('_')
    # If starts with a digit, prepend an underscore (or prefix_if_needed if that's more robust)
    if sanitized and sanitized[0].isdigit():
        sanitized = f"_{sanitized}" # Python ids can start with _

    # If empty after sanitization or still doesn't start with letter/_ , use prefix
    if not sanitized or not (sanitized[0].isalpha() or sanitized[0] == '_'):
        # Fallback to a more generic construction if initial sanitization fails badly
        temp_name = re.sub(r'[^a-zA-Z0-9_]', '_', name_str) # Re-sanitize original
        sanitized = f"{prefix_if_needed.strip('_')}_{temp_name.strip('_')}"
        sanitized = re.sub(r'_+', '_', sanitized).strip('_') # Consolidate multiple underscores

    if not sanitized: # Ultimate fallback if all else fails
        sanitized = f"{prefix_if_needed.strip('_')}_default_agent_name"

        # Ensure it's a valid Python identifier (simple check, not exhaustive)
    # Python identifiers: ^[a-zA-Z_][a-zA-Z0-9_]*$
    # Max length (e.g. Vertex display names often have limits like 63)
    sanitized = sanitized[:63] # Apply a practical length limit

    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", sanitized):
        # If it's *still* not valid (e.g., all underscores, or somehow bad), generate a safe name.
        logger.warn(f"Sanitized name '{sanitized}' from '{name_str}' is still not a valid Python identifier. Using a generic fallback.")
        generic_name = f"{prefix_if_needed.strip('_')}_{os.urandom(4).hex()}" # Random suffix for uniqueness
        return generic_name[:63] # Ensure length constraint

    return sanitized

async def instantiate_adk_agent_from_config(agent_config, parent_adk_name_for_context="root", child_index=0): # Made async
    original_agent_name = agent_config.get('name', f'agent_cfg_{child_index}')
    # Make ADK agent names more unique to avoid conflicts if multiple deployments happen
    # or if names are similar across different parts of a composite agent.
    unique_base_name_for_adk = f"{original_agent_name}_{parent_adk_name_for_context}_{os.urandom(2).hex()}"
    adk_agent_name = sanitize_adk_agent_name(unique_base_name_for_adk, prefix_if_needed=f"agent_{child_index}_")

    agent_type_str = agent_config.get("agentType")
    AgentClass = {
        "Agent": Agent, # This is LlmAgent
        "SequentialAgent": SequentialAgent,
        "LoopAgent": LoopAgent,
        "ParallelAgent": ParallelAgent
    }.get(agent_type_str)

    if not AgentClass:
        error_msg = f"Invalid agentType specified: '{agent_type_str}' for agent config: {original_agent_name}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    logger.info(f"Instantiating ADK Agent: Name='{adk_agent_name}', Type='{AgentClass.__name__}', Original Config Name='{original_agent_name}' (Context: parent='{parent_adk_name_for_context}', index={child_index})")

    if AgentClass in [Agent, LoopAgent]:
        model_id = agent_config.get("modelId")
        if not model_id:
            raise ValueError(f"Agent '{original_agent_name}' is of type {agent_type_str} but is missing required 'modelId'.")

        # Fetch the model configuration from Firestore
        model_config = await get_model_config_from_firestore(model_id)

        # Merge agent-specific properties (like tools, outputKey) with the model's properties.
        # Agent properties take precedence.
        merged_config = {**model_config, **agent_config}

        if AgentClass == Agent:
            agent_kwargs = await _prepare_llm_agent_kwargs(
                merged_config,
                adk_agent_name,
                context_for_log=f"(type: LlmAgent, parent: {parent_adk_name_for_context}, original: {original_agent_name})"
            )
            tool_count = len(agent_kwargs.get("tools", []))
            logger.info(f"Final kwargs for LlmAgent '{adk_agent_name}' includes {tool_count} tools")

            try:
                return Agent(**agent_kwargs)
            except Exception as e_agent_init:
                logger.error(f"Initialization Error for LlmAgent '{adk_agent_name}' (from config '{original_agent_name}'): {e_agent_init}")
                logger.error(f"Args passed: {agent_kwargs}") # Log the arguments that caused the error
                detailed_traceback = traceback.format_exc()
                logger.error(f"Traceback:\n{detailed_traceback}")
                raise ValueError(f"Failed to instantiate LlmAgent '{original_agent_name}': {e_agent_init}.")

        elif AgentClass == LoopAgent:
            looped_agent_config_name = f"{original_agent_name}_looped_child_config" # For logging
            looped_agent_adk_name = sanitize_adk_agent_name(f"{adk_agent_name}_looped_child_instance", prefix_if_needed="looped_")

            looped_agent_kwargs = await _prepare_llm_agent_kwargs(
                merged_config,
                looped_agent_adk_name,
                context_for_log=f"(looped child of LoopAgent '{adk_agent_name}', original config: '{looped_agent_config_name}')"
            )
            logger.debug(f"Final kwargs for Looped Child ADK Agent '{looped_agent_adk_name}' (for LoopAgent '{adk_agent_name}'): {looped_agent_kwargs}")
            try:
                looped_child_agent_instance = Agent(**looped_agent_kwargs) # Agent is LlmAgent
            except Exception as e_loop_child_init:
                logger.error(f"Initialization Error for Looped Child Agent '{looped_agent_adk_name}' (from config '{looped_agent_config_name}'): {e_loop_child_init}")
                logger.error(f"Args passed to looped child Agent constructor: {looped_agent_kwargs}")
                detailed_traceback = traceback.format_exc()
                logger.error(f"Traceback:\n{detailed_traceback}")
                raise ValueError(f"Failed to instantiate looped child agent for '{original_agent_name}': {e_loop_child_init}.")

            max_iterations_str = agent_config.get("maxLoops", "3")  # Using maxLoops as config key, rename to max_iterations internally
            try:
                max_iterations = int(max_iterations_str)
                if max_iterations <= 0:  # Must be positive
                    logger.warning(f"maxLoops for LoopAgent '{adk_agent_name}' is {max_iterations}, which is not positive. Defaulting to 3.")
                    max_iterations = 3
            except ValueError:
                logger.warning(f"Invalid maxLoops value '{max_iterations_str}' for LoopAgent '{adk_agent_name}'. Defaulting to 3.")
                max_iterations = 3

            loop_agent_kwargs = {
                "name": adk_agent_name,
                "description": agent_config.get("description"),
                "sub_agents": [looped_child_agent_instance],  # Pass as list
                "max_iterations": max_iterations,              # Correct parameter name
            }
            logger.debug(f"Final kwargs for LoopAgent '{adk_agent_name}': {{name, description, max_iterations, sub_agents count: {len(loop_agent_kwargs['sub_agents'])}}}")
            return LoopAgent(**loop_agent_kwargs)

    elif AgentClass == SequentialAgent or AgentClass == ParallelAgent:
        child_agent_configs = agent_config.get("childAgents", [])
        if not child_agent_configs:
            logger.info(f"{AgentClass.__name__} '{original_agent_name}' has no child agents configured.")
            instantiated_child_agents = []
        else:
            instantiated_child_agents = []
            for idx, child_config in enumerate(child_agent_configs):
                try:
                    child_agent_instance = await instantiate_adk_agent_from_config( # Await the recursive async call
                        child_config,
                        parent_adk_name_for_context=adk_agent_name, # Pass current agent's ADK name as context
                        child_index=idx
                    )
                    instantiated_child_agents.append(child_agent_instance)
                except Exception as e_child:
                    logger.error(f"Failed to instantiate child agent at index {idx} for {AgentClass.__name__} '{original_agent_name}': {e_child}")
                    # Potentially re-raise or handle to allow partial construction if desired
                    raise ValueError(f"Error processing child agent for '{original_agent_name}': {e_child}")

        orchestrator_kwargs = {
            "name": adk_agent_name,
            "description": agent_config.get("description"),
            "sub_agents": instantiated_child_agents
        }
        logger.debug(f"Final kwargs for {AgentClass.__name__} '{adk_agent_name}': {{name, description, num_sub_agents: {len(instantiated_child_agents)}}}")
        return AgentClass(**orchestrator_kwargs)

    else:
        # This case should be caught by the AgentClass check at the beginning
        raise ValueError(f"Unhandled agent type '{agent_type_str}' during recursive instantiation for '{original_agent_name}'.")