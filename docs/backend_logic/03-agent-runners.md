# The Generic Agent Runner

The `functions/handlers/vertex/task/agent_runner.py` module was created to solve a key problem in the old codebase: the logic for running an agent, collecting its events, and finding the final result was duplicated for local ADK agents and deployed Vertex agents. This module introduces a generic, reusable pattern to handle this flow.

### The Core Abstraction: `_run_agent_and_collect_events`

This function is the heart of the new design. It is a higher-order async function that takes an agent's execution coroutine as input and handles the entire event collection and storage process.

```python
# The generic runner in agent_runner.py
async def _run_agent_and_collect_events(agent_run_coroutine, events_collection_ref):
    """
    Executes an agent coroutine, collects all events, and stores them in Firestore.
    """
    all_events, errors = [], []
    try:
        # This loop works for any async generator that yields events
        async for event_obj in agent_run_coroutine:
            all_events.append(event_obj.model_dump())
    except Exception as e_run:
        errors.append(f"Agent run failed: {str(e_run)}")

    # After the run, write all collected events to Firestore in one batch
    if all_events:
        batch = db.batch()
        for index, event_dict in enumerate(all_events):
            # ... (add metadata and write to batch)
        batch.commit()

    return all_events, errors
```

### Finding the Final Result

After all events are collected, the `_find_final_response_from_events` helper function is used to determine the agent's ultimate answer. It searches backwards through the event list for the **last complete model response that is not a function call**. This ensures we get the final textual answer intended for the user, ignoring any intermediate tool-use steps.

### Concrete Implementations

The specific runner functions (`_run_adk_agent`, `_run_vertex_agent`) are now extremely simple wrappers that use this generic pattern.

#### Local ADK Agent Runner
This is used for direct model-only runs. It sets up an in-memory ADK `Runner`, creates the execution coroutine, and passes it to the generic handler.

```python
# in agent_runner.py
async def _run_adk_agent(local_adk_agent, adk_content_for_run, ...):
    # 1. Set up the ADK Runner with in-memory services
    runner = Runner(agent=local_adk_agent, ...)
    session = await runner.session_service.create_session(...)

    # 2. Create the coroutine for the agent run
    run_coro = runner.run_async(session_id=session.id, new_message=adk_content_for_run, ...)

    # 3. Pass the coroutine to the generic handler
    all_events, errors = await _run_agent_and_collect_events(run_coro, events_collection_ref)

    # 4. Find the final answer from the collected events
    final_parts = _find_final_response_from_events(all_events)
    return {"finalParts": final_parts, "errorDetails": errors}
```

#### Deployed Vertex Agent Runner
The flow is nearly identical, demonstrating the power of the abstraction. The only difference is how the coroutine is created.

```python
# in agent_runner.py
async def _run_vertex_agent(resource_name, adk_content_for_run, ...):
    # 1. Get the remote agent object
    remote_app = agent_engines.get(resource_name)

    # 2. Create the coroutine for the agent run
    run_coro = remote_app.stream_query(message=..., user_id=...)

    # 3. Pass the coroutine to the generic handler
    all_events, errors = await _run_agent_and_collect_events(run_coro, events_collection_ref)

    # 4. Find the final answer from the collected events
    final_parts = _find_final_response_from_events(all_events)
    return {"finalParts": final_parts, "errorDetails": errors}
```

This architecture ensures that any future stream-based agent execution can be integrated with minimal effort by simply creating a new wrapper that provides the appropriate coroutine to the generic `_run_agent_and_collect_events` function.