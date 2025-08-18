// src/components/models/ModelForm.js
import React, { useState, useEffect } from 'react';
import {
    TextField, Button, Select, MenuItem, FormControl, InputLabel,
    Paper, Grid, Box, CircularProgress, Typography, FormHelperText, Slider,
    FormControlLabel, Checkbox
} from '@mui/material';
import ProjectSelector from '../projects/ProjectSelector';
import {
    MODEL_PROVIDERS_LITELLM,
    DEFAULT_LITELLM_PROVIDER_ID,
    DEFAULT_LITELLM_BASE_MODEL_ID,
    getLiteLLMProviderConfig
} from '../../constants/agentConstants';

const ModelForm = ({ onSubmit, initialData = {}, isSaving = false }) => {
    const [name, setName] = useState(initialData.name || '');
    const [description, setDescription] = useState(initialData.description || '');
    const [projectIds, setProjectIds] = useState(initialData.projectIds || []);
    const [isPublic, setIsPublic] = useState(initialData.isPublic || false);

    const [provider, setProvider] = useState(initialData.provider || DEFAULT_LITELLM_PROVIDER_ID);
    const [modelString, setModelString] = useState(initialData.modelString || DEFAULT_LITELLM_BASE_MODEL_ID);
    const [systemInstruction, setSystemInstruction] = useState(initialData.systemInstruction || '');

    // New state for parameters and enabled flags
    const [parameters, setParameters] = useState({});
    const [enabledParams, setEnabledParams] = useState({});

    const [formError, setFormError] = useState('');

    const currentProviderConfig = getLiteLLMProviderConfig(provider);
    const availableBaseModels = currentProviderConfig?.models || [];

    // Get parameter definitions for selected model
    const parameterDefs = React.useMemo(() => {
        if (!currentProviderConfig) return null;
        const modelDef = currentProviderConfig.models.find(m => m.id === modelString);
        return modelDef?.parameters || null;
    }, [currentProviderConfig, modelString]);

    // On provider or modelString or initialData.parameters change, initialize parameters and enabledParams
    useEffect(() => {
        if (!parameterDefs) {
            setParameters({});
            setEnabledParams({});
            setSystemInstruction('');
            return;
        }
        // Set systemInstruction from model definition if not overridden by initialData
        const modelDef = currentProviderConfig.models.find(m => m.id === modelString);
        if (modelDef?.systemInstruction && (!initialData.systemInstruction || initialData.systemInstruction === '')) {
            setSystemInstruction(modelDef.systemInstruction);
        } else if (initialData.systemInstruction) {
            setSystemInstruction(initialData.systemInstruction);
        }

        const newParameters = {};
        const newEnabledParams = {};
        Object.entries(parameterDefs).forEach(([key, def]) => {
            // Load from initialData.parameters if exists, else defaultValue
            const initialValue = initialData.parameters?.[key];
            newParameters[key] = initialValue !== undefined ? initialValue : def.defaultValue;
            // Enable param if not optional or if initialData has a value
            newEnabledParams[key] = !def.optional || (initialValue !== undefined);
        });
        setParameters(newParameters);
        setEnabledParams(newEnabledParams);
    }, [parameterDefs, initialData.parameters, currentProviderConfig, modelString, initialData.systemInstruction]);

    useEffect(() => {
        // When provider changes, reset modelString to first available or empty
        if (currentProviderConfig && availableBaseModels.length > 0) {
            setModelString(availableBaseModels[0].id);
        } else {
            setModelString('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider]);

    const handleSubmit = (e) => {
        e.preventDefault();
        setFormError('');

        if (!name.trim() || !provider || !modelString.trim()) {
            setFormError('Name, Provider, and Model String are required.');
            return;
        }

        // Validate parameters
        if (parameterDefs) {
            for (const [key, def] of Object.entries(parameterDefs)) {
                if (enabledParams[key]) {
                    const val = parameters[key];
                    if (def.type === 'integer' || def.type === 'float') {
                        if (val === undefined || val === null || isNaN(val)) {
                            setFormError(`Parameter "${def.name}" must be a number.`);
                            return;
                        }
                        if (def.minValue !== undefined && val < def.minValue) {
                            setFormError(`Parameter "${def.name}" must be at least ${def.minValue}.`);
                            return;
                        }
                        if (def.maxValue !== undefined && val > def.maxValue) {
                            setFormError(`Parameter "${def.name}" must be at most ${def.maxValue}.`);
                            return;
                        }
                    } else if (def.type === 'choice' || def.type === 'boolean') {
                        if (!def.choices.includes(val)) {
                            setFormError(`Parameter "${def.name}" must be one of: ${def.choices.join(', ')}.`);
                            return;
                        }
                    } else if (def.type === 'string') {
                        if (typeof val !== 'string') {
                            setFormError(`Parameter "${def.name}" must be a string.`);
                            return;
                        }
                    }
                }
            }
        }

        // Collect enabled parameters only
        const parametersToSave = {};
        if (parameterDefs) {
            for (const key of Object.keys(parameterDefs)) {
                if (enabledParams[key]) {
                    parametersToSave[key] = parameters[key];
                }
            }
        }

        const modelData = {
            name,
            description,
            projectIds,
            isPublic,
            provider,
            modelString,
            systemInstruction,
            parameters: parametersToSave,
        };

        onSubmit(modelData);
    };

    const toggleEnabled = (key) => {
        setEnabledParams((prev) => {
            const newEnabled = { ...prev };
            const currentlyEnabled = !!newEnabled[key];
            if (!currentlyEnabled) {
                // Enabling this param, disable mutually exclusive ones
                const def = parameterDefs?.[key];
                if (def?.mutually_exclusive) {
                    def.mutually_exclusive.forEach((exKey) => {
                        newEnabled[exKey] = false;
                    });
                }
            }
            newEnabled[key] = !currentlyEnabled;
            return newEnabled;
        });
    };

    const handleParamChange = (key, value) => {
        setParameters((prev) => ({ ...prev, [key]: value }));
    };

    return (
        <Paper elevation={3} sx={{ p: { xs: 2, md: 4 } }}>
            <Box component="form" onSubmit={handleSubmit} noValidate>
                <Grid container spacing={3}>
                    <Grid item xs={12}>
                        <TextField
                            label="Model Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            fullWidth
                            variant="outlined"
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            label="Description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
                            variant="outlined"
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <ProjectSelector
                            selectedProjectIds={projectIds}
                            onSelectionChange={setProjectIds}
                            helperText="Associate this model with one or more projects."
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <FormControlLabel
                            control={<Checkbox checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />}
                            label="Public Model (visible to all users)"
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth variant="outlined">
                            <InputLabel id="provider-label">LLM Provider</InputLabel>
                            <Select
                                labelId="provider-label"
                                value={provider}
                                onChange={(e) => setProvider(e.target.value)}
                                label="LLM Provider"
                            >
                                {MODEL_PROVIDERS_LITELLM.map(p => (
                                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        {availableBaseModels.length > 0 ? (
                            <FormControl fullWidth variant="outlined">
                                <InputLabel id="model-string-label">Base Model</InputLabel>
                                <Select
                                    labelId="model-string-label"
                                    value={modelString}
                                    onChange={(e) => setModelString(e.target.value)}
                                    label="Base Model"
                                >
                                    {availableBaseModels.map(m => (
                                        <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        ) : (
                            <TextField
                                label="Model String"
                                value={modelString}
                                onChange={(e) => setModelString(e.target.value)}
                                required
                                fullWidth
                                variant="outlined"
                                helperText={currentProviderConfig?.customInstruction || "Enter the exact model name."}
                            />
                        )}
                    </Grid>

                    {/* Dynamic Parameters Section */}
                    {parameterDefs && Object.entries(parameterDefs).map(([key, def]) => (
                        <Grid item xs={12} sm={def.type === 'choice' || def.type === 'boolean' ? 6 : 12} key={key}>
                            <Box sx={{ mb: 1 }}>
                                {def.optional && (
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={enabledParams[key] || false}
                                                onChange={() => toggleEnabled(key)}
                                            />
                                        }
                                        label={`Enable ${def.name}`}
                                    />
                                )}
                            </Box>
                            {(!def.optional || enabledParams[key]) && (
                                <>
                                    {(def.type === 'integer' || def.type === 'float') ? (
                                        <>
                                            <Typography gutterBottom>{def.name}</Typography>
                                            <Slider
                                                value={parameters[key] !== undefined ? parameters[key] : def.defaultValue}
                                                min={def.minValue}
                                                max={def.maxValue}
                                                step={def.type === 'integer' ? 1 : (def.maxValue - def.minValue) / 100}
                                                onChange={(_, v) => handleParamChange(key, v)}
                                                valueLabelDisplay="auto"
                                            />
                                            <Typography variant="caption" color="text.secondary">{def.description}</Typography>
                                        </>
                                    ) : def.type === 'choice' || def.type === 'boolean' ? (
                                        <FormControl fullWidth>
                                            <InputLabel>{def.name}</InputLabel>
                                            <Select
                                                value={parameters[key] !== undefined ? parameters[key] : def.defaultValue}
                                                label={def.name}
                                                onChange={(e) => handleParamChange(key, e.target.value)}
                                            >
                                                {def.choices.map(choice => (
                                                    <MenuItem key={choice} value={choice}>{choice}</MenuItem>
                                                ))}
                                            </Select>
                                            <Typography variant="caption" color="text.secondary">{def.description}</Typography>
                                        </FormControl>
                                    ) : def.type === 'string' ? (
                                        <TextField
                                            fullWidth
                                            label={def.name}
                                            value={parameters[key] !== undefined ? parameters[key] : def.defaultValue || ''}
                                            onChange={(e) => handleParamChange(key, e.target.value)}
                                            helperText={def.description}
                                        />
                                    ) : (
                                        <Typography color="error">Unsupported parameter type: {def.type}</Typography>
                                    )}
                                </>
                            )}
                        </Grid>
                    ))}

                    <Grid item xs={12}>
                        <TextField
                            label="System Instruction (System Prompt)"
                            value={systemInstruction}
                            onChange={(e) => setSystemInstruction(e.target.value)}
                            multiline
                            rows={5}
                            fullWidth
                            variant="outlined"
                            placeholder="e.g., You are a helpful AI assistant."
                        />
                    </Grid>

                    {formError && (
                        <Grid item xs={12}>
                            <FormHelperText error sx={{ fontSize: '1rem', textAlign: 'center' }}>{formError}</FormHelperText>
                        </Grid>
                    )}

                    <Grid item xs={12}>
                        <Button
                            type="submit"
                            variant="contained"
                            color="primary"
                            size="large"
                            disabled={isSaving}
                            fullWidth
                            startIcon={isSaving ? <CircularProgress size={20} color="inherit" /> : null}
                        >
                            {isSaving ? 'Saving...' : (initialData.id ? 'Update Model' : 'Create Model')}
                        </Button>
                    </Grid>
                </Grid>
            </Box>
        </Paper>
    );
};

export default ModelForm;