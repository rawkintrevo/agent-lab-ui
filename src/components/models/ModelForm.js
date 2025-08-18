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

    const parameterDefs = React.useMemo(() => {
        if (!currentProviderConfig) return null;
        const modelDef = currentProviderConfig.models.find(m => m.id === modelString);
        return modelDef?.parameters || null;
    }, [currentProviderConfig, modelString]);

    // Recursive function to initialize parameters and enabled flags from parameterDefs and initial values
    const initializeParamsRecursively = (paramDefs, initialVals, enabledFlags) => {
        const params = {};
        const enabled = {};
        if (!paramDefs) return { params, enabled };
        for (const [key, def] of Object.entries(paramDefs)) {
            if (def.type === 'object' && def.parameters) {
                const nestedInit = initializeParamsRecursively(def.parameters, initialVals?.[key] || {}, enabledFlags?.[key] || {});
                params[key] = nestedInit.params;
                enabled[key] = nestedInit.enabled;
            } else {
                const initialValue = initialVals?.[key];
                params[key] = initialValue !== undefined ? initialValue : def.defaultValue;
                enabled[key] = !def.optional || (initialValue !== undefined);
            }
        }
        return { params, enabled };
    };

    // Recursive function to render parameters UI
    const renderParametersRecursively = (paramDefs, paramsState, enabledState, path = []) => {
        if (!paramDefs) return null;
        return Object.entries(paramDefs).map(([key, def]) => {
            const fullPath = [...path, key];
            const paramKey = fullPath.join('.');

            const isEnabled = enabledState?.[key] ?? true;
            const paramValue = paramsState?.[key];

            const toggleParam = () => {
                setEnabledParams(prev => {
                    const newEnabled = { ...prev };
                    // Helper to set nested enabled flags
                    const setNestedEnabled = (obj, keys, value) => {
                        if (keys.length === 1) {
                            obj[keys[0]] = value;
                        } else {
                            if (!obj[keys[0]]) obj[keys[0]] = {};
                            setNestedEnabled(obj[keys[0]], keys.slice(1), value);
                        }
                    };
                    // Helper to get nested def
                    const getNestedDef = (defs, keys) => {
                        if (keys.length === 0) return null;
                        const [first, ...rest] = keys;
                        if (!defs[first]) return null;
                        if (rest.length === 0) return defs[first];
                        if (defs[first].type === 'object' && defs[first].parameters) {
                            return getNestedDef(defs[first].parameters, rest);
                        }
                        return null;
                    };

                    // Toggle current param
                    const currentValue = isEnabled;
                    const newValue = !currentValue;
                    setNestedEnabled(newEnabled, fullPath, newValue);

                    // If enabling, disable mutually exclusive params at this level
                    if (newValue) {
                        const currentDef = getNestedDef(parameterDefs, fullPath);
                        if (currentDef?.mutually_exclusive) {
                            currentDef.mutually_exclusive.forEach(exKey => {
                                const exPath = [...path.slice(0, -1), exKey]; // mutual exclusives are at same level
                                setNestedEnabled(newEnabled, exPath, false);
                            });
                        }
                    }
                    return newEnabled;
                });
            };

            // Render UI for nested object
            if (def.type === 'object' && def.parameters) {
                return (
                    <Grid item xs={12} key={paramKey} sx={{ border: '1px solid #ccc', borderRadius: 1, p: 2, mb: 2 }}>
                        <Typography variant="subtitle1" sx={{ mb: 1 }}>{def.name}</Typography>
                        {def.description && <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>{def.description}</Typography>}
                        {renderParametersRecursively(def.parameters, paramValue, enabledState?.[key], fullPath)}
                    </Grid>
                );
            }

            // Render UI for leaf parameter
            return (
                <Grid item xs={12} sm={def.type === 'choice' || def.type === 'boolean' ? 6 : 12} key={paramKey}>
                    <Box sx={{ mb: 1 }}>
                        {def.optional && (
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={isEnabled || false}
                                        onChange={toggleParam}
                                    />
                                }
                                label={`Enable ${def.name}`}
                            />
                        )}
                    </Box>
                    {(!def.optional || isEnabled) && (
                        <>
                            {(def.type === 'integer' || def.type === 'float') ? (
                                <>
                                    <Typography gutterBottom>{def.name}</Typography>
                                    <Slider
                                        value={paramValue !== undefined ? paramValue : def.defaultValue}
                                        min={def.minValue}
                                        max={def.maxValue}
                                        step={def.type === 'integer' ? 1 : (def.maxValue - def.minValue) / 100}
                                        onChange={(_, v) => handleParamChange(fullPath, v)}
                                        valueLabelDisplay="auto"
                                    />
                                    <Typography variant="caption" color="text.secondary">{def.description}</Typography>
                                </>
                            ) : def.type === 'choice' || def.type === 'boolean' ? (
                                <FormControl fullWidth>
                                    <InputLabel>{def.name}</InputLabel>
                                    <Select
                                        value={paramValue !== undefined ? paramValue : def.defaultValue}
                                        label={def.name}
                                        onChange={(e) => handleParamChange(fullPath, e.target.value)}
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
                                    value={paramValue !== undefined ? paramValue : def.defaultValue || ''}
                                    onChange={(e) => handleParamChange(fullPath, e.target.value)}
                                    helperText={def.description}
                                />
                            ) : (
                                <Typography color="error">Unsupported parameter type: {def.type}</Typography>
                            )}
                        </>
                    )}
                </Grid>
            );
        });
    };

    // Recursive helper to update nested parameters state on change
    const handleParamChange = (path, value) => {
        setParameters(prev => {
            const newParams = { ...prev };

            const setNestedValue = (obj, keys, val) => {
                if (keys.length === 1) {
                    obj[keys[0]] = val;
                } else {
                    if (!obj[keys[0]] || typeof obj[keys[0]] !== 'object') obj[keys[0]] = {};
                    setNestedValue(obj[keys[0]], keys.slice(1), val);
                }
            };

            setNestedValue(newParams, path, value);
            return newParams;
        });
    };

    // Recursive helper to collect only enabled parameters from state for submission
    const collectEnabledParamsRecursively = (paramDefs, paramsState, enabledState) => {
        const collected = {};
        if (!paramDefs) return collected;
        for (const [key, def] of Object.entries(paramDefs)) {
            if (def.type === 'object' && def.parameters) {
                if (enabledState?.[key]) {
                    const nested = collectEnabledParamsRecursively(def.parameters, paramsState?.[key] || {}, enabledState?.[key] || {});
                    if (Object.keys(nested).length > 0) {
                        collected[key] = nested;
                    }
                }
            } else {
                if (enabledState?.[key]) {
                    collected[key] = paramsState?.[key];
                }
            }
        }
        return collected;
    };

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

        const { params: newParameters, enabled: newEnabledParams } = initializeParamsRecursively(parameterDefs, initialData.parameters || {}, {});

        setParameters(newParameters);
        setEnabledParams(newEnabledParams);
        // eslint-disable-next-line
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

        // Validate parameters recursively
        const validateParamsRecursively = (paramDefs, paramsState, enabledState) => {
            if (!paramDefs) return true;
            for (const [key, def] of Object.entries(paramDefs)) {
                if (def.type === 'object' && def.parameters) {
                    if (enabledState?.[key]) {
                        if (!validateParamsRecursively(def.parameters, paramsState?.[key] || {}, enabledState?.[key] || {})) {
                            return false;
                        }
                    }
                } else {
                    if (enabledState?.[key]) {
                        const val = paramsState[key];
                        if (def.type === 'integer' || def.type === 'float') {
                            if (val === undefined || val === null || isNaN(val)) {
                                setFormError(`Parameter "${def.name}" must be a number.`);
                                return false;
                            }
                            if (def.minValue !== undefined && val < def.minValue) {
                                setFormError(`Parameter "${def.name}" must be at least ${def.minValue}.`);
                                return false;
                            }
                            if (def.maxValue !== undefined && val > def.maxValue) {
                                setFormError(`Parameter "${def.name}" must be at most ${def.maxValue}.`);
                                return false;
                            }
                        } else if (def.type === 'choice' || def.type === 'boolean') {
                            if (!def.choices.includes(val)) {
                                setFormError(`Parameter "${def.name}" must be one of: ${def.choices.join(', ')}.`);
                                return false;
                            }
                        } else if (def.type === 'string') {
                            if (typeof val !== 'string') {
                                setFormError(`Parameter "${def.name}" must be a string.`);
                                return false;
                            }
                        }
                    }
                }
            }
            return true;
        };

        if (parameterDefs && !validateParamsRecursively(parameterDefs, parameters, enabledParams)) {
            return;
        }

        // Collect enabled parameters only recursively
        const parametersToSave = collectEnabledParamsRecursively(parameterDefs, parameters, enabledParams);

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
                    {renderParametersRecursively(parameterDefs, parameters, enabledParams)}

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