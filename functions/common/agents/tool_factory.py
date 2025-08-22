# functions/common/agents/tool_factory.py
import importlib
import traceback
from fastapi.openapi.models import APIKey, APIKeyIn, HTTPBearer
from google.adk.auth.auth_schemes import AuthScheme
from google.adk.auth.auth_credential import AuthCredential, AuthCredentialTypes, HttpAuth, HttpCredentials
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams, SseServerParams
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from ..core import logger

def _create_mcp_auth_objects(auth_config: dict | None) -> tuple[AuthScheme | None, AuthCredential | None]:
    """
    Creates ADK AuthScheme and AuthCredential objects from a UI-provided auth dictionary.
    """
    if not auth_config:
        return None, None

    auth_type = auth_config.get("type")
    try:
        if auth_type == "bearer":
            token = auth_config.get("token")
            if not token:
                logger.warn("MCP Auth: Bearer token type specified but token is missing.")
                return None, None
            scheme = HTTPBearer()
            cred = AuthCredential(
                auth_type=AuthCredentialTypes.HTTP,
                http=HttpAuth(scheme="bearer", credentials=HttpCredentials(token=token))
            )
            logger.info("Created Bearer token AuthScheme and AuthCredential for MCP.")
            return scheme, cred
        elif auth_type == "apiKey":
            key, name, location = auth_config.get("key"), auth_config.get("name"), auth_config.get("in")
            if not all([key, name, location]):
                logger.warn("MCP Auth: API Key type specified but key, name, or location is missing.")
                return None, None
            if location != "header":
                logger.warn(f"MCP Auth: API Key location '{location}' is not supported. Only 'header' is supported.")
                return None, None
            scheme = APIKey(name=name, in_=APIKeyIn.header)
            cred = AuthCredential(auth_type=AuthCredentialTypes.API_KEY, api_key=key)
            logger.info(f"Created API Key AuthScheme (header: {name}) and AuthCredential for MCP.")
            return scheme, cred
        logger.warn(f"MCP Auth: Unsupported auth type '{auth_type}' received.")
        return None, None
    except Exception as e:
        logger.error(f"Error creating MCP auth objects for config {auth_config}: {e}")
        return None, None


def instantiate_tool(tool_config):
    logger.info(f"Attempting to instantiate Custom tool: {tool_config.get('id', 'N/A')}")
    if not isinstance(tool_config, dict):
        raise ValueError(f"Tool configuration must be a dictionary, got {type(tool_config)}")

    module_path, class_name, tool_type = tool_config.get("module_path"), tool_config.get("class_name"), tool_config.get("type")
    if tool_type != 'custom_repo':
        raise ValueError(f"instantiate_tool received unexpected tool type: {tool_type}. Expected 'custom_repo'.")

    if module_path and class_name:
        try:
            module = importlib.import_module(module_path)
            ToolClass = getattr(module, class_name)
            instance_specific_kwargs = tool_config.get('configuration', {})
            if instance_specific_kwargs:
                logger.info(f"Instantiating tool '{tool_config.get('id', class_name)}' with specific configuration keys: {list(instance_specific_kwargs.keys())}")
            else:
                logger.info(f"Instantiating tool '{tool_config.get('id', class_name)}' with no specific instance configuration.")

            instance = ToolClass(**instance_specific_kwargs)
            if hasattr(instance, 'export_to_adk') and callable(instance.export_to_adk):
                return instance.export_to_adk()
            else:
                return instance
        except Exception as e:
            tool_id_for_log = tool_config.get('id', class_name or 'N/A')
            if isinstance(e, (ImportError, ModuleNotFoundError)):
                logger.error(f"Error instantiating tool '{tool_id_for_log}': Could not import module '{module_path}'. Ensure this module is available in the Cloud Function's Python environment. Error: {e}\n{traceback.format_exc()}")
            else:
                logger.error(f"Error instantiating tool '{tool_id_for_log}': {e}\n{traceback.format_exc()}")
            raise ValueError(f"Error instantiating tool {tool_id_for_log}: {e}")
    else:
        raise ValueError(f"Unsupported or incomplete tool configuration for Custom tool ID '{tool_config.get('id', 'N/A')}' (type: {tool_type}). Missing module_path/class_name.")


async def prepare_tools_from_config(merged_agent_and_model_config: dict, adk_agent_name: str) -> list:
    """
    Parses the tool configuration and instantiates all specified tools (MCP, custom, etc.).
    """
    instantiated_tools = []
    mcp_tools_by_server_and_auth = {}
    user_defined_tools_config = merged_agent_and_model_config.get("tools", [])

    for tc_idx, tc in enumerate(user_defined_tools_config):
        tool_type = tc.get('type')
        if tool_type == 'mcp':
            server_url = tc.get('mcpServerUrl')
            tool_name_on_server = tc.get('mcpToolName')
            auth_config_from_ui = tc.get('auth')
            auth_key = frozenset(auth_config_from_ui.items()) if auth_config_from_ui else None
            dict_key = (server_url, auth_key)
            if server_url and tool_name_on_server:
                if dict_key not in mcp_tools_by_server_and_auth:
                    mcp_tools_by_server_and_auth[dict_key] = []
                mcp_tools_by_server_and_auth[dict_key].append(tool_name_on_server)
            else:
                logger.warn(f"Skipping MCP tool for agent '{adk_agent_name}' due to missing mcpServerUrl or mcpToolName: {tc}")
        elif tool_type == 'custom_repo':
            try:
                instantiated_tools.append(instantiate_tool(tc))
            except ValueError as e:
                logger.warn(f"Skipping tool for agent '{adk_agent_name}' due to error: {e}")
        else:
            logger.warn(f"Unknown or unhandled tool type '{tool_type}' for agent '{adk_agent_name}'.")

    for (server_url, auth_key), tool_names_filter in mcp_tools_by_server_and_auth.items():
        try:
            auth_config_dict = dict(auth_key) if auth_key else None
            auth_scheme, auth_credential = _create_mcp_auth_objects(auth_config_dict)
            conn_params = SseServerParams(url=server_url) if server_url.endswith("/sse") else StreamableHTTPConnectionParams(url=server_url)
            unique_tool_filter = list(set(tool_names_filter))
            toolset = MCPToolset(
                connection_params=conn_params, tool_filter=unique_tool_filter,
                auth_scheme=auth_scheme, auth_credential=auth_credential, errlog=None
            )
            instantiated_tools.append(toolset)
            logger.info(f"Successfully created and added MCPToolset for server '{server_url}' with {len(unique_tool_filter)} tools.")
        except Exception as e_mcp_toolset:
            logger.error(f"Failed to create MCPToolset for server '{server_url}': {e_mcp_toolset}")

    return instantiated_tools