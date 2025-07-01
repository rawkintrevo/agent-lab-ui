// nodeFunctions/index.js

const functions = require("firebase-functions");
const { logger } = require("firebase-functions");

const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");


/**
 * A Firebase Callable Function that lists tools from a local MCP server over stdio.
 */
exports.list_local_stdio_server_tools = functions.https.onCall(
    {
        timeoutSeconds: 300,
        memory: "1GiB",
    },
    async (request) => {
        const data = request.data;
        logger.info("data received:", data);
        logger.info("stdioConfig received:", data.stdioConfig);
        logger.info("packageName received:", data.stdioConfig?.packageName);
        const packageName = data?.stdioConfig?.packageName;
        logger.info("packageName is a:", typeof packageName);

        if (!packageName || typeof packageName !== "string") {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "The function must be called with a 'packageName' argument (string)."
            );
        }

        functions.logger.info(
            `Attempting to list tools for package: ${packageName}`
        );

        // --------------------- REWRITTEN LOGIC ---------------------
        try {
            console.log(
                "[DEBUG] Creating server parameters for StdioClientTransport with npx -y:",
                packageName
            );
            const serverParameters = {
                command: "npx",
                args: ["-y", packageName],
                stderr: "inherit",
                cwd: process.cwd(),
            };

            console.log(
                "[DEBUG] Server parameters constructed:",
                JSON.stringify(serverParameters, null, 2)
            );

            // Create the transport that spawns the child process via stdio
            console.log("[DEBUG] Instantiating StdioClientTransport...");
            const transport = new StdioClientTransport(serverParameters);

            // Now create our MCP client
            console.log("[DEBUG] Constructing new Client instance...");
            const client = new Client(
                {
                    name: "Firebase Cloud Function client",
                    version: "0.0.1",
                },
                {
                    // No special capabilities needed for listing tools
                }
            );

            // Connect the client to the transport. Client.connect() calls transport.start() internally.
            console.log("[DEBUG] Client created. Connecting to transport...");
            await client.connect(transport);
            console.log("[DEBUG] Client connected to transport. Listing tools now...");

            // Use the high-level client method to list tools
            const toolsResult = await client.listTools();
            console.log(
                "[DEBUG] Tools result received. Raw structure:",
                JSON.stringify(toolsResult, null, 2)
            );

            // Ensure we got the expected array
            if (!toolsResult || !Array.isArray(toolsResult.tools)) {
                throw new Error(
                    "Did not receive an expected 'tools' array from the local stdio server."
                );
            }

            // Cleanly close the transport
            console.log("[DEBUG] Closing transport...");
            await transport.close();
            console.log("[DEBUG] Transport closed successfully. Returning result...");

            // Return success response
            return {
                success: true,
                tools: toolsResult.tools,
            };
            // --------------------- END OF REWRITTEN LOGIC ---------------------
        } catch (error) {
            functions.logger.error(
                `Error in list_local_stdio_server_tools for package '${packageName}':`,
                error.message,
                { stack: error.stack }
            );
            throw new functions.https.HttpsError(
                "internal",
                error.message || "An unexpected error occurred while listing tools."
            );
        }
    }
);