// src/components/agents/ChildAgentFormDialog.js
import React, { useState, useEffect } from 'react';
import {
    TextField, Button, Select, MenuItem, FormControl, InputLabel,
    Grid, Dialog, DialogTitle, DialogContent, DialogActions, FormHelperText,
    Typography
} from '@mui/material';
import { v4 as uuidv4 } from 'uuid';
import ToolSelector from '../tools/ToolSelector';
import { AGENT_TYPES } from '../../constants/agentConstants';
import ModelSelector from '../models/ModelSelector';


const AGENT_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const RESERVED_AGENT_NAME = "user";

function validateAgentName(name) {
    if (!name || !name.trim()) {
        return "Agent Name is required.";
    }
    if (/\s/.test(name)) {
        return "Agent Name cannot contain spaces.";
    }
    if (!AGENT_NAME_REGEX.test(name)) {
        return "Agent Name must start with a letter or underscore, and can only contain letters, digits, or underscores.";
    }
    if (name.toLowerCase() === RESERVED_AGENT_NAME) {
        return `Agent Name cannot be "${RESERVED_AGENT_NAME}" as it's a reserved name.`;
    }
    if (name.length > 63) {
        return "Agent Name is too long (max 63 characters).";
    }
    return null;
}


const ChildAgentFormDialog = ({
                                  open,
                                  onClose,
                                  onSave,
                                  childAgentData,
                                  availableGofannonTools,
                                  projectIds,
                                  loadingGofannon,
                                  gofannonError,
                                  onRefreshGofannon
                              }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [currentChildAgentType, setCurrentChildAgentType] = useState(AGENT_TYPES[0]);

    const [modelId, setModelId] = useState(''); // State for the selected model ID
    const [selectedTools, setSelectedTools] = useState([]);
    const [outputKey, setOutputKey] = useState('');
    const [formError, setFormError] = useState('');
    const [nameError, setNameError] = useState('');
    // eslint-disable-next-line
    const [usedCustomRepoUrls, setUsedCustomRepoUrls] = useState([]);
    // eslint-disable-next-line
    const [usedMcpServerUrls, setUsedMcpServerUrls] = useState([]);




    useEffect(() => {
        if (open) {
            const dataToLoad = childAgentData || {};

            setName(dataToLoad.name || '');
            setDescription(dataToLoad.description || '');
            setCurrentChildAgentType(dataToLoad.agentType || AGENT_TYPES[0]);

            setModelId(dataToLoad.modelId || '');
            setSelectedTools(dataToLoad.tools || []);
            setOutputKey(dataToLoad.outputKey || '');

            setFormError('');
            setNameError('');
        }
    }, [childAgentData, open]);


    const handleUsedCustomRepoUrlsChange = (urls) => {
        setUsedCustomRepoUrls(urls);
    };
    const handleUsedMcpServerUrlsChange = (urls) => {
        setUsedMcpServerUrls(urls);
    };

    const handleSelectedToolsChange = (newTools) => {
        setSelectedTools(newTools);
        const currentCustomRepoUrls = newTools
            .filter(st => st.type === 'custom_repo' && st.sourceRepoUrl)
            .map(st => st.sourceRepoUrl);
        setUsedCustomRepoUrls(Array.from(new Set(currentCustomRepoUrls)));

        const currentMcpServerUrls = newTools
            .filter(st => st.type === 'mcp' && st.mcpServerUrl)
            .map(st => st.mcpServerUrl);
        setUsedMcpServerUrls(Array.from(new Set(currentMcpServerUrls)));
    };


    const handleNameChange = (event) => {
        const newName = event.target.value;
        setName(newName);
        const validationError = validateAgentName(newName);
        setNameError(validationError || '');
    };

    const handleSave = () => {
        setFormError('');
        setNameError('');

        const agentNameError = validateAgentName(name);
        if (agentNameError) {
            setNameError(agentNameError);
            return;
        }

        const showLlmFields = currentChildAgentType === 'Agent' || currentChildAgentType === 'LoopAgent';

        if (showLlmFields && !modelId) {
            setFormError('A Model must be selected for this step/agent type.');
            return;
        }

        const childDataToSave = {
            id: childAgentData?.id || uuidv4(),
            name, description,
            agentType: currentChildAgentType,
            modelId: showLlmFields ? modelId : null,
            tools: showLlmFields ? selectedTools : [],
        };

        const trimmedOutputKey = outputKey.trim();
        if (showLlmFields && trimmedOutputKey) {
            childDataToSave.outputKey = trimmedOutputKey;
        }

        onSave(childDataToSave);
        onClose();
    };

    const showLlmFields = currentChildAgentType === 'Agent' || currentChildAgentType === 'LoopAgent';


    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                {childAgentData ? 'Edit Step / Child Agent' : 'Add New Step / Child Agent'}
                {currentChildAgentType && <Typography variant="caption" sx={{ml: 1}}>({currentChildAgentType})</Typography>}
            </DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ pt: 1 }}>
                    <Grid item xs={12}>
                        <TextField
                            label="Name" value={name} onChange={handleNameChange} required
                            fullWidth variant="outlined" error={!!nameError}
                            helperText={nameError || "Unique name for this step/child agent."}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            label="Description (Optional)" value={description}
                            onChange={(e) => setDescription(e.target.value)} multiline rows={2}
                            fullWidth variant="outlined"
                        />
                    </Grid>
                    <Grid item xs={12} sm={showLlmFields ? 6 : 12}>
                        <FormControl fullWidth variant="outlined">
                            <InputLabel id="child-agentType-label">Type (for this step)</InputLabel>
                            <Select
                                labelId="child-agentType-label"
                                value={currentChildAgentType}
                                onChange={(e) => setCurrentChildAgentType(e.target.value)}
                                label="Type (for this step)"
                            >
                                {AGENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                            </Select>
                            <FormHelperText>Choose if this step is a standard agent or an orchestrator.</FormHelperText>
                        </FormControl>
                    </Grid>

                    {showLlmFields && (
                        <>
                            <Grid item xs={12}>
                                <ModelSelector
                                    selectedModelId={modelId}
                                    onSelectionChange={setModelId}
                                    projectIds={projectIds}
                                    required
                                    helperText="Select a model. The model's system prompt and temperature will be used."
                                    disabled={!projectIds || projectIds.length === 0}
                                />
                                {(!projectIds || projectIds.length === 0) && <FormHelperText error>Select a project on the main form to see available models.</FormHelperText>}
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    label="Output Key (Optional)" value={outputKey}
                                    onChange={(e) => setOutputKey(e.target.value)}
                                    fullWidth variant="outlined"
                                    helperText="If set, agent's text response is saved to session state."
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <ToolSelector
                                    availableGofannonTools={availableGofannonTools}
                                    selectedTools={selectedTools}
                                    onSelectedToolsChange={handleSelectedToolsChange}
                                    onRefreshGofannon={onRefreshGofannon}
                                    loadingGofannon={loadingGofannon}
                                    gofannonError={gofannonError}
                                    onUsedCustomRepoUrlsChange={handleUsedCustomRepoUrlsChange}
                                    onUsedMcpServerUrlsChange={handleUsedMcpServerUrlsChange}
                                />
                            </Grid>
                        </>
                    )}
                    {formError && !nameError && <Grid item xs={12}><FormHelperText error>{formError}</FormHelperText></Grid>}
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    color="primary"
                    disabled={!!nameError}
                >
                    {childAgentData ? 'Save Changes' : 'Add Step / Child Agent'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ChildAgentFormDialog;