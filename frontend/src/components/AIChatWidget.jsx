import React, { useEffect, useRef, useState } from 'react';
import { aiApi } from '../services/api';
import useAiAvailability from '../hooks/useAiAvailability';

const AIChatWidget = () => {
    const { available: aiAvailable } = useAiAvailability();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        { role: 'ai', text: 'Chào quý khách, tôi là trợ lý ảo của Gốm Sứ Đại Thành. Quý khách muốn tìm hiểu dòng gốm nào ạ?' },
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef(null);

    const getChatId = () => localStorage.getItem('ai_chat_id');

    useEffect(() => {
        if (!aiAvailable) return;

        const chatId = getChatId();
        if (!chatId) return;

        const fetchHistory = async () => {
            try {
                const response = await aiApi.getHistory(chatId);
                if (Array.isArray(response.data) && response.data.length > 0) {
                    setMessages(response.data);
                }
            } catch (error) {
                console.error('Could not load chat history', error);
            }
        };

        fetchHistory();
    }, [aiAvailable]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isOpen]);

    const handleSend = async (event) => {
        event.preventDefault();
        if (!input.trim() || isLoading || !aiAvailable) return;

        const nextMessage = input.trim();
        const chatId = getChatId();

        setMessages((prev) => [...prev, { role: 'user', text: nextMessage }]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await aiApi.chat({
                message: nextMessage,
                chat_id: chatId,
            });

            if (response.data?.chat_id && !chatId) {
                localStorage.setItem('ai_chat_id', response.data.chat_id);
            }

            setMessages((prev) => [...prev, { role: 'ai', text: response.data?.answer || response.data?.response || '' }]);
        } catch (error) {
            const fallbackMessage = error?.response?.data?.message || 'Xin lỗi, trợ lý AI đang tạm nghỉ. Quý khách vui lòng thử lại sau ít phút.';
            setMessages((prev) => [...prev, { role: 'ai', text: fallbackMessage }]);
        } finally {
            setIsLoading(false);
        }
    };

    if (!aiAvailable) {
        return null;
    }

    return (
        <div className="fixed bottom-8 right-8 z-[9999]">
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="size-16 bg-primary text-white rounded-full shadow-premium flex items-center justify-center hover:scale-110 transition-transform group animate-bounce-slow"
                >
                    <span className="material-symbols-outlined text-3xl">chat_spark</span>
                    <span className="absolute -top-1 -right-1 bg-brick text-[8px] font-bold px-2 py-1 rounded-full uppercase tracking-tighter">AI tư vấn</span>
                </button>
            )}

            {isOpen && (
                <div className="w-96 bg-white border border-gold/20 shadow-premium flex flex-col animate-in slide-in-from-bottom-10 duration-300">
                    <div className="p-4 bg-primary text-white flex justify-between items-center bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')]">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-full border border-gold/30 flex items-center justify-center bg-white/10">
                                <span className="material-symbols-outlined text-gold">smart_toy</span>
                            </div>
                            <div>
                                <h4 className="font-display font-bold text-sm uppercase tracking-wider">Trợ lý Đại Thành</h4>
                                <div className="flex items-center gap-1">
                                    <span className="size-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                    <span className="text-[8px] uppercase tracking-widest text-gold opacity-80">Trực tuyến</span>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="hover:rotate-90 transition-transform">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div
                        ref={scrollRef}
                        className="h-96 overflow-y-auto p-4 space-y-4 bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')]"
                    >
                        {messages.map((message, index) => (
                            <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] p-3 rounded-none border ${message.role === 'user'
                                    ? 'bg-gold/10 border-gold/30 text-primary rounded-l-xl rounded-t-xl'
                                    : 'bg-white border-stone/10 shadow-sm text-stone rounded-r-xl rounded-t-xl'
                                    }`}
                                >
                                    <p className="text-xs leading-relaxed font-body whitespace-pre-wrap">{message.text}</p>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="p-3 bg-white border border-stone/10 rounded-xl">
                                    <div className="flex gap-1">
                                        <div className="size-1.5 bg-stone/30 rounded-full animate-bounce"></div>
                                        <div className="size-1.5 bg-stone/30 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                                        <div className="size-1.5 bg-stone/30 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSend} className="p-4 border-t border-gold/10 bg-white shadow-inner flex items-center gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            placeholder="Hỏi về bình hoa, quà tặng, đồ thờ..."
                            className="flex-1 bg-background-light border border-gold/20 p-2 text-xs focus:outline-none focus:border-primary font-ui"
                        />
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="size-8 bg-primary text-white flex items-center justify-center hover:bg-umber transition-colors disabled:opacity-50 shadow-md"
                        >
                            <span className="material-symbols-outlined text-sm">send</span>
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
};

export default AIChatWidget;
