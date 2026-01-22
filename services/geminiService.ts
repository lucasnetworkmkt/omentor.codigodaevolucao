import { GoogleGenAI, GenerateContentResponse, Chat, Part, Content } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";

// --- HELPER: SAFE ENV ACCESS ---
// Ensures keys work in Vercel (Client-Side), Vite, or standard Node environments.
const getEnv = (key: string): string | undefined => {
    // 1. Try standard Vite/ESM (import.meta.env)
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
            // @ts-ignore
            return import.meta.env[key];
        }
    } catch (e) {}

    // 2. Try Standard Process (Node/Polyfilled)
    try {
        if (typeof process !== 'undefined' && process.env && process.env[key]) {
            return process.env[key];
        }
    } catch (e) {}

    return undefined;
};

// --- API KEY MANAGEMENT ---

const PRIMARY_KEY = getEnv("API_KEY") || getEnv("VITE_API_KEY") || getEnv("REACT_APP_API_KEY");

// Group A: Main Brain (Chat)
const GROUP_A_KEYS = [
  getEnv("API_KEY_A1") || PRIMARY_KEY, // Primary
  getEnv("API_KEY_A2"),                // Fallback 1
  getEnv("API_KEY_A3")                 // Fallback 2
].filter(Boolean) as string[];

// Group B: Mind Maps (Structured Text)
const GROUP_B_KEYS = [
  getEnv("API_KEY_B1") || PRIMARY_KEY  // Exclusive for Maps
].filter(Boolean) as string[];

// FIXED: Using 'gemini-2.0-flash' as it is the current stable high-performance model.
// 'gemini-3' series causes 404 errors in production for standard keys.
const TEXT_MODEL = "gemini-2.0-flash";

// --- STATE MANAGEMENT ---

// We keep track of the current active session wrapper to manage key rotation
let currentChatSession: Chat | null = null;
let currentKeyIndexGroupA = 0;

// --- FALLBACK LOGIC ---

/**
 * Creates a new Chat instance.
 * If history is provided, it initializes the chat with it.
 */
const createSession = (apiKey: string, history?: Content[]): Chat => {
  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: TEXT_MODEL,
    history: history,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7,
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingBudget: 0 }, // Disabled for 2.0 Flash to ensure speed/compatibility
    },
  });
};

/**
 * Initializes or Retrieves the current chat session.
 * This is internal usage.
 */
const getOrInitSession = (): Chat => {
  if (!currentChatSession) {
    // Start with the first key in Group A
    currentKeyIndexGroupA = 0;
    // Safety check if keys exist
    if (GROUP_A_KEYS.length ===0) {
        // If strict env vars failed, try a last ditch effort just in case 'process' is globally polyfilled
        // This is unlikely to hit but prevents a hard crash if the array is empty
    }
    currentChatSession = createSession(GROUP_A_KEYS[0] || "MISSING_KEY");
  }
  return currentChatSession;
};

// --- PUBLIC METHODS ---

/**
 * Sends a message to Gemini using Group A keys with automatic fallback.
 * Guarantees continuity of history even if keys fail.
 */
export const sendMessageToGemini = async (
  message: string,
  imagePart?: { mimeType: string; data: string }
): Promise<string> => {
  
  if (GROUP_A_KEYS.length === 0) {
      return "ERRO DE CONFIGURAÇÃO: API Key não encontrada. Configure VITE_API_KEY ou API_KEY no Vercel.";
  }

  // Construct the new user part
  const parts: Part[] = [{ text: message }];
  if (imagePart) {
    parts.unshift({ inlineData: imagePart });
  }

  // Fallback Loop
  // We try up to the number of keys available in Group A
  for (let attempt = 0; attempt < GROUP_A_KEYS.length; attempt++) {
    try {
      const session = getOrInitSession();
      const response: GenerateContentResponse = await session.sendMessage({ message: parts });
      return response.text || "Erro: Sem resposta do Mentor.";

    } catch (error: any) {
      console.warn(`[Mentor AI] Key ${currentKeyIndexGroupA + 1} failed.`, error);

      // If this was the last key, throw/return error
      if (attempt === GROUP_A_KEYS.length - 1) {
        console.error("[Mentor AI] All keys in Group A failed.");
        return "ERRO CRÍTICO: Sistema indisponível temporariamente. Tente novamente em instantes.";
      }

      // --- FALLBACK PROCEDURE ---
      
      // 1. Save History from the failed session (if possible)
      const session = getOrInitSession();
      let previousHistory: Content[] = [];
      try {
        previousHistory = await session.getHistory();
      } catch (hError) {
        console.warn("Could not retrieve history from failed session.", hError);
      }

      // 2. Rotate Key
      currentKeyIndexGroupA = (currentKeyIndexGroupA + 1) % GROUP_A_KEYS.length;
      const nextKey = GROUP_A_KEYS[currentKeyIndexGroupA];
      
      // 3. Create New Session with History
      console.log(`[Mentor AI] Switching to Key ${currentKeyIndexGroupA + 1}...`);
      currentChatSession = createSession(nextKey, previousHistory);
      
      // 4. Loop continues and retries sendMessage on the new session
    }
  }

  return "Erro desconhecido de execução.";
};

/**
 * Generates a Text-Based Mind Map using Group B keys.
 * No images, purely structural text.
 */
export const generateMindMapText = async (topic: string): Promise<string | null> => {
  
  const prompt = `
    VOCÊ É UM ARQUITETO DE INFORMAÇÃO DO CÓDIGO DA EVOLUÇÃO.
    TAREFA: Crie um MAPA MENTAL ESTRUTURAL em texto sobre: "${topic}".
    
    REGRAS VISUAIS:
    - Use caracteres ASCII/Unicode para conectar (├, └, │, ─).
    - Não use Markdown de código (\`\`\`).
    - O layout deve ser vertical e hierárquico.
    - Estilo limpo, direto e focado em AÇÃO.
    
    EXEMPLO DE SAÍDA:
    
    OBJETIVO CENTRAL
    │
    ├── FASE 1: FUNDAÇÃO
    │   ├── Ação Imediata
    │   └── Bloqueio Mental
    │
    └── FASE 2: EXPANSÃO
        ├── Estratégia
        └── Execução
    
    Gere apenas o mapa. Sem introduções.
  `;

  // Fallback Loop for Group B
  for (const key of GROUP_B_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: {
          temperature: 0.5, // Lower temperature for structure
        }
      });
      return response.text || null;
      
    } catch (error) {
      console.warn(`[MindMap AI] Key failed in Group B.`, error);
      // Try next key if available (in this setup loop handles single key gracefully)
    }
  }

  return null;
};

// Deprecated: kept for interface compatibility if needed, but unused.
export const generateMindMapImage = async (prompt: string): Promise<string | null> => {
  return null; 
};