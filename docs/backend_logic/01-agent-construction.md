# Agent Construction Pipeline

The `functions/common/agents` package is a dedicated set of modules responsible for a single, critical task: **translating a JSON-like agent configuration from Firestore into a fully initialized and runnable `google.adk` agent object.**

This process is complex, involving the configuration of LLMs, the instantiation of various tools, and the recursive assembly of composite agents (e.g., `SequentialAgent`). The new architecture breaks this complexity into a clear, delegated pipeline.

The main entry point is `instantiate_adk_agent_from_config` located in `agent_builder.py`.

```python
# A simplified view of the top-level function
async def instantiate_adk_agent_from_config(agent_config, ...):
    # ... logic to determine agent type (LlmAgent, SequentialAgent, etc.)

    if is_an_llm_agent:
        # Fetch the model config from Firestore and merge it
        merged_config = {**model_config, **agent_config}

        # Delegate all complex work to a helper
        agent_kwargs = await _prepare_llm_agent_kwargs(merged_config, ...)
        return Agent(**agent_kwargs)

    if is_a_sequential_agent:
        # Recursively call this function for all child agents
        child_agents = [
            await instantiate_adk_agent_from_config(child_config, ...)
            for child_config in agent_config.get("childAgents")
        ]
        return SequentialAgent(sub_agents=child_agents, ...)
```

The key to this design is the `_prepare_llm_agent_kwargs` helper, which delegates its responsibilities to even more specialized modules.

## The LlmAgent Preparation Pipeline

When building a basic `Agent` (which is an `LlmAgent`), the `_prepare_llm_agent_kwargs` function coordinates the work between the tool factory and the LLM configurator.

```python
# inside agent_builder.py
async def _prepare_llm_agent_kwargs(merged_config, adk_agent_name, ...):
    """
    Prepares the keyword arguments for an LlmAgent by delegating.
    """
    # 1. Delegate tool preparation to the tool_factory module
    instantiated_tools = await prepare_tools_from_config(merged_config, adk_agent_name)

    # 2. Delegate LLM and generation config to the llm_config module
    llm_instance, generation_config = await prepare_llm_and_generation_config(merged_config, adk_agent_name)

    # 3. Assemble the final arguments
    return {
        "name": adk_agent_name,
        "model": llm_instance,
        "tools": instantiated_tools,
        "generate_content_config": generation_config,
        # ... other simple properties
    }
```

### 1. Tool Factory (`tool_factory.py`)

This module is solely responsible for creating runnable tool objects from the agent configuration.

*   **`prepare_tools_from_config`**: The main function that iterates over the `tools` array in the agent config.
*   **MCP Tools**: It groups all MCP tools by their server URL and authentication details, then creates `MCPToolset` instances for each group. This is efficient as it establishes only one connection per server.
*   **Custom Tools**: For tools of type `custom_repo`, it dynamically imports the specified Python module and instantiates the class, passing in any instance-specific configuration.

### 2. LLM Configuration (`llm_config.py`)

This module handles the complex logic of configuring the specific Large Language Model that will power the agent.

*   **`prepare_llm_and_generation_config`**: The main function.
*   **Provider Logic**: It contains the large `BACKEND_LITELLM_PROVIDER_CONFIG` dictionary that maps our internal provider IDs (e.g., "openai", "azure", "bedrock") to the specific prefixes and environment variables required by LiteLLM.
*   **API Key Resolution**: It correctly resolves API keys, giving precedence to user-provided overrides before falling back to environment variables.
*   **Model Parameters**: It parses the `parameters` field (e.g., `temperature`, `maxOutputTokens`, `topP`) and constructs a `genai_types.GenerateContentConfig` object, which is the ADK-native way to specify model generation settings.