// generate_drill tool — voice-driven fill-in-the-blank quiz generation. Two modes:
//   1. Caller (model) supplies questions explicitly — e.g. picked from current
//      conversation context. Use this whenever the model has good grammar or
//      vocabulary practice ideas of its own.
//   2. Caller supplies only `topic` — fall back to a curated starter pack.
//      The pack closest to topic keywords is picked.
//
// After generation, we enqueue a switch_tab cmd so the user is auto-taken to
// Tab 2 — they don't have to find it themselves.

import { createFillBlankArtifact } from '../fill-blank-template.mjs';
import { recordAppState } from './app-state.mjs';

let injectQueue = null;
export function bindCmdEnqueuer(fn) { injectQueue = fn; }

// Mirrors DrillView.swift's `packs` (intentional: same set, both sides). When
// model uses a topic-only call we match here; full set is also available so
// the model can list options if asked.
const STARTER_PACKS = {
  restaurant: { topic: 'Restaurant English', questions: [
    { sentence: 'Could I see the ____, please?', answer: 'menu', options: ['menu', 'ticket', 'platform', 'lobby'] },
    { sentence: "I'd like to ____ the chicken pasta.", answer: 'order', options: ['order', 'depart', 'transfer'] },
    { sentence: 'Can we have the ____, please?', answer: 'check', options: ['check', 'floor', 'luggage', 'reservation'] },
    { sentence: 'What dish do you ____?', answer: 'recommend', options: ['recommend', 'wait', 'arrive'] },
    { sentence: 'We would like an ____ before the main course.', answer: 'appetizer', options: ['appetizer', 'airport', 'receipt'] },
  ]},
  travel: { topic: 'Travel & Directions', questions: [
    { sentence: 'Which ____ does the train leave from?', answer: 'platform', options: ['platform', 'waiter', 'menu', 'key card'] },
    { sentence: 'I need to buy a ____ to Boston.', answer: 'ticket', options: ['ticket', 'lobby', 'breakfast'] },
    { sentence: 'Do I need to ____ at the next station?', answer: 'transfer', options: ['transfer', 'recommend', 'check-in'] },
    { sentence: 'Where can I pick up my ____?', answer: 'luggage', options: ['luggage', 'appetizer', 'floor'] },
    { sentence: 'What time is the ____?', answer: 'departure', options: ['departure', 'reservation', 'latte'] },
  ]},
  hotel: { topic: 'Hotel Check-in', questions: [
    { sentence: 'I have a ____ under the name Chen.', answer: 'reservation', options: ['reservation', 'station', 'appetizer'] },
    { sentence: 'What time can I ____?', answer: 'check-in', options: ['check-in', 'order', 'transfer'] },
    { sentence: 'The elevator is next to the ____.', answer: 'lobby', options: ['lobby', 'menu', 'ticket'] },
    { sentence: 'My ____ does not open the door.', answer: 'key card', options: ['key card', 'platform', 'latte'] },
    { sentence: 'Is ____ included with the room?', answer: 'breakfast', options: ['breakfast', 'departure', 'waiter'] },
  ]},
  daily: { topic: 'Daily Conversation', questions: [
    { sentence: 'It was ____ to meet you.', answer: 'nice', options: ['nice', 'later', 'care'] },
    { sentence: '____ was your day?', answer: 'How', options: ['How', 'Where', 'When'] },
    { sentence: "I'll ____ you later.", answer: 'see', options: ['see', 'take', 'point'] },
    { sentence: 'Please ____ care on your trip.', answer: 'take', options: ['take', 'meet', 'switch'] },
    { sentence: "That's a really good ____.", answer: 'point', options: ['point', 'floor', 'ticket'] },
  ]},
  cafe: { topic: 'Café Order', questions: [
    { sentence: 'Can I get a small ____?', answer: 'latte', options: ['latte', 'lobby', 'ticket'] },
    { sentence: 'Is that for here or to ____?', answer: 'go', options: ['go', 'meet', 'floor'] },
    { sentence: 'Could you add less ____?', answer: 'ice', options: ['ice', 'menu', 'platform'] },
    { sentence: 'Do you have ____ milk?', answer: 'oat', options: ['oat', 'key', 'check'] },
    { sentence: 'Can I ____ up to a large?', answer: 'size', options: ['size', 'depart', 'reserve'] },
  ]},
};

function matchStarterPack(topic) {
  const t = (topic || '').toLowerCase();
  // Direct keyword match first (cheap, deterministic).
  for (const [key, pack] of Object.entries(STARTER_PACKS)) {
    if (t.includes(key)) return pack;
  }
  // Synonym mapping for common phrasings the model might use.
  const synonyms = {
    food: 'restaurant', dining: 'restaurant', ordering: 'restaurant', eat: 'restaurant',
    coffee: 'cafe', drink: 'cafe', beverage: 'cafe',
    direction: 'travel', transit: 'travel', subway: 'travel', train: 'travel', airport: 'travel',
    accommodation: 'hotel', stay: 'hotel', room: 'hotel',
    smalltalk: 'daily', small_talk: 'daily', chat: 'daily', greeting: 'daily', friend: 'daily',
  };
  for (const [syn, key] of Object.entries(synonyms)) {
    if (t.includes(syn)) return STARTER_PACKS[key];
  }
  return null;
}

export async function generateDrillTool({ topic, questions }) {
  let usedTopic = topic && typeof topic === 'string' && topic.trim() ? topic.trim() : null;
  let usedQuestions = Array.isArray(questions) ? questions : null;

  // Validate explicit questions if provided.
  if (usedQuestions) {
    if (usedQuestions.length === 0) usedQuestions = null;
    else {
      for (const q of usedQuestions) {
        if (!q || typeof q.sentence !== 'string' || typeof q.answer !== 'string' || !Array.isArray(q.options)) {
          return { output: 'error: each question must be {sentence: string, answer: string, options: string[]}' };
        }
      }
    }
  }

  // Fallback to starter pack when questions are missing.
  if (!usedQuestions) {
    const matched = matchStarterPack(usedTopic || '');
    if (!matched) {
      const available = Object.keys(STARTER_PACKS).join(', ');
      return {
        output: `error: no questions given and topic "${usedTopic || ''}" did not match a starter pack. Either provide questions as [{sentence, answer, options}, ...] or use a topic keyword like: ${available}`,
      };
    }
    usedQuestions = matched.questions;
    if (!usedTopic) usedTopic = matched.topic;
  }
  if (!usedTopic) usedTopic = 'Practice';

  let result;
  try {
    result = await createFillBlankArtifact({ topic: usedTopic, questions: usedQuestions });
  } catch (e) {
    return { output: `error creating drill: ${e.message}` };
  }

  // Mirror to app-state so subsequent get_app_state calls see the new drill
  // (parity with /artifact/fill-blank HTTP route — codex review P2).
  recordAppState({
    drill: {
      kind: 'fill_blank',
      topic: usedTopic,
      questions: usedQuestions,
      answered: 0,
      correct: 0,
      wrong: 0,
      completed: false,
    },
  });

  // Auto-switch the user to Drill tab AND force the WKWebView to reload from
  // /artifact/latest/. Without `reload_drill`, a user who'd already opened
  // Tab 2 would see the old drill — codex review P2.
  if (injectQueue) {
    injectQueue({ action: 'switch_tab', args: { tab: 1 } });
    injectQueue({ action: 'reload_drill', args: {} });
  }

  return {
    output: JSON.stringify({
      artifact_id: result.artifact_id,
      topic: usedTopic,
      questions_count: usedQuestions.length,
      tab_switched: true,
      message: `Drill ready: ${usedQuestions.length} ${usedTopic} fill-in-the-blank questions. The user is now on Tab 2.`,
    }),
  };
}
