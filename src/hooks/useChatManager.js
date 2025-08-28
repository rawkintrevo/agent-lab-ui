// src/hooks/useChatManager.js
import { useState, useEffect, useMemo, useRef } from 'react';
import * as chatService from '../services/chatService';
import { getAgentsForProjects } from '../services/agentFirestoreService';
import { getModelsForProjects } from '../services/modelService';
import { getPathToLeaf, findLeafOfBranch } from '../utils/chatUtils';

export const useChatManager = (chatId, sharedChatId) => {
    const effectiveChatId = sharedChatId || chatId;
    const [chat, setChat] = useState(null);
    const [messagesMap, setMessagesMap] = useState({});
    const [activeLeafMsgId, setActiveLeafMsgId] = useState(null);
    const [agents, setAgents] = useState([]);
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [messageContentCache, setMessageContentCache] = useState({});
    const eventListeners = useRef(new Map());

    const conversationPath = useMemo(() => {
        if (!messagesMap || !activeLeafMsgId) return [];
        return getPathToLeaf(messagesMap, activeLeafMsgId);
    }, [messagesMap, activeLeafMsgId]);

    useEffect(() => {
        setLoading(true);
        setError(null);
        let unsubscribe;

        const setupListener = async () => {
            try {
                let chatData;
                if (sharedChatId) {
                    chatData = await chatService.getSharedChatDetails(sharedChatId);
                    setChat(chatData);
                    const sharedMessages = await chatService.getSharedChatMessages(sharedChatId);
                    const newMessagesMap = sharedMessages.reduce((acc, m) => ({ ...acc, [m.id]: m }), {});
                    setMessagesMap(newMessagesMap);
                    setActiveLeafMsgId(sharedMessages.length > 0 ? sharedMessages[sharedMessages.length - 1].id : null);
                    setAgents([]);
                    setModels([]);
                } else {
                    chatData = await chatService.getChatDetails(chatId);
                    setChat(chatData);
                    const [projAgents, projModels] = await Promise.all([
                        getAgentsForProjects(chatData.projectIds || []),
                        getModelsForProjects(chatData.projectIds || [])
                    ]);
                    setAgents(projAgents);
                    setModels(projModels);
                    unsubscribe = chatService.listenToChatMessages(chatId, (newMsgs) => {
                        const newMessagesMap = newMsgs.reduce((acc, m) => ({ ...acc, [m.id]: m }), {});
                        setMessagesMap(newMessagesMap);
                        setActiveLeafMsgId(prevLeafId => {
                            if (!prevLeafId || !newMessagesMap[prevLeafId]) {
                                const leafCandidates = newMsgs.filter(m => !newMsgs.some(x => x.parentMessageId === m.id));
                                return leafCandidates.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)).pop()?.id || null;
                            }
                            return findLeafOfBranch(newMessagesMap, prevLeafId);
                        });
                    });
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        setupListener();
        return () => {
            if (unsubscribe) unsubscribe();
            // Clean up all event listeners on unmount
            eventListeners.current.forEach(unsub => unsub());
            // eslint-disable-next-line
            eventListeners.current.clear();
        };
    }, [chatId, sharedChatId]);

    //
    // --- THIS IS THE MODIFIED SECTION ---
    //
    // This effect now manages real-time listeners for message events.
    useEffect(() => {
        const currentMessageIds = new Set(conversationPath.map(msg => msg.id));

        // Subscribe to events for new assistant messages in the path
        conversationPath.forEach(msg => {
            const isAssistant = msg.participant?.startsWith('agent') || msg.participant?.startsWith('model');
            if (isAssistant && !eventListeners.current.has(msg.id)) {
                setMessageContentCache(prev => ({ ...prev, [msg.id]: { status: 'loading' } }));

                const unsubscribe = chatService.listenToMessageEvents(effectiveChatId, msg.id, (events, err) => {
                    if (err) {
                        setMessageContentCache(prev => ({ ...prev, [msg.id]: { status: 'error', error: err.message } }));
                        return;
                    }

                    let aggregatedText = '';
                    if (events?.length > 0) {
                        events.forEach(event => {
                            if (typeof event.content === 'string') {
                                aggregatedText += event.content;
                            } else if (event.content?.parts) {
                                event.content.parts.forEach(part => {
                                    if (part?.text) aggregatedText += part.text;
                                });
                            }
                        });
                    }
                    setMessageContentCache(prev => ({ ...prev, [msg.id]: { status: 'loaded', content: aggregatedText } }));
                });
                eventListeners.current.set(msg.id, unsubscribe);
            }
        });

        // Unsubscribe from messages that are no longer in the active path
        eventListeners.current.forEach((unsubscribe, msgId) => {
            if (!currentMessageIds.has(msgId)) {
                unsubscribe();
                eventListeners.current.delete(msgId);
            }
        });

    }, [conversationPath, effectiveChatId]);
    // --- END OF MODIFIED SECTION ---

    return {
        chat, messagesMap, activeLeafMsgId, conversationPath, agents, models,
        loading, error, messageContentCache, setActiveLeafMsgId
    };
};