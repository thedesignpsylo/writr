import Groq from 'groq-sdk';
import express from 'express';
import { config } from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, 'client', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Process text (shorten / expand / improve / formal / informal) ─────
app.post('/api/process-text', async (req, res) => {
  const { text, action, ratio } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const percent = Math.round((ratio || 1) * 100);
  const prompts = {
    shorten:  `You are a skilled editor. Rewrite the following text to be approximately ${percent}% of its current length. Cut ruthlessly — remove filler, repetition, and weaker details. Preserve the author's voice, key arguments, and tone. Return only the rewritten text, no preamble.\n\n${text}`,
    expand:   `You are a skilled writer. Expand the following text to approximately ${percent}% of its current length. Add depth, nuance, supporting details, vivid language, and elaboration. Preserve the author's voice and intent. Return only the expanded text, no preamble.\n\n${text}`,
    improve:  `Improve the following text. Enhance vocabulary, fix grammar, improve flow, and make it more engaging and polished. Preserve the author's core message and voice. Return only the improved text, no preamble.\n\n${text}`,
    formal:   `Rewrite the following text in a formal, professional tone suitable for business or academic contexts. Use precise vocabulary and a respectful, objective voice. Return only the rewritten text, no preamble.\n\n${text}`,
    informal: `Rewrite the following text in a casual, warm, conversational tone — like talking to a friend. Make it feel approachable and natural. Return only the rewritten text, no preamble.\n\n${text}`,
  };

  const prompt = prompts[action];
  if (!prompt) return res.status(400).json({ error: 'Unknown action' });

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });
    res.json({ result: completion.choices[0]?.message?.content || '' });
  } catch (err) {
    console.error('Groq error:', err.message);
    res.status(500).json({ error: err?.error?.message || err?.message || 'Failed to process text.' });
  }
});

// ── Merge (returns full text; client animates typewriter) ─────────────
app.post('/api/merge-text', async (req, res) => {
  const { text1, text2 } = req.body;
  if (!text1?.trim() || !text2?.trim()) {
    return res.status(400).json({ error: 'Both nodes need content to merge' });
  }

  const prompt = `You are a skilled content writer. Below are two pieces of content on related topics. Intelligently synthesize and blend them into a single, cohesive, well-structured piece that captures the key ideas and insights from both. It should flow naturally as a unified work — not two sections stitched together. Maintain a consistent voice throughout.\n\nContent A:\n${text1}\n\nContent B:\n${text2}\n\nReturn only the merged content, no preamble.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });
    res.json({ result: completion.choices[0]?.message?.content || '' });
  } catch (err) {
    console.error('Groq merge error:', err.message);
    res.status(500).json({ error: 'Merge failed. Check your API key.' });
  }
});

// ── Enhance selected text (returns suggestion + note) ────────────────
app.post('/api/enhance-text', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const prompt = `You are a skilled writing coach. Enhance the following text to be more vivid, precise, and impactful. Return ONLY a valid JSON object with these two fields:
{
  "enhanced": "the improved version of the exact text",
  "note": "one brief sentence explaining the key improvement"
}

Text: "${text.replace(/"/g, '\\"')}"`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
    });
    const raw = (completion.choices[0]?.message?.content || '').replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    try {
      res.json(JSON.parse(raw));
    } catch {
      res.json({ enhanced: raw, note: '' });
    }
  } catch (err) {
    console.error('Enhance error:', err.message);
    res.status(500).json({ error: 'Failed to enhance text.' });
  }
});

// ── Describe pasted image as JSON (vision model) ──────────────────────
app.post('/api/describe-image', async (req, res) => {
  const { imageBase64, mimeType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  const instruction = `Analyze this image and return ONLY a valid JSON object with these exact fields:
{
  "subject": "main subject or scene (string)",
  "style": "visual style e.g. photorealistic, illustration, oil painting",
  "composition": "layout, framing, perspective",
  "colors": ["dominant", "color", "palette"],
  "lighting": "lighting conditions and direction",
  "mood": "overall mood or atmosphere",
  "elements": ["key", "visual", "elements"],
  "recreate_prompt": "A complete, detailed prompt for an AI image generator (Midjourney / DALL-E / Stable Diffusion) that would recreate this image as accurately as possible"
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.2-11b-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: instruction },
        ],
      }],
      max_tokens: 1024,
    });
    const raw = (completion.choices[0]?.message?.content || '').replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    try {
      JSON.parse(raw);
      res.json({ result: raw });
    } catch {
      res.json({ result: raw });
    }
  } catch (err) {
    console.error('Vision error:', err.message);
    res.status(500).json({ error: 'Failed to analyze image. Vision model may be unavailable.' });
  }
});

// ── Brainstorm chat (adaptive persona) ──────────────────────────
app.post('/api/brainstorm', async (req, res) => {
  const { messages, contextNodes, nodeContext } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' });

  const contextParts = [];
  if (contextNodes?.length)
    contextParts.push('Connected canvas nodes:\n' + contextNodes.map((n, i) => `[Node ${i + 1}]: ${n.content}`).join('\n\n'));
  if (nodeContext?.trim())
    contextParts.push('Starting context from this node:\n' + nodeContext);

  const systemPrompt = `You are an adaptive brainstorm partner embedded in a writing and thinking canvas. Analyze the conversation and detect the domain — then respond as an expert in that space:

• Writing / storytelling → creative collaborator who pushes narrative and voice
• Product / features / UX → product strategist who balances user needs with feasibility
• Design → design thinking facilitator who challenges assumptions
• Business / strategy → strategic advisor who stress-tests ideas
• Engineering / code → technical architect who spots tradeoffs
• Marketing / growth → sharp copywriter and growth thinker

Adapt fluidly as the conversation evolves. Be direct, generative, and specific. Offer concrete ideas. End with one sharp follow-up question to push thinking further. Keep responses focused — no filler.${contextParts.length ? `\n\nCanvas context:\n${contextParts.join('\n\n')}` : ''}`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.text })),
      ],
      max_tokens: 1024,
    });
    res.json({ result: completion.choices[0]?.message?.content || '' });
  } catch (err) {
    console.error('Brainstorm error:', err.message);
    res.status(500).json({ error: 'Brainstorm failed.' });
  }
});

// ── Journal summarize ─────────────────────────────────────────────────
app.post('/api/journal-summarize', async (req, res) => {
  const { text, canvasNodes } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No journal text provided' });

  const contextStr = canvasNodes?.length
    ? '\n\nCurrent canvas nodes for additional context:\n' + canvasNodes.map((c, i) => `[${i + 1}] ${c.slice(0, 200)}`).join('\n')
    : '';

  const prompt = `You are a thoughtful journaling companion. The user has written a personal journal entry. Distill the key themes, insights, patterns, and ideas into a clear, articulate summary. Capture what they are processing, the emotions present, and any implicit questions or intentions. Be empathetic, specific, and useful.${contextStr}\n\nJournal entry:\n${text}\n\nReturn only the summary — no preamble, no labels, just the distilled insight as flowing prose.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    });
    res.json({ result: completion.choices[0]?.message?.content || '' });
  } catch (err) {
    console.error('Journal error:', err.message);
    res.status(500).json({ error: err?.error?.message || err?.message || 'Failed to summarize journal.' });
  }
});

// ── Prompt-to-node (custom style / platform transformation) ──────────
app.post('/api/prompt-node', async (req, res) => {
  const { text, prompt } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'No prompt provided' });

  const fullPrompt = `You are a skilled content writer. Transform the following text according to these specific instructions:\n\n${prompt}\n\nText to transform:\n${text}\n\nReturn only the transformed content, no preamble or explanation.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: fullPrompt }],
      max_tokens: 4096,
    });
    res.json({ result: completion.choices[0]?.message?.content || '' });
  } catch (err) {
    console.error('Groq prompt-node error:', err.message);
    res.status(500).json({ error: 'Failed to transform text.' });
  }
});

// ── Serve built frontend in production (single-service deploy) ────────
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`\n  TextCanvas server → http://localhost:${PORT}\n`));
