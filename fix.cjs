const fs = require('fs');
let code = fs.readFileSync('script2videoa/server.ts', 'utf8');

const replacement = `function getGeminiClient() {
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is missing or invalid. Please configure your API key in the Secrets panel.');
  }
  apiKey = apiKey.replace(/^["']|["']$/g, '').trim();`;

code = code.replace(/function getGeminiClient\(\) \{[\s\n\r]*const apiKey = process\.env\.GEMINI_API_KEY;[\s\n\r]*if \(\!apiKey\) \{[\s\n\r]*throw new Error\('GEMINI_API_KEY is not configured'\);/, replacement);
fs.writeFileSync('script2videoa/server.ts', code);
console.log('done2');
