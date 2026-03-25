import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import useLabStore from './stores/labStore';
import { GENRES } from '../../utils/constants';
import { Loader2 } from 'lucide-react';
import './NarrativeLab.css';

const NarrativeLab = () => {
    const { projectId } = useParams();
    const {
        messages,
        isStreaming,
        streamingText,
        sendMessage,
        clearHistory,
        nsfwMode,
        superNsfwMode,
        qualityMode,
        genre,
        writingStyle,
        isPrimed,
        setNsfwMode,
        setSuperNsfwMode,
        setQualityMode,
        setGenre,
        setWritingStyle,
        primeEni
    } = useLabStore();

    const [input, setInput] = useState('');
    const [showSystemPrompt, setShowSystemPrompt] = useState(false);
    const chatEndRef = useRef(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText]);

    const handleSend = () => {
        if (!input.trim() || isStreaming) return;
        sendMessage(input, { projectId });
        setInput('');
    };

    const renderContent = (content) => {
        if (!content) return null;

        // Split by thinking blocks
        const parts = content.split(/(antmlThinking[\s\S]*?(?=\[|$))/i);

        return parts.map((part, i) => {
            if (part.toLowerCase().startsWith('antmlthinking')) {
                return (
                    <div key={i} className="thinking-block">
                        <div className="thinking-header">💭 AI Internal Thought Process (Raw)</div>
                        <pre className="thinking-text">{part.replace(/antmlThinking:?/i, '').trim()}</pre>
                    </div>
                );
            }
            return <div key={i} className="prose-text">{part}</div>;
        });
    };

    return (
        <div className="narrative-lab">
            <div className="lab-sidebar">
                <h3>🔬 Lab Settings</h3>

                <div className="setting-group">
                    <label>Writing Genre</label>
                    <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                        {GENRES.map(g => (
                            <option key={g.value} value={g.value}>{g.label}</option>
                        ))}
                    </select>
                </div>

                <div className="setting-group">
                    <label>Soul / Style Override</label>
                    <select value={writingStyle} onChange={(e) => setWritingStyle(e.target.value)}>
                        <option value="">Auto (Detect from Genre)</option>
                        <option value="han_viet">Hán Việt (Sangtacviet Style)</option>
                        <option value="thuan_viet">Thuần Việt (Modern/Natural)</option>
                    </select>
                </div>

                <div className="setting-group">
                    <label>NSFW Level</label>
                    <div className="toggle-buttons">
                        <button
                            className={!nsfwMode ? 'active' : ''}
                            onClick={() => { setNsfwMode(false); setSuperNsfwMode(false); }}
                        >OFF</button>
                        <button
                            className={nsfwMode && !superNsfwMode ? 'active' : ''}
                            onClick={() => { setNsfwMode(true); setSuperNsfwMode(false); }}
                        >NORMAL</button>
                        <button
                            className={superNsfwMode ? 'active' : ''}
                            onClick={() => { setNsfwMode(true); setSuperNsfwMode(true); }}
                        >ENI MODE</button>
                    </div>
                    {superNsfwMode && !isPrimed && (
                        <div className="priming-promo">
                            <p>⚠️ Persona chưa được mồi (Prime).</p>
                            <button className="btn btn-accent btn-sm" onClick={primeEni} disabled={isStreaming}>
                                {isStreaming ? <Loader2 size={12} className="spin" /> : 'Mồi Persona ngay (Prime ENI)'}
                            </button>
                        </div>
                    )}
                    {superNsfwMode && isPrimed && (
                        <div className="priming-status">
                            ✅ Persona đã sẵn sàng.
                        </div>
                    )}
                </div>

                <div className="setting-group">
                    <label>Quality Mode</label>
                    <select value={qualityMode} onChange={(e) => setQualityMode(e.target.value)}>
                        <option value="fast">Fast (Flash)</option>
                        <option value="balanced">Balanced (Pro)</option>
                        <option value="best">Best (3.1 Pro High)</option>
                    </select>
                </div>

                <div className="setting-group">
                    <label>Transparency</label>
                    <button onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
                        {showSystemPrompt ? 'Hide' : 'Show'} Last System Prompt
                    </button>
                </div>

                <button className="clear-btn" onClick={clearHistory}>Clear History</button>
            </div>

            <div className="lab-main">
                <div className="chat-window">
                    {messages.length === 0 && (
                        <div className="welcome-msg">
                            <h2>Welcome to Narrative Lab v1.0</h2>
                            <p>Hỏi AI về cốt truyện, hoặc yêu cầu viết thử nghiệm để xem luồng dữ liệu thô.</p>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} className={`message-container ${msg.role}`}>
                            <div className="message-label">{msg.role === 'user' ? 'Gửi từ Tác giả' : 'Phản hồi từ AI'}</div>
                            <div className="message-bubble">
                                {msg.role === 'assistant' ? renderContent(msg.content) : msg.content}
                            </div>
                            {msg.role === 'assistant' && msg.model && (
                                <div className="message-meta">
                                    <span>{msg.provider === 'ollama' ? '🏠' : '☁️'} {msg.model}</span>
                                    {msg.elapsed && <span> · {(msg.elapsed / 1000).toFixed(1)}s</span>}
                                </div>
                            )}
                            {msg.systemPrompt && showSystemPrompt && (
                                <div className="system-debug">
                                    <div className="debug-header">📡 Re-constructed System Prompt (Transparent)</div>
                                    <pre className="debug-content">{msg.systemPrompt}</pre>
                                </div>
                            )}
                        </div>
                    ))}
                    {isStreaming && (
                        <div className="message-container assistant streaming">
                            <div className="message-label">AI đang xử lý...</div>
                            <div className="message-bubble">
                                {renderContent(streamingText)}
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                <div className="chat-input-bar">
                    <textarea
                        placeholder="Nhập tin nhắn..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <button onClick={handleSend} disabled={isStreaming || !input.trim()}>
                        {isStreaming ? '...' : 'Gửi'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NarrativeLab;
