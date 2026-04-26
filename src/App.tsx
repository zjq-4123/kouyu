import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import Markdown from 'react-markdown';
import { Globe, Sparkles, Target, CheckCircle, Shuffle, PlusCircle, Mic, MicOff, Send } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Message {
  role: 'user' | 'model' | 'system';
  text: string;
}

const TOPICS = [
  {
    id: 1,
    title: "Ordering at a Café",
    objectives: [
      "Master polite ordering phrases like \"I'd like to have...\"",
      "Ask about daily specials and drink sizes.",
      "Practice handling the bill and tipping etiquette."
    ],
    keywords: ["Espresso", "Croissant", "Here or to go", "Receipt", "Decaf"]
  },
  {
    id: 2,
    title: "Travel: Hotel Check-in",
    objectives: [
      "Present your reservation details clearly.",
      "Ask about breakfast times and hotel amenities.",
      "Request a late checkout or room upgrade."
    ],
    keywords: ["Reservation", "Deposit", "Available", "Luggage", "Keycard"]
  },
  {
    id: 3,
    title: "Travel: Directions",
    objectives: [
      "Ask how to get to a specific landmark or train station.",
      "Understand directions involving streets and blocks.",
      "Ask for estimated walking or transit time."
    ],
    keywords: ["Straight ahead", "Intersection", "Subway", "Block", "Crosswalk"]
  },
  {
    id: 4,
    title: "Job Interview",
    objectives: [
      "Introduce yourself and your background professionally.",
      "Describe your past work experience clearly.",
      "Answer common questions about strengths and weaknesses."
    ],
    keywords: ["Experience", "Strengths", "Teamwork", "Goals", "Resume"]
  },
  {
    id: 5,
    title: "Travel: Airport",
    objectives: [
      "Hand over your passport and ticket.",
      "Answer security questions about your luggage.",
      "Ask about the boarding gate and departure time."
    ],
    keywords: ["Boarding pass", "Baggage drop", "Security", "Aisle seat", "Delayed"]
  },
  {
    id: 6,
    title: "Making Small Talk",
    objectives: [
      "Start a friendly conversation about the weather.",
      "Discuss weekend plans or hobbies.",
      "Politely excuse yourself from the conversation."
    ],
    keywords: ["Weather", "Weekend", "Hobbies", "Interesting", "Catch up"]
  }
];

function encodeBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function App() {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: `Bonjour! Welcome to our virtual café. I'm your server today. Are you ready to order or would you like to see the specials?` }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleShuffleTopic = () => {
    const remaining = TOPICS.filter(t => t.id !== topic.id);
    const nextTopic = remaining[Math.floor(Math.random() * remaining.length)];
    setTopic(nextTopic);
    
    // Add a transitional message
    setMessages((prev) => [
      ...prev, 
      { role: 'system', text: `Topic changed to: ${nextTopic.title} - You can begin practicing whenever you're ready!` }
    ]);
  };

  const stopLive = () => {
    setIsLive(false);
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => {
        try {
          session.close();
        } catch (e) {
          // ignore
        }
      });
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const playBase64Audio = (base64: string) => {
    if (!audioContextRef.current) return;
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    let pcm16: Int16Array;
    if (bytes.byteLength % 2 !== 0) {
       const padded = new Uint8Array(bytes.byteLength + 1);
       padded.set(bytes);
       pcm16 = new Int16Array(padded.buffer);
    } else {
       pcm16 = new Int16Array(bytes.buffer);
    }
    
    const float32Data = new Float32Array(pcm16.length);
    for(let i=0; i<pcm16.length; i++){
        float32Data[i] = pcm16[i] / 32768.0;
    }

    const audioCtx = audioContextRef.current;
    const audioBuffer = audioCtx.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);
    
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    
    const playTime = Math.max(audioCtx.currentTime, nextPlayTimeRef.current || 0);
    source.start(playTime);
    nextPlayTimeRef.current = playTime + audioBuffer.duration;
  };

  const startLive = async () => {
    try {
      setIsLive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      nextPlayTimeRef.current = audioCtx.currentTime;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(audioCtx.destination);
      
      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log("Live session opened");
            setMessages((prev) => [...prev, { role: 'system', text: 'Voice session started. Listening...' }]);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.interrupted) {
               nextPlayTimeRef.current = 0; // stop queueing
            }
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
               playBase64Audio(base64Audio);
            }
          },
          onclose: () => {
            console.log("Live session closed");
            stopLive();
            setMessages((prev) => [...prev, { role: 'system', text: 'Voice session ended.' }]);
          },
          onerror: (err: any) => {
            console.error("Live session error", err);
            stopLive();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `You are an encouraging and friendly English spoken-language practice partner. Keep conversations natural. Gently correct obvious English grammar or vocabulary mistakes. The current topic we are practicing is: "${topic.title}". Please stay on this topic and help the user practice English.`,
        }
      });
      sessionRef.current = sessionPromise;
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        const base64Data = encodeBase64(pcm16.buffer);
        
        sessionPromise.then((session: any) => {
            session.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
            });
        }).catch((err: any) => console.error(err));
      };
      
    } catch (err) {
      console.error(err);
      setIsLive(false);
      setMessages((prev) => [...prev, { role: 'model', text: 'Failed to access microphone or start live session.' }]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLive) return;

    const userMessage = { role: 'user' as const, text: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const contents = messages
        .filter(m => !m.text.includes('Voice session'))
        .map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })).concat([{ role: 'user', parts: [{ text: userMessage.text }] }]);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          systemInstruction: `You are an encouraging and friendly English spoken-language practice partner. Keep conversations natural. Gently correct obvious English grammar or vocabulary mistakes. The current topic we are practicing is: "${topic.title}". Please stay on this topic and help the user practice English.`,
        }
      });
      
      const text = response.text || '';
      setMessages((prev) => [...prev, { role: 'model', text }]);
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      setMessages((prev) => [...prev, { role: 'model', text: 'Oops! Something went wrong. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-surface-container-low text-on-background font-sans overflow-hidden p-4 md:p-6 lg:p-8 gap-6 flex-col lg:flex-row">
      
      {/* Left Column: Topic Generator module */}
      <div className="flex-none w-full lg:w-[400px] flex flex-col gap-6">
        <div className="flex items-center gap-4 bg-white p-5 rounded-card shadow-sm border border-slate-100 shrink-0">
          <div className="w-12 h-12 bg-primary-container rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/20 shrink-0">
            <Globe className="w-7 h-7 md:w-8 md:h-8" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-indigo-600 leading-none mb-1">LingoBuddy</h1>
            <p className="text-xs md:text-[13px] font-medium text-slate-500">English Speaking Partner</p>
          </div>
        </div>

        <div className="bg-white rounded-card p-6 shadow-sm border border-slate-100 flex-1 flex flex-col pt-8 relative overflow-hidden min-h-0 overflow-y-auto">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-tertiary to-primary"></div>
          
          <div className="flex items-center gap-3 mb-6 shrink-0">
            <div className="w-12 h-12 bg-tertiary-fixed rounded-2xl flex items-center justify-center text-tertiary shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] md:text-xs font-bold text-tertiary uppercase tracking-wider drop-shadow-sm">Current Topic</span>
              <h3 className="text-xl md:text-2xl font-bold text-on-surface mt-1">{topic.title}</h3>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs md:text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 md:w-5 md:h-5" />
                Learning Objectives
              </h4>
              <ul className="space-y-3">
                {topic.objectives.map((obj, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="text-indigo-500 mt-0.5 w-5 h-5 md:w-6 md:h-6 shrink-0" />
                    <span className="text-sm md:text-[15px] leading-relaxed text-on-surface-variant flex-1">{obj}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs md:text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">Target Keywords</h4>
              <div className="flex flex-wrap gap-2">
                {topic.keywords.map((kw, i) => (
                  <span key={i} className="px-2.5 py-1 md:px-3 md:py-1.5 bg-slate-50 text-slate-700 text-xs md:text-sm font-semibold rounded-lg border border-slate-100">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          </div>
          
          <div className="mt-auto pt-8 shrink-0">
            <button 
              onClick={handleShuffleTopic}
              className="w-full py-3.5 md:py-4 bg-surface-container hover:bg-surface-container-high text-primary rounded-2xl font-bold flex flex-row items-center justify-center gap-2 transition-all duration-200 active:scale-95 text-sm md:text-base"
            >
              <Shuffle className="w-5 h-5" />
              Generate New Topic
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Main Chat Window */}
      <div className="flex-1 flex flex-col h-full bg-white rounded-card shadow-sm border border-slate-100 overflow-hidden relative min-h-0">
        {/* Chat Header */}
        <div className="px-6 py-4 border-b border-slate-50 flex items-center justify-between shadow-sm z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center overflow-hidden border border-indigo-100">
                <img className="w-full h-full object-cover" src="https://api.dicebear.com/7.x/bottts/svg?seed=Tutor&backgroundColor=e0e7ff" alt="Tutor avatar" />
              </div>
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
            </div>
            <div>
              <h3 className="text-sm md:text-[15px] font-bold text-on-surface leading-none">English AI Tutor</h3>
              <span className="text-[11px] md:text-[13px] font-medium text-emerald-600 mt-1 flex items-center gap-1">
                {isLive ? (
                  <>
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    Voice session active...
                  </>
                ) : 'Online'}
              </span>
            </div>
          </div>
          {isLive && (
            <button 
              onClick={stopLive}
              className="px-4 py-1.5 bg-error-container text-on-error-container text-xs font-bold rounded-full hover:bg-error/20 transition-colors"
            >
              End Call
            </button>
          )}
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 chat-scroll bg-slate-50/30">
          {messages.map((m, idx) => (
            m.role === 'system' ? (
              <div key={idx} className="flex justify-center my-4 opacity-80 transition-opacity hover:opacity-100">
                <div className="bg-slate-200/60 text-slate-600 px-4 py-2 rounded-full text-xs font-semibold tracking-wide flex items-center gap-2 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5" />
                  {m.text}
                </div>
              </div>
            ) : m.role === 'model' ? (
              <div key={idx} className="flex items-end gap-3 max-w-[85%]">
                <div className="w-8 h-8 rounded-full bg-indigo-50 shadow-sm flex-shrink-0 flex items-center justify-center border border-indigo-100 overflow-hidden">
                  <img className="w-full h-full object-cover" src="https://api.dicebear.com/7.x/bottts/svg?seed=Tutor&backgroundColor=e0e7ff" alt="AI Icon" />
                </div>
                <div className="bg-white p-3 md:p-4 rounded-2xl rounded-bl-none shadow-sm border border-slate-100">
                  <div className="text-sm md:text-[15px] leading-relaxed text-slate-800 prose prose-slate max-w-none prose-p:leading-relaxed prose-p:text-sm md:prose-p:text-[15px]">
                    <Markdown>{m.text}</Markdown>
                  </div>
                </div>
              </div>
            ) : (
              <div key={idx} className="flex items-end gap-3 max-w-[85%] ml-auto flex-row-reverse">
                <div className="w-8 h-8 rounded-full bg-primary-container flex-shrink-0 flex items-center justify-center border border-indigo-100 overflow-hidden">
                  <img className="w-full h-full object-cover" src="https://api.dicebear.com/7.x/adventurer/svg?seed=Felix&backgroundColor=c7d2fe" alt="User" />
                </div>
                <div className="bg-primary p-3 md:p-4 rounded-2xl rounded-br-none shadow-md shadow-indigo-200">
                  <p className="text-sm md:text-[15px] leading-relaxed text-white whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            )
          ))}

          {isLoading && (
            <div className="flex items-end gap-3 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-indigo-50 shadow-sm flex-shrink-0 flex items-center justify-center border border-indigo-100 overflow-hidden">
                <img className="w-full h-full object-cover" src="https://api.dicebear.com/7.x/bottts/svg?seed=Tutor&backgroundColor=e0e7ff" alt="AI Icon" />
              </div>
              <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-none shadow-sm border border-slate-100 flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-indigo-200 rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} className="h-px" />
        </div>

        {/* Chat Input Area */}
        <div className="p-4 md:p-6 bg-white border-t border-slate-50 shrink-0">
          <div className={`flex items-center gap-3 md:gap-4 rounded-full px-4 sm:px-6 py-2 sm:py-3 border focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all duration-200 ${isLive ? 'bg-error-container/10 border-error-container/30' : 'bg-surface-container-low border-indigo-50'}`}>
            <button className="text-slate-400 hover:text-primary transition-colors flex-shrink-0 hidden sm:block">
              <PlusCircle className="w-6 h-6" />
            </button>
            <input 
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm md:text-[15px] placeholder:text-slate-400 focus:outline-none min-w-0" 
              placeholder={isLive ? "Speaking... (Voice mode active)" : "Type your response here..."}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isLive}
            />
            <div className="flex items-center gap-2 shrink-0">
              <button 
                className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all flex-shrink-0 relative ${
                  isLive ? 'bg-error text-white shadow-lg shadow-error/30 scale-105' : 'bg-indigo-50 text-primary hover:bg-indigo-100'
                }`}
                onClick={isLive ? stopLive : startLive}
                title={isLive ? "Stop speaking" : "Start voice chat"}
              >
                {isLive && (
                  <span className="absolute inset-0 rounded-full border-2 border-error animate-ping opacity-75"></span>
                )}
                {isLive ? <MicOff className="w-6 h-6 absolute" /> : <Mic className="w-6 h-6 absolute" />}
              </button>
              <button 
                className="w-10 h-10 md:w-12 md:h-12 bg-primary text-white rounded-full flex items-center justify-center shadow-md shadow-indigo-200 hover:scale-105 active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 disabled:hover:scale-100"
                onClick={handleSend}
                disabled={!input.trim() || isLoading || isLive}
              >
                <Send className="w-5 h-5 ml-0.5" />
              </button>
            </div>
          </div>
          <p className="text-center text-[10px] text-slate-400 mt-4 font-medium uppercase tracking-widest hidden sm:block">
            Powered by LingoBuddy AI • Real-time Grammar Feedback On
          </p>
        </div>
      </div>

    </div>
  );
}
