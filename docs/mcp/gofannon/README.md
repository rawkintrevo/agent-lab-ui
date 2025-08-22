# Deploying a Gofannon FastMCP Server with Git Tools to Google Cloud Run

This guide shows you how to deploy a Python-based **MCP server** to [Google Cloud Run](https://cloud.google.com/run/docs/deploying). The server is built with [FastMCP](https://github.com/supercorp-ai/fastmcp) and uses Git-related tools from the `gofannon` library.

This server **natively supports HTTP streaming**, making it a lightweight and efficient service. We will use a streamlined deployment method where Google Cloud builds and deploys the container for you in a single step.

---

## Prerequisites

- A Google Cloud project with billing enabled.
- `gcloud` CLI installed and authenticated (`gcloud init`).
- A **GitHub Personal Access Token** with `repo` scope to use as your `GITHUB_API_KEY`.
- Your project files in a single directory: `main.py`, `Dockerfile`, and `requirements.txt`.

---

## About the MCP Server and Native HTTP Streaming

The server uses two key components:

- **FastMCP**: A Python framework for building high-performance MCP servers.
- **Gofannon**: A library of tools, here specifically used for interacting with GitHub repositories.
- **Native HTTP Streaming**: The server directly implements an HTTP streaming transport, allowing it to function as a standard web service on Cloud Run, which automatically handles requests, scaling, and SSL.

This architecture is simpler and more efficient than using a stdio-based server, as the entire application runs within a single, self-contained container.

---

## Step 1: Deploy to Google Cloud Run

Instead of manually building a container and pushing it to a registry, we can use the `--source .` flag to have `gcloud` handle everything. This command will:
1.  Read the `Dockerfile` in your current directory.
2.  Use Google Cloud Build to build the container image.
3.  Push the image to Google Artifact Registry automatically.
4.  Deploy the new image to Cloud Run.

Navigate to your project's root directory and run the command below.

**Replace `<YOUR_GITHUB_API_KEY>` with your actual GitHub Personal Access Token.**

```bash
# Set your preferred deployment region
export REGION=us-central1

gcloud run deploy gofannon-git-mcp-server \
  --source . \
  --platform=managed \
  --allow-unauthenticated \
  --region=$REGION \
  --port=8080 \
  --set-env-vars "GITHUB_API_KEY=<YOUR_GITHUB_API_KEY>"
```

**Note:** The first time you run this command, `gcloud` may prompt you to enable the Cloud Build API and Artifact Registry API. Answer `y` (yes) to proceed.

### Explanation of the Command

- **`gcloud run deploy gofannon-git-mcp-server`**: Deploys a new service with the specified name.
- **`--source .`**: This is the key flag. It tells Cloud Run to build the container from the source code in the current directory (`.`) using the provided `Dockerfile`.
- **`--platform=managed`**: Uses the fully managed, serverless Cloud Run environment.
- **`--allow-unauthenticated`**: Allows public access. For production, you should configure IAM-based authentication.
- **`--region`**: The deployment region.
- **`--port=8080`**: Informs Cloud Run that your container listens on port 8080.
- **`--set-env-vars "GITHUB_API_KEY=..."`**: Securely provides the GitHub API key to your running container as an environment variable, which `main.py` requires to start.

---

## After Deployment

Cloud Run will provide a public service URL (e.g., `https://gofannon-git-mcp-server-xxxxxxxx-uc.a.run.app`). You can now interact with your server.

You can check the health endpoint to confirm it's running:
```bash
curl https://<YOUR_CLOUD_RUN_URL>/healthz
```

Your MCP tools are available at the `/mcp` endpoint:
```bash
curl https://<YOUR_CLOUD_RUN_URL>/mcp
```

---

## Resources

- [Google Cloud Run Deployment Docs (From Source)](https://cloud.google.com/run/docs/deploying-source-code)
- [FastMCP on GitHub](https://github.com/supercorp-ai/fastmcp)
- [Building Python Containers for Cloud Run](https://cloud.google.com/run/docs/quickstarts/build-and-deploy/python)

---

## Summary

This setup provides a robust, scalable, and secure way to run a `gofannon`-powered MCP server on Google Cloud. By using the `--source .` deployment method, you create a self-contained service with a minimal number of steps, allowing Cloud Run's managed infrastructure to handle the heavy lifting of containerization and deployment.

---

**Happy deploying! 🚀**