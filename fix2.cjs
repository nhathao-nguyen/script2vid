const fs = require('fs');
let code = fs.readFileSync('script2videoa/server.ts', 'utf8');

const target = `function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (isHardQuotaError(normalized)) {
    return 'Gemini quota exhausted for the current API key/model. Use another key/model, wait for quota reset, or run in an AI Studio environment with available quota.';
  }

  return message || 'Unexpected server error';
}`;

const replacement = `function getErrorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : String(error || '');
  
  // Try to parse ApiError JSON string from @google/genai
  try {
    if (message.startsWith('{') && message.includes('"error"')) {
      const parsed = JSON.parse(message);
      if (parsed.error && parsed.error.message) {
        message = parsed.error.message;
      }
    }
  } catch (e) {
    // Ignore parse errors
  }

  const normalized = message.toLowerCase();

  if (isHardQuotaError(normalized)) {
    return 'Gemini quota exhausted for the current API key/model. Use another key/model, wait for quota reset, or run in an AI Studio environment with available quota.';
  }

  if (normalized.includes('api key not valid')) {
    return 'API key not valid. Please configure a valid Gemini API key in the AI Studio Secrets panel. Make sure there are no extra quotes or spaces.';
  }

  return message || 'Unexpected server error';
}`;

if (code.includes('function getErrorMessage(error: unknown) {')) {
  code = code.replace(target, replacement);
  fs.writeFileSync('script2videoa/server.ts', code);
  console.log('done_getErrorMessage');
} else {
  console.log('not found');
}
