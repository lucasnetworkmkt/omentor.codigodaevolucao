import { GoogleGenAI, GenerateContentResponse, Chat, Part, Content } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";

// --- API KEY MANAGEMENT ---

/**
 * CRITICAL CONFIGURATION FOR VERCEL/VITE:
 * 
 * 1. In Vercel Dashboard, go to Settings > Environment Variables.
 * 2. Key Name MUST be: VITE_API_KEY
 * 3. Value: Your Gemini API Key (starts with AIza...)
 * 4. Redeploy after adding the key.
 * 
 * Vite only exposes variables starting with 'VITE_' to the client-side code.
 */
const getPrimaryApiKey = (): string | undefined => {
    // 1. Standard Vite Way (Preferred) with Safe Access
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
             // @ts-ignore
             if (import.meta.env.VITE_API_KEY) {
                 // @ts-ignore
                 return import.meta.env.VITE_API_KEY;
             }
        }
    } catch (e) {
        // Ignore access errors
    }

    // 2. Fallback for older setups or direct process injection
    try {
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env) {
            // @ts-ignore
            if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
            // @ts-ignore
            if (process.env.API_KEY) return process.env.API_KEY;
        }
    } catch (e) {
        // Ignore access errors
    }
    
    return undefined;
};

const PRIMARY_KEY = getPrimaryApiKey();

// Group A: Main Brain (Chat)
const GROUP_A_KEYS = [
  PRIMARY_KEY
].filter(Boolean) as string[];

// Group B: Mind Maps
const GROUP_B_KEYS = [
  PRIMARY_KEY 
].filter(Boolean) as string[];

// USING STABLE MODEL
const TEXT_MODEL = "gemini-2.0-flash";

// --- STATE MANAGEMENT ---

let currentChatSession: Chat | null = null;

// --- FALLBACK LOGIC ---

const createSession = (apiKey: string, history?: Content[]): Chat => {
  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: TEXT_MODEL,
    history: history,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7,
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingBudget: 0 }, 
    },
  });
};

const getOrInitSession = (): Chat => {
  if (!currentChatSession) {
    // If no key is found, we use a dummy string to allow the UI to load, 
    // but the API call will be caught by the error handler below.
    const keyToUse = GROUP_A_KEYS.length > 0 ? GROUP_A_KEYS[0] : "";
    
    if (keyToUse) {
        currentChatSession = createSession(keyToUse);
    }
  }
  return currentChatSession as Chat;
};

// --- PUBLIC METHODS ---

export const sendMessageToGemini = async (
  message: string,
  imagePart?: { mimeType: string; data: string }
): Promise<string> => {
  
  if (!PRIMARY_KEY) {
      console.error("Mentor AI: API Key is missing.");
      return "ERRO DE CONFIGURAÇÃO (Vercel): \n1. Vá em Settings > Environment Variables. \n2. Adicione a chave com o nome 'VITE_API_KEY'. \n3. Faça um novo Deploy.";
  }

  const parts: Part[] = [{ text: message }];
  if (imagePart) {
    parts.unshift({ inlineData: imagePart });
  }

  try {
    const session = getOrInitSession();
    
    if (!session) {
        throw new Error("Sessão não inicializada.");
    }

    const response: GenerateContentResponse = await session.sendMessage({ message: parts });
    return response.text || "Erro: Sem resposta do Mentor.";

  } catch (error: any) {
    console.warn(`[Mentor AI] Request failed.`, error);

    // Handle Model Not Found (404)
    if (error.toString().includes("404") || error.toString().includes("not found")) {
        return "ERRO CRÍTICO: Modelo de IA não disponível para esta chave. Verifique se sua API Key tem acesso ao Gemini 2.0 Flash.";
    }
    
    // Handle Quota/Overload (429/503)
    if (error.toString().includes("429") || error.toString().includes("503")) {
        return "ERRO: O sistema está sobrecarregado. Aguarde alguns segundos e tente novamente.";
    }

    return "ERRO DE SISTEMA: Verifique sua conexão ou a configuração da API Key.";
  }
};

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

  if (!PRIMARY_KEY) return null;

  try {
      const ai = new GoogleGenAI({ apiKey: PRIMARY_KEY });
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: { temperature: 0.5 }
      });
      return response.text || null;
      
    } catch (error) {
      console.warn(`[MindMap AI] Failed.`, error);
      return null;
    }
};

export const generateMindMapImage = async (prompt: string): Promise<string | null> => {
  return null; 
};