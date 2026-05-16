import { GoogleGenAI } from '@google/genai';

const GEMINI_MODEL = 'gemini-2.5-flash';

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!geminiClient) {
    let apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) apiKey = apiKey.replace(/^["']|["']$/g, '').trim();
    geminiClient = new GoogleGenAI({ apiKey: apiKey || '' });
  }
  return geminiClient;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stringifyError(error: unknown) {
  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 6): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = stringifyError(error);
      const isRateLimit =
        errorStr.includes('429') ||
        errorStr.includes('rate_limit') ||
        errorStr.includes('resource_exhausted') ||
        errorStr.includes('quota') ||
        error?.status === 429 ||
        error?.code === 429;

      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 5000 + Math.random() * 2000 + 5000;
        console.warn(`Gemini rate limit. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function generateGeminiText(prompt: string, responseMimeType?: string, responseSchema?: any) {
  return callWithRetry(async () => {
    const request: any = {
      model: GEMINI_MODEL,
      contents: prompt,
    };

    if (responseMimeType || responseSchema) {
      request.config = {};
      if (responseMimeType) request.config.responseMimeType = responseMimeType;
      if (responseSchema) request.config.responseSchema = responseSchema;
    }

    const response = await getGeminiClient().models.generateContent(request);
    return response.text || '';
  });
}

function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr.trim();
  const stack: string[] = [];
  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === '{') stack.push('}');
    else if (fixed[i] === '[') stack.push(']');
    else if ((fixed[i] === '}' || fixed[i] === ']') && stack.at(-1) === fixed[i]) stack.pop();
  }
  while (stack.length > 0) fixed += stack.pop();
  return fixed;
}

function parseGeminiJson<T>(text: string): T {
  let jsonString = text.trim();
  if (jsonString.startsWith('\`\`\`json')) jsonString = jsonString.slice(7);
  else if (jsonString.startsWith('\`\`\`')) jsonString = jsonString.slice(3);
  if (jsonString.endsWith('\`\`\`')) jsonString = jsonString.slice(0, -3);
  jsonString = jsonString.trim();

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    try {
      return JSON.parse(tryFixJson(jsonString));
    } catch (fallbackError) {
      console.error('Failed to parse JSON:', jsonString.substring(0, 200) + '...');
      throw error;
    }
  }
}

export async function processGlobalContext(script: string, targetRegion?: string): Promise<string> {
  const prompt = `
Task: Analyze script for "Cinematic North Star".
Output: mood, theme, style, environment (<100 words).

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.` : '- No explicit target region. Infer from script context and named entities.'}

STRICT VISUAL GROUNDING RULES:
1. NO HARDCODING: Do not assume any default country.
2. CONSISTENCY: Every scene must follow the same geographic logic.
3. VISUAL GEO-ALIGNMENT: All environment and character descriptions must reflect the target region.

Script: ${script}
`;

  try {
    const text = await generateGeminiText(prompt);
    return text || 'Cinematic storytelling.';
  } catch (error) {
    console.error('Gemini Context Error:', error);
    throw error;
  }
}

export async function processSentenceBatch(
  sentences: { id: number; text: string }[],
  context: string,
  languageMode: string,
  targetRegion?: string
): Promise<any> {
  const searchLanguageRule = languageMode === 'original'
    ? '- MEDIA QUERIES: Prefer the original script language when it improves search relevance; keep named places and cultural terms intact.'
    : '- MEDIA QUERIES: Write all media_queries in clear English for broad stock-media search coverage.';

  const prompt = `
Task: Analyze a list of sentences and break each sentence into one or more visual scenes.

GLOBAL CONTEXT: ${context}

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.
- characters -> must match local population of ${targetRegion}.
- architecture/streets -> must match ${targetRegion} local style.
- signage/text in visuals -> use ${targetRegion} local language.` : '- No explicit target region. Infer from script context and named entities.'}

### MEDIA RETRIEVAL ARCHITECTURE: SEMANTIC INTENT ###
Your responsibility is strictly:
1. SEMANTIC ANALYSIS: Strictly parse the core literal subjects, objects, and actions of the scene.
2. ACCURACY & RELEVANCE: Ensure the generated visuals precisely and literally match the text content. No cinematic reasoning is needed—prioritize accuracy and relevance to the original text over artistic style.
3. KEYWORD GENERATION (SEARCH INTENT):
   - Provide "media_queries" as a list of 3-5 highly accurate, literal search queries that precisely pinpoint the content.
   - DIVERSIFY SEARCH ANGLES: Try variations focusing purely on the core subjects, relevant actions, and specific locations described.
   - Keywords MUST strictly align with the actual content and context (geo-aware using the Target Region), bypassing unnecessary cinematic terms.
   - KEEP IT CONCISE: Avoid full sentences. Use 2-4 direct nouns/adjectives. Avoid adding overly descriptive cinematic phrases.
   - NO HALLUCINATION: Do not assume media exists or provide fake URLs.
${searchLanguageRule}
   - For real people, politicians, celebrities, organizations, real events, maps, or historical references, queries MUST include the exact entity name.
   - For any named public figure, use real-person/documentary queries such as "[exact name] portrait", "[exact name] speech", "[exact name] official photo", not generic nature or symbolic footage.
   - Do not replace named entities with metaphors, landscapes, moods, or generic stock footage.

RULES:
- SCENE SPLITTING CRITICAL REQUIREMENT: A single sentence often contains multiple actions, subjects, or evolving context. YOU MUST SPLIT a complex sentence into 2, 3, or more separate scenes to ensure visual diversity and accurately match the text's progression. Do NOT constrain yourself to 1 scene per sentence.
- You MUST create AT LEAST ONE scene for EACH sentence in the list. The "scenes" array for each sentence MUST NOT be empty.
- Decide if VIDEO (motion) or IMAGE (static) is better based on the action described.
- STICK TO THE ORIGINAL TEXT. DO NOT SUMMARIZE.

Sentences to analyze:
${sentences.map(s => `[Sentence #${s.id}]: ${s.text}`).join('\n')}

Output Format Requirements:
- "vietnamese_translation": Dịch toàn bộ câu sang tiếng Việt (mượt mà, tự nhiên).
- "scenes": Array of objects.
- "scene_summary": English summary for LLM context.
- "visual_meaning": The core visual focus of this scene.
- "emotion": Mood (e.g., Hopeful, Tense, Peaceful).
- "style": Cinematic/Natural/Abstract/Documentary.
- "media_type": video or image.
- "search_intent": stock, real_person, real_event, place, documentary, or abstract.
- "entity_names": exact named person/place/org/event if present.
- "keywords": list of keywords.
- "media_queries": contextual search queries with regional grounding.
- "camera_style": Shot type (e.g., High Angle, Extreme Close Up).
- "visual_description": Detailed visual intention including ethnicity, environment, and focal point.
`;

  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        sentence_id: { type: "number" },
        sentence_text: { type: "string" },
        vietnamese_translation: { type: "string" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_id: { type: "number" },
              visual_target: { type: "string" },
              scene_summary: { type: "string" },
              visual_meaning: { type: "string" },
              emotion: { type: "string" },
              style: { type: "string" },
              media_type: { type: "string", enum: ["video", "image"] },
              search_intent: { type: "string", enum: ["stock", "real_person", "real_event", "place", "documentary", "abstract"] },
              entity_names: { type: "array", items: { type: "string" } },
              keywords: { type: "array", items: { type: "string" } },
              media_queries: { type: "array", items: { type: "string" } },
              camera_style: { type: "string" },
              visual_description: { type: "string" }
            },
            required: ["scene_id", "scene_summary", "visual_meaning", "media_type", "search_intent", "media_queries", "visual_description"]
          }
        },
        export_file: { type: "string" }
      },
      required: ["sentence_id", "sentence_text", "vietnamese_translation", "scenes", "export_file"]
    }
  };

  try {
    const text = await generateGeminiText(prompt, 'application/json', schema);
    return parseGeminiJson<unknown>(text);
  } catch (error) {
    console.error('Gemini Analyze Batch Error:', error);
    throw error;
  }
}

export async function processSentence(
  sentence: string,
  sentenceId: number,
  context: string,
  languageMode: string,
  targetRegion?: string
): Promise<any> {
  const searchLanguageRule = languageMode === 'original'
    ? '- MEDIA QUERIES: Prefer the original script language when it improves search relevance; keep named places and cultural terms intact.'
    : '- MEDIA QUERIES: Write all media_queries in clear English for broad stock-media search coverage.';

  const prompt = `
Task: Analyze the following sentence and break it into one or more visual scenes.
Sentence #${sentenceId}: "${sentence}"

GLOBAL CONTEXT: ${context}

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.` : '- No explicit target region. Infer from script context and named entities.'}

### MEDIA RETRIEVAL ARCHITECTURE: SEMANTIC INTENT ###
Your responsibility is strictly:
1. SEMANTIC ANALYSIS: Strictly parse the core literal subjects, objects, and actions of the scene.
2. ACCURACY & RELEVANCE: Ensure the generated visuals precisely and literally match the text content. No cinematic reasoning is needed—prioritize accuracy and relevance to the original text over artistic style.
3. KEYWORD GENERATION (SEARCH INTENT):
   - Provide "media_queries" as a list of 3-5 highly accurate, literal search queries that precisely pinpoint the content.
   - DIVERSIFY SEARCH ANGLES: Try variations focusing purely on the core subjects, relevant actions, and specific locations described.
   - Keywords MUST strictly align with the actual content and context (geo-aware using the Target Region), bypassing unnecessary cinematic terms.
   - KEEP IT CONCISE: Avoid full sentences. Use 2-4 direct nouns/adjectives. Avoid adding overly descriptive cinematic phrases.
   - NO HALLUCINATION: Do not assume media exists or provide fake URLs.
${searchLanguageRule}
   - For real people, politicians, celebrities, organizations, real events, maps, or historical references, queries MUST include the exact entity name.
   - For any named public figure, use real-person/documentary queries such as "[exact name] portrait", "[exact name] speech", "[exact name] official photo", not generic nature or symbolic footage.
   - Do not replace named entities with metaphors, landscapes, moods, or generic stock footage.

RULES:
- SCENE SPLITTING CRITICAL REQUIREMENT: A single sentence often contains multiple actions, subjects, or evolving context. YOU MUST SPLIT a complex sentence into 2, 3, or more separate scenes to ensure visual diversity and accurately match the text's progression. Do NOT constrain yourself to 1 scene per sentence.
- You MUST create AT LEAST ONE scene for the sentence, even if it is short or abstract. The "scenes" array MUST NOT be empty.
- Decide if VIDEO (motion) or IMAGE (static) is better based on the action described.
- If the scene depends on a real person, exact event, document, map, or factual archive, prefer IMAGE unless the sentence explicitly needs motion.
- STICK TO THE ORIGINAL TEXT. DO NOT SUMMARIZE.

Output Format Requirements:
- "vietnamese_translation": Dịch toàn bộ câu sang tiếng Việt (mượt mà, tự nhiên).
- "scenes": Array of objects.
- "scene_summary": English summary for LLM context.
- "visual_meaning": The core visual focus of this scene.
- "emotion": Mood (e.g., Hopeful, Tense, Peaceful).
- "style": Cinematic/Natural/Abstract/Documentary.
- "media_type": video or image.
- "search_intent": stock, real_person, real_event, place, documentary, or abstract.
- "entity_names": exact named person/place/org/event if present.
- "keywords": list of keywords.
- "media_queries": contextual search queries with regional grounding.
- "camera_style": Shot type (e.g., High Angle, Extreme Close Up).
- "visual_description": Detailed visual intention including ethnicity, environment, and focal point.
`;

  const schema = {
    type: "object",
    properties: {
      sentence_id: { type: "number" },
      sentence_text: { type: "string" },
      vietnamese_translation: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scene_id: { type: "number" },
            visual_target: { type: "string" },
            scene_summary: { type: "string" },
            visual_meaning: { type: "string" },
            emotion: { type: "string" },
            style: { type: "string" },
            media_type: { type: "string", enum: ["video", "image"] },
            search_intent: { type: "string", enum: ["stock", "real_person", "real_event", "place", "documentary", "abstract"] },
            entity_names: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            media_queries: { type: "array", items: { type: "string" } },
            camera_style: { type: "string" },
            visual_description: { type: "string" }
          },
          required: ["scene_id", "scene_summary", "visual_meaning", "media_type", "search_intent", "media_queries", "visual_description"]
        }
      },
      export_file: { type: "string" }
    },
    required: ["sentence_id", "sentence_text", "vietnamese_translation", "scenes", "export_file"]
  };

  try {
    const text = await generateGeminiText(prompt, 'application/json', schema);
    return parseGeminiJson<unknown>(text);
  } catch (error) {
    console.error('Gemini Analyze Error:', error);
    throw error;
  }
}
