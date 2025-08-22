# main.py
import os
import json
from fastmcp import FastMCPServer, HTTPStreamingTransport

# --- Import Gofannon tools ---
# These tools will be installed from the gofannon package via pip.
from gofannon.github.list_repo_files import ListRepoFiles
from gofannon.github.read_file import ReadFile
from gofannon.github.create_issue import CreateIssue
from gofannon.github.clone_repo import CloneRepo

# 1. Load sensitive credentials from environment variables
# This is a best practice for security and is required for the Git tools.
api_key = os.getenv("GITHUB_API_KEY")
if not api_key:
    raise ValueError("GITHUB_API_KEY environment variable not set. The server cannot start without it.")

# 2. Initialize the FastMCP Server
# The `app` object is our ASGI application, which uvicorn will run.
app = FastMCPServer(
    title="Gofannon Git Tools MCP Server",
    description="An MCP server exposing GitHub tools from the Gofannon library.",
    version="1.0.0",
)

# 3. Define the list of Gofannon tools to expose
# We instantiate each tool class, passing the API key to its constructor.
gofannon_tools = [
    ListRepoFiles(api_key=api_key),
    ReadFile(api_key=api_key),
    CreateIssue(api_key=api_key),
    CloneRepo(), # This tool uses local git, not the API key directly
]

# 4. Add the tools to the server
print("Loading Gofannon tools...")
for tool in gofannon_tools:
    print(f" - Adding tool: {tool.name}")
    # The MCP mixin provides a standard way to export the tool's definition.
    app.add_tool(
        fn=tool.fn,
        name=tool.name,
        description=json.dumps(tool.definition) # The tool definition is passed as a JSON string
    )
print("All tools loaded successfully.")

# 5. Configure the transport protocol
# We use HTTPStreamingTransport for direct compatibility with Cloud Run.
transport = HTTPStreamingTransport()
app.add_transport(transport)

print("Server configured with HTTP Streaming transport. Ready to run.")