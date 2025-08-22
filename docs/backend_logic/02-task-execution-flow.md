# Asynchronous Agent & Model Execution

Once a query is dispatched to Cloud Tasks, the `executeAgentRunTask` function takes over. The logic for this background job lives in the `/functions/handlers/vertex/task/` package. Its primary role is to orchestrate the entire process of running an agent and recording the result.

The main orchestrator is the `_execute_agent_run` function in `task/__init__.py`.

### The Orchestration Flow

This function follows a clear, sequential set of steps to process a request:

```python
# A high-level view of the orchestrator in task/__init__.py
async def _execute_agent_run(chat_id, assistant_message_id, agent_id, model_id, adk_user_id):
    # 1. Get the placeholder message from Firestore to find its parent
    assistant_message = get_assistant_message_from_firestore(...)
    parent_id = assistant_message.get("parentMessageId")

    # 2. DELEGATE: Build the full conversation history and prompt
    history = await get_full_message_history(chat_id, parent_id)
    adk_content, char_count = await _build_adk_content_from_history(history)

    # 3. Get the configuration for the agent or model being run
    participant_config = get_participant_config_from_firestore(...)

    # 4. Determine which runner to use based on the config
    agent_platform = participant_config.get("platform")

    # 5. DELEGATE: Execute the agent and get the final result
    if agent_platform == 'a2a':
        return await _run_a2a_agent(...)
    if agent_platform == 'google_vertex':
        return await _run_vertex_agent(...)
    if model_id: # This is a direct model run
        local_agent = await instantiate_adk_agent_from_config(...)
        return await _run_adk_agent(local_agent, ...)

    # 6. The result is returned to the main task handler, which updates Firestore
```

This orchestrator delegates the two most complex parts of its job to specialized modules.

### Step 1: Building the Prompt (`history_builder.py`)

Before an agent can be run, its input must be constructed. This module is responsible for preparing the full context and prompt.

*   **`get_full_message_history`**: This function starts from the parent of our current agent message and walks up the conversation tree by following the `parentMessageId` of each message. It fetches all messages from Firestore in a single batch and reconstructs the chronological history in memory.
*   **`_build_adk_content_from_history`**: This is the "prompt engineering" function. It takes the list of historical messages and converts them into a single `google.genai.types.Content` object, which is the standard input format for an ADK agent. It handles:
    *   Combining text parts from a single message.
    *   Prefixing text with the role (`user:` or `model:`) to maintain turn structure.
    *   Downloading images and text files from Google Cloud Storage URIs found in `file_data` parts and including their raw bytes/content in the final prompt.

### Step 2: Running the Agent (`agent_runner.py`)

This module contains the logic for actually executing the agent, collecting its output, and logging all intermediate steps. It implements a generic pattern to handle different types of agents consistently.

For a detailed breakdown of this module, see [The Generic Agent Runner](./03-agent-runners.md).