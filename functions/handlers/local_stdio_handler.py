# functions/handlers/local_stdio_handler.py
import asyncio
import traceback
import shlex  # For safely parsing arguments

from firebase_functions import https_fn
from mcp.client.session import ClientSession
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioServerParameters

from common.core import logger

async def _list_local_stdio_server_tools_logic_async(req: https_fn.CallableRequest):
    """
    Handles listing tools from an MCP server spawned locally via stdio.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication is required to list local MCP server tools."
        )

    stdio_config = req.data.get("stdioConfig")
    if not stdio_config or not isinstance(stdio_config, dict):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="'stdioConfig' object is required."
        )

    command = stdio_config.get("command")
    args_str = stdio_config.get("args", "")  # Expecting a single string of arguments
    env_vars = stdio_config.get("env")  # Expecting a dict of {KEY: VALUE}

    if not command:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="A 'command' is required in stdioConfig."
        )

    try:
        # Use shlex to safely split the arguments string
        args_list = shlex.split(args_str)
    except ValueError as e:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=f"Invalid arguments format: {e}"
        )

    log_command_str = f"{command} {' '.join(args_list)}"
    logger.info(f"Attempting to list tools from local stdio server with command: '{log_command_str}'")

    try:
        # Create StdioServerParameters with the parsed command and arguments
        # The ADK will handle spawning the process.
        connection_params = StdioServerParameters(
            command=command,
            args=args_list,
            env=env_vars if isinstance(env_vars, dict) else None
        )

        # Use MCPToolset to connect and list tools
        toolset = MCPToolset(connection_params=connection_params,
                            errlog=None)

        # MCPToolset's initialization logic handles the connection and tool listing.
        # We need to access the underlying client to perform the list operation.
        # This part might need adjustment based on the ADK/MCP library's public API.
        # Assuming an async initialization or a method to get tools.

        mcp_server_tools = await toolset.get_tools()

        logger.info(f"Retrieved {len(mcp_server_tools.tools)} tools from local stdio server.")

        tools_for_client = [{
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.inputSchema
        } for tool in mcp_server_tools.tools]

        return {"success": True, "tools": tools_for_client}

    except FileNotFoundError:
        logger.error(f"Command not found for local stdio server: '{command}'")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message=f"The command '{command}' was not found in the function's environment."
        )
    except asyncio.TimeoutError:
        logger.error(f"Timeout connecting to local stdio server for command: '{log_command_str}'")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.DEADLINE_EXCEEDED,
            message="The local process started but did not respond in time."
        )
    except Exception as e:
        logger.error(f"Error listing tools from local stdio server '{log_command_str}': {e}\n{traceback.format_exc()}", exc_info=True)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"An unexpected error occurred while running the local tool server: {str(e)[:200]}"
        )

__all__ = ['_list_local_stdio_server_tools_logic_async']