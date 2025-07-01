// nodeFunctions/index.js  

const functions = require("firebase-functions");
const { spawn } = require("child_process");
const {logger} = require("firebase-functions");

/**
 * A Firebase Callable Function that lists tools from a local MCP (Machine-readable
 * Capability Protocol) server that communicates over stdio.
 * It uses `npx` to run the specified package, which is available in the Node.js runtime.
 *
 * @param {object} data The data object passed from the client.
 * @param {string} data.packageName The npm package name to execute (e.g., '@my-tools/cli').
 * @param {functions.https.CallableContext} context The context of the function call.
 * @returns {Promise<{success: boolean, tools: Array<Object>}>} A promise that resolves with the list of tools.
 */
exports.list_local_stdio_server_tools = functions.https.onCall(async (request) => {
    const data = await request.data;
    console.log('data received:', data);
    // console.log("🔥 raw data value:", JSON.stringify(data, null, 2));
    console.log('stdioConfig received:', data.stdioConfig);
    console.log('packageName received:', data.stdioConfig?.packageName);
    const packageName = data.stdioConfig.packageName;
    console.log('packageName is a:' , typeof packageName);
    if (!packageName || typeof packageName !== 'string') {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "The function must be called with a 'packageName' argument (string)."
        );
    }

    functions.logger.info(`Attempting to list tools for package: ${packageName}`);

    // 2. Core Logic wrapped in a Promise to handle the async child process
    try {
        const tools = await new Promise((resolve, reject) => {
            console.log(`Starting MCP tool listing for package: ${packageName}`);
            const command = 'npx';
            // The -y flag automatically answers "yes" to any prompts, like installing the package.
            const args = ['-y', packageName];

            let stdoutData = '';
            let stderrData = '';
            // Set a timeout to prevent the function from hanging on unresponsive processes.
            const timeoutDuration = 20000; // 20 seconds

            // Spawn the process. Using shell:true can help with path resolution for `npx`.
            const child = spawn(command, args, { shell: true, detached: true });
            console.log(`Spawned child process with PID: ${child.pid}`);
            const timeout = setTimeout(() => {
                try {
                    // Kill the entire process group to ensure cleanup
                    process.kill(-child.pid);
                } catch (e) {
                    child.kill(); // Fallback kill
                }
                reject(new Error(`Process timed out after ${timeoutDuration / 1000} seconds.`));
            }, timeoutDuration);

            // --- Child Process Event Handlers ---

            child.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to spawn npx process: ${err.message}`));
            });

            child.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            child.on('close', (code) => {
                clearTimeout(timeout);

                if (code !== 0) {
                    const errorMessage = `Process for '${packageName}' exited with code ${code}.`
                        + (stderrData ? `\nSTDERR: ${stderrData}` : '');
                    return reject(new Error(errorMessage));
                }

                if (!stdoutData.trim()) {
                    const errorMessage = `Package '${packageName}' ran successfully but produced no output.`
                        + (stderrData ? `\nSTDERR (for context): ${stderrData}` : '');
                    return reject(new Error(errorMessage));
                }

                // --- Response Parsing ---

                // MCP servers can output multiple JSON objects, one per line. We need to find
                // the one that is the response to our specific request.
                const lines = stdoutData.trim().split('\n');
                let responseFound = false;

                for (const line of lines) {
                    try {
                        const response = JSON.parse(line);
                        // Look for a valid JSON-RPC response with our request ID (1)
                        // and the expected 'result.tools' array structure.
                        if (response && response.id === 1 && response.result && Array.isArray(response.result.tools)) {
                            functions.logger.info(`Successfully found and parsed tool list for '${packageName}'.`);
                            resolve(response.result.tools);
                            responseFound = true;
                            break; // Success, no need to check other lines
                        }
                    } catch (lineParseError) {
                        // This line wasn't valid JSON, which can happen with debug output. Ignore it.
                        functions.logger.warn(`Ignoring non-JSON line from stdio tool output: ${line}`);
                    }
                }

                if (!responseFound) {
                    reject(new Error(`Invalid response format from '${packageName}'. Expected a JSON-RPC response with 'result.tools' array. Received: ${stdoutData}`));
                }
            });

            // 3. Send the MCP Request to the running process
            const requestPayload = {
                jsonrpc: '2.0',
                method: 'list_tools',
                params: {},
                id: 1, // Static ID to match the response
            };

            try {
                child.stdin.write(JSON.stringify(requestPayload) + '\n');
                child.stdin.end(); // Signal that we are done writing
            } catch (e) {
                clearTimeout(timeout);
                reject(new Error(`Failed to write to process stdin: ${e.message}`));
            }
        });

        // On success, return the structured data
        return { success: true, tools: tools };

    } catch (error) {
        functions.logger.error(`Error in list_local_stdio_server_tools for package '${packageName}':`, error.message, { stack: error.stack });
        // Re-throw the error as an HttpsError for the client
        throw new functions.https.HttpsError("internal", error.message || "An unexpected error occurred while listing tools.");
    }
});  