# Backend Logic Overview

This document provides a high-level overview of the refactored backend architecture. The primary goal of this refactoring was to improve the codebase by adhering to key software design principles:

*   **High Cohesion & Low Coupling**: Modules now have a single, well-defined responsibility. For example, logic for building agents is now separate from logic that runs them.
*   **Don't Repeat Yourself (DRY)**: Duplicated patterns, especially in how different types of agents were executed and logged, have been abstracted into a single, reusable function.
*   **Readability & Maintainability**: By breaking down large, complex functions and files into smaller, more focused units, the code is easier to understand, debug, and extend.

## High-Level Execution Flow

The journey of a user's query is broken into two main phases: an immediate dispatch phase and a background execution phase, managed by Cloud Tasks.

1.  **Dispatch (Synchronous)**: The `executeQuery` Cloud Function acts as a fast, lightweight dispatcher.
    *   It validates the incoming request.
    *   It creates placeholder messages in Firestore for the user's query and the agent's upcoming response.
    *   It enqueues a job in **Cloud Tasks** with all the necessary context (chat ID, message ID, agent ID).
    *   It returns an immediate response to the client with the ID of the placeholder message, allowing the UI to update instantly.

2.  **Execution (Asynchronous)**: The `executeAgentRunTask` Cloud Task handler performs the heavy lifting in the background.
    *   It receives the job from the task queue.
    *   It uses the `history_builder` to fetch the complete conversation history from Firestore and construct a prompt.
    *   It uses the `agent_runner` to execute the appropriate agent (A2A, Deployed Vertex AI, or an API-based Model).
    *   During the run, all events are streamed to a sub-collection in Firestore for real-time debugging and logging.
    *   Once the run is complete, it updates the placeholder message with the final response and status.

## Key Architectural Components

The refactored logic is primarily organized into two new, focused packages:

*   **Agent Construction (`/functions/common/agents`)**: This package is responsible for taking a configuration from Firestore and translating it into a fully instantiated, runnable ADK Agent object. It handles everything from setting up the correct LLM provider to instantiating complex toolsets.
    *   [See Details: Agent Construction Pipeline](./01-agent-construction.md)

*   **Task Execution (`/functions/handlers/vertex/task`)**: This package contains all the logic for the asynchronous background task. It is responsible for preparing the agent's input and managing its execution.
    *   [See Details: Asynchronous Agent & Model Execution](./02-task-execution-flow.md)
    *   [See Details: The Generic Agent Runner](./03-agent-runners.md)